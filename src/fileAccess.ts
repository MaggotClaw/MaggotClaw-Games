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

// Pull the shared map from Dropbox and remember it locally. `shared` says
// whether Dropbox actually answered — callers that guard downloads need to
// know the difference between "no ratings" and "could not ask".
export async function fetchSharedAccessMap(
  client: LongRotMcpClient
): Promise<{ map: FileAccessMap; shared: boolean }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const map = parseAccessMap(await client.readText(ACCESS_MAP_DROPBOX_PATH));
      // The shared ratings are the truth, but this machine's unpublished
      // edits stay on top of them.
      const merged = { ...map, ...loadAccessMap() };
      saveAccessMap(merged);
      return { map: merged, shared: true };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
  }
  return { map: loadAccessMap(), shared: false };
}

// Owner only: publish the local ratings so every machine downloads by them.
// Refuses to publish an empty map over a real one — that is how a fresh
// machine could otherwise wipe the whole permission system.
export async function publishAccessMap(client: LongRotMcpClient): Promise<void> {
  const local = loadAccessMap();
  if (!Object.keys(local).length) {
    try {
      const shared = parseAccessMap(await client.readText(ACCESS_MAP_DROPBOX_PATH));
      if (Object.keys(shared).length) {
        throw new Error("This computer has no ratings yet — open the file list and rate files before publishing.");
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("no ratings yet")) throw error;
      // No shared map exists either; publishing empty is harmless.
    }
  }
  await client.writeText(ACCESS_MAP_DROPBOX_PATH, JSON.stringify(local, null, 2));
}
