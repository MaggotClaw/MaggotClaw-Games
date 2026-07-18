import { describe, expect, it } from "vitest";
import { emptyPerson, parseProfileMessage, personFilePath, personMarkdown, removePerson, roleFolder, sortedPeople, upsertPerson } from "../src/people";
import { readerProfileSummary, EMPTY_READER_PROFILE } from "../src/profileInfo";

describe("people — the roster", () => {
  it("adds someone new and never loses what is already known", () => {
    let list = upsertPerson([], { name: "Dana", email: "dana@example.com", where: "Louisiana" });
    list = upsertPerson(list, { name: "Dana", phone: "555-0100" });
    expect(list).toHaveLength(1);
    expect(list[0].email).toBe("dana@example.com");
    expect(list[0].phone).toBe("555-0100");
  });

  it("does not let a blank field wipe a real one", () => {
    let list = upsertPerson([], { name: "Dana", email: "dana@example.com" });
    list = upsertPerson(list, { name: "Dana", email: "" });
    expect(list[0].email).toBe("dana@example.com");
  });

  it("matches the same person whatever the capitalisation", () => {
    let list = upsertPerson([], { name: "Dana" });
    list = upsertPerson(list, { name: "  dana  ", role: "editor" });
    expect(list).toHaveLength(1);
    expect(list[0].role).toBe("editor");
  });

  it("removes someone by name", () => {
    const list = upsertPerson(upsertPerson([], { name: "Dana" }), { name: "Marcus" });
    expect(removePerson(list, "dana").map((p) => p.name)).toEqual(["Marcus"]);
  });

  it("sorts the most trusted first, then alphabetically", () => {
    const list = [
      { ...emptyPerson("Zoe"), role: "reader" as const },
      { ...emptyPerson("Adam"), role: "manager" as const },
      { ...emptyPerson("Beth"), role: "reader" as const }
    ];
    expect(sortedPeople(list).map((p) => p.name)).toEqual(["Adam", "Beth", "Zoe"]);
  });
});

describe("people — reading the joining message", () => {
  it("reads back exactly what onboarding sent", () => {
    const details = {
      ...EMPTY_READER_PROFILE,
      email: "sam@example.com", phone: "555-0199", where: "Ontario",
      reads: "Southern gothic and horror", authors: "Jesmyn Ward",
      betaBefore: "A little", pace: "An hour or two", prefers: "Read to me",
      avoid: "Animal harm", invitedBy: "Dana", notes: "Nightshift, reads late"
    };
    const parsed = parseProfileMessage(readerProfileSummary("Sam", "Editor / Manager", details))!;
    expect(parsed.name).toBe("Sam");
    expect(parsed.email).toBe("sam@example.com");
    expect(parsed.where).toBe("Ontario");
    expect(parsed.reads).toBe("Southern gothic and horror");
    expect(parsed.avoid).toBe("Animal harm");
    expect(parsed.role).toBe("manager");
  });

  it("ignores ordinary chatter", () => {
    expect(parseProfileMessage("just saying hello everyone")).toBeNull();
    expect(parseProfileMessage("**Access request** from Sam")).toBeNull();
  });
});

describe("people — their file on Dropbox", () => {
  it("files each person under what they do", () => {
    expect(roleFolder("reader")).toBe("Readers");
    expect(roleFolder("manager")).toBe("Editors And Managers");
    const person = { ...emptyPerson("Dana Reed"), role: "editor" as const };
    expect(personFilePath(person)).toContain("/People/Editors/Dana Reed.md");
  });

  it("keeps a name that would break a file path safe", () => {
    const person = { ...emptyPerson("Bad/Name:Here"), role: "reader" as const };
    expect(personFilePath(person)).toContain("Bad-Name-Here.md");
  });

  it("writes a readable page and leaves empty answers out", () => {
    const person = { ...emptyPerson("Dana"), email: "dana@example.com", role: "reader" as const };
    const text = personMarkdown(person);
    expect(text).toContain("# Dana");
    expect(text).toContain("dana@example.com");
    expect(text).not.toContain("Phone");
  });
});
