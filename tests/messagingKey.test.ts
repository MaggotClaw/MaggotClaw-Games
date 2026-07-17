import { describe, expect, it } from "vitest";
import { makeMessagingKey, makeUnlockCode, parseMessagingKey, parseUnlockCode } from "../src/accessCodes";

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
