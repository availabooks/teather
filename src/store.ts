import type { Env } from "./env";
import { HttpError } from "./env";
import { Drive, type DriveFile, FOLDER_MIME, folderUrl } from "./drive";
import { type User, type SiteRecord, accessToken, getUser, saveUserData } from "./db";
import { type Item, type StateDoc, emptyState, mergeInto, parseState, serializeState } from "./merge";
import { type Site, siteForHost } from "./sites";
import { ROOT_README_VERSION, rootReadme, siteReadme } from "./readme";

export const ROOT_FOLDER = "Teather";
export const STATE_FILE = "state.json";
export const README_FILE = "README.md";
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

const FILE_NAME = /^[A-Za-z0-9._-]{1,100}$/;
export const MAX_PATH_DEPTH = 5;

function isReserved(name: string) {
  const lower = name.toLowerCase();
  return lower === "readme.md" || lower === "state.json" || lower.startsWith("state.broken-");
}

function checkSegment(name: string) {
  if (!FILE_NAME.test(name) || name === "." || name === "..") {
    throw new HttpError(400, "File names may use letters, digits, '.', '_' and '-', up to 100 characters", "bad_name");
  }
}

export function checkFileName(name: string) {
  checkSegment(name);
  if (isReserved(name)) throw new HttpError(403, `"${name}" is reserved by Teather`, "reserved_name");
}

/**
 * A file path inside a site folder: up to 5 names joined by "/", such as "courses/abc/roster.json".
 * Only top-level names can be reserved, so "notes/state.json" is fine.
 */
export function checkFilePath(path: string | string[]): string[] {
  const parts = Array.isArray(path) ? path : path.split("/");
  if (parts.length === 0 || parts.length > MAX_PATH_DEPTH) {
    throw new HttpError(400, `Paths may have at most ${MAX_PATH_DEPTH} parts`, "bad_name");
  }
  parts.forEach(checkSegment);
  if (parts.length === 1) checkFileName(parts[0]);
  return parts;
}

/** A folder path for listing: "" (the site folder) or up to 4 names joined by "/". */
export function checkDirPath(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  if (parts.length >= MAX_PATH_DEPTH) throw new HttpError(400, "That folder is too deep", "bad_name");
  parts.forEach(checkSegment);
  return parts;
}

export interface FileInfo {
  name: string;
  size: number;
  modifiedTime: string | undefined;
  contentType: string;
  /** Drive's version number for the file. It changes on every write; use it with If-Match. */
  version: string | undefined;
}

function info(f: DriveFile, size?: number): FileInfo {
  return { name: f.name, size: Number(f.size ?? size ?? 0), modifiedTime: f.modifiedTime, contentType: f.mimeType, version: f.version };
}

export interface WriteConditions {
  /** An HTTP date: fail if the file changed after it. */
  ifUnmodifiedSince?: string | null;
  /** Fail unless the file exists with one of these Drive versions ("*" for any). */
  ifMatch?: string | null;
  /** "*": fail if the file already exists. */
  ifNoneMatch?: string | null;
}

/** The write conditions a request's headers ask for. */
export function writeConditions(request: Request): WriteConditions {
  return {
    ifUnmodifiedSince: request.headers.get("If-Unmodified-Since"),
    ifMatch: request.headers.get("If-Match"),
    ifNoneMatch: request.headers.get("If-None-Match"),
  };
}

function unquote(v: string): string {
  return v.trim().replace(/^W\//, "").replace(/^"(.*)"$/, "$1");
}

/** Throw 412 if the file doesn't meet the caller's conditions. */
export function checkConditions(existing: DriveFile | null, c: WriteConditions) {
  const fail = () => {
    throw new HttpError(412, "The file was changed since you last read it", "precondition_failed");
  };
  if (c.ifNoneMatch && c.ifNoneMatch.trim() === "*" && existing) fail();
  if (c.ifMatch) {
    const wanted = c.ifMatch.split(",").map(unquote);
    if (!existing || !(wanted.includes("*") || (existing.version !== undefined && wanted.includes(existing.version)))) fail();
  }
  if (existing && c.ifUnmodifiedSince) {
    const since = Date.parse(c.ifUnmodifiedSince);
    // HTTP dates have 1-second precision.
    if (!Number.isNaN(since) && Math.floor(Date.parse(existing.modifiedTime ?? "") / 1000) > Math.floor(since / 1000)) fail();
  }
}

/**
 * One student's Teather folder. The ids cached in the user record are only a
 * shortcut: anything missing is found again (or recreated) in Drive.
 */
export class Store {
  private dirty = false;

  private constructor(private env: Env, public user: User, private drive: Drive) {}

  static async open(env: Env, sub: string): Promise<Store> {
    const user = await getUser(env, sub);
    if (!user) throw new HttpError(401, "Please sign in again", "signed_out");
    return new Store(env, user, new Drive(await accessToken(env, sub)));
  }

  /** Save any changed folder ids or README versions. */
  async save() {
    if (this.dirty) await saveUserData(this.env, this.user.sub, this.user.data);
    this.dirty = false;
  }

  private rec(host: string): SiteRecord {
    return (this.user.data.sites[host] ??= {});
  }

  // ---- folders ----

  private async root(): Promise<string> {
    const d = this.user.data;
    if (d.rootFolderId && (await this.drive.get(d.rootFolderId))) return d.rootFolderId;
    const { folder } = await this.drive.findOrCreateFolder(ROOT_FOLDER, "root");
    d.rootFolderId = folder.id;
    d.rootReadmeId = undefined;
    d.rootReadmeSites = undefined;
    this.dirty = true;
    return folder.id;
  }

  /** The site's folder, created if needed, with READMEs brought up to date. */
  async siteFolder(site: Site): Promise<string> {
    const rec = this.rec(site.host);
    if (!rec.folderId || !(await this.drive.get(rec.folderId))) {
      const { folder, created } = await this.drive.findOrCreateFolder(site.host, await this.root());
      rec.folderId = folder.id;
      rec.stateFileId = undefined;
      if (created) rec.readmeVersion = 0;
      this.dirty = true;
    }
    await this.ensureReadmes(site);
    return rec.folderId;
  }

  private async writeTextFile(parentId: string, name: string, knownId: string | undefined, text: string, mime: string) {
    let id = knownId && (await this.drive.get(knownId)) ? knownId : (await this.drive.findChild(parentId, name))?.id;
    if (id) await this.drive.update(id, mime, text);
    else id = (await this.drive.create(parentId, name, mime, text)).id;
    return id;
  }

  private async ensureReadmes(site: Site) {
    const rec = this.rec(site.host);
    if (rec.folderId && rec.readmeVersion !== site.version) {
      rec.readmeId = await this.writeTextFile(rec.folderId, README_FILE, rec.readmeId, siteReadme(site), "text/markdown");
      rec.readmeVersion = site.version;
      this.dirty = true;
    }
    const d = this.user.data;
    const hosts = Object.keys(d.sites).filter((h) => d.sites[h].folderId).sort();
    if (d.rootReadmeVersion !== ROOT_README_VERSION || JSON.stringify(d.rootReadmeSites) !== JSON.stringify(hosts)) {
      const rootId = await this.root();
      const listed = hosts.flatMap((h) => {
        const s = siteForHost(h);
        return s ? [{ site: s, folderId: d.sites[h].folderId! }] : [];
      });
      d.rootReadmeId = await this.writeTextFile(rootId, README_FILE, d.rootReadmeId, rootReadme(listed), "text/markdown");
      d.rootReadmeSites = hosts;
      d.rootReadmeVersion = ROOT_README_VERSION;
      this.dirty = true;
    }
  }

  // ---- state.json ----

  private async stateFile(site: Site): Promise<DriveFile> {
    const rec = this.rec(site.host);
    const readmesCurrent = rec.readmeVersion === site.version && this.user.data.rootReadmeVersion === ROOT_README_VERSION;
    if (rec.stateFileId && readmesCurrent) {
      const f = await this.drive.get(rec.stateFileId);
      if (f) return f;
    }
    const folderId = await this.siteFolder(site);
    const f =
      (await this.drive.findChild(folderId, STATE_FILE)) ??
      (await this.drive.create(folderId, STATE_FILE, "application/json", serializeState(emptyState(site.host))));
    rec.stateFileId = f.id;
    this.dirty = true;
    return f;
  }

  /** Read and parse state.json. A file that can't be parsed is kept as a backup and replaced. */
  private async load(site: Site): Promise<{ file: DriveFile; doc: StateDoc }> {
    const file = await this.stateFile(site);
    const doc = parseState(await this.drive.text(file.id));
    if (doc) return { file, doc };

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backup = `state.broken-${stamp}.json`;
    await this.drive.rename(file.id, backup);
    const fresh = await this.drive.create(this.rec(site.host).folderId!, STATE_FILE, "application/json", serializeState(emptyState(site.host)));
    const rec = this.rec(site.host);
    rec.stateFileId = fresh.id;
    rec.warnings = [...(rec.warnings ?? []), `state.json could not be read, so it was saved as ${backup} and a new one was started.`].slice(-5);
    this.dirty = true;
    return { file: fresh, doc: emptyState(site.host) };
  }

  async readState(site: Site): Promise<StateDoc> {
    return (await this.load(site)).doc;
  }

  /**
   * Merge items into state.json. If the file changes while we work (another device,
   * the student's Sheet), start over, up to three times.
   */
  async writeState(site: Site, incoming: Record<string, Item>): Promise<StateDoc> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { file, doc } = await this.load(site);
      const { doc: merged, changed } = mergeInto(doc, incoming);
      if (!changed) return merged;
      const text = serializeState(merged);
      const now = await this.drive.get(file.id);
      if (!now || now.version !== file.version) continue;
      await this.drive.update(file.id, "application/json", text);
      return merged;
    }
    throw new HttpError(409, "The data changed while saving. Please try again.", "conflict");
  }

  // ---- other files ----

  /**
   * The folder at `dirs` inside the site folder. With `create`, missing folders are made;
   * otherwise a missing folder gives null. Folder ids are cached in the user record.
   */
  private async dir(site: Site, dirs: string[], create: boolean): Promise<string | null> {
    let id = await this.siteFolder(site);
    if (dirs.length === 0) return id;
    const rec = this.rec(site.host);
    rec.folders ??= {};
    for (let i = 0; i < dirs.length; i++) {
      const key = dirs.slice(0, i + 1).join("/");
      const cached = rec.folders[key];
      if (cached && (await this.drive.get(cached))?.parents?.includes(id)) {
        id = cached;
        continue;
      }
      const found = create ? (await this.drive.findOrCreateFolder(dirs[i], id)).folder : await this.drive.findChild(id, dirs[i], true);
      if (!found) return null;
      rec.folders[key] = found.id;
      this.dirty = true;
      id = found.id;
    }
    return id;
  }

  private async findFile(site: Site, path: string[]): Promise<DriveFile | null> {
    const folderId = await this.dir(site, path.slice(0, -1), false);
    return folderId ? this.drive.findChild(folderId, path[path.length - 1]) : null;
  }

  /** Files directly inside a folder (the site folder by default), and the names of its subfolders. */
  async listDir(site: Site, dirs: string[] = []): Promise<{ files: FileInfo[]; folders: string[] }> {
    const folderId = await this.dir(site, dirs, false);
    if (!folderId) return { files: [], folders: [] };
    const children = await this.drive.children(folderId);
    return {
      files: children.filter((f) => f.mimeType !== FOLDER_MIME && !(dirs.length === 0 && isReserved(f.name))).map((f) => info(f)),
      folders: children.filter((f) => f.mimeType === FOLDER_MIME).map((f) => f.name).sort(),
    };
  }

  /** Files in the site folder itself (what teather.js files.list() has always returned). */
  async listFiles(site: Site): Promise<Omit<FileInfo, "version">[]> {
    return (await this.listDir(site)).files.map(({ version: _v, ...f }) => f);
  }

  /**
   * Every file in the site folder and its subfolders (up to the path depth limit), named by path,
   * such as "projects/photos/a.jpg". One Drive query per folder level, not per folder.
   */
  async listAllFiles(site: Site): Promise<Omit<FileInfo, "version">[]> {
    const out: Omit<FileInfo, "version">[] = [];
    let level = new Map<string, string>([[await this.siteFolder(site), ""]]); // folder id -> path prefix
    for (let depth = 0; depth < MAX_PATH_DEPTH && level.size; depth++) {
      const next = new Map<string, string>();
      for (const f of await this.drive.childrenOfAny([...level.keys()])) {
        const parent = f.parents?.find((p) => level.has(p));
        if (parent === undefined) continue;
        const prefix = level.get(parent)!;
        if (f.mimeType === FOLDER_MIME) {
          if (depth < MAX_PATH_DEPTH - 1) next.set(f.id, `${prefix}${f.name}/`);
        } else if (!(depth === 0 && isReserved(f.name))) {
          const { version: _v, ...rest } = info(f);
          out.push({ ...rest, name: prefix + f.name });
        }
      }
      level = next;
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getFile(site: Site, path: string | string[]): Promise<Response> {
    const f = await this.findFile(site, checkFilePath(path));
    if (!f) throw new HttpError(404, "File not found", "not_found");
    const body = await this.drive.download(f.id);
    const headers: Record<string, string> = {
      "Content-Type": f.mimeType || "application/octet-stream",
      "Last-Modified": new Date(f.modifiedTime ?? Date.now()).toUTCString(),
      "Content-Disposition": `attachment; filename="${f.name}"`,
    };
    if (f.version) headers.ETag = `"${f.version}"`;
    return new Response(body.body, { headers });
  }

  async putFile(site: Site, path: string | string[], body: ArrayBuffer, contentType: string, cond: WriteConditions | string | null = {}) {
    // Older callers passed If-Unmodified-Since as a plain string.
    const c: WriteConditions = typeof cond === "string" || cond === null ? { ifUnmodifiedSince: cond } : cond;
    if (body.byteLength > MAX_FILE_BYTES) throw new HttpError(413, "Files may be at most 10 MB", "file_too_large");
    const parts = checkFilePath(path);
    const folderId = (await this.dir(site, parts.slice(0, -1), true))!;
    const name = parts[parts.length - 1];
    const existing = await this.drive.findChild(folderId, name);
    checkConditions(existing, c);
    const f = existing ? await this.drive.update(existing.id, contentType, body) : await this.drive.create(folderId, name, contentType, body);
    return info(f, body.byteLength);
  }

  async deleteFile(site: Site, path: string | string[], cond: WriteConditions = {}) {
    const f = await this.findFile(site, checkFilePath(path));
    if (!f) throw new HttpError(404, "File not found", "not_found");
    checkConditions(f, cond);
    await this.drive.trash(f.id);
  }

  // ---- whole sites (manage page) ----

  /** Site folders inside Teather/, with what the registry says about each. */
  async listSites() {
    const rootId = await this.root();
    const folders = (await this.drive.children(rootId)).filter((f) => f.mimeType === FOLDER_MIME);
    return folders.map((f) => {
      const site = siteForHost(f.name);
      const rec = this.user.data.sites[f.name];
      if (rec && rec.folderId !== f.id) {
        rec.folderId = f.id;
        this.dirty = true;
      }
      return {
        host: f.name,
        name: site?.name ?? f.name,
        url: site?.url ?? null,
        description: site?.description ?? "This folder is not from a site Teather knows about.",
        known: !!site,
        folderUrl: folderUrl(f.id),
        warnings: rec?.warnings ?? [],
      };
    });
  }

  clearWarnings(host: string) {
    const rec = this.user.data.sites[host];
    if (rec?.warnings?.length) {
      rec.warnings = [];
      this.dirty = true;
    }
  }

  /** Move the site's folder to the Drive trash and update the root README. */
  async deleteSite(host: string) {
    const rootId = await this.root();
    const rec = this.user.data.sites[host];
    const folder = (rec?.folderId && (await this.drive.get(rec.folderId))) || (await this.drive.findChild(rootId, host, true));
    if (folder) await this.drive.trash(folder.id);
    delete this.user.data.sites[host];
    this.dirty = true;
    const d = this.user.data;
    const hosts = Object.keys(d.sites).filter((h) => d.sites[h].folderId).sort();
    const listed = hosts.flatMap((h) => {
      const s = siteForHost(h);
      return s ? [{ site: s, folderId: d.sites[h].folderId! }] : [];
    });
    d.rootReadmeId = await this.writeTextFile(rootId, README_FILE, d.rootReadmeId, rootReadme(listed), "text/markdown");
    d.rootReadmeSites = hosts;
    d.rootReadmeVersion = ROOT_README_VERSION;
  }
}
