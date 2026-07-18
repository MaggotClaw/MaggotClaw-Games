import { describe, expect, it } from "vitest";
import { addRequest, applyDecision, dismissRequest, pending, type AccessRequest } from "../src/accessRequests";

function req(over: Partial<AccessRequest>): AccessRequest {
  return {
    id: "id", name: "Alex", currentRole: "reader", requestedRole: "editor",
    reason: "", status: "pending", createdAt: "2026-07-15T10:00:00Z", ...over
  };
}

describe("access-request queue", () => {
  it("replaces a person's earlier pending request instead of duplicating", () => {
    const first = req({ id: "a", createdAt: "2026-07-15T10:00:00Z" });
    const second = req({ id: "b", createdAt: "2026-07-15T11:00:00Z" });
    const list = addRequest(addRequest([], first), second);
    expect(list.filter((r) => r.name === "Alex" && r.status === "pending")).toHaveLength(1);
    expect(list[0].id).toBe("b");
  });

  it("keeps decided requests from other people", () => {
    const mine = req({ id: "a", name: "Alex" });
    const theirs = req({ id: "b", name: "Sam", status: "approved" });
    const list = addRequest([theirs], mine);
    expect(list).toHaveLength(2);
  });

  it("lists pending newest-first", () => {
    const list = [
      req({ id: "a", createdAt: "2026-07-15T10:00:00Z" }),
      req({ id: "b", name: "Sam", createdAt: "2026-07-15T12:00:00Z" }),
      req({ id: "c", name: "Jo", status: "denied", createdAt: "2026-07-15T13:00:00Z" })
    ];
    expect(pending(list).map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("approving grants the requested role", () => {
    const list = [req({ id: "a", requestedRole: "editor" })];
    const { list: next, grant } = applyDecision(list, "a", true, "Owner", "2026-07-15T14:00:00Z");
    expect(grant).toEqual({ name: "Alex", role: "editor" });
    expect(next[0].status).toBe("approved");
    expect(next[0].decidedBy).toBe("Owner");
  });

  it("denying grants nothing and marks it denied", () => {
    const list = [req({ id: "a" })];
    const { list: next, grant } = applyDecision(list, "a", false, "Owner", "2026-07-15T14:00:00Z");
    expect(grant).toBeUndefined();
    expect(next[0].status).toBe("denied");
  });

  it("ignores decisions on an already-resolved request", () => {
    const list = [req({ id: "a", status: "approved" })];
    const { grant } = applyDecision(list, "a", true, "Owner", "2026-07-15T14:00:00Z");
    expect(grant).toBeUndefined();
  });

  it("setting a request aside hides it from the queue without deciding it", () => {
    const list = dismissRequest([req({ id: "a" })], "a", "2026-07-15T14:00:00Z");
    expect(list[0].status).toBe("pending");
    expect(list[0].dismissedAt).toBe("2026-07-15T14:00:00Z");
    expect(pending(list)).toHaveLength(0);
  });

  it("a set-aside request can still be approved later", () => {
    const aside = dismissRequest([req({ id: "a", requestedRole: "editor" })], "a", "2026-07-15T14:00:00Z");
    const { grant } = applyDecision(aside, "a", true, "Owner", "2026-07-15T15:00:00Z");
    expect(grant).toEqual({ name: "Alex", role: "editor" });
  });

  it("asking again brings a set-aside person back into the queue", () => {
    const aside = dismissRequest([req({ id: "a" })], "a", "2026-07-15T14:00:00Z");
    const list = addRequest(aside, req({ id: "b", createdAt: "2026-07-15T16:00:00Z" }));
    expect(pending(list).map((r) => r.id)).toEqual(["b"]);
  });

  it("leaves other people's requests alone when one is set aside", () => {
    const list = dismissRequest([req({ id: "a" }), req({ id: "b", name: "Sam" })], "a", "2026-07-15T14:00:00Z");
    expect(pending(list).map((r) => r.id)).toEqual(["b"]);
  });
});
