import { HttpError, json } from "../../src/env";
import { getUser } from "../../src/db";
import { requireSite, route } from "../../src/http";
import { ID_TOKEN_TTL_S, issueIdToken } from "../../src/identity";

/**
 * POST /api/token: a signed identity token for the signed-in student, for the site's own server.
 * The site sends it to its server, which checks it against /.well-known/jwks.json.
 */
export const onRequestPost = route(async (ctx) => {
  const { session } = await requireSite(ctx);
  const user = await getUser(ctx.env, session.sub);
  if (!user) throw new HttpError(401, "Please sign in again", "signed_out");
  const token = await issueIdToken(ctx.env, new URL(ctx.request.url).origin, session, user);
  return json({ token, expiresIn: ID_TOKEN_TTL_S });
});
