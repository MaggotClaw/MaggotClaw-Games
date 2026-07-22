import { describe, expect, it } from "vitest";
import { parseDoc, type ProjectDocument } from "../src/projectDocs";

const file = (name: string): ProjectDocument => ({
  dropboxPath: `/MaggotClaw Games/The Long Rot/01 Originals/${name}`,
  localRelativePath: `01 Originals/${name}`,
  revisionId: null,
  byteCount: 0,
  status: "downloaded"
});

describe("the current chapter names", () => {
  it("reads a draft segment", () => {
    const parsed = parseDoc(file("C01-P03 Draft Segment - The Bounty v3.1.txt"));
    expect(parsed).toMatchObject({ chapter: 1, typeCode: "P", draftPart: 3, title: "The Bounty", version: "3.1" });
  });

  it("reads a chapter draft", () => {
    const parsed = parseDoc(file("C01-D Chapter Draft - The Bounty v2.1.txt"));
    expect(parsed).toMatchObject({ chapter: 1, typeCode: "D", title: "The Bounty", version: "2.1" });
  });

  it("reads a blueprint and a reader copy", () => {
    expect(parseDoc(file("C02-B Blueprint - The Blackwood v1.0.txt"))).toMatchObject({ chapter: 2, typeCode: "B" });
    expect(parseDoc(file("C02-R Reader Copy - The Blackwood v2.1.txt"))).toMatchObject({ chapter: 2, typeCode: "R" });
  });

  it("reads a chapter that has no title yet", () => {
    expect(parseDoc(file("C09-P01 Draft Segment v1.0.txt")))
      .toMatchObject({ chapter: 9, typeCode: "P", draftPart: 1, title: "Chapter 9" });
  });

  it("reads the page-exact copy sitting beside a chapter", () => {
    expect(parseDoc(file("C01-R Reader Copy - The Bounty v9.5.pdf")))
      .toMatchObject({ chapter: 1, typeCode: "R", version: "9.5" });
  });
});

describe("the older chapter names", () => {
  // One file missed in a rename must keep its chapter rather than dropping off
  // the shelf without a word.
  it("still reads the repeated chapter number", () => {
    expect(parseDoc(file("C01-P01 Chapter 01 Draft - The Bounty v3.1.txt")))
      .toMatchObject({ chapter: 1, typeCode: "P", draftPart: 1, title: "The Bounty" });
  });

  it("counts the old Development letter as a chapter draft", () => {
    expect(parseDoc(file("C04-B Chapter 04 Development - The Ledger v1.0.txt")))
      .toMatchObject({ chapter: 4, typeCode: "D", title: "The Ledger" });
  });

  it("still reads an untitled old name", () => {
    expect(parseDoc(file("C11-A Chapter 11 Blueprint v1.1.txt")))
      .toMatchObject({ chapter: 11, typeCode: "B", title: "Chapter 11" });
  });

  // The letter B meant Development before and means Blueprint now, so the
  // label is what decides — otherwise every old Development file would come
  // back as a blueprint.
  it("tells the two meanings of B apart by their label", () => {
    expect(parseDoc(file("C05-B Chapter 05 Development - The Shack v1.2.txt")))
      .toMatchObject({ chapter: 5, typeCode: "D" });
    expect(parseDoc(file("C05-B Blueprint - The Shack v1.2.txt")))
      .toMatchObject({ chapter: 5, typeCode: "B" });
  });
});

describe("everything else", () => {
  it("knows a codex from a chapter", () => {
    expect(parseDoc(file("82 Codex, Roles, Duties & Authority v1.4.txt")))
      .toMatchObject({ typeCode: "codex", chapter: null, title: "Roles, Duties & Authority" });
  });

  it("knows the master codex", () => {
    expect(parseDoc(file("00 Master Codex v2.7.docx"))).toMatchObject({ typeCode: "master" });
  });

  it("does not force a name that fits no rule into a chapter", () => {
    expect(parseDoc(file("Notes to self.txt"))).toMatchObject({ typeCode: "other", chapter: null });
  });
});
