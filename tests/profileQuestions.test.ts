import { describe, expect, it } from "vitest";
import {
  answersSummary, completeness, newlyAsked, PROFILE_QUESTIONS, questionsFor, unanswered
} from "../src/profileQuestions";

describe("a profile that grows with the role", () => {
  it("asks a reader only the plain questions", () => {
    const asked = questionsFor("reader");
    expect(asked.some((q) => q.id === "email")).toBe(true);
    expect(asked.some((q) => q.id === "catches")).toBe(false);
    expect(asked.some((q) => q.id === "mayApprove")).toBe(false);
  });

  it("keeps the reader's questions for an editor, because an editor still reads", () => {
    const asked = questionsFor("editor");
    expect(asked.some((q) => q.id === "email")).toBe(true);
    expect(asked.some((q) => q.id === "catches")).toBe(true);
    expect(asked.some((q) => q.id === "format")).toBe(true);
  });

  it("asks a manager everything below as well", () => {
    const asked = questionsFor("manager").map((q) => q.id);
    for (const id of ["email", "catches", "format", "mayApprove"]) expect(asked).toContain(id);
  });

  it("never shrinks as the role rises", () => {
    const order = ["reader", "contributor", "reviewer", "editor", "manager"] as const;
    for (let i = 1; i < order.length; i += 1) {
      expect(questionsFor(order[i]).length).toBeGreaterThanOrEqual(questionsFor(order[i - 1]).length);
    }
  });

  it("names exactly what a promotion newly asks", () => {
    const fresh = newlyAsked("reader", "reviewer").map((q) => q.id);
    expect(fresh).toContain("catches");
    expect(fresh).not.toContain("email");
    expect(newlyAsked("reader", "reader")).toEqual([]);
  });

  it("counts a promoted person's new questions as unanswered", () => {
    // The honest part: being made an Editor does not answer an Editor's
    // questions, and the app must not pretend it did.
    const answers = Object.fromEntries(questionsFor("reader").map((q) => [q.id, "said"]));
    expect(unanswered("reader", answers)).toEqual([]);
    expect(unanswered("editor", answers).length).toBeGreaterThan(0);
  });

  it("treats blank and whitespace answers as unanswered", () => {
    expect(unanswered("reader", { email: "   " }).some((q) => q.id === "email")).toBe(true);
  });

  it("reports how much is filled in", () => {
    const total = questionsFor("reader").length;
    expect(completeness("reader", {})).toEqual({ answered: 0, total });
    expect(completeness("reader", { email: "a@b.c" })).toEqual({ answered: 1, total });
  });

  it("writes a summary of answers only, never empty prompts", () => {
    const text = answersSummary("reader", { email: "a@b.c", phone: "" });
    expect(text).toContain("Email: a@b.c");
    expect(text).not.toContain("Phone");
  });

  it("says so plainly when nothing has been filled in", () => {
    expect(answersSummary("reader", {})).toBe("Nothing filled in yet.");
  });

  it("gives every question a unique id", () => {
    const ids = PROFILE_QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every choice question something to choose from", () => {
    for (const question of PROFILE_QUESTIONS) {
      if (question.kind === "choice") expect(question.options?.length ?? 0).toBeGreaterThan(1);
    }
  });
});
