import { describe, expect, it } from "vitest";
import { emptyState, LIMITS, mergeInto, parseState, serializeState, validateBatch } from "../src/merge";

const NOW = 1_800_000_000_000;

describe("mergeInto", () => {
  it("keeps the newer value per key", () => {
    const doc = { ...emptyState("s", 1), items: { a: { value: 1, updatedAt: 100 }, b: { value: "old", updatedAt: 300 } } };
    const { doc: out, changed } = mergeInto(doc, { a: { value: 2, updatedAt: 200 }, b: { value: "older", updatedAt: 200 } }, NOW);
    expect(changed).toBe(true);
    expect(out.items.a).toEqual({ value: 2, updatedAt: 200 });
    expect(out.items.b).toEqual({ value: "old", updatedAt: 300 });
    expect(out.updatedAt).toBe(NOW);
  });

  it("reports no change for identical items", () => {
    const doc = { ...emptyState("s", 1), items: { a: { value: { x: 1 }, updatedAt: 100 } } };
    const { changed, doc: out } = mergeInto(doc, { a: { value: { x: 1 }, updatedAt: 100 } }, NOW);
    expect(changed).toBe(false);
    expect(out.updatedAt).toBe(1);
  });

  it("keeps deletion markers so other devices learn about them", () => {
    const doc = { ...emptyState("s", 1), items: { a: { value: 1, updatedAt: NOW - 300 } } };
    const { doc: out } = mergeInto(doc, { a: { value: null, updatedAt: NOW - 200 } }, NOW);
    expect(out.items.a).toEqual({ value: null, updatedAt: NOW - 200 });
    // an older write from another device does not bring it back
    const { doc: again } = mergeInto(out, { a: { value: 1, updatedAt: NOW - 250 } }, NOW);
    expect(again.items.a.value).toBeNull();
  });

  it("drops deletion markers after 90 days", () => {
    const doc = { ...emptyState("s", 1), items: { gone: { value: null, updatedAt: NOW - LIMITS.tombstoneMs - 1 } } };
    const { doc: out, changed } = mergeInto(doc, {}, NOW);
    expect(changed).toBe(true);
    expect(out.items.gone).toBeUndefined();
  });
});

describe("validateBatch", () => {
  it("normalises timestamps and nulls", () => {
    const items = validateBatch({ items: { a: { value: undefined, updatedAt: 0 }, b: { value: 1, updatedAt: NOW + 10 * 60_000 } } }, NOW);
    expect(items.a).toEqual({ value: null, updatedAt: NOW });
    expect(items.b.updatedAt).toBe(NOW + LIMITS.futureSkewMs);
  });

  it("rejects bad input", () => {
    expect(() => validateBatch({}, NOW)).toThrow();
    expect(() => validateBatch({ items: [] }, NOW)).toThrow();
    expect(() => validateBatch({ items: { "": { value: 1 } } }, NOW)).toThrow();
    expect(() => validateBatch({ items: { a: 5 } }, NOW)).toThrow();
    const many = Object.fromEntries(Array.from({ length: LIMITS.maxBatch + 1 }, (_, i) => [`k${i}`, { value: i }]));
    expect(() => validateBatch({ items: many }, NOW)).toThrow(/At most/);
    expect(() => validateBatch({ items: { big: { value: "x".repeat(LIMITS.maxValueBytes) } } }, NOW)).toThrow(/larger/);
  });
});

describe("parseState", () => {
  it("round-trips", () => {
    const doc = { ...emptyState("loomination.org", 5), items: { a: { value: [1, 2], updatedAt: 9 } } };
    expect(parseState(serializeState(doc))).toEqual(doc);
  });

  it("returns null for broken files", () => {
    expect(parseState("{not json")).toBeNull();
    expect(parseState("[]")).toBeNull();
    expect(parseState('{"items": []}')).toBeNull();
  });

  it("accepts hand-edited bare values", () => {
    expect(parseState('{"items": {"theme": "dark"}}')?.items.theme).toEqual({ value: "dark", updatedAt: 0 });
  });
});
