import { describe, expect, it } from "vitest";
import { indexPage, locateSentence, mergeRects, normalizeForMatch } from "../src/pageHighlight";

// The runs below are shaped like the ones Word's own PDF actually produces:
// whole lines with no trailing space, an em dash stranded as its own run, and
// curly quotes throughout.
const page = [
  { str: "—" },
  { str: " I " },
  { str: "—" },
  { str: "The heat in the Saint Barrow bottoms did not break. It settled there like a living thing," },
  { str: "thick and breathing, pressing down on the back of a man’s neck until he forgot what air" },
  { str: "was supposed to feel like moving. The swamp held it all" },
  { str: "—" },
  { str: "the river rot, the split cypress" }
];

describe("plain form", () => {
  it("settles curly quotes and dashes, and drops every space", () => {
    expect(normalizeForMatch("A  “quoted”  word—here’s one")).toBe('a"quoted"word-here\'sone');
  });

  it("reads a spaced dash and a tight one as the same thing", () => {
    // Word's PDF strands an em dash in a run of its own, so the page says
    // "his eyes — deep-set" where the manuscript says "his eyes—deep-set".
    expect(normalizeForMatch("his eyes—deep-set")).toBe(normalizeForMatch("his eyes — deep-set"));
  });
});

describe("indexing a page", () => {
  it("joins across a line break, which carries no space", () => {
    expect(indexPage(page).text).toContain("alivingthing,thickandbreathing");
  });

  it("traces every character back to the run it came from", () => {
    const { text, owner } = indexPage(page);
    expect(owner).toHaveLength(text.length);
    expect(owner[owner.length - 1]).toBe(page.length - 1);
  });
});

describe("finding the sentence being read", () => {
  it("finds one that sits inside a single run", () => {
    expect(locateSentence(page, "The heat in the Saint Barrow bottoms did not break.")).toEqual([3]);
  });

  it("finds one that runs across a line break", () => {
    expect(locateSentence(page, "It settled there like a living thing, thick and breathing, pressing down on the back of a man’s neck until he forgot what air was supposed to feel like moving."))
      .toEqual([3, 4, 5]);
  });

  it("still matches when the quotes and dashes differ", () => {
    expect(locateSentence(page, "pressing down on the back of a man's neck")).toEqual([4]);
  });

  it("matches a sentence whose em dash the page split into its own run", () => {
    expect(locateSentence(page, "The swamp held it all—the river rot, the split cypress")).toEqual([5, 6, 7]);
  });

  it("says nothing when the sentence is on another page", () => {
    expect(locateSentence(page, "Mosquitoes rose in thick clouds from the duckweed.")).toEqual([]);
  });

  it("says nothing for a fragment too short to be sure of", () => {
    expect(locateSentence(page, "The swamp")).toEqual([]);
  });

  it("says nothing when the same words appear twice on the page", () => {
    const repeated = [{ str: "he waited by the door." }, { str: "he waited by the door." }];
    expect(locateSentence(repeated, "he waited by the door.")).toEqual([]);
  });
});

describe("drawing the highlight", () => {
  const boxes = [
    { left: 72, top: 100, width: 200, height: 12 },
    { left: 272, top: 101, width: 150, height: 12 },
    { left: 72, top: 120, width: 300, height: 12 }
  ];

  it("joins runs on one line into a single bar", () => {
    expect(mergeRects(boxes, [0, 1])).toEqual([{ left: 72, top: 100, width: 350, height: 12 }]);
  });

  it("keeps separate lines apart", () => {
    expect(mergeRects(boxes, [0, 1, 2])).toHaveLength(2);
  });

  it("draws nothing when there is nothing to draw", () => {
    expect(mergeRects(boxes, [])).toEqual([]);
    expect(mergeRects([], [0])).toEqual([]);
  });
});
