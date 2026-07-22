// Check-for-updates, from either of two places.
//
// The author publishes the installer to his own Dropbox and, if he wants,
// GitHub as well. The app looks at Dropbox first and falls back to GitHub, so
// either can be switched off later without stranding anybody. Both sources are
// settings, not baked-in facts.

import { compareVersions } from "./projectDocs";

// GitHub is off by default.
//
// It used to be the fallback, with the repository named here, which quietly
// made every install — the author's and every reader's — depend on that
// repository staying public. Making it private would have turned Check For
// Updates into a 404 for everybody with nothing on screen to explain why.
// Dropbox is the author's real distribution channel, so it is the only one
// configured out of the box. A repository can still be set in Settings, and
// then it works exactly as before.
export const DEFAULT_UPDATE_REPO = "";

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

// ---- The author's own channel ---------------------------------------------
// A small file on Dropbox describing the newest build. Its address travels in
// the Messaging Key and the reader catalog, so friends never type anything.

const MANIFEST_KEY = "mcg-update-manifest-url";

// The author's published update file. This address never changes — Dropbox
// keeps the same share link while the file behind it is replaced — so it is
// the built-in default rather than something typed into every machine. A
// reader's Messaging Key can still carry a different one, and Settings still
// overrides both.
//
// This is a read-only share link to a file naming the current version and its
// installer. It carries nothing private.
export const DEFAULT_UPDATE_MANIFEST_URL =
  "https://www.dropbox.com/scl/fi/yu7oh90wpbksmzpiwcy1l/latest-version.json?rlkey=gfm3j5q50mxajq9ceyhx45v84&dl=1";

export interface UpdateManifest {
  version: string;
  installerUrl: string;
  notes?: string;
}

export function getUpdateManifestUrl(): string {
  try {
    return (localStorage.getItem(MANIFEST_KEY) || DEFAULT_UPDATE_MANIFEST_URL).trim();
  } catch {
    return DEFAULT_UPDATE_MANIFEST_URL;
  }
}

// Clearing the box puts the built-in address back rather than switching update
// checks off — an app that silently stops looking for updates is worse than
// one that looks in the standard place.
export function setUpdateManifestUrl(url: string): void {
  try {
    if (url.trim()) localStorage.setItem(MANIFEST_KEY, url.trim());
    else localStorage.removeItem(MANIFEST_KEY);
  } catch { /* ignore */ }
}

// Pure: read the published file, keeping only a sane version and a Dropbox
// installer address.
export function parseManifest(json: string): UpdateManifest | null {
  try {
    const raw = JSON.parse(json) as Partial<UpdateManifest>;
    const version = stripV(String(raw?.version ?? ""));
    const installerUrl = String(raw?.installerUrl ?? "");
    if (!/^[0-9]+(\.[0-9]+)*(-[A-Za-z0-9.]+)?$/.test(version)) return null;
    if (!/^https:\/\/[^\s]*dropbox(usercontent)?\.com\//.test(installerUrl)) return null;
    return { version, installerUrl, notes: typeof raw?.notes === "string" ? raw.notes : "" };
  } catch {
    return null;
  }
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
  // `downloadUrl` is carried even when nothing is new: it is the address the
  // author sends people so they can install the app in the first place, and it
  // used to come from the GitHub release page, which no longer exists for a
  // private repository.
  | { state: "current"; current: string; downloadUrl?: string }
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
  const manifestUrl = getUpdateManifestUrl();
  const repo = getUpdateRepo();
  if (!manifestUrl && !isValidRepo(repo)) return { state: "unconfigured" };
  if (!("__TAURI_INTERNALS__" in window)) {
    return { state: "error", message: "Open the installed MaggotClaw Games app to check for updates." };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  let firstProblem = "";

  // The author's own channel first.
  if (manifestUrl) {
    try {
      const manifest = parseManifest(await invoke<string>("fetch_dropbox_link_text", { url: manifestUrl }));
      if (manifest) {
        const info: UpdateInfo = {
          version: manifest.version,
          url: manifest.installerUrl,
          page: manifest.installerUrl,
          notes: manifest.notes ?? ""
        };
        return isNewer(info.version, current)
          ? { state: "available", info }
          : { state: "current", current, downloadUrl: manifest.installerUrl };
      }
      firstProblem = "The update file could not be read.";
    } catch (error) {
      firstProblem = error instanceof Error ? error.message : "The update file could not be reached.";
    }
  }

  // Then GitHub, so either source can be retired without stranding anyone.
  if (isValidRepo(repo)) {
    try {
      const json = await invoke<ReleaseJson>("fetch_latest_release", { repo });
      const info = parseLatestRelease(json);
      return isNewer(info.version, current) ? { state: "available", info } : { state: "current", current };
    } catch (error) {
      const second = error instanceof Error ? error.message : "The update check could not be completed.";
      return { state: "error", message: firstProblem || second };
    }
  }
  return { state: "error", message: firstProblem || "The update check could not be completed." };
}

export async function openDownload(url: string): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_url", { url });
}
