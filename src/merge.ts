import { HttpError } from "./env";

/** A stored value. `value: null` is a deletion marker, kept so other devices learn about it. */
export interface Item {
  value: unknown;
  updatedAt: number;
}

export interface StateDoc {
  teather: 1;
  site: string;
  updatedAt: number;
  items: Record<string, Item>;
}

export const LIMITS = {
  maxKeyLength: 200,
  maxValueBytes: 256 * 1024,
  maxStateBytes: 5 * 1024 * 1024,
  maxBatch: 50,
  /** Deletion markers older than this are dropped. */
  tombstoneMs: 90 * 24 * 60 * 60 * 1000,
  /** Clocks can be off; never accept times further ahead than this. */
  futureSkewMs: 5 * 60 * 1000,
};

export function emptyState(site: string, now = Date.now()): StateDoc {
  return { teather: 1, site, updatedAt: now, items: {} };
}

/** Parse state.json. Returns null if the text is not a valid teather state file. */
export function parseState(text: string): StateDoc | null {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== "object") return null;
  const d = doc as Partial<StateDoc>;
  if (!d.items || typeof d.items !== "object" || Array.isArray(d.items)) return null;
  const items: Record<string, Item> = {};
  for (const [k, v] of Object.entries(d.items)) {
    // Be forgiving about hand edits: a bare value becomes an item dated 0.
    if (v && typeof v === "object" && "value" in v) {
      const it = v as Item;
      items[k] = { value: it.value ?? null, updatedAt: Number(it.updatedAt) || 0 };
    } else {
      items[k] = { value: v ?? null, updatedAt: 0 };
    }
  }
  return {
    teather: 1,
    site: typeof d.site === "string" ? d.site : "",
    updatedAt: Number(d.updatedAt) || 0,
    items,
  };
}

/** Check and normalise an incoming {items} batch from a client. */
export function validateBatch(body: unknown, now = Date.now()): Record<string, Item> {
  if (!body || typeof body !== "object" || !("items" in body)) {
    throw new HttpError(400, "Body must be {items: {key: {value, updatedAt}}}", "bad_request");
  }
  const raw = (body as { items: unknown }).items;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new HttpError(400, "items must be an object", "bad_request");
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > LIMITS.maxBatch) {
    throw new HttpError(413, `At most ${LIMITS.maxBatch} items per request`, "too_many_items");
  }
  const out: Record<string, Item> = {};
  for (const [key, v] of entries) {
    if (!key || key.length > LIMITS.maxKeyLength) {
      throw new HttpError(400, `Keys must be 1-${LIMITS.maxKeyLength} characters`, "bad_key");
    }
    if (!v || typeof v !== "object" || !("value" in v)) {
      throw new HttpError(400, `Item "${key}" must be {value, updatedAt}`, "bad_request");
    }
    const it = v as Item;
    const value = it.value === undefined ? null : it.value;
    const size = new TextEncoder().encode(JSON.stringify(value)).length;
    if (size > LIMITS.maxValueBytes) {
      throw new HttpError(413, `Item "${key}" is larger than ${LIMITS.maxValueBytes / 1024} KB`, "value_too_large");
    }
    let updatedAt = Number(it.updatedAt);
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) updatedAt = now;
    updatedAt = Math.min(updatedAt, now + LIMITS.futureSkewMs);
    out[key] = { value, updatedAt };
  }
  return out;
}

/**
 * Merge incoming items into a state document, key by key; the newer updatedAt wins.
 * Ties go to the incoming item. Returns a new document and whether anything changed.
 */
export function mergeInto(doc: StateDoc, incoming: Record<string, Item>, now = Date.now()) {
  const items = { ...doc.items };
  let changed = false;
  for (const [key, item] of Object.entries(incoming)) {
    const cur = items[key];
    if (!cur || item.updatedAt >= cur.updatedAt) {
      if (!cur || cur.updatedAt !== item.updatedAt || JSON.stringify(cur.value) !== JSON.stringify(item.value)) {
        items[key] = item;
        changed = true;
      }
    }
  }
  // Drop old deletion markers.
  for (const [key, item] of Object.entries(items)) {
    if (item.value === null && now - item.updatedAt > LIMITS.tombstoneMs) {
      delete items[key];
      changed = true;
    }
  }
  const out: StateDoc = { ...doc, items, updatedAt: changed ? now : doc.updatedAt };
  return { doc: out, changed };
}

export function serializeState(doc: StateDoc): string {
  const text = JSON.stringify(doc, null, 2);
  if (new TextEncoder().encode(text).length > LIMITS.maxStateBytes) {
    throw new HttpError(413, `This site's saved data would exceed ${LIMITS.maxStateBytes / 1024 / 1024} MB`, "state_too_large");
  }
  return text;
}

/** Pick some keys (or all) from a document. */
export function pick(doc: StateDoc, keys?: string[]): Record<string, Item> {
  if (!keys) return doc.items;
  const out: Record<string, Item> = {};
  for (const k of keys) if (doc.items[k]) out[k] = doc.items[k];
  return out;
}
