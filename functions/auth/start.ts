import type { Env } from "../../src/env";
import { createOAuthState } from "../../src/db";
import { authUrl } from "../../src/google";
import { html, route } from "../../src/http";
import { type Site, siteForOrigin } from "../../src/sites";

/**
 * Opened in a popup by teather.js: /auth/start?origin=<site origin>&poll=<random id>[&hint=<email>]
 * Sends the student to Google, then on to /auth/callback.
 *
 * With &grant=server (from Teather.allowServerAccess()), it first shows a page explaining that
 * the site's server will use the student's folder while they are away. Only its "Allow" button
 * continues to Google, and the permission is recorded after that sign-in, in /auth/callback.
 */
export const onRequestGet = route(async (ctx) => {
  const url = new URL(ctx.request.url);
  const origin = url.searchParams.get("origin") ?? "";
  const poll = url.searchParams.get("poll");
  const grant = url.searchParams.get("grant") === "server";
  // An email address the site expects; Google gets it as login_hint so that account is pre-selected.
  const hint = loginHint(url.searchParams.get("hint"));
  const manage = origin === url.origin;
  const site = manage ? null : siteForOrigin(origin, ctx.env.DEV === "1");
  if (!manage && !site) {
    return html(
      `<!doctype html><meta charset="utf-8"><title>Teather</title><p>This site (${escapeHtml(origin) || "unknown"}) is not registered with Teather, so it can't save data here.</p>`,
      400,
    );
  }
  if (poll && !/^[A-Za-z0-9_-]{20,100}$/.test(poll)) return html("Bad request", 400);
  if (grant) {
    if (!site?.serverAccess) return html("This site does not use server access.", 400);
    const nonce = await createOAuthState(ctx.env, origin, site.host, false, poll, "server");
    return grantPage(site, authUrl(ctx.env, `${url.origin}/auth/callback`, nonce, hint));
  }
  const nonce = await createOAuthState(ctx.env, origin, manage ? "teather" : site!.host, manage, poll);
  return Response.redirect(authUrl(ctx.env, `${url.origin}/auth/callback`, nonce, hint), 302);
});

function loginHint(value: string | null): string | null {
  const v = (value ?? "").trim();
  return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

function grantPage(site: Site, continueUrl: string): Response {
  const a = site.serverAccess!;
  const items = a.uses.map((u) => `<li>${escapeHtml(u)}</li>`).join("");
  return html(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Allow ${escapeHtml(site.name)}</title>
<style>
  :root { color-scheme: light dark; --bg:#f7f5f0; --fg:#1f2328; --muted:#5b6370; --accent:#2f6f5e; --line:#d9d4c7; }
  @media (prefers-color-scheme: dark) { :root { --bg:#16181c; --fg:#e8e6e1; --muted:#a3a9b3; --accent:#7fc2ad; --line:#30343b; } }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--fg);
         font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; padding:16px; box-sizing:border-box; }
  main { max-width: 30rem; }
  h1 { font-size: 1.3rem; margin: 0 0 .75rem; }
  p, li { color: var(--muted); }
  ul { padding-left: 1.2rem; }
  .row { display:flex; gap:.75rem; margin-top:1.25rem; flex-wrap:wrap; }
  a.button, button { font: inherit; padding:.6rem 1.1rem; border-radius:.5rem; border:1px solid var(--line); background:transparent; color:var(--fg); cursor:pointer; text-decoration:none; }
  a.button.primary { background: var(--accent); border-color: var(--accent); color: var(--bg); }
</style></head>
<body><main>
  <h1>Let ${escapeHtml(site.name)}'s server use your Teather folder?</h1>
  <p>${escapeHtml(a.summary)}</p>
  <p>While you are away, ${escapeHtml(site.name)}'s server will be able to read and write files in
     <strong>Teather/${escapeHtml(site.host)}/</strong> in your Google Drive. It can't see anything else in your Drive.</p>
  <ul>${items}</ul>
  <p>You can take this back at any time on the Teather page (teather.technologylearningcompany.com/manage). Your files stay in your Drive.</p>
  <div class="row">
    <a class="button primary" href="${escapeHtml(continueUrl)}">Allow and continue to Google</a>
    <button type="button" onclick="window.close()">Not now</button>
  </div>
</main></body></html>`);
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
