// Per-file access levels. The owner rates every project file with the lowest
// role that needs it (or excludes it from the app entirely); Download or Update
// then fetches only the files that matter for the person's role, so a Reader's
// AI context stays small and clean.
//
// The map lives on Dropbox next to the project so every machine sees the same
// ratings; a local copy keeps working when the bridge is off.

import type { LongRotMcpClient } from "./mcp";
import { ROLE_ORDER, type ProjectRole } from "./permissions";

// "excluded" means the file never downloads for anyone — clutter the app
// simply does not need.
export type FileAccessLevel = ProjectRole | "excluded";

export type FileAccessMap = Record<string, FileAccessLevel>;

export const ACCESS_MAP_DROPBOX_PATH = "/The Long Rot/.mcg/file-access.json";
const STORAGE_KEY = "mcg-file-access";

export const ACCESS_LEVEL_LABELS: Array<{ value: FileAccessLevel; label: string }> = [
  { value: "reader", label: "Reader And Up" },
  { value: "contributor", label: "Contributor And Up" },
  { value: "reviewer", label: "Reviewer And Up" },
  { value: "editor", label: "Editor And Up" },
  { value: "support", label: "Support And Owner" },
  { value: "administrator", label: "Owner Only" },
  { value: "excluded", label: "Not Needed In App" }
];

export function loadAccessMap(): FileAccessMap {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as FileAccessMap; } catch { return {}; }
}

export function saveAccessMap(map: FileAccessMap): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)); } catch { /* ignore */ }
}

export function setFileAccess(dropboxPath: string, level: FileAccessLevel): FileAccessMap {
  const map = { ...loadAccessMap(), [dropboxPath]: level };
  saveAccessMap(map);
  return map;
}

// Pure: may this role download this file? Unrated files stay open to everyone,
// so a missing rating never locks anyone out of the book.
export function roleMayDownload(map: FileAccessMap, dropboxPath: string, role: ProjectRole): boolean {
  const level = map[dropboxPath];
  if (!level) return true;
  if (level === "excluded") return false;
  return ROLE_ORDER.indexOf(role) >= ROLE_ORDER.indexOf(level);
}

function isValidLevel(value: unknown): value is FileAccessLevel {
  return typeof value === "string" && (value === "excluded" || (ROLE_ORDER as string[]).includes(value));
}

export function parseAccessMap(json: string): FileAccessMap {
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    const map: FileAccessMap = {};
    for (const [path, level] of Object.entries(raw)) {
      if (typeof path === "string" && isValidLevel(level)) map[path] = level;
    }
    return map;
  } catch {
    return {};
  }
}

// Pull the shared map from Dropbox and remember it locally. Quietly keeps the
// local copy when the bridge is off or the map has never been published.
export async function fetchSharedAccessMap(client: LongRotMcpClient): Promise<FileAccessMap> {
  try {
    const map = parseAccessMap(await client.readText(ACCESS_MAP_DROPBOX_PATH));
    saveAccessMap(map);
    return map;
  } catch {
    return loadAccessMap();
  }
}

// Owner only: publish the local ratings so every machine downloads by them.
export async function publishAccessMap(client: LongRotMcpClient): Promise<void> {
  await client.writeText(ACCESS_MAP_DROPBOX_PATH, JSON.stringify(loadAccessMap(), null, 2));
}
