import { describe, expect, it } from "vitest";
import {
  makeRequestCode,
  makeUnlockCode,
  parseRequestCode,
  parseUnlockCode,
  unlockMatchesProfile
} from "../src/accessCodes";

describe("access codes", () => {
  it("round-trips a request code", () => {
    const code = makeRequestCode({
      name: "Sam Reader",
      currentRole: "reader",
      requestedRole: "editor",
      reason: "Helping with chapter 3 edits"
    });
    expect(parseRequestCode(code)).toEqual({
      name: "Sam Reader",
      currentRole: "reader",
      requestedRole: "editor",
      reason: "Helping with chapter 3 edits"
    });
  });

  it("round-trips an unlock code", () => {
    const code = makeUnlockCode({ name: "Sam Reader", role: "editor" });
    expect(parseUnlockCode(code)).toEqual({ name: "Sam Reader", role: "editor" });
  });

  it("survives surrounding whitespace and line breaks from a pasted message", () => {
    const code = makeUnlockCode({ name: "Sam", role: "contributor" });
    expect(parseUnlockCode(`\n  ${code}  \n`)).toEqual({ name: "Sam", role: "contributor" });
  });

  it("rejects a truncated or mistyped code instead of decoding nonsense", () => {
    const code = makeUnlockCode({ name: "Sam", role: "editor" });
    expect(parseUnlockCode(code.slice(0, code.length - 4))).toBeNull();
    expect(parseUnlockCode(code.replace(/.$/, "x"))).toBeNull();
  });

  it("rejects the wrong kind of code and plain junk", () => {
    const unlock = makeUnlockCode({ name: "Sam", role: "editor" });
    expect(parseRequestCode(unlock)).toBeNull();
    expect(parseUnlockCode("hello")).toBeNull();
    expect(parseUnlockCode("")).toBeNull();
  });

  it("rejects a code carrying an unknown role", () => {
    const forged = makeUnlockCode({ name: "Sam", role: "owner-supreme" as never });
    expect(parseUnlockCode(forged)).toBeNull();
  });

  it("ties an unlock to its person, forgiving case and spacing", () => {
    const payload = { name: "Sam Reader", role: "editor" as const };
    expect(unlockMatchesProfile(payload, "sam  reader")).toBe(true);
    expect(unlockMatchesProfile(payload, "Someone Else")).toBe(false);
  });
});
