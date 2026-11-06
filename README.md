# Teather

Free websites use Teather to save each student's data (settings, notes, highlights, drafts, copies of work) in the
**student's own Google Drive**. The student owns it and can see it, and nobody pays for storage.

- **Site:** https://teather.pages.dev (Cloudflare Pages project `teather`, with Pages Functions and D1)
- **For students:** https://teather.pages.dev/manage
- **First sites:** [Loomination](https://www.loomination.org) and [AvailaBooks](https://availabooks.com)

## How it works

```
site ── teather.js ── popup ──> /auth/start ──> Google sign-in ──> /auth/callback
  │                                                   (encrypted refresh token kept in D1)
  └── /api/state, /api/files (session token) ──> Pages Functions ──> student's Drive:
                                                                       Teather/
                                                                         README.md
                                                                         <site-host>/
                                                                           README.md
                                                                           state.json
                                                                           <other files>
```

- **Permissions.** Teather asks Google only for `drive.file`, so it can see only the files it creates.
- **Folders.** Each site gets its own folder. A site's session works only for that site's folder.
- **`state.json`** holds the site's items as `{ key: { value, updatedAt } }`. Edits are merged key by key and the newest
  wins. The same format is used by AvailaBooks' synced-storage.
- **READMEs.** Teather writes the `README.md` files from [src/sites.ts](src/sites.ts) and [src/readme.ts](src/readme.ts).
  Each one tells the student what the folder is for and how to remove it safely.
- **What Teather's database (D1) holds:** students' emails, encrypted Google tokens, hashed session tokens, and cached
  Drive ids. Student data is never stored there.

## Adding a site

Add an entry to `SITES` in [src/sites.ts](src/sites.ts), with its origins, the text students will see, and any
removal warnings. Then deploy. Bump `version` whenever you change a site's text, so students' READMEs are rewritten.

## Using it from a site

```html
<script src="https://teather.pages.dev/v1/teather.js"></script>
<script>
  Teather.init();
  Teather.set("settings", { fontSize: 18 });   // local at once, synced about 1 second later
  Teather.get("settings");
  Teather.onChange(({ key, value, source }) => {});
  button.onclick = () => Teather.signIn();     // must be called from a click
  await Teather.files.put("pending-ch3.enc", blob);
  img.src = Teather.pictureUrl(64);            // Google photo, or initial on a circle
  // use <img referrerpolicy="no-referrer"> for Google photos
</script>
```

See the comments in [public/teather.js](public/teather.js) for the full API.

The full guide for site builders and AI coding assistants is [public/integrate.md](public/integrate.md), served at
https://teather.pages.dev/integrate.md (and listed in `/llms.txt`). Keep it in step with `teather.js`.

## Development

```sh
npm install
npm test                    # unit tests
npm run typecheck
npm run db:migrate:local
npx wrangler pages dev --port 8788
```

- `.dev.vars` needs `DEV=1`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `TOKEN_ENC_KEY`. To test identity
  tokens, also set `ID_SIGNING_KEY` (a private Ed25519 JWK, as one line of JSON) and `ID_SIGNING_KID`.
- `DEV=1` allows any `http://localhost` origin.
- To test as a separate site, open [public/demo.html](public/demo.html) from another port, for example
  `npx serve public -l 3000`, then go to `http://localhost:3000/demo.html`.

## Deploying

The first time:
1. Set up Google as described in [docs/google-setup.md](docs/google-setup.md).
2. Set the secrets on the Pages project: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENC_KEY`, and for
   identity tokens `ID_SIGNING_KEY` and `ID_SIGNING_KID` (optionally `ID_SIGNING_OLD_PUBLIC` while rotating keys).
   Make a signing key with
   `node -e "const k=require('crypto').generateKeyPairSync('ed25519').privateKey.export({format:'jwk'});console.log(JSON.stringify(k))"`.
3. Run `npm run db:migrate:remote`.

Then, and for every update:

```sh
npx wrangler pages deploy --project-name teather
```
