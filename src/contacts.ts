// People you can message. The owner adds friends by their Discord name; when
// that person later joins the app, their entry attaches to the profile name
// they chose, and their role updates when the owner approves them.

import { ROLE_ORDER, type ProjectRole } from "./permissions";

export interface Contact {
  // The name shown in the app. Starts as whatever the owner typed (usually the
  // Discord name) and switches to the person's in-app name once they join.
  name: string;
  discordName: string;
  role: ProjectRole;
  attached: boolean;        // true once a real app profile claimed this entry
  addedAt: string;
}

const STORAGE_KEY = "mcg-contacts";

export function loadContacts(): Contact[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as Contact[]; } catch { return []; }
}

function save(list: Contact[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

const tidy = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

export function addContact(name: string, discordName: string, role: ProjectRole = "reader"): Contact[] {
  const list = loadContacts();
  const clean = name.trim() || discordName.trim();
  if (!clean) return list;
  if (list.some((c) => tidy(c.name) === tidy(clean) || (discordName.trim() && tidy(c.discordName) === tidy(discordName)))) return list;
  const next = [...list, { name: clean, discordName: discordName.trim(), role, attached: false, addedAt: new Date().toISOString() }];
  save(next);
  return next;
}

export function removeContact(name: string): Contact[] {
  const next = loadContacts().filter((c) => tidy(c.name) !== tidy(name));
  save(next);
  return next;
}

// A person joined (or was approved): attach their app name to a matching
// contact, or record them fresh. Pure logic exported for tests via applyJoin.
export function applyJoin(list: Contact[], appName: string, discordName: string, role?: ProjectRole): Contact[] {
  const matches = (c: Contact) =>
    tidy(c.name) === tidy(appName) ||
    (Boolean(discordName.trim()) && tidy(c.discordName) === tidy(discordName));
  if (!list.some(matches)) {
    return [...list, { name: appName.trim(), discordName: discordName.trim(), role: role ?? "reader", attached: true, addedAt: new Date().toISOString() }];
  }
  return list.map((c) => matches(c)
    ? { ...c, name: appName.trim(), discordName: discordName.trim() || c.discordName, role: role ?? c.role, attached: true }
    : c);
}

export function recordJoin(appName: string, discordName: string, role?: ProjectRole): Contact[] {
  if (!appName.trim()) return loadContacts();
  const next = applyJoin(loadContacts(), appName, discordName, role);
  save(next);
  return next;
}

export function setContactRole(name: string, role: ProjectRole): Contact[] {
  const next = loadContacts().map((c) => tidy(c.name) === tidy(name) ? { ...c, role } : c);
  save(next);
  return next;
}

// Direct-message targets for the sidebar: management-level contacts appear for
// everyone; the owner sees every contact.
export function directMessageTargets(list: Contact[], viewerIsOwner: boolean, viewerName: string): Contact[] {
  const editorRank = ROLE_ORDER.indexOf("editor");
  return list
    .filter((c) => tidy(c.name) !== tidy(viewerName))
    .filter((c) => viewerIsOwner || ROLE_ORDER.indexOf(c.role) >= editorRank)
    .sort((a, b) => a.name.localeCompare(b.name));
}
