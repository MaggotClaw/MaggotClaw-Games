import { describe, expect, it } from "vitest";
import { isNewer, isValidRepo, parseLatestRelease, pickInstaller } from "../src/updates";

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
