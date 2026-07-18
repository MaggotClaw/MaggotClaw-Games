import { describe, expect, it } from "vitest";
import { clampStep, findWalkthrough, progressLine, WALKTHROUGHS, walkthroughsFor } from "../src/walkthrough";
import { diagnosticsReport, feedbackMessage } from "../src/feedback";

describe("walkthroughs", () => {
  it("hides the owner's guides from everyone else", () => {
    expect(walkthroughsFor(false).every((w) => !w.forOwner)).toBe(true);
    expect(walkthroughsFor(true).length).toBeGreaterThan(walkthroughsFor(false).length);
  });

  it("gives every guide a plain name, a reason, and real steps", () => {
    for (const guide of WALKTHROUGHS) {
      expect(guide.name.length).toBeGreaterThan(3);
      expect(guide.why.length).toBeGreaterThan(10);
      expect(guide.steps.length).toBeGreaterThan(1);
      for (const step of guide.steps) expect(step.say.length).toBeGreaterThan(15);
    }
  });

  it("never sends anyone to a screen that does not exist", () => {
    const screens = new Set([
      "home", "library", "reader", "settings", "projects", "project-workspace",
      "project-explorer", "workspace-files", "human-maker", "chat", "dashboard",
      "idea", "comments", "directions", "claude-access", "voice-targets", "people", "feedback"
    ]);
    for (const guide of WALKTHROUGHS) {
      for (const step of guide.steps) {
        if (step.screen) expect(screens.has(step.screen)).toBe(true);
      }
    }
  });

  it("keeps the step number inside the guide", () => {
    const guide = findWalkthrough("reader-start")!;
    expect(clampStep(guide, -5)).toBe(0);
    expect(clampStep(guide, 999)).toBe(guide.steps.length - 1);
    expect(progressLine(guide, 0)).toBe(`Step 1 of ${guide.steps.length}`);
  });

  it("has a first-time guide for both a reader and the owner", () => {
    expect(findWalkthrough("reader-start")?.forOwner).toBe(false);
    expect(findWalkthrough("owner-setup")?.forOwner).toBe(true);
  });
});

describe("feedback", () => {
  it("writes a message that says what kind of feedback it is", () => {
    const base = { id: "1", at: "", sent: false, from: "Dana", area: "Reader Mode", text: "The narrator is lovely." };
    expect(feedbackMessage({ ...base, kind: "rating", rating: 4 })).toContain("★★★★☆");
    expect(feedbackMessage({ ...base, kind: "idea" })).toContain("**Idea**");
    expect(feedbackMessage({ ...base, kind: "problem" })).toContain("**Problem**");
    expect(feedbackMessage({ ...base, kind: "idea" })).toContain("Dana");
  });

  it("reports how the app behaved without carrying anyone's words", () => {
    const report = diagnosticsReport("1.4.0", { library: 12, reader: 30 }, [
      { at: "2026-07-18T10:00:00Z", what: "Cannot read property of undefined", where: "reader" }
    ]);
    expect(report).toContain("1.4.0");
    expect(report).toContain("reader ×30");
    expect(report).toContain("Problems recorded: 1");
  });

  it("says plainly when there is nothing to report", () => {
    const report = diagnosticsReport("1.4.0", {}, []);
    expect(report).toContain("nothing recorded yet");
    expect(report).toContain("No problems recorded");
  });
});
