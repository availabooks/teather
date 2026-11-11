import { beforeAll, describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { HttpError } from "../src/env";
import { decodeJwt, importPrivateJwk, importPublicJwk, signJwt, verifySignature } from "../src/jwt";
import { issueIdToken, jwks } from "../src/identity";
import { verifyServerToken } from "../src/server-auth";
import { SITES } from "../src/sites";
import { checkConditions, checkDirPath, checkFilePath } from "../src/store";
import type { DriveFile } from "../src/drive";

const TEATHER = "https://teather.technologylearningcompany.com";

async function newKey(): Promise<{ privateText: string; publicJwk: JsonWebKey }> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  return {
    privateText: JSON.stringify(await crypto.subtle.exportKey("jwk", pair.privateKey)),
    publicJwk: (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey,
  };
}

/** Just enough D1 for useServerJti: a set of used ids. */
function fakeDb() {
  const used = new Set<string>();
  const stmt = (sql: string, args: unknown[] = []): { sql: string; args: unknown[]; bind: (...a: unknown[]) => unknown } => ({
    sql,
    args,
    bind: (...a: unknown[]) => stmt(sql, a),
  });
  return {
    prepare: (sql: string) => stmt(sql),
    batch: async (stmts: { sql: string; args: unknown[] }[]) =>
      stmts.map((s) => {
        if (s.sql.startsWith("INSERT OR IGNORE INTO server_jti")) {
          const id = String(s.args[0]);
          const fresh = !used.has(id);
          used.add(id);
          return { meta: { changes: fresh ? 1 : 0 } };
        }
        return { meta: { changes: 0 } };
      }),
  } as unknown as D1Database;
}

describe("identity tokens", () => {
  it("signs a token that verifies against the published key", async () => {
    const { privateText } = await newKey();
    const env = { ID_SIGNING_KEY: privateText, ID_SIGNING_KID: "k1" } as Env;
    const token = await issueIdToken(
      env,
      TEATHER,
      { sub: "123", host: "availabooks.com", origin: "https://app.availabooks.com", manage: false },
      {
        sub: "123",
        email: "a@b.c",
        name: "Ann Bee",
        givenName: "Ann",
        familyName: "Bee",
        picture: null,
        profileChecked: null,
        data: { sites: {} },
      },
    );
    const decoded = decodeJwt(token)!;
    expect(decoded.header).toMatchObject({ alg: "EdDSA", kid: "k1" });
    expect(decoded.claims).toMatchObject({
      iss: TEATHER,
      aud: "availabooks.com",
      sub: "123",
      email: "a@b.c",
      email_verified: true,
      given_name: "Ann",
      family_name: "Bee",
      origin: "https://app.availabooks.com",
    });
    expect(Number(decoded.claims.exp) - Number(decoded.claims.iat)).toBe(300);

    const published = jwks(env).keys;
    expect(published).toHaveLength(1);
    expect(published[0]).not.toHaveProperty("d");
    expect(await verifySignature(decoded, await importPublicJwk(published[0]))).toBe(true);

    // Changing the claims breaks the signature.
    const tampered = { ...decoded, signed: decoded.signed.replace(/\.[^.]+$/, ".e30") };
    expect(await verifySignature(tampered, await importPublicJwk(published[0]))).toBe(false);
  });
});

describe("site server tokens", () => {
  const site = SITES.find((s) => s.host === "availabooks.com")!;
  let key: CryptoKey;
  let otherKey: CryptoKey;

  beforeAll(async () => {
    const k = await newKey();
    key = await importPrivateJwk(k.privateText);
    site.serverKeys = [...(site.serverKeys ?? []), { kid: "test", kty: "OKP", crv: "Ed25519", x: k.publicJwk.x! }];
    otherKey = await importPrivateJwk((await newKey()).privateText);
  });

  const claims = (over: Record<string, unknown> = {}) => {
    const now = Math.floor(Date.now() / 1000);
    return { iss: "availabooks.com", aud: TEATHER, iat: now, exp: now + 60, jti: crypto.randomUUID(), ...over };
  };
  const env = () => ({ DB: fakeDb() }) as unknown as Env;
  const outcome = async (p: Promise<unknown>) => {
    try {
      await p;
      return "ok";
    } catch (e) {
      return e instanceof HttpError ? `${e.code}: ${e.message}` : String(e);
    }
  };

  it("accepts a fresh token signed with the site's key", async () => {
    const s = await verifyServerToken(env(), await signJwt(claims(), key, "test"), TEATHER);
    expect(s.host).toBe("availabooks.com");
  });

  it("refuses a token used twice", async () => {
    const e = env();
    const token = await signJwt(claims(), key, "test");
    await verifyServerToken(e, token, TEATHER);
    expect(await outcome(verifyServerToken(e, token, TEATHER))).toMatch(/already used/);
  });

  it("refuses expired, long-lived, wrong-audience, wrong-key and unknown-site tokens", async () => {
    const now = Math.floor(Date.now() / 1000);
    const check = async (c: Record<string, unknown>, k = key, kid = "test") =>
      outcome(verifyServerToken(env(), await signJwt(claims(c), k, kid), TEATHER));
    expect(await check({ iat: now - 200, exp: now - 100 })).toMatch(/expired/);
    expect(await check({ exp: now + 3600 })).toMatch(/lifetime/);
    expect(await check({ aud: "https://evil.example" })).toMatch(/audience/);
    expect(await check({}, otherKey)).toMatch(/signature/);
    expect(await check({ iss: "loomination.org" })).toMatch(/Unknown site/);
    expect(await check({}, key, "nope")).toMatch(/key id/);
    expect(await check({ jti: "short" })).toMatch(/token id/);
    expect(await outcome(verifyServerToken(env(), "not.a.jwt", TEATHER))).toMatch(/bad_server_token/);
  });
});

describe("file paths", () => {
  it("accepts nested paths and keeps top-level names reserved", () => {
    expect(checkFilePath("courses/abc/roster.json")).toEqual(["courses", "abc", "roster.json"]);
    expect(checkFilePath("courses/abc/state.json")).toHaveLength(3);
    expect(() => checkFilePath("state.json")).toThrow(/reserved/);
    expect(() => checkFilePath("a/b/c/d/e/f")).toThrow(/at most 5/);
    expect(() => checkFilePath("a/../b")).toThrow();
    expect(() => checkFilePath("a//b")).toThrow();
    expect(checkDirPath("")).toEqual([]);
    expect(checkDirPath("courses/abc/")).toEqual(["courses", "abc"]);
  });
});

describe("write conditions", () => {
  const file = { id: "1", name: "x", mimeType: "application/json", version: "7", modifiedTime: "2026-01-01T00:00:00Z" } as DriveFile;
  const fails = (f: () => void) => expect(f).toThrow(/changed since/);

  it("checks If-Match against the Drive version", () => {
    checkConditions(file, { ifMatch: '"7"' });
    checkConditions(file, { ifMatch: "*" });
    fails(() => checkConditions(file, { ifMatch: '"6"' }));
    fails(() => checkConditions(null, { ifMatch: '"7"' }));
  });

  it("If-None-Match: * only creates", () => {
    checkConditions(null, { ifNoneMatch: "*" });
    fails(() => checkConditions(file, { ifNoneMatch: "*" }));
  });

  it("keeps If-Unmodified-Since working", () => {
    checkConditions(file, { ifUnmodifiedSince: "Thu, 01 Jan 2026 00:00:00 GMT" });
    fails(() => checkConditions(file, { ifUnmodifiedSince: "Wed, 31 Dec 2025 00:00:00 GMT" }));
  });
});
