import { describe, expect, it } from "vitest";
import { decrypt, encrypt, randomToken, toBase64 } from "../src/crypto";
import { siteForHost, siteForOrigin, SITES } from "../src/sites";
import { rootReadme, siteReadme } from "../src/readme";
import { checkFileName } from "../src/store";
import { originAllowed } from "../src/http";
import type { Env } from "../src/env";

const KEY = toBase64(new Uint8Array(32).fill(7));

describe("crypto", () => {
  it("encrypts and decrypts", async () => {
    const secret = "1//refresh-token-" + randomToken();
    const enc = await encrypt(secret, KEY);
    expect(enc).not.toContain("refresh");
    expect(await decrypt(enc, KEY)).toBe(secret);
    expect(await encrypt(secret, KEY)).not.toBe(enc); // fresh IV each time
  });

  it("fails with the wrong key", async () => {
    const enc = await encrypt("x", KEY);
    await expect(decrypt(enc, toBase64(new Uint8Array(32).fill(8)))).rejects.toThrow();
  });
});

describe("sites", () => {
  it("maps origins to sites", () => {
    expect(siteForOrigin("https://www.loomination.org", false)?.host).toBe("loomination.org");
    expect(siteForOrigin("https://app.availabooks.com", false)?.host).toBe("availabooks.com");
    expect(siteForOrigin("https://evil.example", false)).toBeNull();
    expect(siteForOrigin("https://www.loomination.org.evil.example", false)).toBeNull();
  });

  it("allows localhost only in development", () => {
    expect(siteForOrigin("http://localhost:5173", false)).toBeNull();
    expect(siteForOrigin("http://localhost:5173", true)?.host).toBe("localhost");
    expect(siteForOrigin("http://localhost.evil.example", true)).toBeNull();
  });

  it("checks API origins", () => {
    const env = { DEV: "0" } as Env;
    expect(originAllowed("https://teather.pages.dev", "https://teather.pages.dev", env)).toBe(true);
    expect(originAllowed("https://loomination.org", "https://teather.pages.dev", env)).toBe(true);
    expect(originAllowed("https://evil.example", "https://teather.pages.dev", env)).toBe(false);
  });

  it("has a unique host for each site", () => {
    const hosts = SITES.map((s) => s.host);
    expect(new Set(hosts).size).toBe(hosts.length);
    for (const s of SITES) expect(siteForHost(s.host)).toBe(s);
  });
});

describe("file names", () => {
  it("accepts ordinary names", () => {
    expect(() => checkFileName("pending-ch3-quiz.enc")).not.toThrow();
  });
  it("protects Teather's own files and rejects paths", () => {
    for (const bad of ["README.md", "readme.md", "state.json", "State.JSON", "state.broken-2026.json"]) {
      expect(() => checkFileName(bad)).toThrow(/reserved/);
    }
    for (const bad of ["../x", "a/b", "", ".", "..", "x".repeat(101), "a b"]) {
      expect(() => checkFileName(bad)).toThrow();
    }
  });
});

describe("READMEs", () => {
  const loom = siteForHost("loomination.org")!;
  const books = siteForHost("availabooks.com")!;

  it("root README explains ownership and lists sites", () => {
    const text = rootReadme([{ site: loom, folderId: "F1" }]);
    expect(text).toContain("your data");
    expect(text).toContain("Loomination");
    expect(text).toContain("https://drive.google.com/drive/folders/F1");
    expect(text).toContain("Delete & disconnect");
    expect(rootReadme([])).toContain("None yet");
  });

  it("site README includes the site's removal warnings", () => {
    expect(siteReadme(books)).toContain('"pending-"');
    expect(siteReadme(loom)).not.toContain("**Note:**");
    expect(siteReadme(loom)).toMatchSnapshot();
  });
});
