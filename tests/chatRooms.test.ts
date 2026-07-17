import { describe, expect, it } from "vitest";
import { visibleRooms } from "../src/ChatScreen";

describe("chat rooms", () => {
  it("shows a reader only the open rooms", () => {
    const names = visibleRooms("reader").map((room) => room.id);
    expect(names).toEqual(["announcements", "readers", "questions"]);
    expect(names).not.toContain("editors");
    expect(names).not.toContain("owner");
  });

  it("adds the craft rooms for an editor but not the owner room", () => {
    const names = visibleRooms("editor").map((room) => room.id);
    expect(names).toContain("editors");
    expect(names).toContain("review");
    expect(names).not.toContain("owner");
  });

  it("gives the owner every room", () => {
    expect(visibleRooms("administrator").map((room) => room.id)).toContain("owner");
  });
});
