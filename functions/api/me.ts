import { HttpError, json } from "../../src/env";
import { freshProfile, getUser } from "../../src/db";
import { requireSession, route } from "../../src/http";
import { siteForHost } from "../../src/sites";

/** The signed-in student: {email, name, picture, site, manage}. `picture` is a Google photo URL or null. */
export const onRequestGet = route(async (ctx) => {
  const session = await requireSession(ctx);
  const user = await getUser(ctx.env, session.sub);
  if (!user) throw new HttpError(401, "Please sign in again", "signed_out");
  const profile = await freshProfile(ctx.env, user);
  const site = session.manage ? null : siteForHost(session.host);
  return json({
    email: user.email,
    name: profile.name,
    picture: profile.picture,
    site: site ? { host: site.host, name: site.name } : null,
    manage: session.manage,
  });
});
