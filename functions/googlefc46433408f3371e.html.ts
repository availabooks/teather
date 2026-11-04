// Google Search Console ownership check for teather.pages.dev (needed for Google's
// sign-in branding verification). Served by a function because Pages redirects
// static *.html paths to extensionless ones, which the check may not follow.
// Keep this file: Google re-checks it periodically.
export const onRequestGet: PagesFunction = () =>
  new Response("google-site-verification: googlefc46433408f3371e.html", {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
