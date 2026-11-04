import { json } from "../../../src/env";
import { deleteSession } from "../../../src/db";
import { route } from "../../../src/http";

/** End this browser's session. Missing or expired tokens are fine. */
export const onRequestPost = route(async (ctx) => {
  const m = /^Bearer\s+(\S+)$/i.exec(ctx.request.headers.get("Authorization") ?? "");
  if (m) await deleteSession(ctx.env, m[1]);
  return json({ ok: true });
});
