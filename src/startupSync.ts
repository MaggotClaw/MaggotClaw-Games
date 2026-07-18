// Startup sync check: when the app opens, quietly compare each downloaded
// file's remembered Dropbox revision against the current one. Nothing is
// changed — the result is a gentle note telling the person whether their
// local copies are current.

import type { LongRotMcpClient } from "./mcp";

export interface SyncCheckResult {
  checked: number;
  stale: string[];          // dropbox paths with a newer revision on Dropbox
  missing: string[];        // files that could not be asked about (moved/removed)
  unreachable: boolean;     // bridge or Dropbox could not be asked at all
}

interface ManifestEntry {
  dropboxPath: string;
  revisionId: string | null;
  status: string;
}

export async function checkProjectSync(client: LongRotMcpClient): Promise<SyncCheckResult> {
  const result: SyncCheckResult = { checked: 0, stale: [], missing: [], unreachable: false };
  if (!("__TAURI_INTERNALS__" in window)) return result;
  const { invoke } = await import("@tauri-apps/api/core");
  let files: ManifestEntry[];
  try {
    files = (await invoke<Array<{ dropboxPath: string; revisionId: string | null; status: string }>>("list_project_documents"))
      .filter((file) => file.status === "downloaded" && file.revisionId);
  } catch {
    return result;
  }
  if (!files.length) return result;
  // One cheap probe decides whether the bridge is reachable at all, so a
  // single deleted file can never disguise itself as "everything is offline".
  try {
    await client.listFolder("/The Long Rot");
  } catch {
    result.unreachable = true;
    return result;
  }
  for (const file of files) {
    try {
      const current = await client.currentRevision(file.dropboxPath);
      result.checked += 1;
      if (current && file.revisionId && current !== file.revisionId) result.stale.push(file.dropboxPath);
    } catch {
      // This one file could not be asked about — probably moved or removed on
      // Dropbox. Note it and keep checking the rest.
      result.missing.push(file.dropboxPath);
    }
    // The same gentle pacing downloads use, so a big project cannot trip
    // Dropbox rate limits just by opening the app.
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return result;
}

export function syncNote(result: SyncCheckResult): string {
  if (result.unreachable) return "";
  if (!result.checked && !result.missing.length) return "";
  if (result.stale.length) {
    const count = result.stale.length;
    return `${count} File${count === 1 ? " Has" : "s Have"} Newer Versions On Dropbox`;
  }
  if (result.missing.length) {
    const count = result.missing.length;
    return `${count} File${count === 1 ? " May Have" : "s May Have"} Moved On Dropbox — Run Download Or Update`;
  }
  return "Local Copies Are Up To Date With Dropbox";
}
