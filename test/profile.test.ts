import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { idTokenClaims } from "../src/google";

function fakeIdToken(claims: object): string {
  const b64 = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `header.${b64}.signature`;
}

describe("idTokenClaims", () => {
  it("reads name and picture, including accented names", () => {
    const c = idTokenClaims(fakeIdToken({ sub: "1", email: "a@b.c", name: "Zoë Núñez", picture: "https://lh3.googleusercontent.com/a/x=s96-c" }));
    expect(c).toEqual({
      sub: "1",
      email: "a@b.c",
      emailVerified: false,
      givenName: null,
      familyName: null,
      name: "Zoë Núñez",
      picture: "https://lh3.googleusercontent.com/a/x=s96-c",
    });
  });

  it("reads email_verified and the given and family names", () => {
    const c = idTokenClaims(fakeIdToken({ sub: "1", email: "a@b.c", email_verified: true, given_name: "Zoë", family_name: "Núñez" }));
    expect(c.emailVerified).toBe(true);
    expect(c.givenName).toBe("Zoë");
    expect(c.familyName).toBe("Núñez");
    expect(idTokenClaims(fakeIdToken({ sub: "1", email: "a@b.c", email_verified: "true" })).emailVerified).toBe(true);
  });

  it("allows a missing profile", () => {
    const c = idTokenClaims(fakeIdToken({ sub: "1", email: "a@b.c" }));
    expect(c.name).toBeNull();
    expect(c.picture).toBeNull();
  });
});

/** Load public/teather.js the way a browser would, with just enough of a browser to run it. */
function loadTeather() {
  const src = readFileSync(new URL("../public/teather.js", import.meta.url), "utf8");
  const win: Record<string, unknown> = {};
  new Function("window", "document", src.replace(/typeof window !== "undefined" \? window : this/, "window"))(win, {
    currentScript: null,
  });
  return win.Teather as { pictureUrl: (size: number, user: object | null) => string | null };
}

describe("Teather.pictureUrl", () => {
  const T = loadTeather();

  it("resizes Google photos", () => {
    expect(T.pictureUrl(48, { picture: "https://lh3.googleusercontent.com/a/abc=s96-c" })).toBe(
      "https://lh3.googleusercontent.com/a/abc=s48-c",
    );
    expect(T.pictureUrl(48, { picture: "https://example.com/me.png" })).toBe("https://example.com/me.png");
  });

  it("draws an initial when there is no photo", () => {
    const url = T.pictureUrl(64, { email: "zoe@example.com", name: "Zoë" })!;
    expect(url.startsWith("data:image/svg+xml")).toBe(true);
    expect(decodeURIComponent(url)).toContain(">Z</text>");
  });

  it("uses a stable color per email", () => {
    const a = T.pictureUrl(64, { email: "one@example.com" });
    expect(T.pictureUrl(64, { email: "one@example.com" })).toBe(a);
    const colors = new Set(
      ["a", "b", "c", "d", "e", "f", "g", "h"].map((x) => /fill="(#[0-9a-f]+)"/.exec(decodeURIComponent(T.pictureUrl(64, { email: `${x}@ex.com` })!))![1]),
    );
    expect(colors.size).toBeGreaterThan(1);
  });

  it("escapes odd characters and handles signed out", () => {
    expect(decodeURIComponent(T.pictureUrl(64, { name: "<script>", email: "" })!)).not.toContain("<script>");
    expect(T.pictureUrl(64, null)).toBeNull();
  });
});
