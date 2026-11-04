import type { Env } from "../../src/env";
import { HttpError } from "../../src/env";
import { createSession, putHandoff, takeOAuthState, upsertUser } from "../../src/db";
import { DRIVE_SCOPE, exchangeCode, idTokenClaims } from "../../src/google";
import { html, route, scriptJson } from "../../src/http";
import { siteForHost } from "../../src/sites";

/**
 * Google sends the student back here. We save their encrypted refresh token, make a
 * session for the site, and hand it to the site page two ways: postMessage to the
 * opener (when the browser kept that link) and a one-time pickup the page polls for.
 */
export const onRequestGet = route(async (ctx) => {
  const url = new URL(ctx.request.url);
  const state = await takeOAuthState(ctx.env, url.searchParams.get("state") ?? "");
  if (!state) return page(null, { error: "expired", message: "This sign-in link has expired. Please try again." });

  const deliver = async (payload: Record<string, unknown>) => {
    if (state.pollId) await putHandoff(ctx.env, state.pollId, state.origin, payload);
    return page(state.origin, payload);
  };

  const googleError = url.searchParams.get("error");
  if (googleError) {
    return deliver({
      error: googleError === "access_denied" ? "cancelled" : "google_error",
      message: googleError === "access_denied" ? "Sign-in was cancelled." : `Google said: ${googleError}`,
    });
  }

  try {
    const tok = await exchangeCode(ctx.env, url.searchParams.get("code") ?? "", `${url.origin}/auth/callback`);
    const granted = (tok.scope ?? "").split(" ");
    if (!granted.includes(DRIVE_SCOPE)) {
      return deliver({
        error: "no_drive",
        message: "Teather needs permission to save files in your Google Drive. Please sign in again and leave that box checked.",
      });
    }
    const claims = idTokenClaims(tok.id_token ?? "");
    const profile = { name: claims.name, picture: claims.picture };
    await upsertUser(ctx.env, claims.sub, claims.email, tok.refresh_token, profile);
    const token = await createSession(ctx.env, { sub: claims.sub, host: state.host, origin: state.origin, manage: state.manage });
    return deliver({ token, email: claims.email, ...profile, host: state.host });
  } catch (e) {
    const message = e instanceof HttpError ? e.message : "Sign-in failed. Please try again.";
    if (!(e instanceof HttpError)) console.error(e);
    return deliver({ error: "failed", message });
  }
});

function page(origin: string | null, payload: Record<string, unknown>): Response {
  const ok = !payload.error;
  const siteName = ok && typeof payload.host === "string" ? siteForHost(payload.host)?.name : null;
  const heading = ok ? "You're connected" : "Sign-in didn't finish";
  const text = ok
    ? `${siteName ? `${siteName} can now save your data` : "Your data will be saved"} in the Teather folder in your Google Drive. You can close this window.`
    : String(payload.message ?? "Please try again.");
  return html(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Teather</title>
<style>
  :root { color-scheme: light dark; --bg:#f7f5f0; --fg:#1f2328; --muted:#5b6370; }
  @media (prefers-color-scheme: dark) { :root { --bg:#16181c; --fg:#e8e6e1; --muted:#a3a9b3; } }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--fg);
         font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; padding:16px; box-sizing:border-box; }
  main { max-width: 26rem; text-align:center; }
  h1 { font-size: 1.3rem; margin: 0 0 .5rem; }
  p { color: var(--muted); margin: 0; }
</style></head>
<body><main><h1>${heading}</h1><p>${escapeHtml(text)}</p></main>
<script>
  (function () {
    var origin = ${scriptJson(origin)};
    var payload = ${scriptJson({ type: "teather-auth", ...payload })};
    try { if (origin && window.opener) window.opener.postMessage(payload, origin); } catch (e) {}
    setTimeout(function () { window.close(); }, ${ok ? 600 : 4000});
  })();
</script>
</body></html>`);
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
