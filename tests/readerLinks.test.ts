import { describe, expect, it } from "vitest";
import { catalogFilesForRole, parseCatalog } from "../src/readerLinks";
import { makeMessagingKey, parseMessagingKey } from "../src/accessCodes";

const catalog = parseCatalog(JSON.stringify({
  updatedAt: "2026-07-18T00:00:00Z",
  released: [1, 2, 3, 4, 5],
  files: [
    { path: "/The Long Rot/C01-R Chapter 01 Reader Copy v1.txt", name: "C01-R Chapter 01 Reader Copy v1.txt", url: "https://www.dropbox.com/scl/a?dl=0", access: "reader" },
    { path: "/The Long Rot/00 Master Codex v2.7.txt", name: "00 Master Codex v2.7.txt", url: "https://www.dropbox.com/scl/b?dl=0", access: "editor" },
    { path: "/The Long Rot/Owner Notes.txt", name: "Owner Notes.txt", url: "https://www.dropbox.com/scl/c?dl=0", access: "administrator" }
  ]
}))!;

describe("reader catalog", () => {
  it("parses a published catalog with its release list", () => {
    expect(catalog.released).toEqual([1, 2, 3, 4, 5]);
    expect(catalog.files).toHaveLength(3);
  });

  it("rejects nonsense and keeps only well-formed file entries", () => {
    expect(parseCatalog("not json")).toBeNull();
    expect(parseCatalog(JSON.stringify({ files: "nope" }))).toBeNull();
    const partial = parseCatalog(JSON.stringify({ files: [{ path: "/x", url: "https://u", name: "x" }, { bad: true }] }))!;
    expect(partial.files).toHaveLength(1);
    expect(partial.released).toEqual([]);
  });

  it("gives each role only its files", () => {
    expect(catalogFilesForRole(catalog, "reader").map((f) => f.access)).toEqual(["reader"]);
    expect(catalogFilesForRole(catalog, "editor").map((f) => f.access)).toEqual(["reader", "editor"]);
    expect(catalogFilesForRole(catalog, "administrator")).toHaveLength(3);
  });

  it("travels inside a messaging key without any secrets", () => {
    const key = parseMessagingKey(makeMessagingKey({
      botToken: "tok", channelId: "42",
      catalogUrl: "https://www.dropbox.com/scl/catalog?dl=0"
    }));
    expect(key?.catalogUrl).toBe("https://www.dropbox.com/scl/catalog?dl=0");
    expect(key?.dropbox).toBeUndefined();
  });
});
