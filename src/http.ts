import type { Env } from "./env";
import { HttpError, json } from "./env";
import { type Session, getSession } from "./db";
import { type Site, siteForHost, siteForOrigin } from "./sites";

export type Ctx = EventContext<Env, string, Record<string, unknown>>;

/** Is this origin allowed to call the API? The teather site itself always is. */
export function originAllowed(origin: string, selfOrigin: string, env: Env): boolean {
  return origin === selfOrigin || !!siteForOrigin(origin, env.DEV === "1");
}

export function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, If-Unmodified-Since, If-Match, If-None-Match",
    "Access-Control-Expose-Headers": "Last-Modified, Content-Disposition, ETag",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status);
  console.error(e);
  return json({ error: "server_error", message: "Something went wrong in Teather" }, 500);
}

/** Wrap a handler so thrown HttpErrors become JSON responses. */
export function route(fn: (ctx: Ctx) => Promise<Response>): PagesFunction<Env> {
  return async (ctx) => {
    try {
      return await fn(ctx as Ctx);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

function bearer(request: Request): string | null {
  const h = request.headers.get("Authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  return m ? m[1] : null;
}

/**
 * The caller's session. The token is the credential; when the browser sends an
 * Origin header it must also match the site the session was made for.
 */
export async function requireSession(ctx: Ctx): Promise<Session & { token: string }> {
  const token = bearer(ctx.request);
  if (!token) throw new HttpError(401, "Not signed in", "signed_out");
  const session = await getSession(ctx.env, token);
  if (!session) throw new HttpError(401, "Your sign-in has ended. Please sign in again.", "signed_out");
  const origin = ctx.request.headers.get("Origin");
  if (origin && origin !== session.origin) throw new HttpError(403, "This sign-in belongs to a different site", "wrong_site");
  return { ...session, token };
}

/** A site session and its registry entry. */
export async function requireSite(ctx: Ctx): Promise<{ session: Session; site: Site }> {
  const session = await requireSession(ctx);
  if (session.manage) throw new HttpError(403, "Use /api/sites from the manage page", "wrong_site");
  const site = siteForHost(session.host);
  if (!site) throw new HttpError(403, "This site is no longer connected to Teather", "unknown_site");
  return { session, site };
}

export async function requireManage(ctx: Ctx): Promise<Session> {
  const session = await requireSession(ctx);
  if (!session.manage) throw new HttpError(403, "Only the Teather manage page can do this", "forbidden");
  return session;
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "Body must be JSON", "bad_request");
  }
}

export function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

/** JSON that is safe to put inside a <script> element. */
export function scriptJson(v: unknown): string {
  return JSON.stringify(v).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}
