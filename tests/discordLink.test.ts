import { describe, expect, it } from "vitest";
import { extractRequestCodes, isDiscordWebhook, requestAnnouncement } from "../src/discordLink";
import { makeRequestCode } from "../src/accessCodes";

describe("discord link", () => {
  it("accepts only real Discord webhook addresses", () => {
    expect(isDiscordWebhook("https://discord.com/api/webhooks/123456/abc-DEF_ghi")).toBe(true);
    expect(isDiscordWebhook("https://discordapp.com/api/webhooks/1/t")).toBe(true);
    expect(isDiscordWebhook("https://evil.com/api/webhooks/1/t")).toBe(false);
    expect(isDiscordWebhook("http://discord.com/api/webhooks/1/t")).toBe(false);
    expect(isDiscordWebhook("")).toBe(false);
  });

  it("finds request codes inside channel messages and skips chatter", () => {
    const code = makeRequestCode({ name: "Sam", currentRole: "reader", requestedRole: "editor", reason: "helping" });
    const messages = [
      { id: "1", content: "hey everyone", author: { username: "sam" }, timestamp: "2026-07-16T00:00:00Z" },
      { id: "2", content: `**Access request** from Sam\n\`${code}\``, author: { username: "sam" }, timestamp: "2026-07-16T00:01:00Z" },
      { id: "3", content: "unrelated MCG-KEY-notarealcode chatter", author: { username: "bob" } }
    ];
    const found = extractRequestCodes(messages);
    expect(found).toHaveLength(1);
    expect(found[0].messageId).toBe("2");
    expect(found[0].code).toBe(code);
  });

  it("writes an announcement that carries the person, the change, and the code", () => {
    const text = requestAnnouncement({
      name: "Sam", discordName: "sam99", currentRole: "Reader",
      requestedRole: "Editor / Maintainer", reason: "chapter 3", code: "MCG-REQ-X-Y"
    });
    expect(text).toContain("Sam (Discord: sam99)");
    expect(text).toContain("Reader → **Editor / Maintainer**");
    expect(text).toContain("MCG-REQ-X-Y");
  });
});
