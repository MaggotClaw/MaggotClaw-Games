import { describe, expect, it } from "vitest";
import { auditProse, auditForAI, humanMakerAllows, LEGACY_EVERYONE, splitParagraphs, splitSentences, stripFileHeader, TELLS } from "../src/humanMaker";
import { parseArrivedFeedback } from "../src/feedback";

const machineish = `The old house stood against the grey sky. The wind moved across the field slowly. The door was opened by the wind again. It is worth noting that the house had stood there for years.

Furthermore, the roof was comprehensive in its decay. Additionally, the walls were robust despite the weather. Moreover, the porch served as a testament to the family who left.

Silas walked. Silas waited. Silas listened.

He did not move from the porch. He could not see the road. He would not leave before dark. The evening was meticulous in its arrival, showcasing a vibrant tapestry of light — a light that still remembered — and the moment was pivotal.`;

const humanish = `Rain had worked the roof all night, and by morning every board in the house remembered it.

Silas stood at the window. He'd promised himself he wouldn't go back down that road, and the promise had felt solid at midnight, the way promises do when you make them alone in the dark with your boots off and the fire banked low and nothing in the world asking anything of you.

It felt thinner now.

Out past the fence the road bent toward Mourning Bend and disappeared into the cypress the way a thread disappears into cloth. He'd tracked deer through worse. That wasn't the trouble. The trouble was what waited at the other end, and whether it still wore his brother's face.`;

describe("human maker — text splitting", () => {
  it("splits paragraphs on blank lines and sentences within them", () => {
    expect(splitParagraphs("One line.\n\nTwo line.\n\n\nThree.")).toHaveLength(3);
    expect(splitSentences("He ran. She waited! Did they know?")).toHaveLength(3);
  });
});

describe("human maker — catches the mechanical tells", () => {
  const report = auditProse(machineish);
  const hit = (n: number) => report.findings.some((f) => f.tell === n);

  it("flags machine-favorite words (Tell 8)", () => {
    expect(hit(8)).toBe(true);
    const finding = report.findings.find((f) => f.tell === 8)!;
    expect(finding.detail.toLowerCase()).toContain("comprehensive");
  });

  it("flags scaffold transitions (Tell 9)", () => expect(hit(9)).toBe(true));
  it("flags inflated significance (Tell 11)", () => expect(hit(11)).toBe(true));
  it("flags the three-clipped-sentence drumbeat (Tell 13)", () => expect(hit(13)).toBe(true));
  it("flags missing contractions (Tell 5)", () => expect(hit(5)).toBe(true));
  it("flags personified objects (Tell 29)", () => expect(hit(29)).toBe(true));

  it("scores machine-ish prose low and says so plainly", () => {
    expect(report.score).toBeLessThan(60);
    expect(report.verdict.length).toBeGreaterThan(0);
  });
});

describe("human maker — leaves human prose alone", () => {
  const report = auditProse(humanish);

  it("scores it well above the machine sample", () => {
    expect(report.score).toBeGreaterThan(auditProse(machineish).score + 20);
  });

  it("does not invent word-list hits that are not there", () => {
    expect(report.findings.some((f) => f.tell === 8)).toBe(false);
    expect(report.findings.some((f) => f.tell === 11)).toBe(false);
  });

  it("reports real statistics", () => {
    expect(report.stats.words).toBeGreaterThan(100);
    expect(report.stats.sentences).toBeGreaterThan(5);
    expect(report.stats.sentenceVariety).toBeGreaterThan(4);
  });
});

describe("human maker — the catalogue and the AI handoff", () => {
  it("carries all forty-five of the author's tells", () => {
    expect(TELLS).toHaveLength(45);
    expect(TELLS.filter((t) => t.auto).length).toBeGreaterThan(10);
    expect(TELLS.every((t) => t.fix.length > 10)).toBe(true);
  });

  it("lists the human-judgment tells as a read-aloud checklist", () => {
    const report = auditProse(humanish);
    expect(report.checklist.every((t) => !t.auto)).toBe(true);
    expect(report.checklist.some((t) => t.n === 30)).toBe(true);
  });

  it("builds a rewrite brief that protects canon", () => {
    const brief = auditForAI(auditProse(machineish), "Chapter 07");
    expect(brief).toContain("Chapter 07");
    expect(brief).toContain("Ward");
    expect(brief).toContain("locked lines");
    expect(brief).toContain("Tell 8");
  });
});

describe("who may use the Human Maker", () => {
  it("lets in only the people named", () => {
    expect(humanMakerAllows(["Chris"], "Chris")).toBe(true);
    expect(humanMakerAllows(["Chris"], "Sam")).toBe(false);
  });

  it("lets nobody in when no one is named", () => {
    expect(humanMakerAllows([], "Chris")).toBe(false);
  });

  it("ignores case and stray spaces in a name", () => {
    expect(humanMakerAllows(["Chris Emmert"], "  chris emmert ")).toBe(true);
    expect(humanMakerAllows([" Chris "], "Chris")).toBe(true);
  });

  it("never lets an empty name in", () => {
    // A profile with no name must not slip through by matching nothing.
    expect(humanMakerAllows([""], "")).toBe(false);
    expect(humanMakerAllows(["Chris"], "   ")).toBe(false);
  });

  it("honours the old all-editors setting so nobody loses access on upgrade", () => {
    expect(humanMakerAllows([LEGACY_EVERYONE], "Anyone At All")).toBe(true);
  });

  it("stops being everyone once a real name is chosen", () => {
    // The Settings screen drops the legacy marker the moment a name is ticked;
    // both must never be in force at once.
    const afterPicking = [LEGACY_EVERYONE].filter((n) => n !== LEGACY_EVERYONE).concat("Chris");
    expect(humanMakerAllows(afterPicking, "Chris")).toBe(true);
    expect(humanMakerAllows(afterPicking, "Sam")).toBe(false);
  });
});

describe("reading a manuscript file correctly", () => {
  const header = "═════════════════════════════════════════════\nTHE LONG ROT\n\nChapter 01 - The Bounty\nVersion 2.1\n═════════════════════════════════════════════\n\n";

  it("does not count the file's title banner as prose", () => {
    const body = "The heat did not break.\nHe stood.";
    expect(stripFileHeader(header + body).trim()).toBe(body);
    // The banner was being reported as a staccato one-line paragraph.
    expect(splitParagraphs(header + body).some((p) => p.includes("THE LONG ROT"))).toBe(false);
  });

  it("leaves prose alone when there is no banner", () => {
    const plain = "The heat did not break.\nHe stood.";
    expect(stripFileHeader(plain).trim()).toBe(plain);
  });

  it("counts a paragraph per line when the file separates them that way", () => {
    // The real shape of the author's chapters: one paragraph per line, no
    // blank line between. Splitting only on blank lines read a 253-paragraph
    // chapter as 13.
    const long = (n: number) => `Paragraph ${n} ` + "the swamp held it all and the heat did not break and the water shifted somewhere beneath the duckweed as he listened. ".repeat(2);
    expect(splitParagraphs([long(1), long(2), long(3)].join("\n"))).toHaveLength(3);
  });

  it("still joins a hard-wrapped paragraph into one", () => {
    // Older files wrap a single paragraph across short lines; those must not
    // become three paragraphs.
    const wrapped = "The heat in the Saint Barrow bottoms did not\nbreak. It settled there like a living thing,\nthick and breathing, pressing down.";
    const paragraphs = splitParagraphs(wrapped);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]).toContain("pressing down");
  });

  it("handles blank-line separated paragraphs as it always did", () => {
    expect(splitParagraphs("First one.\n\nSecond one.\n\nThird one.")).toHaveLength(3);
  });

  it("keeps the banner out of the word count, so rates are not softened", () => {
    const body = "He stood. The heat did not break.";
    expect(auditProse(header + body).stats.words).toBe(auditProse(body).stats.words);
  });

  it("reports the same score with or without the banner", () => {
    const body = "He stood. The heat did not break. He waited on the bank.";
    expect(auditProse(header + body).score).toBe(auditProse(body).score);
  });
});

describe("feedback that arrived from other people", () => {
  const msg = (content: string, at = "2026-07-19T10:00:00Z", who = "chris") =>
    ({ content, timestamp: at, author: { username: who } });

  it("picks feedback out of a channel that also carries request codes", () => {
    const found = parseArrivedFeedback([
      msg("MCG-REQ-abc123 :: Sam :: reader"),
      msg("**Problem** — Reader Mode\nFrom: Sam\n\nThe refresh button does nothing."),
      msg("**Approved:** Sam → Reader")
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe("problem");
    expect(found[0].area).toBe("Reader Mode");
    expect(found[0].text).toBe("The refresh button does nothing.");
    expect(found[0].from).toBe("Sam");
  });

  it("reads the stars off a rating", () => {
    const found = parseArrivedFeedback([msg("**Rating** ★★★★☆ — Voice Companion\nFrom: Jo\n\nNearly perfect.")]);
    expect(found[0].rating).toBe(4);
    expect(found[0].kind).toBe("rating");
  });

  it("puts problems before ideas before ratings", () => {
    const found = parseArrivedFeedback([
      msg("**Rating** ★★★★★ — Messages\nFrom: A\n\nGood."),
      msg("**Idea** — Reader Mode\nFrom: B\n\nBigger text please."),
      msg("**Problem** — Projects\nFrom: C\n\nIt crashed.")
    ]);
    expect(found.map((f) => f.kind)).toEqual(["problem", "idea", "rating"]);
  });

  it("falls back to the Discord name when nobody signed it", () => {
    expect(parseArrivedFeedback([msg("**Idea** — Settings\n\nMore voices.", "2026-07-19T10:00:00Z", "billy")])[0].from)
      .toBe("billy");
  });

  it("ignores anything that is not feedback", () => {
    expect(parseArrivedFeedback([msg("just chatting"), msg(""), msg("**Approved:** Sam → Reader")])).toEqual([]);
  });
});
