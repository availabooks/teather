import { HttpError, json } from "../../../src/env";
import { takeHandoff } from "../../../src/db";
import { readJson, route } from "../../../src/http";

/**
 * POST {poll} — the site page collects its sign-in result here when the popup
 * couldn't postMessage back (Google's pages often cut the popup's link to its opener).
 * Returns {pending: true} until the result is ready. Each result can be collected once.
 */
export const onRequestPost = route(async (ctx) => {
  const origin = ctx.request.headers.get("Origin");
  if (!origin) throw new HttpError(400, "Origin header required", "bad_request");
  const body = (await readJson(ctx.request)) as { poll?: unknown };
  if (typeof body.poll !== "string" || !/^[A-Za-z0-9_-]{20,100}$/.test(body.poll)) {
    throw new HttpError(400, "poll must be the id passed to /auth/start", "bad_request");
  }
  const payload = await takeHandoff(ctx.env, body.poll, origin);
  return json(payload ?? { pending: true });
});
