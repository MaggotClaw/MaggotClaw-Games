import { describe, expect, it } from "vitest";
import { claudeInstructions, describeAction, needsOkGo, parseActions } from "../src/claudeActions";

describe("claude actions — reading the request file", () => {
  it("accepts a well-formed batch in either shape", () => {
    const wrapped = parseActions(JSON.stringify({ actions: [{ id: "a", kind: "open_screen", screen: "library" }] }));
    const bare = parseActions(JSON.stringify([{ id: "a", kind: "open_screen", screen: "library" }]));
    expect(wrapped).toHaveLength(1);
    expect(bare).toHaveLength(1);
  });

  it("throws out anything half-written rather than guessing", () => {
    const actions = parseActions(JSON.stringify([
      { id: "1", kind: "open_screen" },                                   // no screen
      { id: "", kind: "say", text: "hello" },                             // no id
      { id: "3", kind: "not_a_kind", text: "x" },                         // unknown kind
      { id: "4", kind: "propose_edit", path: "a.txt", find: "x" },        // no replacement
      { id: "5", kind: "add_pronunciation", say: "Vina" },                // no spoken form
      { id: "6", kind: "release_chapters", chapters: ["five"] },          // not numbers
      { id: "7", kind: "say", text: "read me" }                           // good
    ]));
    expect(actions.map((a) => a.id)).toEqual(["7"]);
  });

  it("survives a damaged or half-written file", () => {
    expect(parseActions("{ not json")).toEqual([]);
    expect(parseActions("")).toEqual([]);
    expect(parseActions("null")).toEqual([]);
  });

  it("takes a complete rewrite request", () => {
    const actions = parseActions(JSON.stringify([{
      id: "r1", kind: "propose_edit", path: "01 Originals/C07.txt",
      find: "the old line", replace: "the new line", why: "tightening the open"
    }]));
    expect(actions).toHaveLength(1);
    expect(actions[0].why).toBe("tightening the open");
  });
});

describe("claude actions — the brake", () => {
  it("makes anything that touches the book wait for OK GO", () => {
    expect(needsOkGo("propose_edit")).toBe(true);
    expect(needsOkGo("move_file")).toBe(true);
    expect(needsOkGo("release_chapters")).toBe(true);
  });

  it("lets ordinary actions run straight away", () => {
    expect(needsOkGo("open_screen")).toBe(false);
    expect(needsOkGo("set_setting")).toBe(false);
    expect(needsOkGo("add_pronunciation")).toBe(false);
    expect(needsOkGo("make_note")).toBe(false);
    expect(needsOkGo("say")).toBe(false);
  });
});

describe("claude actions — what the author is shown", () => {
  it("describes each request in plain words", () => {
    expect(describeAction({ id: "1", kind: "open_screen", screen: "library" })).toContain("library");
    expect(describeAction({ id: "2", kind: "release_chapters", chapters: [5, 6] })).toContain("5, 6");
    expect(describeAction({ id: "3", kind: "add_pronunciation", say: "Vina", as: "VEE-nah" })).toContain("VEE-nah");
    expect(describeAction({ id: "4", kind: "move_file", path: "a.txt", to: "b.txt" })).toContain("b.txt");
  });

  it("hands Claude a protocol that names the brake and the canon rules", () => {
    const text = claudeInstructions();
    expect(text).toContain("propose_edit");
    expect(text).toContain("OK GO");
    expect(text).toContain("canon");
    expect(text).toContain("/The Long Rot/.mcg/claude-actions.json");
  });
});
