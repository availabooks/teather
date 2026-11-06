import { HttpError, json } from "../../../src/env";
import { hasServerAccess } from "../../../src/db";
import { route, type Ctx } from "../../../src/http";
import { verifyServerToken } from "../../../src/server-auth";
import type { Site } from "../../../src/sites";
import { checkDirPath, checkFilePath, MAX_FILE_BYTES, Store, writeConditions } from "../../../src/store";

/**
 * Routes a site's own server calls, never a browser. The caller proves it is the site with a
 * short-lived token signed by the site's registered key. It can only reach that site's folder,
 * and only for students who gave it permission on Teather's /grant page.
 *
 * GET    /api/server/users/:sub/grant              {granted}
 * GET    /api/server/users/:sub/list?dir=a/b       {files, folders}
 * GET    /api/server/users/:sub/files/<path>       download (ETag = Drive version)
 * PUT    /api/server/users/:sub/files/<path>       save (If-Match, If-None-Match: *)
 * DELETE /api/server/users/:sub/files/<path>       move to Drive trash (If-Match)
 */
async function authorize(ctx: Ctx): Promise<{ site: Site; sub: string; rest: string[]; op: string }> {
  if (ctx.request.headers.get("Origin")) throw new HttpError(403, "Server routes can't be called from a browser", "forbidden");
  const m = /^Bearer\s+(\S+)$/i.exec(ctx.request.headers.get("Authorization") ?? "");
  if (!m) throw new HttpError(401, "Missing server token", "bad_server_token");
  const site = await verifyServerToken(ctx.env, m[1], new URL(ctx.request.url).origin);

  const p = ctx.params.path;
  const parts = (Array.isArray(p) ? p : p ? [p] : []).map((s) => decodeURIComponent(s));
  if (parts[0] !== "users" || !parts[1] || !parts[2]) throw new HttpError(404, "Unknown server route", "not_found");
  const sub = parts[1];
  if (!/^[0-9A-Za-z_-]{1,255}$/.test(sub)) throw new HttpError(400, "Bad user id", "bad_request");
  return { site, sub, op: parts[2], rest: parts.slice(3) };
}

async function openFor(ctx: Ctx, site: Site, sub: string): Promise<Store> {
  if (!(await hasServerAccess(ctx.env, sub, site.host))) {
    throw new HttpError(403, "This person hasn't let the site's server use their folder", "no_server_grant");
  }
  try {
    return await Store.open(ctx.env, sub);
  } catch (e) {
    // Their Google access is gone (revoked, or they disconnected Teather).
    if (e instanceof HttpError && e.status === 401) {
      throw new HttpError(410, "This person's Google Drive is no longer connected to Teather", "user_disconnected");
    }
    throw e;
  }
}

async function run<T>(store: Store, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError && e.code === "google_revoked") {
      throw new HttpError(410, "This person's Google Drive is no longer connected to Teather", "user_disconnected");
    }
    throw e;
  } finally {
    await store.save();
  }
}

export const onRequestGet = route(async (ctx) => {
  const { site, sub, op, rest } = await authorize(ctx);
  if (op === "grant") return json({ granted: await hasServerAccess(ctx.env, sub, site.host) });
  if (op === "list") {
    const dirs = checkDirPath(new URL(ctx.request.url).searchParams.get("dir") ?? "");
    const store = await openFor(ctx, site, sub);
    return json(await run(store, () => store.listDir(site, dirs)));
  }
  if (op === "files" && rest.length) {
    const path = checkFilePath(rest);
    const store = await openFor(ctx, site, sub);
    return run(store, () => store.getFile(site, path));
  }
  throw new HttpError(404, "Unknown server route", "not_found");
});

export const onRequestPut = route(async (ctx) => {
  const { site, sub, op, rest } = await authorize(ctx);
  if (op !== "files" || !rest.length) throw new HttpError(404, "Unknown server route", "not_found");
  const path = checkFilePath(rest);
  const declared = Number(ctx.request.headers.get("Content-Length") ?? 0);
  if (declared > MAX_FILE_BYTES) throw new HttpError(413, "Files may be at most 10 MB", "file_too_large");
  const body = await ctx.request.arrayBuffer();
  const type = ctx.request.headers.get("Content-Type") || "application/octet-stream";
  const store = await openFor(ctx, site, sub);
  const file = await run(store, () => store.putFile(site, path, body, type, writeConditions(ctx.request)));
  return json({ file }, 200, file.version ? { ETag: `"${file.version}"` } : {});
});

export const onRequestDelete = route(async (ctx) => {
  const { site, sub, op, rest } = await authorize(ctx);
  if (op !== "files" || !rest.length) throw new HttpError(404, "Unknown server route", "not_found");
  const path = checkFilePath(rest);
  const store = await openFor(ctx, site, sub);
  await run(store, () => store.deleteFile(site, path, writeConditions(ctx.request)));
  return json({ ok: true });
});
