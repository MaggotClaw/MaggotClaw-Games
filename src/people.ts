// The people roster.
//
// Everyone who joins fills in the onboarding questions; their answers travel
// to the author, land here, and can be published to Dropbox as one file per
// person, filed under what they do. This is the author's address book for his
// whole circle — who they are, how to reach them, and what they like to read.

import { ROLE_ORDER, roleLabel, type ProjectRole } from "./permissions";
import { activeProject } from "./projects";
import type { LongRotMcpClient } from "./mcp";
import { EMPTY_READER_PROFILE, type ReaderProfile } from "./profileInfo";

export interface Person extends ReaderProfile {
  name: string;
  nickname: string;
  discord: string;
  role: ProjectRole;
  joinedAt: string;
  lastHeard: string;      // last time they were seen on the relay
  furthest: string;       // furthest reading point reported
}

const ROSTER_KEY = "mcg-people";

export function emptyPerson(name: string): Person {
  return {
    ...EMPTY_READER_PROFILE,
    name, nickname: "", discord: "", role: "reader",
    joinedAt: new Date().toISOString(), lastHeard: "", furthest: ""
  };
}

export function loadPeople(): Person[] {
  try {
    const raw = JSON.parse(localStorage.getItem(ROSTER_KEY) || "[]") as Person[];
    return raw.filter((p) => p && typeof p.name === "string" && p.name.trim());
  } catch {
    return [];
  }
}

export function savePeople(list: Person[]): void {
  try { localStorage.setItem(ROSTER_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// Pure: fold someone into the roster without losing what is already known.
// Blank incoming fields never erase details already on file.
export function upsertPerson(list: Person[], incoming: Partial<Person> & { name: string }): Person[] {
  const found = list.find((p) => same(p.name, incoming.name));
  if (!found) return [...list, { ...emptyPerson(incoming.name), ...clean(incoming) }];
  return list.map((p) => same(p.name, incoming.name) ? { ...p, ...clean(incoming) } : p);
}

function clean(incoming: Partial<Person>): Partial<Person> {
  const kept: Partial<Person> = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (typeof value === "string" && !value.trim()) continue;
    (kept as Record<string, unknown>)[key] = value;
  }
  return kept;
}

export function removePerson(list: Person[], name: string): Person[] {
  return list.filter((p) => !same(p.name, name));
}

// The onboarding summary arrives as a Discord message; read it back into a
// person so the roster fills itself instead of being typed twice.
export function parseProfileMessage(content: string): (Partial<Person> & { name: string }) | null {
  const header = /\*\*New reader\*\*\s+(.+)/.exec(content);
  if (!header) return null;
  const name = header[1].trim();
  if (!name) return null;
  const fields: Record<string, keyof Person> = {
    "email": "email", "phone": "phone", "where": "where",
    "usually reads": "reads", "favourite authors": "authors", "favorite authors": "authors",
    "beta read before": "betaBefore", "reading pace": "pace", "prefers": "prefers",
    "rather not read": "avoid", "invited by": "invitedBy", "notes": "notes"
  };
  const person: Partial<Person> & { name: string } = { name };
  for (const line of content.split("\n").slice(1)) {
    const match = /^([^:]+):\s*(.+)$/.exec(line.trim());
    if (!match) continue;
    const label = match[1].trim().toLowerCase();
    const value = match[2].trim();
    if (label === "role asked for") {
      const role = ROLE_ORDER.find((r) => roleLabel(r).toLowerCase() === value.toLowerCase());
      if (role) person.role = role;
      continue;
    }
    const key = fields[label];
    if (key) (person as Record<string, unknown>)[key] = value;
  }
  return person;
}

// Where a person's file lives: filed by what they do.
export function roleFolder(role: ProjectRole): string {
  switch (role) {
    case "reader": return "Readers";
    case "contributor": return "Contributors";
    case "reviewer": return "Reviewers";
    case "editor": return "Editors";
    case "manager": return "Editors And Managers";
    case "support": return "Technical Support";
    case "administrator": return "Owner";
  }
}

function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "-").trim();
}

export function personFilePath(person: Person, project = activeProject()): string {
  return `${project.dropboxRoot}/People/${roleFolder(person.role)}/${safeFileName(person.name)}.md`;
}

export function personMarkdown(person: Person): string {
  const rows: Array<[string, string]> = [
    ["Role", roleLabel(person.role)], ["Nickname", person.nickname], ["Email", person.email],
    ["Phone", person.phone], ["Where", person.where], ["Discord", person.discord],
    ["Usually reads", person.reads], ["Favourite authors", person.authors],
    ["Beta read before", person.betaBefore], ["Reading pace", person.pace],
    ["Prefers", person.prefers], ["Rather not read", person.avoid],
    ["Invited by", person.invitedBy], ["Furthest read", person.furthest],
    ["Joined", person.joinedAt ? new Date(person.joinedAt).toLocaleDateString() : ""],
    ["Last heard", person.lastHeard ? new Date(person.lastHeard).toLocaleDateString() : ""]
  ];
  const lines = rows.filter(([, value]) => value && value.trim()).map(([label, value]) => `- **${label}:** ${value.trim()}`);
  const notes = person.notes?.trim() ? `\n\n## Notes\n\n${person.notes.trim()}\n` : "";
  return `# ${person.name}\n\n${lines.join("\n")}${notes}\n`;
}

// Owner only: write one file per person into the project's People folder.
export async function publishPeople(client: LongRotMcpClient, list: Person[]): Promise<number> {
  let written = 0;
  for (const person of list) {
    try {
      await client.writeText(personFilePath(person), personMarkdown(person));
      written += 1;
    } catch { /* keep going; one failure should not stop the roster */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return written;
}

export function sortedPeople(list: Person[]): Person[] {
  return [...list].sort((a, b) => {
    const byRole = ROLE_ORDER.indexOf(b.role) - ROLE_ORDER.indexOf(a.role);
    return byRole !== 0 ? byRole : a.name.localeCompare(b.name);
  });
}
