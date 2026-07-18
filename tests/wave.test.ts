import { describe, expect, it } from "vitest";
import { applyPronunciations } from "../src/pronunciation";
import { withListening } from "../src/listeningStats";
import { effectiveReleased, parseReleasesFile } from "../src/readerCopies";
import { sanitizeChapterQuestions } from "../src/chapterQuestions";
import { entitiesMentioned, parseRegistry, storyContextBlock } from "../src/storyBrain";

describe("pronunciation dictionary", () => {
  const list = [
    { say: "Louvenia", as: "loo-VEE-nee-ah" },
    { say: "Louvenia Blackwood", as: "loo-VEE-nee-ah BLACK-wood" }
  ];
  it("replaces whole words, case-insensitively, longest first", () => {
    expect(applyPronunciations("Louvenia Blackwood spoke. louvenia listened.", list))
      .toBe("loo-VEE-nee-ah BLACK-wood spoke. loo-VEE-nee-ah listened.");
  });
  it("never touches partial words", () => {
    expect(applyPronunciations("The Louvenian custom.", [{ say: "Louvenia", as: "X" }]))
      .toBe("The Louvenian custom.");
  });
});

describe("listening stats", () => {
  it("grows a streak day by day and resets after a gap", () => {
    let stats = { secondsListened: 0, chaptersFinished: 0, streakDays: 0, lastDay: "" };
    stats = withListening(stats, 60, "2026-07-16");
    expect(stats.streakDays).toBe(1);
    stats = withListening(stats, 60, "2026-07-17");
    expect(stats.streakDays).toBe(2);
    stats = withListening(stats, 60, "2026-07-17");
    expect(stats.streakDays).toBe(2);
    stats = withListening(stats, 60, "2026-07-20");
    expect(stats.streakDays).toBe(1);
    expect(stats.secondsListened).toBe(240);
  });
});

describe("scheduled releases", () => {
  it("reads both the old array format and the new schedule format", () => {
    expect(parseReleasesFile("[1,2,3]")).toEqual({ released: [1, 2, 3], scheduled: [] });
    expect(parseReleasesFile(JSON.stringify({ released: [1], scheduled: [{ chapter: 5, on: "2026-08-01" }] })))
      .toEqual({ released: [1], scheduled: [{ chapter: 5, on: "2026-08-01" }] });
  });
  it("unlocks scheduled chapters only once their day arrives", () => {
    const scheduled = [{ chapter: 5, on: "2026-08-01" }, { chapter: 6, on: "2026-09-01" }];
    expect(effectiveReleased([1, 2], scheduled, "2026-07-18")).toEqual([1, 2]);
    expect(effectiveReleased([1, 2], scheduled, "2026-08-01")).toEqual([1, 2, 5]);
    expect(effectiveReleased([1, 2], scheduled, "2026-09-02")).toEqual([1, 2, 5, 6]);
  });
});

describe("chapter questions", () => {
  it("keeps only numbered chapters with non-empty questions", () => {
    expect(sanitizeChapterQuestions({ "3": ["Did you trust Vina?", "  "], nope: ["x"], "4": [] }))
      .toEqual({ "3": ["Did you trust Vina?"] });
  });
});

describe("story context", () => {
  const brain = parseRegistry([
    "IDENTIFIER PREFIXES",
    "DC — Direct Carriers",
    "",
    "DIRECT CARRIERS",
    'DC-01 — Louvenia "Vina" Reed',
    "DC-02 — Silas Crane"
  ].join("\n"));
  it("finds mentioned canon names and builds a context block", () => {
    const found = entitiesMentioned(brain, "What would Silas Crane say to Vina here?");
    expect(found.map((e) => e.id)).toContain("DC-02");
    const block = storyContextBlock(found);
    expect(block).toContain("Story context");
    expect(block).toContain("Silas Crane");
  });
  it("stays silent when nothing canon is mentioned", () => {
    expect(storyContextBlock(entitiesMentioned(brain, "make this paragraph tighter"))).toBe("");
  });
});
