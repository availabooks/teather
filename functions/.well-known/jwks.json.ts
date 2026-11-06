import type { Env } from "../../src/env";
import { jwks } from "../../src/identity";

/** Public keys for checking Teather identity tokens. Anyone may fetch these. */
export const onRequestGet: PagesFunction<Env> = async (ctx) =>
  new Response(JSON.stringify(jwks(ctx.env)), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
