import type { Env } from "../../src/env";
import { json } from "../../src/env";
import { corsHeaders, errorResponse, originAllowed } from "../../src/http";

/** CORS for every /api route. Requests from sites not in the registry are refused. */
export const onRequest: PagesFunction<Env> = async (ctx) => {
  const origin = ctx.request.headers.get("Origin");
  const self = new URL(ctx.request.url).origin;
  if (origin && !originAllowed(origin, self, ctx.env)) {
    return json({ error: "unknown_site", message: `${origin} is not registered with Teather` }, 403);
  }
  const cors = origin ? corsHeaders(origin) : {};
  if (ctx.request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  let res: Response;
  try {
    res = await ctx.next();
  } catch (e) {
    res = errorResponse(e);
  }
  res = new Response(res.body, res);
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
  res.headers.set("Cache-Control", "no-store");
  return res;
};
