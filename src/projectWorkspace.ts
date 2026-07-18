import { invoke } from "@tauri-apps/api/core";
import { LongRotMcpClient, type ProjectEntry } from "./mcp";
import { fetchSharedAccessMap, roleMayDownload, ACCESS_MAP_DROPBOX_PATH } from "./fileAccess";
import type { ProjectRole } from "./permissions";

export interface WorkspaceStatus {
  workspacePath: string;
  initialized: boolean;
  downloadedFiles: number;
  pendingBinaryFiles: number;
  lastDownloadAt: string | null;
  uploadEnabled: boolean;
}

export interface DownloadProgress {
  stage: string;
  completed: number;
  total: number;
  skipped: number;
}

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "json", "jsonl", "csv", "tsv", "yaml", "yml",
  "xml", "html", "htm", "css", "js", "jsx", "ts", "tsx", "rs", "ps1",
  "log", "ini", "toml"
]);

export function workspaceStatus(): Promise<WorkspaceStatus> {
  return invoke("project_workspace_status");
}

export function initializeWorkspace(): Promise<WorkspaceStatus> {
  return invoke("initialize_project_workspace");
}

export function openWorkspace(): Promise<void> {
  return invoke("open_project_workspace");
}

export async function downloadProject(
  client: LongRotMcpClient,
  role: ProjectRole,
  onProgress: (progress: DownloadProgress) => void
): Promise<DownloadProgress> {
  await initializeWorkspace();
  // The owner's file ratings decide what this role actually needs, so a
  // Reader's machine is never buried under files meant for editors. If the
  // ratings cannot be read at all, non-owners stop rather than silently
  // downloading everything unrated.
  const access = await fetchSharedAccessMap(client);
  if (!access.shared && role !== "administrator" && role !== "support" && !Object.keys(access.map).length) {
    throw new Error("The file permissions could not be read, so nothing was downloaded. Try again in a moment.");
  }
  const everything = await collectFiles(client, "/The Long Rot", onProgress);
  const files = everything.filter((file) =>
    file.path !== ACCESS_MAP_DROPBOX_PATH && roleMayDownload(access.map, file.path, role));
  const withheld = everything.length - files.length;

  // What this machine already has, so unchanged files can be skipped instead
  // of re-downloaded — an everyday Update takes seconds, not minutes.
  const known = new Map<string, string>();
  const knownPaths = new Set<string>();
  try {
    for (const doc of await invoke<Array<{ dropboxPath: string; revisionId: string | null }>>("list_project_documents")) {
      knownPaths.add(doc.dropboxPath);
      if (doc.revisionId) known.set(doc.dropboxPath, doc.revisionId);
    }
  } catch { /* fresh workspace */ }

  let completed = 0;
  let skipped = 0;
  let unchanged = 0;
  const failures: string[] = [];
  for (const file of files) {
    try {
      const extension = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";
      // Files with no extension are almost always plain text notes.
      if (extension && !TEXT_EXTENSIONS.has(extension)) {
        await invoke("record_project_binary_file", { dropboxPath: file.path });
        skipped += 1;
        onProgress({ stage: `Skipped ${file.name}; binary download support is not available yet`, completed, total: files.length, skipped });
        continue;
      }
      const revisionBefore = await client.currentRevision(file.path);
      if (revisionBefore && known.get(file.path) === revisionBefore) {
        unchanged += 1;
        onProgress({ stage: `${file.name} is already current`, completed, total: files.length, skipped });
        continue;
      }
      onProgress({ stage: `Downloading ${file.name}`, completed, total: files.length, skipped });
      const content = await client.readText(file.path);
      const revisionAfter = await client.currentRevision(file.path);
      if (revisionBefore && revisionAfter && revisionBefore !== revisionAfter) {
        // Being edited right this second — skip it and keep going instead of
        // abandoning every remaining file.
        failures.push(`${file.name} (being edited right now)`);
        continue;
      }
      await invoke("save_project_text_file", {
        dropboxPath: file.path,
        content,
        revisionId: revisionAfter || revisionBefore
      });
      completed += 1;
      onProgress({ stage: `Saved ${file.name}`, completed, total: files.length, skipped });
    } catch {
      failures.push(file.name);
    }
    // Gentle pause between files so a large project does not cluster Dropbox
    // calls and trip its rate limits. Downloads stay sequential and calm.
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  // Files that vanished from Dropbox (deleted or renamed) get tucked into
  // Backups locally instead of haunting the shelf and search forever.
  let retired = 0;
  const listed = new Set(everything.map((file) => file.path));
  for (const path of knownPaths) {
    if (listed.has(path) || path.startsWith("local:")) continue;
    try {
      await invoke("retire_project_file", { dropboxPath: path });
      retired += 1;
    } catch { /* leave it for next time */ }
  }

  const parts = [`${completed} saved`, `${unchanged} already current`];
  if (skipped) parts.push(`${skipped} waiting on binary support`);
  if (retired) parts.push(`${retired} removed on Dropbox (tucked into Backups)`);
  if (withheld) parts.push(`${withheld} not needed for your role`);
  if (failures.length) parts.push(`${failures.length} had problems: ${failures[0]}${failures.length > 1 ? "…" : ""}`);
  return { stage: `Update finished — ${parts.join(" · ")}.`, completed, total: files.length, skipped };
}

async function collectFiles(
  client: LongRotMcpClient,
  path: string,
  onProgress: (progress: DownloadProgress) => void
): Promise<ProjectEntry[]> {
  onProgress({ stage: `Checking ${path}`, completed: 0, total: 0, skipped: 0 });
  const entries = await client.listFolder(path);
  const files = entries.filter((entry) => entry.type === "file");
  // ".mcg" holds the app's own shared settings, not project writing.
  const folders = entries.filter((entry) => entry.type === "folder" && entry.name !== ".mcg");
  for (const folder of folders) {
    files.push(...await collectFiles(client, folder.path, onProgress));
  }
  return files;
}

export function formatWorkspaceTime(value: string | null): string {
  if (!value) return "Never";
  const seconds = Number(value);
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toLocaleString() : value;
}
