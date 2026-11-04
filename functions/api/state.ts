import { json } from "../../src/env";
import { pick, validateBatch } from "../../src/merge";
import { readJson, requireSite, route } from "../../src/http";
import { Store } from "../../src/store";

/** GET /api/state[?keys=a,b] — this site's saved items. Deleted items come back with value null. */
export const onRequestGet = route(async (ctx) => {
  const { session, site } = await requireSite(ctx);
  const store = await Store.open(ctx.env, session.sub);
  try {
    const doc = await store.readState(site);
    const keys = new URL(ctx.request.url).searchParams.get("keys");
    return json({ items: pick(doc, keys ? keys.split(",").filter(Boolean) : undefined), updatedAt: doc.updatedAt });
  } finally {
    await store.save();
  }
});

/** PUT /api/state {items: {key: {value, updatedAt}}} — merge; returns the stored version of each key sent. */
export const onRequestPut = route(async (ctx) => {
  const { session, site } = await requireSite(ctx);
  const incoming = validateBatch(await readJson(ctx.request));
  const store = await Store.open(ctx.env, session.sub);
  try {
    const doc = await store.writeState(site, incoming);
    return json({ items: pick(doc, Object.keys(incoming)), updatedAt: doc.updatedAt });
  } finally {
    await store.save();
  }
});
