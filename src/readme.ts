import type { Site } from "./sites";
import { folderUrl } from "./drive";

/** Bump when the root README template changes so every student's copy is rewritten. */
export const ROOT_README_VERSION = 2;

export const TEATHER_URL = "https://teather.technologylearningcompany.com";
const MANAGE_URL = `${TEATHER_URL}/manage`;

export function rootReadme(sites: { site: Site; folderId: string }[]): string {
  const list = sites.length
    ? sites
        .map(({ site, folderId }) => `- **${site.name}** (${site.url}): folder \`${site.host}\`, ${folderUrl(folderId)}`)
        .join("\n")
    : "- None yet.";
  return `# Your Teather folder

This folder holds **your data**. It belongs to you, and it lives in your own Google Drive.

## What is this?

Teather lets free websites save things for you, such as settings, notes, highlights and drafts, without
running their own accounts or servers. When you clicked "Sign in with Google" on one of those sites, you allowed
Teather to keep that site's data here, so it follows you to any computer and costs you nothing.

- Each site gets its own folder inside this one.
- Teather can only see the files it created in this folder. It cannot see anything else in your Google Drive.
- The sites themselves never get access to your Google account. They only see their own folder's data, through Teather.

## Sites using this folder

${list}

Each site folder has its own README explaining what that site saves.

## Managing your data

- **See, edit, download or delete it:** go to ${MANAGE_URL} and sign in with this Google account.
- **Look at the files directly:** open any site folder here. \`state.json\` holds that site's saved settings and items
  as text. Other files in a site folder are things the site saved for you, such as copies of work.
- **Download everything:** right-click this folder and choose Download.

Please don't edit \`state.json\` by hand unless you are comfortable with JSON. If the file can't be read, Teather
keeps it as \`state.broken-<date>.json\` and starts a fresh one, so nothing is lost. You can delete those backups.

## Removing data safely

To remove one site's data:

1. Go to ${MANAGE_URL} and choose **Delete & disconnect** for that site. This signs you out of the site on every
   device and moves its folder to your Drive trash.
2. Or: sign out on the site first, then delete its folder here.

If you delete a folder while you are still signed in on the site, the copy saved in your browser will be uploaded
again the next time you use the site.

Deleted folders stay in your Google Drive trash for 30 days, in case you change your mind.

## Stopping Teather completely

On ${MANAGE_URL}, choose **Sign out everywhere**. Or open your Google Account, go to Security, then
"Your connections to third-party apps & services", find Teather, and remove its access.
Your files stay here until you delete them.

Privacy: ${TEATHER_URL}/privacy.html

_Teather writes this file and may update it. Your edits to it will be replaced._
`;
}

export function siteReadme(site: Site): string {
  const stores = site.stores.map((s) => `- ${s}`).join("\n");
  const notes = (site.removalNotes ?? []).map((n) => `- **Note:** ${n}`).join("\n");
  return `# ${site.name}

${site.description}

Website: ${site.url}

## What ${site.name} saves here

${stores}

## Files in this folder

- \`state.json\`: ${site.name}'s saved settings and items, as text.
- \`README.md\`: this file.
- Any other files are things ${site.name} saved for you.
- \`state.broken-<date>.json\`, if present, is a backup of a file Teather couldn't read. You can delete it.

## Managing this data

Go to ${MANAGE_URL}, sign in with this Google account and choose ${site.name}. There you can see each saved item,
edit or delete it, download files, or download everything.

## Removing it safely

1. On ${MANAGE_URL}, choose **Delete & disconnect** for ${site.name}. This signs you out of ${site.name} on every
   device and moves this folder to your Drive trash.
2. Or: sign out on ${site.name} first, then delete this folder.

If you delete this folder while you are still signed in on ${site.name}, the copy saved in your browser will be
uploaded again the next time you use it.
${notes ? `\n${notes}\n` : ""}
## Questions

About ${site.name}: ${site.contact}
About Teather: ${TEATHER_URL}

_Teather writes this file and may update it. Your edits to it will be replaced._
`;
}
