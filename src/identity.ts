import type { Env } from "./env";
import { HttpError } from "./env";
import type { User } from "./db";
import type { Session } from "./db";
import { randomToken } from "./crypto";
import { type Jwk, importPrivateJwk, publicJwk, signJwt } from "./jwt";

/** How long an identity token lasts. Sites exchange it for their own session straight away. */
export const ID_TOKEN_TTL_S = 300;

function signingKey(env: Env): { jwk: string; kid: string } {
  if (!env.ID_SIGNING_KEY || !env.ID_SIGNING_KID) {
    throw new HttpError(503, "Teather can't issue identity tokens yet", "not_configured");
  }
  return { jwk: env.ID_SIGNING_KEY, kid: env.ID_SIGNING_KID };
}

/**
 * A short-lived token a site's server can check offline (against /.well-known/jwks.json)
 * to know which Google account signed in. Only issued for accounts whose email Google has confirmed.
 */
export async function issueIdToken(env: Env, issuer: string, session: Session, user: User): Promise<string> {
  const { jwk, kid } = signingKey(env);
  const now = Math.floor(Date.now() / 1000);
  return signJwt(
    {
      iss: issuer,
      aud: session.host,
      sub: user.sub,
      email: user.email,
      // Sign-in refuses accounts whose email Google hasn't confirmed, so every stored email is verified.
      email_verified: true,
      name: user.name,
      given_name: user.givenName,
      family_name: user.familyName,
      picture: user.picture,
      origin: session.origin,
      iat: now,
      exp: now + ID_TOKEN_TTL_S,
      jti: randomToken(16),
    },
    await importPrivateJwk(jwk),
    kid,
  );
}

export function jwks(env: Env): { keys: Jwk[] } {
  const keys: Jwk[] = [];
  if (env.ID_SIGNING_KEY && env.ID_SIGNING_KID) keys.push(publicJwk(env.ID_SIGNING_KEY, env.ID_SIGNING_KID));
  if (env.ID_SIGNING_OLD_PUBLIC) {
    try {
      for (const k of JSON.parse(env.ID_SIGNING_OLD_PUBLIC) as Jwk[]) keys.push({ ...k, alg: "EdDSA", use: "sig" });
    } catch {
      console.error("ID_SIGNING_OLD_PUBLIC is not a JSON array");
    }
  }
  return { keys };
}
