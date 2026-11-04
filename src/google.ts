import type { Env } from "./env";
import { HttpError } from "./env";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const SCOPES = ["openid", "email", "profile", DRIVE_SCOPE];

export interface Profile {
  name: string | null;
  picture: string | null;
}

export function authUrl(env: Env, redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    // Always ask, so Google always returns a refresh token.
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponse & { error?: string; error_description?: string };
  if (!res.ok) {
    // invalid_grant means the student revoked access or the token expired.
    const code = body.error === "invalid_grant" ? "google_revoked" : "google_error";
    throw new HttpError(code === "google_revoked" ? 401 : 502, body.error_description || body.error || "Google token error", code);
  }
  return body;
}

export function exchangeCode(env: Env, code: string, redirectUri: string) {
  return tokenRequest({
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
}

export function refreshAccessToken(env: Env, refreshToken: string) {
  return tokenRequest({
    refresh_token: refreshToken,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    grant_type: "refresh_token",
  });
}

export async function revoke(token: string): Promise<void> {
  await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  }).catch(() => undefined);
}

/**
 * Read the claims in an ID token. The token came straight from Google's token
 * endpoint over TLS in this same request, so its signature need not be checked
 * (OpenID Connect Core 3.1.3.7).
 */
export function idTokenClaims(idToken: string): { sub: string; email: string } & Profile {
  const part = idToken.split(".")[1] ?? "";
  const bin = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
  // The payload is UTF-8 (names can have accents), so decode the bytes properly.
  const text = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  const claims = JSON.parse(text);
  if (!claims.sub) throw new HttpError(502, "Google sign-in returned no account id", "google_error");
  return {
    sub: claims.sub,
    email: claims.email,
    name: typeof claims.name === "string" ? claims.name : null,
    picture: typeof claims.picture === "string" ? claims.picture : null,
  };
}

/** The student's current Google name and photo, or null if Google won't say. */
export async function fetchProfile(accessToken: string): Promise<Profile | null> {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const u = (await res.json().catch(() => null)) as { name?: unknown; picture?: unknown } | null;
  if (!u) return null;
  return {
    name: typeof u.name === "string" ? u.name : null,
    picture: typeof u.picture === "string" ? u.picture : null,
  };
}
