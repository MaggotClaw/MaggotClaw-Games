import { describe, expect, it } from "vitest";
import { canPerform, visibleActions } from "../src/permissions";

describe("project permissions", () => {
  it("keeps readers read-only", () => {
    expect(canPerform("reader", "download")).toBe(true);
    expect(canPerform("reader", "review")).toBe(false);
    expect(canPerform("reader", "upload")).toBe(false);
  });

  it("shows the test administrator every planned project action", () => {
    expect(visibleActions("administrator")).toEqual(["download", "review", "propose", "upload", "manage"]);
  });
});
