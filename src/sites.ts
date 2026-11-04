/**
 * Sites allowed to save student data through teather.
 *
 * Each site gets its own folder, Teather/<host>/, in the student's Drive.
 * The text here is shown to students in that folder's README.md and on /manage.
 * Bump `version` whenever you change the text so students' READMEs are rewritten.
 */
export interface Site {
  /** Folder name in the student's Drive. */
  host: string;
  /** Exact browser origins that may use this site's folder. */
  origins: string[];
  name: string;
  url: string;
  /** One or two plain sentences for students. */
  description: string;
  /** What the site saves, as short phrases. */
  stores: string[];
  /** Extra warnings shown before a student deletes this site's data. */
  removalNotes?: string[];
  /** Where a student can ask questions about this site. */
  contact: string;
  version: number;
}

export const SITES: Site[] = [
  {
    host: "loomination.org",
    // localhost:3000 is `npx serve` for local testing against the live Teather; it signs in to the same folder.
    origins: ["https://www.loomination.org", "https://loomination.org", "http://localhost:3000"],
    name: "Loomination",
    url: "https://www.loomination.org",
    description:
      "Loomination is a free weaving design tool. It saves your drafts and settings here so they follow you to any computer you sign in on.",
    stores: [
      "weaving drafts you have saved",
      "your loom profile",
      "warp plans and yarn calculations",
      "your yarn stash and AI-assistant notes",
    ],
    contact: "https://www.loomination.org",
    version: 1,
  },
  {
    host: "availabooks.com",
    origins: [
      "https://availabooks.com",
      "https://app.availabooks.com",
      "https://availabook.blogspot.com",
    ],
    name: "AvailaBooks",
    url: "https://availabooks.com",
    description:
      "AvailaBooks publishes free online textbooks. It saves your reading settings, notes and highlights here, and can keep copies of work you have not yet submitted.",
    stores: [
      "reading settings such as text size",
      "notes and highlights",
      "copies of work waiting to be submitted",
    ],
    removalNotes: [
      "Files whose names start with \"pending-\" are work you have not submitted yet. If you delete them before submitting, that work is lost.",
    ],
    contact: "https://availabooks.com",
    version: 1,
  },
];

/** Used for any http://localhost or 127.0.0.1 origin when DEV is "1". */
export const DEV_SITE: Site = {
  host: "localhost",
  origins: [],
  name: "Local development",
  url: "http://localhost",
  description:
    "A site running on a developer's own computer. This folder holds test data and can be deleted.",
  stores: ["test data"],
  contact: "https://teather.pages.dev",
  version: 1,
};

const DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function siteForOrigin(origin: string | null, dev: boolean): Site | null {
  if (!origin) return null;
  for (const site of SITES) if (site.origins.includes(origin)) return site;
  if (dev && DEV_ORIGIN.test(origin)) return DEV_SITE;
  return null;
}

export function siteForHost(host: string): Site | null {
  if (host === DEV_SITE.host) return DEV_SITE;
  return SITES.find((s) => s.host === host) ?? null;
}
