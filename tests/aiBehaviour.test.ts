import { describe, expect, it } from "vitest";
import { BEHAVIOUR_CHOICES, behaviourFile, composeBehaviour, conflicts, parseBehaviourFile } from "../src/aiBehaviour";

describe("how the AI should act", () => {
  it("says nothing when nothing is chosen", () => {
    expect(composeBehaviour([])).toBe("");
  });

  it("turns a choice into a concrete instruction, not an adjective", () => {
    const text = composeBehaviour(["short"]);
    expect(text).toContain("Answer in a line or two");
    // An adjective would be useless to an assistant; the rule must be actionable.
    expect(text).not.toMatch(/be clear|be concise/i);
  });

  it("keeps a fixed order however the buttons were pressed", () => {
    const one = composeBehaviour(["push-back", "short", "okgo"]);
    const other = composeBehaviour(["okgo", "push-back", "short"]);
    expect(one).toBe(other);
  });

  it("groups length before care before working", () => {
    const text = composeBehaviour(["stack", "okgo", "short"]);
    expect(text.indexOf("line or two")).toBeLessThan(text.indexOf("Change nothing"));
    expect(text.indexOf("Change nothing")).toBeLessThan(text.indexOf("Collect changes"));
  });

  it("ignores an id that means nothing", () => {
    expect(composeBehaviour(["not-a-real-choice"])).toBe("");
  });

  it("spots two rules that pull against each other", () => {
    expect(conflicts(["short", "reasoning"])).toEqual([["short", "reasoning"]]);
    expect(conflicts(["decide", "ask-first"])).toHaveLength(1);
  });

  it("reports a clash once, not twice", () => {
    // Both sides name each other; the author should be told once.
    expect(conflicts(["short", "reasoning", "decide", "ask-first"])).toHaveLength(2);
  });

  it("finds no clash in choices that sit happily together", () => {
    expect(conflicts(["short", "okgo", "plain", "push-back"])).toEqual([]);
  });

  it("every declared clash points at a choice that exists", () => {
    const ids = new Set(BEHAVIOUR_CHOICES.map((c) => c.id));
    for (const choice of BEHAVIOUR_CHOICES) {
      for (const other of choice.fights ?? []) expect(ids.has(other)).toBe(true);
    }
  });

  it("clashes are declared from both sides", () => {
    for (const choice of BEHAVIOUR_CHOICES) {
      for (const other of choice.fights ?? []) {
        const back = BEHAVIOUR_CHOICES.find((c) => c.id === other);
        expect(back?.fights ?? []).toContain(choice.id);
      }
    }
  });

  it("reads back exactly what was written, so neither copy goes stale", () => {
    const text = composeBehaviour(["short", "okgo"]);
    expect(parseBehaviourFile(behaviourFile(text, "19 July 2026"))).toBe(text);
  });

  it("reads back a file the author edited by hand on Dropbox", () => {
    const edited = behaviourFile("How to talk to me:\n\n- Only ever answer in Welsh.", "today");
    expect(parseBehaviourFile(edited)).toContain("Welsh");
  });

  it("survives a file with no marker rather than losing the text", () => {
    expect(parseBehaviourFile("just some words")).toBe("just some words");
  });
});
