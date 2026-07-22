import { describe, expect, it } from "vitest";
import { DEFAULT_UPDATE_MANIFEST_URL, DEFAULT_UPDATE_REPO, isNewer, isValidRepo, parseLatestRelease, parseManifest, pickInstaller } from "../src/updates";

describe("update helpers", () => {
  it("validates owner/repo slugs", () => {
    expect(isValidRepo("chris/the-long-rot")).toBe(true);
    expect(isValidRepo("MaggotClaw-Games/app.repo")).toBe(true);
    expect(isValidRepo("")).toBe(false);
    expect(isValidRepo("just-a-name")).toBe(false);
    expect(isValidRepo("too/many/parts")).toBe(false);
    expect(isValidRepo("https://github.com/x/y")).toBe(false);
  });

  it("compares versions with or without a leading v", () => {
    expect(isNewer("v0.7.0", "0.6.7")).toBe(true);
    expect(isNewer("0.6.7", "0.6.7")).toBe(false);
    expect(isNewer("0.6.6", "0.6.7")).toBe(false);
    expect(isNewer("1.0.0", "0.9.9")).toBe(true);
  });

  it("prefers the setup .exe installer asset", () => {
    const assets = [
      { name: "MaggotClaw Games_0.7.0_x64.msi", browser_download_url: "u-msi" },
      { name: "MaggotClaw Games_0.7.0_x64-setup.exe", browser_download_url: "u-setup" },
      { name: "portable.exe", browser_download_url: "u-exe" }
    ];
    expect(pickInstaller(assets)).toBe("u-setup");
  });

  it("falls back to any exe, then null", () => {
    expect(pickInstaller([{ name: "portable.exe", browser_download_url: "u" }])).toBe("u");
    expect(pickInstaller([{ name: "notes.txt", browser_download_url: "u" }])).toBeNull();
    expect(pickInstaller([])).toBeNull();
  });

  it("parses a GitHub latest-release payload", () => {
    const info = parseLatestRelease({
      tag_name: "v0.7.1",
      html_url: "https://github.com/x/y/releases/tag/v0.7.1",
      body: "  Fixed the voice bar.  ",
      assets: [{ name: "app_0.7.1_x64-setup.exe", browser_download_url: "dl" }]
    });
    expect(info.version).toBe("0.7.1");
    expect(info.url).toBe("dl");
    expect(info.page).toContain("releases/tag");
    expect(info.notes).toBe("Fixed the voice bar.");
  });
});

describe("where updates are looked for", () => {
  // The repository used to be named here as a fallback, which quietly made
  // every install depend on it staying public.
  it("does not point at GitHub out of the box", () => {
    expect(DEFAULT_UPDATE_REPO).toBe("");
    expect(isValidRepo(DEFAULT_UPDATE_REPO)).toBe(false);
  });

  it("ships the author's own update file as the default", () => {
    expect(DEFAULT_UPDATE_MANIFEST_URL).toMatch(/^https:\/\/[^\s]*dropbox\.com\//);
    expect(DEFAULT_UPDATE_MANIFEST_URL).toContain("latest-version.json");
    // dl=1 is what makes Dropbox hand back the file instead of a web page.
    expect(DEFAULT_UPDATE_MANIFEST_URL).toContain("dl=1");
  });

  it("accepts the installer address that file points to", () => {
    const manifest = parseManifest(JSON.stringify({
      version: "1.24.1-beta",
      installerUrl: "https://www.dropbox.com/scl/fi/abc/MaggotClaw%20Games_1.24.1-beta_x64-setup.exe?dl=1",
      notes: "Page-exact chapters."
    }));
    expect(manifest).toMatchObject({ version: "1.24.1-beta", notes: "Page-exact chapters." });
  });

  it("refuses an installer hosted anywhere but the author's storage", () => {
    expect(parseManifest(JSON.stringify({ version: "9.9.9", installerUrl: "https://example.com/evil.exe" }))).toBeNull();
  });
});
