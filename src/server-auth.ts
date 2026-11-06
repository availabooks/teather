import type { Env } from "./env";
import { HttpError } from "./env";
import { useServerJti } from "./db";
import { decodeJwt, importPublicJwk, verifySignature } from "./jwt";
import { type Site, siteForHost } from "./sites";

/** Longest lifetime Teather accepts for a site-server token. */
export const SERVER_TOKEN_MAX_S = 120;
/** Allowed clock difference between the site's server and Teather. */
const SKEW_S = 30;

/**
 * Check a token a site's server signed with its registered key:
 * { iss: <site host>, aud: <Teather origin>, iat, exp, jti }, EdDSA.
 * Each token works once.
 */
export async function verifyServerToken(env: Env, token: string, audience: string, nowMs = Date.now()): Promise<Site> {
  const bad = (msg: string) => new HttpError(401, msg, "bad_server_token");
  const decoded = decodeJwt(token);
  if (!decoded) throw bad("Not a JWT");
  const { header, claims } = decoded;
  const host = typeof claims.iss === "string" ? claims.iss : "";
  const site = siteForHost(host);
  if (!site || !site.serverKeys?.length) throw bad("Unknown site or site has no server key");
  const jwk = site.serverKeys.find((k) => k.kid === header.kid);
  if (!jwk) throw bad("Unknown key id");
  if (!(await verifySignature(decoded, await importPublicJwk(jwk)))) throw bad("Bad signature");
  if (claims.aud !== audience) throw bad("Wrong audience");
  const now = Math.floor(nowMs / 1000);
  const exp = Number(claims.exp);
  const iat = Number(claims.iat);
  if (!Number.isFinite(exp) || exp < now - SKEW_S) throw bad("Token expired");
  if (!Number.isFinite(iat) || iat > now + SKEW_S || exp - iat > SERVER_TOKEN_MAX_S) throw bad("Token lifetime not allowed");
  const jti = typeof claims.jti === "string" ? claims.jti : "";
  if (jti.length < 16 || jti.length > 100) throw bad("Missing token id");
  if (!(await useServerJti(env, `${host}:${jti}`, host, (exp + SKEW_S) * 1000))) throw bad("Token already used");
  return site;
}
