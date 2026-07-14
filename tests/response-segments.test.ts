import { describe, expect, it } from "vitest";
import { responseParagraphs } from "../src/responseSegments";

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

