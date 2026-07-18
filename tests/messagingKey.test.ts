import { describe, expect, it } from "vitest";
import { makeMessagingKey, makeUnlockCode, parseMessagingKey, parseUnlockCode } from "../src/accessCodes";

import { grantMessage, parseGrants } from "../src/discordLink";
import { makeUnlockCode as mkKey, parseUnlockCode as rdKey, unlockMatchesProfile } from "../src/accessCodes";
describe("messaging keys", () => {
  it("round-trips the bot key and channel", () => {
    const code = makeMessagingKey({ botToken: "abc.def.ghi", channelId: "1210102876547055668" });
    expect(code.startsWith("MCG-MSG-")).toBe(true);
    expect(parseMessagingKey(code)).toEqual({ botToken: "abc.def.ghi", channelId: "1210102876547055668" });
  });

  it("rejects damage and nonsense", () => {
    const code = makeMessagingKey({ botToken: "abc", channelId: "12345" });
    expect(parseMessagingKey(code.slice(0, -4))).toBeNull();
    expect(parseMessagingKey("MCG-MSG-XXXXXX-notbase64!!!")).toBeNull();
    expect(parseMessagingKey("")).toBeNull();
  });

  it("carries the project file keys when the owner has them", () => {
    const code = makeMessagingKey({
      botToken: "tok", channelId: "42",
      dropbox: { appKey: "key1", appSecret: "sec1", refreshToken: "ref1" }
    });
    const parsed = parseMessagingKey(code);
    expect(parsed?.dropbox).toEqual({ appKey: "key1", appSecret: "sec1", refreshToken: "ref1" });

    const plain = parseMessagingKey(makeMessagingKey({ botToken: "tok", channelId: "42" }));
    expect(plain?.dropbox).toBeUndefined();
  });

  it("carries messaging inside an unlock code and leaves old codes valid", () => {
    const withMessaging = parseUnlockCode(makeUnlockCode({
      name: "Sam", role: "editor", messaging: { botToken: "tok", channelId: "42" }
    }));
    expect(withMessaging?.messaging).toEqual({ botToken: "tok", channelId: "42" });

    const plain = parseUnlockCode(makeUnlockCode({ name: "Sam", role: "editor" }));
    expect(plain).toMatchObject({ name: "Sam", role: "editor" });
    expect(plain?.messaging).toBeUndefined();
  });
});


describe("approvals that apply themselves", () => {
  it("writes a grant the person's app can find and act on", () => {
    const code = mkKey({ name: "Sam", role: "editor" });
    const grants = parseGrants([
      { id: "1", content: "just chatting" },
      { id: "2", content: grantMessage("Sam", "Editor", code), timestamp: "2026-07-18T00:00:00Z" }
    ]);
    expect(grants).toHaveLength(1);
    expect(grants[0].name).toBe("Sam");
    const payload = rdKey(grants[0].code)!;
    expect(payload.role).toBe("editor");
    expect(unlockMatchesProfile(payload, "sam")).toBe(true);
  });

  it("tells the person there is nothing for them to copy", () => {
    expect(grantMessage("Sam", "Editor", mkKey({ name: "Sam", role: "editor" })))
      .toContain("nothing to copy");
  });

  it("never matches a grant meant for somebody else", () => {
    const grants = parseGrants([{ id: "1", content: grantMessage("Dana", "Reviewer", mkKey({ name: "Dana", role: "reviewer" })) }]);
    const payload = rdKey(grants[0].code)!;
    expect(unlockMatchesProfile(payload, "Sam")).toBe(false);
  });

  it("ignores a grant whose code is damaged", () => {
    const grants = parseGrants([{ id: "1", content: "[GRANT] Sam :: MCG-KEY-BADBAD-notarealcode" }]);
    expect(rdKey(grants[0]?.code ?? "")).toBeNull();
  });
});
