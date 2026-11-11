import { HttpError, json } from "../../../src/env";
import { deleteSiteSessions, listServerGrants, revokeServerAccess } from "../../../src/db";
import { validateBatch } from "../../../src/merge";
import { readJson, requireManage, route, type Ctx } from "../../../src/http";
import { siteForHost } from "../../../src/sites";
import { checkFilePath, Store } from "../../../src/store";

/**
 * Manage page only.
 * GET    /api/sites                        list site folders
 * GET    /api/sites/:host                  that site's items and files
 * PUT    /api/sites/:host                  merge {items} into its state.json
 * DELETE /api/sites/:host                  delete & disconnect (folder to trash, site signed out everywhere)
 * DELETE /api/sites/:host/warnings         dismiss warnings
 * DELETE /api/sites/:host/server-access    take back the site server's access to the folder
 * GET    /api/sites/:host/files/<path>     download a file; <path> may include folders, as "projects/photos/a.jpg"
 * DELETE /api/sites/:host/files/<path>     move a file to trash
 */
function parts(ctx: Ctx): string[] {
  const p = ctx.params.path;
  return Array.isArray(p) ? p : p ? [p] : [];
}

/** The file path after /files/, whether its slashes came as path segments or encoded as %2F in one. */
function filePath(segments: string[]): string[] {
  return checkFilePath(segments.join("/"));
}

function knownSite(host: string) {
  const site = siteForHost(host);
  if (!site) throw new HttpError(404, "Teather doesn't know this site, so it can only delete its folder", "unknown_site");
  return site;
}

async function withStore<T>(ctx: Ctx, fn: (store: Store) => Promise<T>): Promise<T> {
  const session = await requireManage(ctx);
  const store = await Store.open(ctx.env, session.sub);
  try {
    return await fn(store);
  } finally {
    await store.save();
  }
}

export const onRequestGet = route(async (ctx) => {
  const [host, sub, name, ...rest] = parts(ctx);
  return withStore(ctx, async (store) => {
    if (!host) {
      const granted = new Set((await listServerGrants(ctx.env, store.user.sub)).map((g) => g.host));
      const sites = (await store.listSites()).map((s) => ({ ...s, serverAccess: granted.has(s.host) }));
      return json({ email: store.user.email, name: store.user.name, picture: store.user.picture, sites });
    }
    const site = knownSite(host);
    if (!sub) {
      const doc = await store.readState(site);
      return json({ items: doc.items, updatedAt: doc.updatedAt, files: await store.listAllFiles(site) });
    }
    if (sub === "files" && name) return store.getFile(site, filePath([name, ...rest]));
    throw new HttpError(404, "Not found", "not_found");
  });
});

export const onRequestPut = route(async (ctx) => {
  const [host, ...rest] = parts(ctx);
  if (!host || rest.length) throw new HttpError(404, "Not found", "not_found");
  const site = knownSite(host);
  const incoming = validateBatch(await readJson(ctx.request));
  return withStore(ctx, async (store) => {
    const doc = await store.writeState(site, incoming);
    return json({ items: doc.items, updatedAt: doc.updatedAt });
  });
});

export const onRequestDelete = route(async (ctx) => {
  const [host, sub, name, ...rest] = parts(ctx);
  if (!host || (rest.length && sub !== "files")) throw new HttpError(404, "Not found", "not_found");
  return withStore(ctx, async (store) => {
    if (!sub) {
      // Sign the site out first, so its browser copies can't upload the data again.
      await deleteSiteSessions(ctx.env, store.user.sub, host);
      await revokeServerAccess(ctx.env, store.user.sub, host);
      await store.deleteSite(host);
      return json({ ok: true });
    }
    if (sub === "server-access" && !name) {
      await revokeServerAccess(ctx.env, store.user.sub, host);
      return json({ ok: true });
    }
    if (sub === "warnings" && !name) {
      store.clearWarnings(host);
      return json({ ok: true });
    }
    if (sub === "files" && name) {
      await store.deleteFile(knownSite(host), filePath([name, ...rest]));
      return json({ ok: true });
    }
    throw new HttpError(404, "Not found", "not_found");
  });
});
