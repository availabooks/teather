import { HttpError, json } from "../../../src/env";
import { requireSite, route, type Ctx } from "../../../src/http";
import { checkFileName, MAX_FILE_BYTES, Store } from "../../../src/store";

/**
 * GET    /api/files         list this site's files
 * GET    /api/files/:name   download one
 * PUT    /api/files/:name   save one (raw body; optional If-Unmodified-Since)
 * DELETE /api/files/:name   move one to the student's Drive trash
 */
function fileName(ctx: Ctx): string | null {
  const p = ctx.params.name;
  const parts = Array.isArray(p) ? p : p ? [p] : [];
  if (parts.length === 0) return null;
  if (parts.length > 1) throw new HttpError(400, "Folders inside a site folder are not supported", "bad_name");
  checkFileName(parts[0]);
  return parts[0];
}

export const onRequestGet = route(async (ctx) => {
  const { session, site } = await requireSite(ctx);
  const name = fileName(ctx);
  const store = await Store.open(ctx.env, session.sub);
  try {
    return name ? await store.getFile(site, name) : json({ files: await store.listFiles(site) });
  } finally {
    await store.save();
  }
});

export const onRequestPut = route(async (ctx) => {
  const { session, site } = await requireSite(ctx);
  const name = fileName(ctx);
  if (!name) throw new HttpError(400, "PUT /api/files/<name>", "bad_name");
  const declared = Number(ctx.request.headers.get("Content-Length") ?? 0);
  if (declared > MAX_FILE_BYTES) throw new HttpError(413, "Files may be at most 10 MB", "file_too_large");
  const body = await ctx.request.arrayBuffer();
  const type = ctx.request.headers.get("Content-Type") || "application/octet-stream";
  const store = await Store.open(ctx.env, session.sub);
  try {
    const file = await store.putFile(site, name, body, type, ctx.request.headers.get("If-Unmodified-Since"));
    return json({ file });
  } finally {
    await store.save();
  }
});

export const onRequestDelete = route(async (ctx) => {
  const { session, site } = await requireSite(ctx);
  const name = fileName(ctx);
  if (!name) throw new HttpError(400, "DELETE /api/files/<name>", "bad_name");
  const store = await Store.open(ctx.env, session.sub);
  try {
    await store.deleteFile(site, name);
    return json({ ok: true });
  } finally {
    await store.save();
  }
});
