# Google Cloud setup for Teather

Teather needs a Google OAuth client so students can sign in and let it save files in their Drive.
It takes about 15 minutes, and you do it once.

## 1. Create a project and turn on the Drive API

1. Go to https://console.cloud.google.com/ and create a project named **Teather**.
2. Open **APIs & Services → Library**, search for **Google Drive API**, and click **Enable**.

## 2. Set up the consent screen

Open **Google Auth Platform** (previously "OAuth consent screen") and click **Get started**. The setup asks for:

- **App information:** App name **Teather**, and your email address as the user support email
- **Audience:** **External**
- **Contact information:** your email address

Agree to the policy and click **Create**.

**Branding page (after setup)**

Setup doesn't ask for these. Open **Branding** in the left menu and add them there:
- App logo: **leave it empty for now.** Any logo means Google requires verification before the app can be published
  (step 4). When you're ready for verification (step 5), upload `public/logo-120.png` (120×120 PNG).
- App home page: `https://teather.technologylearningcompany.com`
- Privacy policy: `https://teather.technologylearningcompany.com/privacy.html`
- Terms of service: `https://teather.technologylearningcompany.com/terms.html`
- Authorized domains: `technologylearningcompany.com`

They aren't required to create the client in step 3, but Google needs them before it will verify the app's branding,
and the privacy page should be deployed first.

**Data access**
Open **Data access**, click **Add or remove scopes**, and add:
- `openid`
- `.../auth/userinfo.email` ("See your primary Google Account email address")
- `.../auth/userinfo.profile` ("See your personal info…"). Sites use it to show the student's name and photo.
- `.../auth/drive.file`

To find a scope, type part of its name (`email`, `drive.file`) in the filter box above the table. If one isn't listed,
paste its full URL into **Manually add scopes** at the bottom of the panel and click **Add to table**:
- `https://www.googleapis.com/auth/userinfo.email`
- `https://www.googleapis.com/auth/userinfo.profile`
- `https://www.googleapis.com/auth/drive.file`. This one is listed only after the Drive API is enabled (step 1).

Click **Update**, then **Save**.

All four are "non-sensitive", so Google's security assessment isn't required. `openid`, email and profile sign-in work even if
they aren't listed here, but listing them keeps what the app declares in line with what it asks for.

## 3. Create the OAuth client

Open **Clients → Create client**.
- Application type: **Web application**
- Name: `Teather`
- Authorized redirect URIs:
  - `https://teather.technologylearningcompany.com/auth/callback`
  - `https://teather.pages.dev/auth/callback` (the old address, still used by sites that load `teather.js` from it)
  - `http://localhost:8788/auth/callback` (for local development)
- Authorized JavaScript origins: **leave empty.** That setting is for apps whose web pages get tokens from Google
  directly in the browser. In Teather, the server gets the tokens after Google redirects to `/auth/callback`, so only the
  redirect URIs matter. Sites that use Teather, such as Loomination, never talk to Google; [src/sites.ts](../src/sites.ts)
  controls which sites are allowed.

Copy the **Client ID** and **Client secret**.

## 4. Publish the app

Under **Audience**, click **Publish app** so the status becomes **In production**.

Google asks you to submit for verification if the app has a logo, more than 10 domains, or sensitive scopes. Teather
has none of these as long as no logo is uploaded, so it publishes straight away. If Google asks for verification, check
Branding and remove the logo.

This matters. While the app is in **Testing**, Google:
- ends every student's sign-in after **7 days**, and
- allows only 100 named test users.

## 5. Brand verification (optional at first)

Until Google verifies the branding, sign-in still works, but students see the raw domain on the consent screen instead
of the Teather name. To verify:

1. Prove you own `teather.technologylearningcompany.com` in Google Search Console. Choose the "URL prefix" property and use the HTML file
   method: Google gives you a file (Teather's is served by `functions/googlefc46433408f3371e.html.ts`); serve it and deploy.
2. Then submit for verification under **Verification Center**.

## 6. Give the secrets to Cloudflare

From this folder:

```sh
npx wrangler pages secret put GOOGLE_CLIENT_ID     --project-name teather
npx wrangler pages secret put GOOGLE_CLIENT_SECRET --project-name teather
npx wrangler pages secret put TOKEN_ENC_KEY        --project-name teather
```

For `TOKEN_ENC_KEY`, generate 32 random bytes:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

You don't need to keep a copy. Only the server uses this key, and Cloudflare stores it. If it's lost or replaced,
every student signs in once more; their data in Drive is untouched. Keep it in a password manager only if you might
move Teather to a new project or account and want students to stay signed in. **Never commit it to the repo.** With
the key and a copy of the database, someone could decrypt the stored Google tokens. Local development uses its own
key in `.dev.vars`.

For local development, put the same three values plus `DEV=1` in `.dev.vars`. That file is git-ignored.
