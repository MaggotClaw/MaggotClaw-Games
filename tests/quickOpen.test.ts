import { describe, expect, it } from "vitest";
import { parseDoc, type ParsedDoc } from "../src/projectDocs";
import { latestVersions, resolveQuickOpen } from "../src/quickOpen";

// Build a ParsedDoc straight from a filename, the way the workspace would.
function doc(fileName: string): ParsedDoc {
  return parseDoc({
    dropboxPath: `/The Long Rot/${fileName}`,
    localRelativePath: `01 Originals/${fileName}`,
    revisionId: "rev",
    byteCount: 1000,
    status: "downloaded"
  });
}

const project = [
  "00 Master Codex v2.7.txt",
  "01 Codex, ID Registry v1.29.txt",
  "01 Codex, ID Registry v1.31.txt", // newer — should supersede v1.29
  "14 Codex, Profiles – Silas Crane v1.3.txt",
  "15 Codex, Profiles – Mourning Bend v1.6.txt",
  "C02-A Chapter 02 Blueprint - The Blackwood v1.0.txt",
  "C02-B Chapter 02 Development - The Blackwood v1.0.txt",
  "C02-P01 Chapter 02 Draft - The Blackwood v1.1.txt",
  "C02-P02 Chapter 02 Draft - The Blackwood v1.1.txt",
  "C02-P03 Chapter 02 Draft - The Blackwood v1.1.txt",
  "C02-R Chapter 02 Reader Copy - The Blackwood v2.1.txt",
  "C01-A Chapter 01 Blueprint - Mourning Bend v1.0.txt",
  "C01-R Chapter 01 Reader Copy - Mourning Bend v2.0.txt"
].map(doc);

describe("resolveQuickOpen", () => {
  it("opens a chapter's Reader Copy by default", () => {
    const r = resolveQuickOpen("chapter 2", project);
    expect(r.best?.fileName).toContain("C02-R");
    expect(r.interpretation).toContain("Reader Copy");
  });

  it("understands spelled-out chapter numbers", () => {
    expect(resolveQuickOpen("chapter two", project).best?.fileName).toContain("C02-R");
  });

  it("honours a named stage", () => {
    expect(resolveQuickOpen("chapter 2 blueprint", project).best?.fileName).toContain("C02-A");
    expect(resolveQuickOpen("ch 2 reader", project).best?.fileName).toContain("C02-R");
  });

  it("picks a specific draft part", () => {
    const r = resolveQuickOpen("ch 2 draft 3", project);
    expect(r.best?.fileName).toContain("C02-P03");
    expect(r.best?.draftPart).toBe(3);
  });

  it("defaults a bare 'draft' to the most advanced part", () => {
    expect(resolveQuickOpen("chapter 2 draft", project).best?.fileName).toContain("C02-P03");
  });

  it("opens a character profile by name", () => {
    const r = resolveQuickOpen("Silas", project);
    expect(r.best?.fileName).toContain("Profiles – Silas Crane");
  });

  it("opens a chapter by its title, preferring the Reader Copy", () => {
    expect(resolveQuickOpen("the Blackwood", project).best?.fileName).toContain("C02-R");
  });

  it("opens the Master Codex", () => {
    expect(resolveQuickOpen("master codex", project).best?.typeCode).toBe("master");
  });

  it("returns nothing for an unmatched phrase", () => {
    expect(resolveQuickOpen("zzzzzqqq", project).best).toBeNull();
  });

  it("lists chapter alternatives with the Reader Copy first", () => {
    const codes = resolveQuickOpen("chapter 2", project).candidates.map((c) => c.typeCode);
    expect(codes[0]).toBe("R");
  });

  it("collapses superseded versions to the newest", () => {
    const registries = latestVersions(project).filter((d) => d.title === "ID Registry");
    expect(registries).toHaveLength(1);
    expect(registries[0].version).toBe("1.31");
  });
});
