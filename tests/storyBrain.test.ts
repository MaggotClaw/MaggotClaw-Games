import { describe, expect, it } from "vitest";
import { brainHeadline, parseRegistry } from "../src/storyBrain";

// A faithful slice of the real ID Registry, em-dashes and all.
const REGISTRY = `═════════════════════════════════════════════
01 Codex, ID Registry v1.31
═════════════════════════════════════════════

1. IDENTIFIER PREFIXES

DC  — Direct Carriers
CB  — Crane Blood
CH  — Characters
EN  — Entities
LO  — Locations
OB  — Objects
RU  — Rules
DOC — Documents

2. DIRECT CARRIERS

DC-001 — Silas Crane
DC-002 — Evelyn Crane
DC-003 — Dr. Josiah Curn / Evil Curn
DC-005 — Elowen "Ellie" Curn

3. CRANE BLOOD

CB-001 — Judson Crane

4. CHARACTERS

CH-001 — Louvenia "Vina" Reed
CH-008 — Corporal Lemuel "Lem" Baskin

5. ENTITIES

EN-002 — The Warden

6. LOCATIONS

LO-001 — Mourning Bend
LO-002 — The Blackwood

7. OBJECTS

OB-001 — Bone-handled knife, Silas's mother's

9. GOVERNING AND CODEX DOCUMENTS

DOC-0001 — 00 Master Codex v2.5.txt — Active
`;

describe("parseRegistry", () => {
  const brain = parseRegistry(REGISTRY);
  const find = (id: string) => brain.entities.find((e) => e.id === id)!;

  it("keeps the registry's own categories, in order, without documents/rules", () => {
    expect(brain.categories.map((c) => c.label)).toEqual([
      "Direct Carriers", "Crane Blood", "Characters", "Entities", "Locations", "Objects"
    ]);
  });

  it("classifies entities by prefix", () => {
    expect(find("DC-001").kind).toBe("person");
    expect(find("EN-002").kind).toBe("entity");
    expect(find("LO-001").kind).toBe("location");
    expect(find("OB-001").kind).toBe("object");
  });

  it("searches people by first name, stripping titles", () => {
    expect(find("DC-001").searchTerm).toBe("Silas");
    expect(find("DC-003").searchTerm).toBe("Josiah"); // "Dr." dropped
  });

  it("prefers a quoted nickname as the search term", () => {
    expect(find("CH-001").searchTerm).toBe("Vina");
    expect(find("CH-008").searchTerm).toBe("Lem");
    expect(find("DC-005").searchTerm).toBe("Ellie");
  });

  it("drops the leading 'The' for places and forces", () => {
    expect(find("LO-002").searchTerm).toBe("Blackwood");
    expect(find("EN-002").searchTerm).toBe("Warden");
    expect(find("LO-001").searchTerm).toBe("Mourning Bend");
  });

  it("captures slash and nickname aliases", () => {
    expect(find("DC-003").aliases).toContain("Evil Curn");
    expect(find("CH-001").aliases).toContain("Vina");
  });

  it("keeps objects to the phrase before the comma", () => {
    expect(find("OB-001").searchTerm).toBe("Bone-handled knife");
  });

  it("does not surface documents as a browsable category", () => {
    expect(brain.categories.some((c) => c.kind === "document")).toBe(false);
  });

  it("summarises the world", () => {
    expect(brainHeadline(brain)).toContain("people");
    expect(brainHeadline(brain)).toContain("locations");
  });
});
