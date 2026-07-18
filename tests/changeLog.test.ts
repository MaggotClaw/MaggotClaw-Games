import { describe, expect, it } from "vitest";
import { changesFor, mergeChangeLogs, parseChangeLog, recordChange, type ChangeLogMap } from "../src/changeLog";

const at = (day: number) => `2026-07-${String(day).padStart(2, "0")}T10:00:00.000Z`;
const entry = (who: string, day: number, note?: string) => ({ who, at: at(day), ...(note ? { note } : {}) });

describe("file change logs", () => {
  it("keeps the newest change first", () => {
    let map: ChangeLogMap = {};
    map = recordChange(map, "/c1.docx", entry("Chris", 1));
    map = recordChange(map, "/c1.docx", entry("Sam", 2));
    expect(changesFor(map, "/c1.docx").map((e) => e.who)).toEqual(["Sam", "Chris"]);
  });

  it("keeps only three and drops the oldest when a fourth arrives", () => {
    let map: ChangeLogMap = {};
    for (const [who, day] of [["A", 1], ["B", 2], ["C", 3], ["D", 4]] as const) {
      map = recordChange(map, "/c1.docx", entry(who, day));
    }
    expect(changesFor(map, "/c1.docx").map((e) => e.who)).toEqual(["D", "C", "B"]);
  });

  it("logs each file separately", () => {
    let map: ChangeLogMap = {};
    map = recordChange(map, "/c1.docx", entry("Chris", 1));
    map = recordChange(map, "/c2.docx", entry("Sam", 1));
    expect(changesFor(map, "/c1.docx")).toHaveLength(1);
    expect(changesFor(map, "/c2.docx")[0].who).toBe("Sam");
  });

  it("reports nothing for a file that has never changed", () => {
    expect(changesFor({}, "/never.docx")).toEqual([]);
  });

  it("keeps an optional note but never requires one", () => {
    const map = recordChange({}, "/c1.docx", entry("Chris", 1, "Rewrote the ending"));
    expect(changesFor(map, "/c1.docx")[0].note).toBe("Rewrote the ending");
    expect(changesFor(recordChange({}, "/c1.docx", entry("Chris", 1)), "/c1.docx")[0].note).toBeUndefined();
  });

  it("caps a published file that somehow carries more than three", () => {
    const over = JSON.stringify({ "/c1.docx": [entry("A", 4), entry("B", 3), entry("C", 2), entry("D", 1)] });
    expect(parseChangeLog(over)["/c1.docx"]).toHaveLength(3);
  });

  it("drops damaged entries rather than throwing", () => {
    expect(parseChangeLog('{"/c1.docx":[{"who":"","at":"x"},{"at":"y"},null,7]}')).toEqual({});
    expect(parseChangeLog("not json")).toEqual({});
    expect(parseChangeLog("[1,2]")).toEqual({});
  });

  it("merges two machines' logs newest-first without duplicating", () => {
    const mine = { "/c1.docx": [entry("Chris", 3)] };
    const theirs = { "/c1.docx": [entry("Chris", 3), entry("Sam", 2), entry("Jo", 1)] };
    const merged = mergeChangeLogs(mine, theirs);
    expect(merged["/c1.docx"].map((e) => e.who)).toEqual(["Chris", "Sam", "Jo"]);
  });

  it("keeps the newest three across both machines", () => {
    const mine = { "/c1.docx": [entry("New", 9)] };
    const theirs = { "/c1.docx": [entry("A", 3), entry("B", 2), entry("C", 1)] };
    expect(mergeChangeLogs(mine, theirs)["/c1.docx"].map((e) => e.who)).toEqual(["New", "A", "B"]);
  });

  it("leaves the other machine's untouched files alone", () => {
    const merged = mergeChangeLogs({ "/c1.docx": [entry("Chris", 1)] }, { "/c2.docx": [entry("Sam", 1)] });
    expect(merged["/c2.docx"][0].who).toBe("Sam");
  });
});
