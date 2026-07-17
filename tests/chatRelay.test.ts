import { describe, expect, it } from "vitest";
import { formatChatLine, parseChatLines } from "../src/discordLink";
import { mergeThread, threadKeyFor, OWNER_HANDLE, type LocalMessage } from "../src/ChatScreen";

describe("chat relay wire format", () => {
  it("round-trips a room message", () => {
    const line = formatChatLine({ room: "readers", author: "Bob", text: "Chapter two wrecked me" });
    const parsed = parseChatLines([{ id: "9", content: line, timestamp: "2026-07-17T00:00:00Z" }]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ room: "readers", to: null, author: "Bob", text: "Chapter two wrecked me" });
  });

  it("round-trips a direct message and keeps multi-line text", () => {
    const line = formatChatLine({ to: OWNER_HANDLE, author: "Sam", text: "line one\nline two" });
    const parsed = parseChatLines([{ id: "1", content: line }]);
    expect(parsed[0]).toMatchObject({ to: OWNER_HANDLE, room: null, author: "Sam" });
    expect(parsed[0].text).toContain("line two");
  });

  it("ignores ordinary Discord chatter and returns oldest first", () => {
    const parsed = parseChatLines([
      { id: "2", content: formatChatLine({ room: "readers", author: "B", text: "second" }) },
      { id: "1", content: formatChatLine({ room: "readers", author: "A", text: "first" }) },
      { id: "3", content: "just talking, no tag" }
    ]);
    expect(parsed.map((m) => m.author)).toEqual(["A", "B"]);
  });
});

describe("thread sorting", () => {
  const dm = (to: string, author: string) => ({ messageId: "m", room: null, to, author, text: "hi", sentAt: "" });

  it("puts room messages in their room for everyone", () => {
    expect(threadKeyFor({ messageId: "m", room: "readers", to: null, author: "A", text: "x", sentAt: "" }, "Sam", false)).toBe("room:readers");
  });

  it("routes a DM to me under the sender's thread", () => {
    expect(threadKeyFor(dm("Sam", "Bob"), "Sam", false)).toBe("dm:bob");
  });

  it("routes a DM I sent under the recipient's thread", () => {
    expect(threadKeyFor(dm("Bob", "Sam"), "Sam", false)).toBe("dm:bob");
  });

  it("gives the owner everything addressed to the MaggotClaw handle", () => {
    expect(threadKeyFor(dm(OWNER_HANDLE, "Bob"), "Quin", true)).toBe("dm:bob");
    expect(threadKeyFor(dm(OWNER_HANDLE, "Bob"), "Sam", false)).toBeNull();
  });
});

describe("thread merging", () => {
  const at = (s: number) => new Date(2026, 6, 17, 0, 0, s).toISOString();

  it("replaces an optimistic local echo with the relayed copy", () => {
    const local: LocalMessage[] = [{ id: "local-1", author: "Sam", text: "hello", at: at(1) }];
    const merged = mergeThread(local, [{ id: "discord-9", author: "Sam", text: "hello", at: at(2) }]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("discord-9");
  });

  it("keeps existing messages and sorts by time", () => {
    const local: LocalMessage[] = [{ id: "a", author: "Sam", text: "later", at: at(5) }];
    const merged = mergeThread(local, [{ id: "b", author: "Bob", text: "earlier", at: at(1) }]);
    expect(merged.map((m) => m.id)).toEqual(["b", "a"]);
  });

  it("does not duplicate a message pulled twice", () => {
    const once = mergeThread([], [{ id: "x", author: "A", text: "t", at: at(1) }]);
    expect(mergeThread(once, [{ id: "x", author: "A", text: "t", at: at(1) }])).toHaveLength(1);
  });
});
