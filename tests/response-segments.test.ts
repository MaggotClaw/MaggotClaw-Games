import { describe, expect, it } from "vitest";
import { responseParagraphs, responsePlaybackSegments } from "../src/responseSegments";

describe("responseParagraphs", () => {
  it("keeps paragraphs separate while joining wrapped lines", () => {
    expect(responseParagraphs("First line\nwraps here.\n\nSecond paragraph.")).toEqual([
      "First line wraps here.",
      "Second paragraph."
    ]);
  });

  it("ignores empty whitespace", () => {
    expect(responseParagraphs("\n\n  One.  \n\n\n Two. \n")).toEqual(["One.", "Two."]);
  });
});

describe("responsePlaybackSegments", () => {
  it("replaces fenced boxes with a short spoken notice", () => {
    expect(responsePlaybackSegments("Before.\n\n```js\nalert('x');\n```\n\nAfter.")).toEqual([
      { kind: "text", spokenText: "Before." },
      { kind: "skipped", spokenText: "Content box skipped.", hiddenText: "alert('x');" },
      { kind: "text", spokenText: "After." }
    ]);
  });
});
