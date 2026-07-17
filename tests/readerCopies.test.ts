import { describe, expect, it } from "vitest";
import { isChapterUnlocked, readerCopies } from "../src/readerCopies";
import type { ProjectDocument } from "../src/projectDocs";

const doc = (localRelativePath: string, status = "downloaded"): ProjectDocument => ({
  dropboxPath: `/The Long Rot/${localRelativePath}`,
  localRelativePath,
  revisionId: "r1",
  byteCount: 10,
  status
});

describe("reader copies", () => {
  it("keeps only Reader Copies, in chapter order", () => {
    const list = readerCopies([
      doc("C02-R Chapter 02 Reader Copy - The Blackwood v2.1.txt"),
      doc("C01-A Chapter 01 Blueprint - The Bounty v2.1.txt"),
      doc("C01-R Chapter 01 Reader Copy - The Bounty v2.1.txt"),
      doc("C01-P01 Chapter 01 Draft - The Bounty v3.1.txt"),
      doc("00 Master Codex v2.7.txt")
    ]);
    expect(list.map((d) => d.chapter)).toEqual([1, 2]);
    expect(list.every((d) => d.typeCode === "R")).toBe(true);
  });

  it("keeps the newest version when a chapter has more than one Reader Copy", () => {
    const list = readerCopies([
      doc("C01-R Chapter 01 Reader Copy - The Bounty v2.1.txt"),
      doc("C01-R Chapter 01 Reader Copy - The Bounty v2.10.txt")
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].version).toBe("2.10");
  });

  it("ignores files that are not downloaded yet", () => {
    expect(readerCopies([doc("C01-R Chapter 01 Reader Copy v1.0.txt", "needs-binary-download")])).toHaveLength(0);
  });

  it("locks every chapter except the released ones for a reader", () => {
    expect(isChapterUnlocked(1, "reader")).toBe(true);
    expect(isChapterUnlocked(2, "reader")).toBe(false);
    expect(isChapterUnlocked(7, "contributor")).toBe(false);
  });

  it("lets the owner open everything", () => {
    expect(isChapterUnlocked(7, "administrator")).toBe(true);
  });

  it("honours an explicit released-chapter list", () => {
    expect(isChapterUnlocked(3, "reader", [1, 3])).toBe(true);
    expect(isChapterUnlocked(2, "reader", [1, 3])).toBe(false);
  });
});
