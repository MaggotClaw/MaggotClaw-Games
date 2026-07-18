import { describe, expect, it } from "vitest";
import { canPerform, roleLabel, visibleActions, ROLE_ORDER } from "../src/permissions";

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

describe("the manager role", () => {
  it("sits between editor and support in authority", () => {
    expect(ROLE_ORDER.indexOf("manager")).toBeGreaterThan(ROLE_ORDER.indexOf("editor"));
    expect(ROLE_ORDER.indexOf("manager")).toBeLessThan(ROLE_ORDER.indexOf("support"));
  });

  it("edits the book like an editor and also approves people", () => {
    expect(canPerform("manager", "upload")).toBe(true);
    expect(canPerform("manager", "manage")).toBe(true);
    expect(canPerform("editor", "manage")).toBe(false);
  });

  it("keeps Editor and Editor / Manager as separate labels", () => {
    expect(roleLabel("editor")).toBe("Editor");
    expect(roleLabel("manager")).toBe("Editor / Manager");
  });
});
