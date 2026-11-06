import type { Env } from "./env";
import { HttpError } from "./env";
import { decrypt, encrypt, randomToken, sha256 } from "./crypto";
import { type Profile, fetchProfile, refreshAccessToken, revoke } from "./google";

export const PROFILE_REFRESH_MS = 24 * 60 * 60 * 1000;

export const SESSION_TTL_MS = 60 * 24 * 60 * 60 * 1000;
export const OAUTH_TTL_MS = 10 * 60 * 1000;
export const HANDOFF_TTL_MS = 2 * 60 * 1000;

export interface SiteRecord {
  folderId?: string;
  stateFileId?: string;
  readmeId?: string;
  readmeVersion?: number;
  warnings?: string[];
  /** Ids of folders inside the site folder, by path ("courses/abc"). */
  folders?: Record<string, string>;
}

export interface UserData {
  rootFolderId?: string;
  rootReadmeId?: string;
  /** Hosts listed in the current root README, so it is only rewritten when this changes. */
  rootReadmeSites?: string[];
  rootReadmeVersion?: number;
  sites: Record<string, SiteRecord>;
}

export interface Session {
  sub: string;
  host: string;
  origin: string;
  manage: boolean;
}

export interface Names {
  givenName: string | null;
  familyName: string | null;
}

export interface User extends Profile, Names {
  sub: string;
  email: string;
  profileChecked: number | null;
  data: UserData;
}

// ---- users ----

export async function upsertUser(
  env: Env,
  sub: string,
  email: string,
  refreshToken: string | undefined,
  profile: Profile,
  names: Names = { givenName: null, familyName: null },
) {
  const now = Date.now();
  const refreshEnc = refreshToken ? await encrypt(refreshToken, env.TOKEN_ENC_KEY) : null;
  await env.DB.prepare(
    `INSERT INTO users (sub, email, refresh_enc, data, name, picture, given_name, family_name, profile_checked, created_at, updated_at)
     VALUES (?1, ?2, ?3, '{}', ?5, ?6, ?7, ?8, ?4, ?4, ?4)
     ON CONFLICT (sub) DO UPDATE SET
       email = ?2,
       refresh_enc = COALESCE(?3, refresh_enc),
       access_enc = CASE WHEN ?3 IS NULL THEN access_enc ELSE NULL END,
       name = ?5,
       picture = ?6,
       given_name = ?7,
       family_name = ?8,
       profile_checked = ?4,
       updated_at = ?4`,
  )
    .bind(sub, email, refreshEnc, now, profile.name, profile.picture, names.givenName, names.familyName)
    .run();
}

export async function getUser(env: Env, sub: string): Promise<User | null> {
  const row = await env.DB.prepare(
    "SELECT sub, email, name, picture, given_name, family_name, profile_checked, data FROM users WHERE sub = ?1",
  )
    .bind(sub)
    .first<{
      sub: string;
      email: string;
      name: string | null;
      picture: string | null;
      given_name: string | null;
      family_name: string | null;
      profile_checked: number | null;
      data: string;
    }>();
  if (!row) return null;
  const data = JSON.parse(row.data || "{}") as UserData;
  data.sites ??= {};
  return {
    sub: row.sub,
    email: row.email,
    name: row.name,
    picture: row.picture,
    givenName: row.given_name,
    familyName: row.family_name,
    profileChecked: row.profile_checked,
    data,
  };
}

/**
 * Pick up a changed Google name or photo, at most once a day. Never fails:
 * if Google can't be reached, the stored profile is used.
 */
export async function freshProfile(env: Env, user: User): Promise<Profile> {
  const stored = { name: user.name, picture: user.picture };
  if (user.profileChecked && Date.now() - user.profileChecked < PROFILE_REFRESH_MS) return stored;
  try {
    const latest = await fetchProfile(await accessToken(env, user.sub));
    // Record the check even if Google gave nothing, so we don't ask on every request.
    const profile = latest ?? stored;
    await env.DB.prepare("UPDATE users SET name = ?2, picture = ?3, profile_checked = ?4 WHERE sub = ?1")
      .bind(user.sub, profile.name, profile.picture, Date.now())
      .run();
    return profile;
  } catch {
    return stored;
  }
}

export async function saveUserData(env: Env, sub: string, data: UserData) {
  await env.DB.prepare("UPDATE users SET data = ?2, updated_at = ?3 WHERE sub = ?1")
    .bind(sub, JSON.stringify(data), Date.now())
    .run();
}

/** A Google access token for this student, refreshed when needed. */
export async function accessToken(env: Env, sub: string): Promise<string> {
  const row = await env.DB.prepare("SELECT refresh_enc, access_enc, access_expires FROM users WHERE sub = ?1")
    .bind(sub)
    .first<{ refresh_enc: string | null; access_enc: string | null; access_expires: number | null }>();
  if (!row?.refresh_enc) throw new HttpError(401, "Please sign in again", "signed_out");
  if (row.access_enc && row.access_expires && row.access_expires > Date.now() + 60_000) {
    return decrypt(row.access_enc, env.TOKEN_ENC_KEY);
  }
  const refresh = await decrypt(row.refresh_enc, env.TOKEN_ENC_KEY);
  let tok;
  try {
    tok = await refreshAccessToken(env, refresh);
  } catch (e) {
    if (e instanceof HttpError && e.code === "google_revoked") await forgetUser(env, sub);
    throw e;
  }
  await env.DB.prepare("UPDATE users SET access_enc = ?2, access_expires = ?3 WHERE sub = ?1")
    .bind(sub, await encrypt(tok.access_token, env.TOKEN_ENC_KEY), Date.now() + tok.expires_in * 1000)
    .run();
  return tok.access_token;
}

/** Revoke Google access and remove every session and token. The student's Drive files are untouched. */
export async function disconnectUser(env: Env, sub: string) {
  const row = await env.DB.prepare("SELECT refresh_enc FROM users WHERE sub = ?1").bind(sub).first<{ refresh_enc: string | null }>();
  if (row?.refresh_enc) await revoke(await decrypt(row.refresh_enc, env.TOKEN_ENC_KEY));
  await forgetUser(env, sub);
}

async function forgetUser(env: Env, sub: string) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE sub = ?1").bind(sub),
    env.DB.prepare("UPDATE site_grants SET revoked_at = ?2 WHERE sub = ?1 AND revoked_at IS NULL").bind(sub, Date.now()),
    env.DB.prepare("UPDATE users SET refresh_enc = NULL, access_enc = NULL, access_expires = NULL WHERE sub = ?1").bind(sub),
  ]);
}

// ---- server access grants ----

export interface SiteGrant {
  host: string;
  grantedAt: number;
}

export async function grantServerAccess(env: Env, sub: string, host: string) {
  await env.DB.prepare(
    `INSERT INTO site_grants (sub, host, scope, granted_at, revoked_at) VALUES (?1, ?2, 'server', ?3, NULL)
     ON CONFLICT (sub, host) DO UPDATE SET granted_at = ?3, revoked_at = NULL`,
  )
    .bind(sub, host, Date.now())
    .run();
}

export async function revokeServerAccess(env: Env, sub: string, host: string) {
  await env.DB.prepare("UPDATE site_grants SET revoked_at = ?3 WHERE sub = ?1 AND host = ?2 AND revoked_at IS NULL")
    .bind(sub, host, Date.now())
    .run();
}

export async function hasServerAccess(env: Env, sub: string, host: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT 1 AS ok FROM site_grants WHERE sub = ?1 AND host = ?2 AND revoked_at IS NULL")
    .bind(sub, host)
    .first<{ ok: number }>();
  return !!row;
}

export async function listServerGrants(env: Env, sub: string): Promise<SiteGrant[]> {
  const res = await env.DB.prepare("SELECT host, granted_at FROM site_grants WHERE sub = ?1 AND revoked_at IS NULL ORDER BY host")
    .bind(sub)
    .all<{ host: string; granted_at: number }>();
  return (res.results ?? []).map((r) => ({ host: r.host, grantedAt: r.granted_at }));
}

/** Record a site-server token id. Returns false if it was already used (a replay). */
export async function useServerJti(env: Env, jti: string, host: string, expiresAt: number): Promise<boolean> {
  const now = Date.now();
  const res = await env.DB.batch([
    env.DB.prepare("DELETE FROM server_jti WHERE expires_at < ?1").bind(now),
    env.DB.prepare("INSERT OR IGNORE INTO server_jti (jti, host, expires_at) VALUES (?1, ?2, ?3)").bind(jti, host, expiresAt),
  ]);
  return (res[1].meta.changes ?? 0) === 1;
}

// ---- sessions ----

export async function createSession(env: Env, s: Session): Promise<string> {
  const token = randomToken(32);
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO sessions (token_hash, sub, host, origin, manage, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
  )
    .bind(await sha256(token), s.sub, s.host, s.origin, s.manage ? 1 : 0, now, now + SESSION_TTL_MS)
    .run();
  return token;
}

/** Sessions renew while in use: they end only after 60 days without use. */
export async function getSession(env: Env, token: string): Promise<Session | null> {
  const hash = await sha256(token);
  const now = Date.now();
  const row = await env.DB.prepare(
    "SELECT sub, host, origin, manage, expires_at FROM sessions WHERE token_hash = ?1 AND expires_at > ?2",
  )
    .bind(hash, now)
    .first<{ sub: string; host: string; origin: string; manage: number; expires_at: number }>();
  if (!row) return null;
  if (row.expires_at - now < SESSION_TTL_MS / 2) {
    await env.DB.prepare("UPDATE sessions SET expires_at = ?2 WHERE token_hash = ?1").bind(hash, now + SESSION_TTL_MS).run();
  }
  return { sub: row.sub, host: row.host, origin: row.origin, manage: row.manage === 1 };
}

export async function deleteSession(env: Env, token: string) {
  await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(await sha256(token)).run();
}

/** Sign a student out of one site on every device. */
export async function deleteSiteSessions(env: Env, sub: string, host: string) {
  await env.DB.prepare("DELETE FROM sessions WHERE sub = ?1 AND host = ?2 AND manage = 0").bind(sub, host).run();
}

// ---- sign-in handoff ----

export async function createOAuthState(
  env: Env,
  origin: string,
  host: string,
  manage: boolean,
  pollId: string | null,
  purpose: "server" | null = null,
) {
  const nonce = randomToken(24);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM oauth_states WHERE expires_at < ?1").bind(now),
    env.DB.prepare("DELETE FROM handoffs WHERE expires_at < ?1").bind(now),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?1").bind(now),
    env.DB.prepare(
      "INSERT INTO oauth_states (nonce, origin, host, manage, poll_id, expires_at, purpose) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    ).bind(nonce, origin, host, manage ? 1 : 0, pollId, now + OAUTH_TTL_MS, purpose),
  ]);
  return nonce;
}

/** Look up and delete a sign-in state (one use only). */
export async function takeOAuthState(env: Env, nonce: string) {
  const row = await env.DB.prepare(
    "DELETE FROM oauth_states WHERE nonce = ?1 AND expires_at > ?2 RETURNING origin, host, manage, poll_id, purpose",
  )
    .bind(nonce, Date.now())
    .first<{ origin: string; host: string; manage: number; poll_id: string | null; purpose: string | null }>();
  return row
    ? { origin: row.origin, host: row.host, manage: row.manage === 1, pollId: row.poll_id, purpose: row.purpose === "server" ? "server" : null }
    : null;
}

export async function putHandoff(env: Env, pollId: string, origin: string, payload: unknown) {
  await env.DB.prepare(
    "INSERT OR REPLACE INTO handoffs (poll_id, origin, payload, expires_at) VALUES (?1, ?2, ?3, ?4)",
  )
    .bind(await sha256(pollId), origin, JSON.stringify(payload), Date.now() + HANDOFF_TTL_MS)
    .run();
}

export async function takeHandoff(env: Env, pollId: string, origin: string): Promise<unknown | null> {
  const row = await env.DB.prepare(
    "DELETE FROM handoffs WHERE poll_id = ?1 AND origin = ?2 AND expires_at > ?3 RETURNING payload",
  )
    .bind(await sha256(pollId), origin, Date.now())
    .first<{ payload: string }>();
  return row ? JSON.parse(row.payload) : null;
}
