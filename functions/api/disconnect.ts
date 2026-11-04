import { json } from "../../src/env";
import { disconnectUser } from "../../src/db";
import { requireManage, route } from "../../src/http";

/** "Sign out everywhere": revoke Google access and end every session. Drive files are kept. */
export const onRequestPost = route(async (ctx) => {
  const session = await requireManage(ctx);
  await disconnectUser(ctx.env, session.sub);
  return json({ ok: true });
});
