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
  /**
   * Public Ed25519 keys (JWK) the site's own server signs its tokens with, for /api/server.
   * The private halves are secrets on the site's server and never belong here.
   */
  serverKeys?: ServerKey[];
  /**
   * Shown on the page where a person lets the site's server use their folder while they are away.
   * Sites without this can't ask for server access.
   */
  serverAccess?: {
    /** One or two sentences: why the server needs it. */
    summary: string;
    /** What the server reads and writes, as short phrases. */
    uses: string[];
  };
}

export interface ServerKey {
  kid: string;
  kty: "OKP";
  crv: "Ed25519";
  x: string;
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
      "https://dev.availabooks.com",
      "https://local.availabooks.com:2732",
      "https://availabook.blogspot.com",
    ],
    name: "AvailaBooks",
    url: "https://availabooks.com",
    description:
      "AvailaBooks publishes free online textbooks and runs courses that use them. Signing in to Teather is how you sign in to AvailaBooks, so AvailaBooks learns your name, email address and Google photo. Your photo is shown to other readers next to notes you share and on your public page, unless you choose to show your initial instead (on your AvailaBooks profile page). It saves your reading settings, notes and highlights here. If you teach a course, that course's settings, class list, grades and students' finished work are kept here too.",
    stores: [
      "reading settings such as text size",
      "notes and highlights you write, in the \"notes\" folder (one folder per book)",
      "copies of work waiting to be submitted",
      "for instructors: each course's settings, class list, grades and students' finished work, in the \"courses\" folder",
    ],
    removalNotes: [
      "Files whose names start with \"pending-\" are work you have not submitted yet. If you delete them before submitting, that work is lost.",
      "If you teach a course, the \"courses\" folder is the main copy of its settings, class list and grades. AvailaBooks keeps a working copy, but deleting the folder or taking back AvailaBooks' access means changes stop reaching your Drive.",
      "The \"notes\" folder is the only copy of your private notes and highlights: AvailaBooks doesn't keep them. If you delete it, they are gone. Note sets you share with other readers or with a course are also kept by AvailaBooks, so they can be shown to them.",
    ],
    contact: "https://availabooks.com",
    version: 5,
    serverKeys: [
      { kid: "availabooks-server-2026-11-06-b42db5", kty: "OKP", crv: "Ed25519", x: "NRtSpG3Neio9CLDOk8693O7qM_FeMshxjqP2ZqVBhyg" },
    ],
    serverAccess: {
      summary:
        "AvailaBooks keeps your notes and highlights, and the courses you teach, in your Teather folder. Notes can be written from any device, and students submit work and earn grades when you aren't online, so AvailaBooks' server needs to save those to your folder for you.",
      uses: [
        "your notes and highlights, and the details of note sets you own (title, who they're shared with, and which courses can see them)",
        "it reads your notes back to restore them, including any changes you make to them in Drive",
        "course settings: title, books, dates and assignments",
        "the class list and invitations",
        "each student's grades",
        "students' finished work, once they submit it",
        "it reads these files back, including any changes you make to them in Drive",
      ],
    },
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
  contact: "https://teather.technologylearningcompany.com",
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
