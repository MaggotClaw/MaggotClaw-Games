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
  // Reader's machine is never buried under working files meant for editors.
  const access = await fetchSharedAccessMap(client);
  const everything = await collectFiles(client, "/The Long Rot", onProgress);
  const files = everything.filter((file) =>
    file.path !== ACCESS_MAP_DROPBOX_PATH && roleMayDownload(access, file.path, role));
  const withheld = everything.length - files.length;
  let completed = 0;
  let skipped = 0;
  for (const file of files) {
    const extension = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";
    if (!TEXT_EXTENSIONS.has(extension)) {
      await invoke("record_project_binary_file", { dropboxPath: file.path });
      skipped += 1;
      onProgress({ stage: `Skipped ${file.name}; binary download support is not available yet`, completed, total: files.length, skipped });
      continue;
    }
    onProgress({ stage: `Downloading ${file.name}`, completed, total: files.length, skipped });
    const revisionBefore = await client.currentRevision(file.path);
    const content = await client.readText(file.path);
    const revisionAfter = await client.currentRevision(file.path);
    if (revisionBefore && revisionAfter && revisionBefore !== revisionAfter) {
      throw new Error(`${file.name} changed during download. Nothing was overwritten; run the download again.`);
    }
    await invoke("save_project_text_file", {
      dropboxPath: file.path,
      content,
      revisionId: revisionAfter || revisionBefore
    });
    completed += 1;
    onProgress({ stage: `Saved ${file.name}`, completed, total: files.length, skipped });
    // Gentle pause between files so a large project does not cluster Dropbox
    // calls and trip its rate limits. Downloads stay sequential and calm.
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const note = withheld > 0
    ? `Local download finished. ${withheld} file${withheld === 1 ? "" : "s"} stayed on Dropbox — not needed for your role.`
    : "Local download finished";
  return { stage: note, completed, total: files.length, skipped };
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
