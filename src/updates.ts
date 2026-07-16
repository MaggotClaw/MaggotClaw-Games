// Check-for-updates against a GitHub repository's latest Release. Keeps only the
// small, pure helpers here; the network call and browser-open run through Tauri
// commands (see fetch_latest_release / open_url in the Rust side).

import { compareVersions } from "./projectDocs";

// The app's GitHub home. Releases published here (tag = version, with the
// …-setup.exe attached) are what "Check for updates" finds. It can still be
// overridden at runtime from Settings (stored per-machine) without a rebuild.
export const DEFAULT_UPDATE_REPO = "MaggotClaw/MaggotClaw-Games";

export function getUpdateRepo(): string {
  try {
    return (localStorage.getItem("mcg-update-repo") || DEFAULT_UPDATE_REPO).trim();
  } catch {
    return DEFAULT_UPDATE_REPO;
  }
}

export function setUpdateRepo(repo: string): void {
  try {
    localStorage.setItem("mcg-update-repo", repo.trim());
  } catch {
    /* ignore private-mode storage errors */
  }
}

export function isValidRepo(repo: string): boolean {
  return /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo.trim());
}

// A stable link to send people: GitHub always redirects /releases/latest to the
// newest published release, where they download the installer.
export function downloadShareLink(repo: string = getUpdateRepo()): string | null {
  return isValidRepo(repo) ? `https://github.com/${repo.trim()}/releases/latest` : null;
}

export interface UpdateInfo {
  version: string;
  url: string | null; // direct installer download, when present
  page: string;       // the release page, always usable as a fallback
  notes: string;
}

export type UpdateResult =
  | { state: "current"; current: string }
  | { state: "available"; info: UpdateInfo }
  | { state: "unconfigured" }
  | { state: "error"; message: string };

interface ReleaseAsset { name?: string; browser_download_url?: string }
interface ReleaseJson { tag_name?: string; name?: string; html_url?: string; body?: string; assets?: ReleaseAsset[] }

const stripV = (v: string) => v.replace(/^v/i, "").trim();

// Prefer the Windows NSIS installer (…setup.exe), then any .exe, then nothing.
export function pickInstaller(assets: ReleaseAsset[]): string | null {
  const exes = assets.filter((a) => /\.exe$/i.test(a?.name ?? ""));
  const setup = exes.find((a) => /setup/i.test(a.name ?? ""));
  return (setup ?? exes[0])?.browser_download_url ?? null;
}

export function parseLatestRelease(json: ReleaseJson): UpdateInfo {
  return {
    version: stripV(json?.tag_name || json?.name || "0"),
    url: pickInstaller(Array.isArray(json?.assets) ? json.assets : []),
    page: json?.html_url ?? "",
    notes: (json?.body ?? "").trim()
  };
}

export function isNewer(latest: string, current: string): boolean {
  return compareVersions(stripV(latest), stripV(current)) > 0;
}

export async function checkForUpdates(current: string): Promise<UpdateResult> {
  const repo = getUpdateRepo();
  if (!isValidRepo(repo)) return { state: "unconfigured" };
  if (!("__TAURI_INTERNALS__" in window)) {
    return { state: "error", message: "Open the installed MaggotClaw Games app to check for updates." };
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const json = await invoke<ReleaseJson>("fetch_latest_release", { repo });
    const info = parseLatestRelease(json);
    return isNewer(info.version, current) ? { state: "available", info } : { state: "current", current };
  } catch (error) {
    return { state: "error", message: error instanceof Error ? error.message : "The update check could not be completed." };
  }
}

export async function openDownload(url: string): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_url", { url });
}
