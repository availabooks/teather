import { HttpError } from "./env";

/** Thin wrapper over the Drive v3 REST API. With the drive.file scope it only sees files teather created. */

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
export const FOLDER_MIME = "application/vnd.google-apps.folder";

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  version?: string;
  trashed?: boolean;
  parents?: string[];
}

const FIELDS = "id,name,mimeType,size,modifiedTime,version,trashed,parents";

export class Drive {
  constructor(private token: string) {}

  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.token}`);
    const res = await fetch(url, { ...init, headers });
    if (res.status === 404) return res;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 401) throw new HttpError(401, "Google access was revoked", "google_revoked");
      if (res.status === 403 && /storageQuotaExceeded/.test(text)) {
        throw new HttpError(507, "Your Google Drive is full", "drive_full");
      }
      throw new HttpError(502, `Google Drive error ${res.status}: ${text.slice(0, 300)}`, "drive_error");
    }
    return res;
  }

  /** File metadata, or null if it is missing or in the trash. */
  async get(id: string): Promise<DriveFile | null> {
    const res = await this.call(`${API}/files/${encodeURIComponent(id)}?fields=${FIELDS}`);
    if (res.status === 404) return null;
    const f = (await res.json()) as DriveFile;
    return f.trashed ? null : f;
  }

  async list(q: string): Promise<DriveFile[]> {
    const out: DriveFile[] = [];
    let pageToken = "";
    do {
      const p = new URLSearchParams({ q, fields: `nextPageToken,files(${FIELDS})`, pageSize: "1000", spaces: "drive" });
      if (pageToken) p.set("pageToken", pageToken);
      const res = await this.call(`${API}/files?${p}`);
      const body = (await res.json()) as { files: DriveFile[]; nextPageToken?: string };
      out.push(...body.files);
      pageToken = body.nextPageToken ?? "";
    } while (pageToken);
    return out;
  }

  children(parentId: string): Promise<DriveFile[]> {
    return this.list(`'${q(parentId)}' in parents and trashed = false`);
  }

  async findChild(parentId: string, name: string, folder = false): Promise<DriveFile | null> {
    const mime = folder ? ` and mimeType = '${FOLDER_MIME}'` : ` and mimeType != '${FOLDER_MIME}'`;
    const files = await this.list(`'${q(parentId)}' in parents and name = '${q(name)}' and trashed = false${mime}`);
    files.sort((a, b) => (b.modifiedTime ?? "").localeCompare(a.modifiedTime ?? ""));
    return files[0] ?? null;
  }

  async createFolder(name: string, parentId: string): Promise<DriveFile> {
    const res = await this.call(`${API}/files?fields=${FIELDS}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
    });
    return res.json();
  }

  async findOrCreateFolder(name: string, parentId: string): Promise<{ folder: DriveFile; created: boolean }> {
    const found = await this.findChild(parentId, name, true);
    if (found) return { folder: found, created: false };
    return { folder: await this.createFolder(name, parentId), created: true };
  }

  async create(parentId: string, name: string, mimeType: string, body: string | ArrayBuffer): Promise<DriveFile> {
    const boundary = `teather${crypto.randomUUID().replace(/-/g, "")}`;
    const enc = new TextEncoder();
    const head = enc.encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        JSON.stringify({ name, parents: [parentId], mimeType }) +
        `\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    );
    const content = typeof body === "string" ? enc.encode(body) : new Uint8Array(body);
    const tail = enc.encode(`\r\n--${boundary}--`);
    const all = new Uint8Array(head.length + content.length + tail.length);
    all.set(head);
    all.set(content, head.length);
    all.set(tail, head.length + content.length);
    const res = await this.call(`${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}`, {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body: all,
    });
    return res.json();
  }

  async update(id: string, mimeType: string, body: string | ArrayBuffer): Promise<DriveFile> {
    const res = await this.call(`${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=media&fields=${FIELDS}`, {
      method: "PATCH",
      headers: { "Content-Type": mimeType },
      body,
    });
    if (res.status === 404) throw new HttpError(409, "File disappeared while saving", "conflict");
    return res.json();
  }

  async rename(id: string, name: string): Promise<void> {
    await this.call(`${API}/files/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  }

  /** Moves to the student's Drive trash, so they can still recover it for 30 days. */
  async trash(id: string): Promise<void> {
    await this.call(`${API}/files/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trashed: true }),
    });
  }

  async download(id: string): Promise<Response> {
    const res = await this.call(`${API}/files/${encodeURIComponent(id)}?alt=media`);
    if (res.status === 404) throw new HttpError(404, "File not found", "not_found");
    return res;
  }

  async text(id: string): Promise<string> {
    return (await this.download(id)).text();
  }
}

/** Escape a value for use inside single quotes in a Drive query. */
function q(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function folderUrl(id: string): string {
  return `https://drive.google.com/drive/folders/${id}`;
}
