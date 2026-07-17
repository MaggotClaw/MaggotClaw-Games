import { describe, expect, it } from "vitest";
import { applyJoin, directMessageTargets, type Contact } from "../src/contacts";

const contact = (partial: Partial<Contact>): Contact => ({
  name: "Friend", discordName: "", role: "reader", attached: false, addedAt: "2026-07-17T00:00:00Z", ...partial
});

describe("contacts", () => {
  it("attaches a joining person to the entry with their Discord name and takes their app name", () => {
    const list = [contact({ name: "sam_discord", discordName: "sam_discord" })];
    const joined = applyJoin(list, "Sam", "sam_discord");
    expect(joined).toHaveLength(1);
    expect(joined[0]).toMatchObject({ name: "Sam", attached: true, discordName: "sam_discord" });
  });

  it("records an unknown joiner as a fresh attached contact", () => {
    const joined = applyJoin([], "Riley", "riley#1", "editor");
    expect(joined).toHaveLength(1);
    expect(joined[0]).toMatchObject({ name: "Riley", role: "editor", attached: true });
  });

  it("updates the role when an approval comes through", () => {
    const list = [contact({ name: "Sam", attached: true })];
    expect(applyJoin(list, "Sam", "", "editor")[0].role).toBe("editor");
  });

  it("shows everyone only management-level people, but shows the owner all contacts", () => {
    const list = [
      contact({ name: "Ed", role: "editor" }),
      contact({ name: "Rita", role: "reader" }),
      contact({ name: "Me", role: "editor" })
    ];
    expect(directMessageTargets(list, false, "Me").map((c) => c.name)).toEqual(["Ed"]);
    expect(directMessageTargets(list, true, "Me").map((c) => c.name)).toEqual(["Ed", "Rita"]);
  });
});
