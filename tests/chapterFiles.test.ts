import { describe, expect, it } from "vitest";
import { parseChapterFiles } from "../src/chapterFiles";

describe("chapter file picks", () => {
  it("reads a published pick list", () => {
    expect(parseChapterFiles('{"1":"/The Long Rot/c1.docx","2":"/The Long Rot/c2.docx"}'))
      .toEqual({ 1: "/The Long Rot/c1.docx", 2: "/The Long Rot/c2.docx" });
  });

  it("drops entries that are not real chapter numbers", () => {
    expect(parseChapterFiles('{"0":"/a.docx","-3":"/b.docx","first":"/c.docx","2.5":"/d.docx"}')).toEqual({});
  });

  it("drops entries with no usable path", () => {
    expect(parseChapterFiles('{"1":"","2":"   ","3":null,"4":12}')).toEqual({});
  });

  it("survives damaged or unexpected files rather than throwing", () => {
    expect(parseChapterFiles("not json")).toEqual({});
    expect(parseChapterFiles("[1,2,3]")).toEqual({});
    expect(parseChapterFiles("null")).toEqual({});
  });
});
