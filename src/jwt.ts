import { base64url } from "./crypto";

/**
 * Small Ed25519 JWT (EdDSA) helpers. Teather signs identity tokens for sites with its own key,
 * and checks tokens that a site's server signs with the key registered for it in sites.ts.
 */

export type Jwk = JsonWebKey & { kid?: string };

export interface JwtHeader {
  alg: string;
  typ?: string;
  kid?: string;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function fromBase64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function encodePart(v: unknown): string {
  return base64url(enc.encode(JSON.stringify(v)));
}

const privateKeys = new Map<string, Promise<CryptoKey>>();
const publicKeys = new Map<string, Promise<CryptoKey>>();

/** Import a private Ed25519 JWK, given as JSON text (the form it is stored in as a secret). */
export function importPrivateJwk(jwkText: string): Promise<CryptoKey> {
  let key = privateKeys.get(jwkText);
  if (!key) {
    const jwk = JSON.parse(jwkText) as Jwk;
    if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.d) throw new Error("Signing key must be a private Ed25519 JWK");
    key = crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, false, ["sign"]);
    privateKeys.set(jwkText, key);
  }
  return key;
}

export function importPublicJwk(jwk: Jwk): Promise<CryptoKey> {
  const id = `${jwk.crv}:${jwk.x}`;
  let key = publicKeys.get(id);
  if (!key) {
    if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.x) throw new Error("Public key must be an Ed25519 JWK");
    key = crypto.subtle.importKey("jwk", { kty: "OKP", crv: "Ed25519", x: jwk.x }, { name: "Ed25519" }, false, ["verify"]);
    publicKeys.set(id, key);
  }
  return key;
}

/** The public half of a private JWK, safe to publish. */
export function publicJwk(jwkText: string, kid: string): Jwk {
  const jwk = JSON.parse(jwkText) as Jwk;
  return { kty: "OKP", crv: "Ed25519", x: jwk.x, kid, alg: "EdDSA", use: "sig" };
}

export async function signJwt(claims: Record<string, unknown>, key: CryptoKey, kid: string): Promise<string> {
  const head = encodePart({ alg: "EdDSA", typ: "JWT", kid } satisfies JwtHeader);
  const body = encodePart(claims);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, key, enc.encode(`${head}.${body}`)));
  return `${head}.${body}.${base64url(sig)}`;
}

/** Split a JWT without checking it. Returns null if it isn't shaped like one. */
export function decodeJwt(token: string): { header: JwtHeader; claims: Record<string, unknown>; signed: string; sig: Uint8Array } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return {
      header: JSON.parse(dec.decode(fromBase64url(parts[0]))),
      claims: JSON.parse(dec.decode(fromBase64url(parts[1]))),
      signed: `${parts[0]}.${parts[1]}`,
      sig: fromBase64url(parts[2]),
    };
  } catch {
    return null;
  }
}

/** Check an EdDSA signature. Claims (exp, aud, ...) are the caller's job. */
export async function verifySignature(decoded: { header: JwtHeader; signed: string; sig: Uint8Array }, key: CryptoKey): Promise<boolean> {
  if (decoded.header.alg !== "EdDSA") return false;
  return crypto.subtle.verify({ name: "Ed25519" }, key, decoded.sig, enc.encode(decoded.signed));
}
