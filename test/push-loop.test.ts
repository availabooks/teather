import { readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { describe, expect, it } from "vitest";

// Regression test for the "Out of Memory" freeze reported from Loomination.
//
// When a push had nothing to send, its async body finished without awaiting, so its
// `finally { pushing = null }` ran before `pushing = (...)` stored the finished promise.
// `pushing` then stayed set for good, and the next push chained `.then(push)` onto it
// forever: an endless microtask loop that starves timers and eats memory.
//
// That loop blocks the whole thread, so a vitest timeout can't stop it. The scenario
// runs in a worker with a small heap and a watchdog on this thread instead.

const SCENARIO = String.raw`
const { parentPort, workerData } = require("node:worker_threads");

const store = new Map();
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};
// Signed in, nothing waiting to upload, nothing stored locally.
localStorage.setItem("teather:meta", JSON.stringify({
  token: "t", email: "s@example.com", name: "S", picture: null, host: "example.org", dirty: {}, lastPull: 0,
}));

const puts = [];
const server = {};
async function fetch(url, init) {
  const path = new URL(url).pathname;
  const reply = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  if (path === "/api/state" && init.method === "GET") return reply({ items: server });
  if (path === "/api/state" && init.method === "PUT") {
    const body = JSON.parse(init.body);
    puts.push(Object.keys(body.items));
    Object.assign(server, body.items);
    return reply({ items: body.items });
  }
  if (path === "/api/me") return reply({ email: "s@example.com", name: "S", picture: null });
  return new Response("{}", { status: 404 });
}

const window = { localStorage, addEventListener() {}, location: { origin: "https://example.org" } };
const document = { currentScript: null, visibilityState: "visible", addEventListener() {} };
new Function("window", "document", "fetch", workerData.src)(window, document, fetch);
const T = window.Teather;

const tick = () => new Promise((r) => setTimeout(r, 5));
async function until(cond) {
  for (let i = 0; i < 200 && !cond(); i++) await tick();
  if (!cond()) throw new Error("timed out waiting");
}

(async () => {
  T.init({ base: "https://teather.test", pushDelay: 0 });
  await T.ready(); // first sync: pull finds nothing, then a push with nothing to send
  const statuses = [];
  T.onStatus((s) => statuses.push(s));

  T.set("a", 1);
  await until(() => puts.length === 1 && T.status() === "synced");
  await tick();
  const first = { puts: puts.slice(), statuses: statuses.slice() };

  T.set("b", 2); // a later push still works
  await until(() => puts.length === 2 && T.status() === "synced");
  await T.sync(); // and so does a manual sync, which has nothing to send
  parentPort.postMessage({ first, puts, status: T.status() });
})().catch((e) => parentPort.postMessage({ error: String(e) }));
`;

function runScenario(): Promise<any> {
  const src = readFileSync(new URL("../public/teather.js", import.meta.url), "utf8").replace(
    /typeof window !== "undefined" \? window : this/,
    "window",
  );
  const worker = new Worker(SCENARIO, { eval: true, workerData: { src }, resourceLimits: { maxOldGenerationSizeMb: 64 } });
  return new Promise((resolve) => {
    const watchdog = setTimeout(() => {
      worker.terminate();
      resolve({ error: "hung: the page would freeze" });
    }, 5000);
    const done = (r: unknown) => {
      clearTimeout(watchdog);
      worker.terminate();
      resolve(r);
    };
    worker.on("message", done);
    worker.on("error", (e) => done({ error: `worker died: ${e.message}` }));
  });
}

describe("teather.js push after a sync with nothing to send", () => {
  it("pushes once per change and doesn't loop", async () => {
    const r = await runScenario();
    expect(r.error).toBeUndefined();
    expect(r.first.puts).toEqual([["a"]]);
    expect(r.first.statuses).toEqual(["syncing", "synced"]);
    expect(r.puts).toEqual([["a"], ["b"]]);
    expect(r.status).toBe("synced");
  }, 10000);
});
