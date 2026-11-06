# Integrating Teather into a website

This guide is for developers and AI coding assistants adding Teather to a site. It is self-contained: follow it
top to bottom. For every function's exact signature, see the comments in
https://teather.pages.dev/v1/teather.js.

## What Teather is

Teather saves a site's per-user data (settings, notes, drafts, progress, copies of work) in the user's **own
Google Drive**, in a folder `Teather/<site-host>/`. The site needs no backend, database or accounts of its own.

- The data lives in the browser first (localStorage) and syncs to Drive when the user signs in with Google.
- Before sign-in, everything still works; data just stays in that browser. On first sign-in it is uploaded.
- Teather is for free, public sites, especially ones used by students.
- Each site can see only its own folder. Teather can see only files it created (`drive.file` scope).

There are two kinds of storage:

| | Key-value items | Files |
|---|---|---|
| API | `Teather.get/set/remove/keys/all` | `Teather.files.put/get/list/remove` |
| Works signed out | Yes (local only) | No, it throws `signed_out` |
| Synchronous | Yes, reads and writes are instant | No, every call is a network request |
| Size | 256 KB per value, 5 MB per site in total | 10 MB per file |
| Conflicts | Merged per key; newest write wins | Last write wins, or use `ifUnmodifiedSince` |
| Good for | Settings, preferences, small documents, progress, lists | Large or binary data, exports, copies of work |

## Step 1: Get the site registered (required, done by Teather's maintainer)

Teather only answers requests from registered origins. Until the site is registered, API calls fail with
`403 unknown_site` and the sign-in popup says the site "is not registered with Teather". **You cannot finish this
step in code.** Send the following to teather@technologylearningcompany.com:

- **Origins**: every exact origin the site runs on, for example `https://example.org` and `https://www.example.org`.
  Scheme, host and port must match exactly. Optionally add one `http://localhost:<port>` origin for testing
  against the live Teather.
- **Name** and **home page URL**.
- **Description**: one or two plain sentences, written for students, saying what the site is and why it saves data.
- **What it stores**: a few short phrases, such as "reading settings such as text size", "notes and highlights".
- **Removal warnings** (optional): anything a student should know before deleting the site's folder, such as
  "Files whose names start with "pending-" are work you have not submitted yet."
- **Contact**: a URL or email where students can ask about the site.

This text goes into a `README.md` in the student's Drive folder and onto https://teather.pages.dev/manage, so write
it for students, not developers.

All of a site's origins share one Drive folder. Note that each origin still has its own localStorage, so a user
who visits both `example.org` and `www.example.org` gets the same data only after signing in on each. Redirecting to
one canonical origin avoids confusion.

## Step 2: Add the script

```html
<script src="https://teather.pages.dev/v1/teather.js"></script>
```

- Always use the `/v1/` path. It stays backward compatible; a breaking change would go in `/v2/`.
- It defines a global `window.Teather`. There is no npm package. In a bundled app (React, Vue, Svelte and so on),
  load the script tag in the HTML page and access `window.Teather`. For TypeScript, declare it (see the end of this
  guide).
- `defer` is fine. Call `Teather.init()` once, after the script has loaded and before other calls (any call will
  also initialise it).

If the site sends a Content-Security-Policy, allow:

```
script-src  https://teather.pages.dev
connect-src https://teather.pages.dev
img-src     https://lh3.googleusercontent.com data:
```

(`img-src` is only needed for profile pictures.) The sign-in popup opens `https://teather.pages.dev`; it works
even under `Cross-Origin-Opener-Policy: same-origin`, because the script also polls for the result.

## Step 3: Store data

```js
Teather.init();

Teather.set("settings", { fontSize: 18, theme: "dark" }); // saved locally at once, synced ~1 s later
const settings = Teather.get("settings", { fontSize: 16, theme: "light" }); // second argument is the default
Teather.remove("draft:chapter-3");
Teather.keys();  // ["settings", ...]
Teather.all();   // { settings: {...}, ... }
```

- Values are anything `JSON.stringify` can handle. `undefined` and `null` both mean "delete".
- `get` returns a stored copy parsed from JSON each time; changing the returned object does not save it. Call
  `set` again with the new value.
- Keys: 1 to 200 characters. Use a short, stable naming scheme, such as `settings`, `note:<bookId>:<page>`,
  `progress:<courseId>`.

### Design the keys around how conflicts merge

The unit of sync is one key. When two devices change the same key, the later `set` wins and the other change
to that key is lost. Changes to different keys never conflict. So:

- **Split independent things into separate keys.** One key per note, per document or per course, not one big
  `notes` array. Two devices adding different notes then both survive.
- **Keep each value well under 256 KB.** A value over 256 KB is saved locally, but the server rejects the whole
  upload batch (`value_too_large`), the status becomes `"error"` and that browser's changes stop syncing until the
  value is made smaller. Check the size before saving anything that can grow:
  `new TextEncoder().encode(JSON.stringify(value)).length`.
- **The site's total stays under 5 MB.** Put large or binary data in files (Step 6).
- Deleted keys are remembered for 90 days so other devices learn about the deletion.

## Step 4: React to changes

Data can change under the page: after sign-in, when another device syncs, or in another tab.

```js
Teather.onChange(({ key, value, source }) => {
  // source: "local" (this page called set), "remote" (from Drive), "other-tab", or "signout"
  // value is undefined when the key was deleted
  if (key === "settings" && source !== "local") applySettings(value);
});

await Teather.ready(); // resolves after the first sync on page load (immediately when signed out)
```

A simple, robust pattern is to render from `Teather.get(...)` on load, then re-render the affected part in
`onChange` when `source !== "local"`. All `on*` functions return an unsubscribe function, which components should
call when they unmount.

## Step 5: Sign in and out

```js
signInButton.addEventListener("click", async () => {
  try {
    const user = await Teather.signIn(); // resolves after the first sync
  } catch (e) {
    // e.code: "popup_blocked", "timeout", or an error from Google (for example the user cancelled)
  }
});

Teather.onAuthChange((user) => {
  // user: { email, name, picture, host } or null
  signInButton.hidden = !!user;
  signOutButton.hidden = !user;
  avatar.src = user ? Teather.pictureUrl(64) : ""; // Google photo, or the user's initial on a coloured circle
});

signOutButton.addEventListener("click", () => Teather.signOut());
```

- **Call `signIn()` directly in the click handler**, before any `await`. Otherwise the browser blocks the popup.
- `Teather.isSignedIn()` and `Teather.user()` read the current state synchronously. `onAuthChange` does not fire
  on page load for an already signed-in user, so also call your update function once at startup with
  `Teather.user()`.
- `signOut()` uploads pending changes, then **clears this browser's copy** of the site's data (emitting `onChange`
  with `source: "signout"` for each key). That is right for shared computers. Use
  `Teather.signOut({ keepLocal: true })` to keep the local copy.
- If the user disconnects the site at teather.pages.dev/manage, or their session ends, the page is signed out the
  same way on its next request.
- To send people to their data for your site, link to `https://teather.pages.dev/manage?site=<your host>`
  (the `host` you registered, e.g. `?site=loomination.org`). That site's data opens once they sign in.
- Sessions last 60 days and renew when used.
- Show profile photos with `<img referrerpolicy="no-referrer">`; Google refuses some photo requests that carry a
  referrer.

### Show sync status (recommended)

```js
Teather.onStatus((s) => { statusEl.textContent = s; }); // "signed-out" | "syncing" | "synced" | "offline" | "error"
Teather.status(); // current value
```

Pending changes are kept and retried automatically: on the next `set`, when the window regains focus, when the
browser comes back online, and when the page is hidden. `Teather.sync()` forces a push and pull now.

## Step 6: Files (optional)

For large or binary data. Signed-in only: check `Teather.isSignedIn()` first, or catch `e.code === "signed_out"`.

```js
await Teather.files.put("export-2026-11.json", JSON.stringify(data), { contentType: "application/json" });
const blob = await Teather.files.get("export-2026-11.json"); // a Blob; use await blob.text() for text
const list = await Teather.files.list(); // [{ name, size, modifiedTime, contentType }]
await Teather.files.remove("export-2026-11.json"); // moves it to the user's Drive trash
```

- Names: letters, digits, `.`, `_` and `-`, up to 100 characters. A name can also be a path of up to 5 such names
  joined by `/`, such as `drafts/ch1.json`; Teather makes the folders. At the top level, `README.md`, `state.json` and
  names starting with `state.broken-` are reserved. `files.list()` lists only the top level.
- `put` accepts a Blob, ArrayBuffer, typed array or string, up to 10 MB, and resolves to the file's metadata.
- To avoid overwriting a newer copy from another device, pass the `version` you last saw:
  `put(name, data, { ifMatch: file.version })`, or `{ ifNoneMatch: "*" }` to only create a new file. The older
  `{ ifUnmodifiedSince: file.modifiedTime }` still works. These fail with `e.code === "precondition_failed"` if the
  file changed since.
- `get` on a missing file fails with `e.code === "not_found"`.
- Users can open, edit and delete these files in Drive. If the site must trust a file (for example work waiting to
  be submitted for a grade), sign or encrypt it with a key on the site's own server and check it when reading.

## Step 7: Know who signed in, on your own server (optional)

A site with its own server can use Teather sign-in as its login. In the browser, get a short-lived signed token and
send it to your server:

```js
await Teather.signIn();                 // in a click handler
const idToken = await Teather.idToken(); // a JWT, valid for 5 minutes
await fetch("/api/login", { method: "POST", body: JSON.stringify({ idToken }) });
```

On the server, check it before trusting it:

- The signature, with the keys at `https://teather.pages.dev/.well-known/jwks.json` (Ed25519, `alg: "EdDSA"`; pick
  the key by the header's `kid`, and fetch again when you see a new `kid`).
- `iss` is `https://teather.pages.dev`, `aud` is your site's host (for example `availabooks.com`) and `exp` hasn't
  passed.
- Claims: `sub` (the person's stable Google account id; use it as the key, not the email), `email`, `email_verified`
  (always `true`: Teather refuses Google accounts whose email isn't confirmed), `name`, `given_name`, `family_name`,
  `picture`, `origin` (the page that asked), `iat`, `exp` and `jti`.

Then create your own session. The token is only proof of who signed in; don't keep it.

## Step 8: Let your server use a person's folder (optional, needs registration)

Some sites need their server to save to a person's folder while that person is away (for example, grades for an
instructor while students submit work). This needs two things in the site's registration (Step 1): `serverKeys`, the
public half of an Ed25519 key your server signs with, and `serverAccess`, the text shown to people when they're asked.

1. **Ask the person.** In a click handler:

   ```js
   const allowed = await Teather.allowServerAccess(); // true, or false if they closed the window
   ```

   Teather shows its own page explaining what your server will do, then Google sign-in. The permission is recorded
   only after that sign-in, and it also signs them in to your site (check `Teather.user()` afterwards: they may have
   picked a different Google account). People can take it back at any time on `/manage`.

2. **Call Teather from your server.** Sign a fresh token for each request with your private key: header
   `{ alg: "EdDSA", kid }`, claims `{ iss: <your host>, aud: "https://teather.pages.dev", iat, exp, jti }`, with
   `exp` at most 120 seconds after `iat` and a random `jti` of 16 to 100 characters. Each token works once. Send it
   as `Authorization: Bearer <token>`, with no `Origin` header. `:sub` is the person's `sub` from their identity token.

   | Request | Does |
   |---|---|
   | `GET /api/server/users/:sub/grant` | `{ granted }`: whether they have given permission |
   | `GET /api/server/users/:sub/list?dir=a/b` | `{ files: [{ name, size, modifiedTime, contentType, version }], folders: [names] }` |
   | `GET /api/server/users/:sub/files/<path>` | the file, with `ETag: "<version>"` |
   | `PUT /api/server/users/:sub/files/<path>` | saves the raw body; `If-Match: "<version>"` or `If-None-Match: *`; returns `{ file }` |
   | `DELETE /api/server/users/:sub/files/<path>` | moves it to their Drive trash; optional `If-Match` |

   Errors your server should handle: `403 no_server_grant` (no permission, or it was taken back), `410
   user_disconnected` (their Google access ended), `412 precondition_failed`, `507 drive_full`, `401
   bad_server_token`. Keep your own copy of anything you write, and retry later: people can be disconnected for a
   while.

## Step 9: Moving existing localStorage data into Teather

If the site already keeps data in its own localStorage, copy it once on load. Don't overwrite anything Teather
already has:

```js
Teather.init();
const old = localStorage.getItem("myapp-settings");
if (old !== null && Teather.get("settings") === undefined) {
  Teather.set("settings", JSON.parse(old));
}
if (old !== null) localStorage.removeItem("myapp-settings");
```

If a user has data in Drive from another device and also local data from before signing in, the newer write of
each key wins when they sign in.

## Step 10: Test

- **Against the live Teather:** ask for a `http://localhost:<port>` origin to be added in Step 1, serve the site on
  that port and sign in. The data goes into the site's real Drive folder.
- **Against a local copy of Teather** (no registration needed): run Teather from
  its repository with `DEV=1` (see its README), which accepts any `http://localhost` origin. Then
  `Teather.init({ base: "http://localhost:8788" })`.
- Check: works signed out, sign-in uploads local data, a change in one browser shows up in another after a focus or
  reload, sign-out clears the page, and the status reaches `"synced"`.

## Errors

Promises from Teather reject with an `Error` that has `code`, `message` and (for HTTP errors) `status`. Main codes:

| `code` | Meaning |
|---|---|
| `unknown_site` | This origin isn't registered (Step 1). |
| `signed_out` | Not signed in, or the session ended. |
| `wrong_site` | The session belongs to a different site. |
| `popup_blocked` | `signIn()` wasn't called directly from a click, or pop-ups are blocked. |
| `timeout` | Sign-in wasn't completed within 5 minutes. |
| `offline` | Teather couldn't be reached; changes are kept and retried. |
| `value_too_large`, `state_too_large`, `file_too_large` | Over the limits above. |
| `bad_key`, `bad_name`, `reserved_name` | Key or file name not allowed. |
| `precondition_failed` | `ifMatch`, `ifNoneMatch` or `ifUnmodifiedSince` check failed. |
| `email_unverified` | The Google account's email isn't confirmed, so sign-in was refused. |
| `not_configured` | `idToken()`: this Teather server can't issue identity tokens. |
| `not_found` | File doesn't exist. |

## Options

```js
Teather.init({
  pushDelay: 1000,  // ms to wait after a set before uploading (0 to 60000)
  prefix: "teather:", // localStorage key prefix; change only if it clashes with the site's own keys
  base: "https://teather.pages.dev", // Teather server; change only for local testing
});
```

The local format is stable for v1: each item is `localStorage["teather:i:" + key] = JSON.stringify({ value,
updatedAt })`, where `value: null` means deleted. A page can read it directly if the script fails to load.

## TypeScript declaration

```ts
type TeatherUser = { email: string; name: string | null; picture: string | null; host: string };
type TeatherStatus = "signed-out" | "syncing" | "synced" | "offline" | "error";
type TeatherFile = { name: string; size: number; modifiedTime: string; contentType: string; version?: string };

declare global {
  interface Window {
    Teather: {
      init(opts?: { base?: string; prefix?: string; pushDelay?: number }): Window["Teather"];
      ready(): Promise<void>;
      get<T = unknown>(key: string, fallback?: T): T;
      set(key: string, value: unknown): void;
      remove(key: string): void;
      keys(): string[];
      all(): Record<string, unknown>;
      onChange(fn: (e: { key: string; value: unknown; source: "local" | "remote" | "other-tab" | "signout" }) => void): () => void;
      onAuthChange(fn: (user: TeatherUser | null) => void): () => void;
      onStatus(fn: (status: TeatherStatus) => void): () => void;
      status(): TeatherStatus;
      isSignedIn(): boolean;
      user(): TeatherUser | null;
      pictureUrl(size?: number, user?: TeatherUser | null): string | null;
      sync(): Promise<void>;
      signIn(): Promise<TeatherUser | null>;
      idToken(): Promise<string>;
      allowServerAccess(): Promise<boolean>;
      signOut(opts?: { keepLocal?: boolean }): Promise<void>;
      files: {
        list(): Promise<TeatherFile[]>;
        get(name: string): Promise<Blob>;
        put(name: string, data: Blob | ArrayBuffer | ArrayBufferView | string,
            opts?: { contentType?: string; ifUnmodifiedSince?: string; ifMatch?: string; ifNoneMatch?: "*" }): Promise<TeatherFile>;
        remove(name: string): Promise<void>;
      };
    };
  }
}
export {};
```

## Checklist

- [ ] Site registered with every origin it runs on (Step 1)
- [ ] `/v1/teather.js` loaded; `Teather.init()` called once
- [ ] CSP updated, if the site has one
- [ ] Keys split so that independent edits don't overwrite each other; values checked against 256 KB
- [ ] UI re-renders on `onChange` from `"remote"`, `"other-tab"` and `"signout"`
- [ ] Sign-in button calls `Teather.signIn()` directly in the click handler; errors shown to the user
- [ ] Signed-in state shown on load (`Teather.user()`) and on `onAuthChange`; sign-out button
- [ ] Sync status shown (optional but recommended)
- [ ] Existing localStorage data moved over once (if any)
- [ ] If your server uses `idToken()`: signature, `iss`, `aud` and `exp` checked; sessions keyed by `sub`
- [ ] If your server uses people's folders: `serverAccess` text registered, `allowServerAccess()` asked in a click,
      and `no_server_grant` / `user_disconnected` handled
- [ ] Tested signed out, signing in, across two browsers, and signing out
- [ ] The site's privacy text says it saves data in the user's Google Drive through Teather
