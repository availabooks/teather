import { HttpError, json } from "../../../src/env";
import { requireSite, route, type Ctx } from "../../../src/http";
import { checkFilePath, MAX_FILE_BYTES, Store, writeConditions } from "../../../src/store";

/**
 * GET    /api/files          list the files in this site's folder
 * GET    /api/files/:path    download one ("notes.txt" or "courses/abc/roster.json")
 * PUT    /api/files/:path    save one (raw body; optional If-Unmodified-Since, If-Match, If-None-Match: *)
 * DELETE /api/files/:path    move one to the student's Drive trash (optional If-Match)
 */
function filePath(ctx: Ctx): string[] | null {
  const p = ctx.params.name;
  const parts = Array.isArray(p) ? p : p ? [p] : [];
  if (parts.length === 0) return null;
  return checkFilePath(parts);
}

export const onRequestGet = route(async (ctx) => {
  const { session, site } = await requireSite(ctx);
  const path = filePath(ctx);
  const store = await Store.open(ctx.env, session.sub);
  try {
    return path ? await store.getFile(site, path) : json({ files: await store.listFiles(site) });
  } finally {
    await store.save();
  }
});

export const onRequestPut = route(async (ctx) => {
  const { session, site } = await requireSite(ctx);
  const path = filePath(ctx);
  if (!path) throw new HttpError(400, "PUT /api/files/<name>", "bad_name");
  const declared = Number(ctx.request.headers.get("Content-Length") ?? 0);
  if (declared > MAX_FILE_BYTES) throw new HttpError(413, "Files may be at most 10 MB", "file_too_large");
  const body = await ctx.request.arrayBuffer();
  const type = ctx.request.headers.get("Content-Type") || "application/octet-stream";
  const store = await Store.open(ctx.env, session.sub);
  try {
    const file = await store.putFile(site, path, body, type, writeConditions(ctx.request));
    return json({ file });
  } finally {
    await store.save();
  }
});

export const onRequestDelete = route(async (ctx) => {
  const { session, site } = await requireSite(ctx);
  const path = filePath(ctx);
  if (!path) throw new HttpError(400, "DELETE /api/files/<name>", "bad_name");
  const store = await Store.open(ctx.env, session.sub);
  try {
    await store.deleteFile(site, path, writeConditions(ctx.request));
    return json({ ok: true });
  } finally {
    await store.save();
  }
});
