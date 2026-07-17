import { describe, expect, it } from "vitest";
import { parseAccessMap, roleMayDownload, type FileAccessMap } from "../src/fileAccess";

describe("file access ratings", () => {
  const map: FileAccessMap = {
    "/The Long Rot/Chapter 1.txt": "reader",
    "/The Long Rot/Master Codex.txt": "editor",
    "/The Long Rot/Owner Notes.txt": "administrator",
    "/The Long Rot/Old Build Log.txt": "excluded"
  };

  it("lets a reader take only reader-rated and unrated files", () => {
    expect(roleMayDownload(map, "/The Long Rot/Chapter 1.txt", "reader")).toBe(true);
    expect(roleMayDownload(map, "/The Long Rot/Master Codex.txt", "reader")).toBe(false);
    expect(roleMayDownload(map, "/The Long Rot/Something Unrated.txt", "reader")).toBe(true);
  });

  it("opens editor files at editor level and above", () => {
    expect(roleMayDownload(map, "/The Long Rot/Master Codex.txt", "editor")).toBe(true);
    expect(roleMayDownload(map, "/The Long Rot/Master Codex.txt", "administrator")).toBe(true);
    expect(roleMayDownload(map, "/The Long Rot/Owner Notes.txt", "editor")).toBe(false);
  });

  it("keeps excluded files away from everyone, even the owner", () => {
    expect(roleMayDownload(map, "/The Long Rot/Old Build Log.txt", "administrator")).toBe(false);
  });

  it("reads only sensible entries from a published map", () => {
    const parsed = parseAccessMap(JSON.stringify({
      "/The Long Rot/A.txt": "editor",
      "/The Long Rot/B.txt": "not-a-level",
      "/The Long Rot/C.txt": 7
    }));
    expect(parsed).toEqual({ "/The Long Rot/A.txt": "editor" });
    expect(parseAccessMap("this is not json")).toEqual({});
  });
});
