import { describe, expect, it } from "vitest";
import { isChapterUnlocked, parseReleasedChapters, readerCopies } from "../src/readerCopies";
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

  it("never lets an old Word file shadow a newer text revision", () => {
    const list = readerCopies([
      doc("C01-R Chapter 01 Reader Copy - The Bounty v1.0.docx"),
      doc("C01-R Chapter 01 Reader Copy - The Bounty v3.0.txt")
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].fileName).toContain("v3.0.txt");
  });

  it("prefers the styled Word copy when versions tie", () => {
    const list = readerCopies([
      doc("C01-R Chapter 01 Reader Copy - The Bounty v2.0.txt"),
      doc("C01-R Chapter 01 Reader Copy - The Bounty v2.0.docx")
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].fileName).toContain(".docx");
  });

  it("reads only sensible release lists", () => {
    expect(parseReleasedChapters("[1, 2, 5]")).toEqual([1, 2, 5]);
    expect(parseReleasedChapters("[5, 1, 1]")).toEqual([1, 5]);
    expect(parseReleasedChapters("nonsense")).toBeNull();
    expect(parseReleasedChapters('["one"]')).toBeNull();
  });

  it("releases chapters one to four to a reader and locks the rest", () => {
    expect(isChapterUnlocked(1, "reader")).toBe(true);
    expect(isChapterUnlocked(4, "reader")).toBe(true);
    expect(isChapterUnlocked(5, "reader")).toBe(false);
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

describe("the owner's chosen reader copy", () => {
  const textCopy = doc("C01-R Chapter 01 Reader Copy - The Bounty v3.0.txt");
  const wordCopy = doc("C01-R Chapter 01 Reader Copy - The Bounty v1.0.docx");

  it("opens the chosen file even when another version is newer", () => {
    const list = readerCopies([textCopy, wordCopy], { 1: wordCopy.dropboxPath });
    expect(list).toHaveLength(1);
    expect(list[0].fileName).toMatch(/\.docx$/);
  });

  it("falls back to the automatic rule when a chapter has no pick", () => {
    const list = readerCopies([textCopy, wordCopy], {});
    expect(list[0].version).toBe("3.0");
  });

  it("never hides a chapter when the pick points at a missing file", () => {
    const list = readerCopies([textCopy], { 1: "/The Long Rot/gone.docx" });
    expect(list).toHaveLength(1);
    expect(list[0].version).toBe("3.0");
  });

  it("leaves other chapters on the automatic rule", () => {
    const two = doc("C02-R Chapter 02 Reader Copy - The Blackwood v2.0.txt");
    const list = readerCopies([textCopy, wordCopy, two], { 1: wordCopy.dropboxPath });
    expect(list.map((d) => d.chapter)).toEqual([1, 2]);
    expect(list[1].version).toBe("2.0");
  });

  it("ignores a pick for a file that is not downloaded", () => {
    const pending = doc("C01-R Chapter 01 Reader Copy - The Bounty v1.0.docx", "needs-binary-download");
    const list = readerCopies([textCopy, pending], { 1: pending.dropboxPath });
    expect(list[0].version).toBe("3.0");
  });
});
