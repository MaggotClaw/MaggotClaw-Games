import { describe, expect, it } from "vitest";
import { deadlineAfterSpeech } from "../src/countdown";

describe("voice countdown", () => {
  it("preserves time added by the user when more speech arrives", () => {
    const now = 100_000;
    expect(deadlineAfterSpeech(now + 10_000, now, 2)).toBe(now + 10_000);
  });

  it("restores the normal silence allowance when no bonus remains", () => {
    const now = 100_000;
    expect(deadlineAfterSpeech(now + 500, now, 2)).toBe(now + 2_000);
  });
});
