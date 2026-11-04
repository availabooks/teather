import type { Env } from "../../src/env";
import { createOAuthState } from "../../src/db";
import { authUrl } from "../../src/google";
import { html, route } from "../../src/http";
import { siteForOrigin } from "../../src/sites";

/**
 * Opened in a popup by teather.js: /auth/start?origin=<site origin>&poll=<random id>
 * Sends the student to Google, then on to /auth/callback.
 */
export const onRequestGet = route(async (ctx) => {
  const url = new URL(ctx.request.url);
  const origin = url.searchParams.get("origin") ?? "";
  const poll = url.searchParams.get("poll");
  const manage = origin === url.origin;
  const site = manage ? null : siteForOrigin(origin, ctx.env.DEV === "1");
  if (!manage && !site) {
    return html(
      `<!doctype html><meta charset="utf-8"><title>Teather</title><p>This site (${escapeHtml(origin) || "unknown"}) is not registered with Teather, so it can't save data here.</p>`,
      400,
    );
  }
  if (poll && !/^[A-Za-z0-9_-]{20,100}$/.test(poll)) return html("Bad request", 400);
  const nonce = await createOAuthState(ctx.env, origin, manage ? "teather" : site!.host, manage, poll);
  return Response.redirect(authUrl(ctx.env, `${url.origin}/auth/callback`, nonce), 302);
});

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
