// Who changed what, and when.
//
// Everyone's app signs into the same Dropbox account, so Dropbox's own history
// cannot tell one person from another — every revision looks like the owner.
// The app stamps the signed-in name at the moment of upload instead, which is
// the only place that knowledge exists.
//
// Nobody is ever made to explain themselves: an entry writes itself from the
// name, the file and the clock. The note is optional and usually empty.
//
// Only the last three changes per file are kept, by the owner's rule. Nothing
// is truly lost — Dropbox still holds the full revision history underneath.

import type { LongRotMcpClient } from "./mcp";
import { projectFile } from "./projects";

export interface ChangeEntry {
  who: string;
  at: string;               // ISO timestamp
  note?: string;            // optional, usually blank
}

export type ChangeLogMap = Record<string, ChangeEntry[]>;

export const KEPT_PER_FILE = 3;

export const changeLogPath = () => projectFile("change-log.json");
const STORAGE_KEY = "mcg-change-log";

// Pure: newest first, capped at three. A fourth change pushes the oldest off
// the end — exactly the rule the owner set.
export function recordChange(map: ChangeLogMap, dropboxPath: string, entry: ChangeEntry): ChangeLogMap {
  const existing = map[dropboxPath] ?? [];
  return { ...map, [dropboxPath]: [entry, ...existing].slice(0, KEPT_PER_FILE) };
}

export function changesFor(map: ChangeLogMap, dropboxPath: string): ChangeEntry[] {
  return map[dropboxPath] ?? [];
}

function normalize(raw: unknown): ChangeLogMap {
  const map: ChangeLogMap = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return map;
  for (const [path, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const entries = value
      .filter((item): item is ChangeEntry =>
        Boolean(item) && typeof item === "object"
        && typeof (item as ChangeEntry).who === "string" && Boolean((item as ChangeEntry).who)
        && typeof (item as ChangeEntry).at === "string" && Boolean((item as ChangeEntry).at))
      .map((item) => ({
        who: item.who,
        at: item.at,
        ...(typeof item.note === "string" && item.note.trim() ? { note: item.note.trim() } : {})
      }))
      // A file published by an older or damaged build could carry more than
      // three; the cap is applied on the way in as well as on the way out.
      .slice(0, KEPT_PER_FILE);
    if (entries.length) map[path] = entries;
  }
  return map;
}

export function parseChangeLog(json: string): ChangeLogMap {
  try { return normalize(JSON.parse(json)); } catch { return {}; }
}

export function loadChangeLog(): ChangeLogMap {
  try { return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}")); } catch { return {}; }
}

export function saveChangeLog(map: ChangeLogMap): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)); } catch { /* ignore */ }
}

// Merging two logs for the same file keeps the newest three across both, so an
// editor's upload and the owner's own edit never overwrite each other's history.
export function mergeChangeLogs(mine: ChangeLogMap, theirs: ChangeLogMap): ChangeLogMap {
  const merged: ChangeLogMap = { ...theirs };
  for (const [path, entries] of Object.entries(mine)) {
    const combined = [...entries, ...(theirs[path] ?? [])];
    const seen = new Set<string>();
    merged[path] = combined
      .filter((entry) => {
        const key = `${entry.who}|${entry.at}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, KEPT_PER_FILE);
  }
  return merged;
}

// Records a change locally and pushes the shared log up. A Dropbox failure
// leaves the local note in place rather than losing it.
export async function noteChange(
  client: LongRotMcpClient,
  dropboxPath: string,
  who: string,
  note = ""
): Promise<void> {
  const entry: ChangeEntry = { who, at: new Date().toISOString(), ...(note.trim() ? { note: note.trim() } : {}) };
  const local = recordChange(loadChangeLog(), dropboxPath, entry);
  saveChangeLog(local);
  try {
    const shared = parseChangeLog(await client.readText(changeLogPath()));
    const merged = mergeChangeLogs(local, shared);
    saveChangeLog(merged);
    await client.writeText(changeLogPath(), JSON.stringify(merged, null, 2));
  } catch { /* saved on this computer; it publishes with the next change */ }
}

export async function fetchSharedChangeLog(client: LongRotMcpClient): Promise<ChangeLogMap> {
  try {
    const merged = mergeChangeLogs(loadChangeLog(), parseChangeLog(await client.readText(changeLogPath())));
    saveChangeLog(merged);
    return merged;
  } catch {
    return loadChangeLog();
  }
}
