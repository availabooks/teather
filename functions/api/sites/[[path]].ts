import { HttpError, json } from "../../../src/env";
import { deleteSiteSessions } from "../../../src/db";
import { validateBatch } from "../../../src/merge";
import { readJson, requireManage, route, type Ctx } from "../../../src/http";
import { siteForHost } from "../../../src/sites";
import { checkFileName, Store } from "../../../src/store";

/**
 * Manage page only.
 * GET    /api/sites                        list site folders
 * GET    /api/sites/:host                  that site's items and files
 * PUT    /api/sites/:host                  merge {items} into its state.json
 * DELETE /api/sites/:host                  delete & disconnect (folder to trash, site signed out everywhere)
 * DELETE /api/sites/:host/warnings         dismiss warnings
 * GET    /api/sites/:host/files/:name      download a file
 * DELETE /api/sites/:host/files/:name      move a file to trash
 */
function parts(ctx: Ctx): string[] {
  const p = ctx.params.path;
  return Array.isArray(p) ? p : p ? [p] : [];
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
      return json({ email: store.user.email, name: store.user.name, picture: store.user.picture, sites: await store.listSites() });
    }
    const site = knownSite(host);
    if (!sub) {
      const doc = await store.readState(site);
      return json({ items: doc.items, updatedAt: doc.updatedAt, files: await store.listFiles(site) });
    }
    if (sub === "files" && name && rest.length === 0) {
      checkFileName(name);
      return store.getFile(site, name);
    }
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
  if (!host || rest.length) throw new HttpError(404, "Not found", "not_found");
  return withStore(ctx, async (store) => {
    if (!sub) {
      // Sign the site out first, so its browser copies can't upload the data again.
      await deleteSiteSessions(ctx.env, store.user.sub, host);
      await store.deleteSite(host);
      return json({ ok: true });
    }
    if (sub === "warnings" && !name) {
      store.clearWarnings(host);
      return json({ ok: true });
    }
    if (sub === "files" && name) {
      checkFileName(name);
      await store.deleteFile(knownSite(host), name);
      return json({ ok: true });
    }
    throw new HttpError(404, "Not found", "not_found");
  });
});
