import { describe, expect, it } from "vitest";
import { clampStep, findWalkthrough, progressLine, WALKTHROUGHS, walkthroughsFor } from "../src/walkthrough";
import { diagnosticsReport, feedbackMessage } from "../src/feedback";
import { outstandingTasks, tasksHeadline } from "../src/setupTasks";

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


const base = {
  isOwner: false, hasProjectKeys: false, sharingWorks: false, readerLinksPublished: false,
  hasMessaging: false, hasCatalog: false, filesDownloaded: 0, releasedChapters: 0,
  settingsBackedUp: false, peopleCount: 0
};

describe("things still to do", () => {
  it("tells a brand-new owner to connect the files first, and nothing further", () => {
    const tasks = outstandingTasks({ ...base, isOwner: true });
    expect(tasks[0].id).toBe("project-keys");
    expect(tasks[0].urgent).toBe(true);
    expect(tasks.some((t) => t.id === "reader-links")).toBe(false);
  });

  it("raises the sharing problem only once the keys are in", () => {
    const tasks = outstandingTasks({ ...base, isOwner: true, hasProjectKeys: true });
    expect(tasks.some((t) => t.id === "dropbox-sharing")).toBe(true);
    expect(tasks.find((t) => t.id === "dropbox-sharing")?.guide).toBe("dropbox-sharing");
  });

  it("asks for reader links once sharing works", () => {
    const tasks = outstandingTasks({ ...base, isOwner: true, hasProjectKeys: true, sharingWorks: true });
    expect(tasks.some((t) => t.id === "reader-links")).toBe(true);
    expect(tasks.some((t) => t.id === "dropbox-sharing")).toBe(false);
  });

  it("goes quiet for an owner who has finished everything", () => {
    const tasks = outstandingTasks({
      isOwner: true, hasProjectKeys: true, sharingWorks: true, readerLinksPublished: true,
      hasMessaging: true, hasCatalog: true, filesDownloaded: 170, releasedChapters: 4,
      settingsBackedUp: true, peopleCount: 3
    });
    expect(tasks).toEqual([]);
    expect(tasksHeadline(tasks)).toBe("");
  });

  it("tells a new reader to paste their key, then to fetch the book", () => {
    expect(outstandingTasks(base)[0].id).toBe("key");
    const withKey = outstandingTasks({ ...base, hasCatalog: true });
    expect(withKey.some((t) => t.id === "get-book")).toBe(true);
    expect(withKey.some((t) => t.id === "key")).toBe(false);
  });

  it("says plainly when something is actually broken", () => {
    expect(tasksHeadline(outstandingTasks({ ...base, isOwner: true }))).toContain("Before This Works");
    const gentle = outstandingTasks({ ...base, isOwner: true, hasProjectKeys: true, sharingWorks: true, readerLinksPublished: true, filesDownloaded: 5, releasedChapters: 2, peopleCount: 1 });
    expect(tasksHeadline(gentle)).toContain("Left To Set Up");
  });
});
