import { describe, expect, it } from "vitest";
import { segmentDocument } from "../src/segmenter";

describe("segmentDocument", () => {
  it("keeps paragraph, sentence, and source character anchors", () => {
    const text = "First sentence. Second one!\n\nA new paragraph?";
    const segments = segmentDocument(text);
    expect(segments.map((item) => item.text)).toEqual([
      "First sentence.", "Second one!", "A new paragraph?"
    ]);
    expect(segments[1]).toMatchObject({ paragraphIndex: 0, sentenceIndex: 1 });
    expect(text.slice(segments[2].charStart, segments[2].charEnd)).toBe("A new paragraph?");
  });

  it("ignores blank input", () => {
    expect(segmentDocument("  \n\n ")).toEqual([]);
  });
});
