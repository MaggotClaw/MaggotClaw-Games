import { invoke } from "@tauri-apps/api/core";
import { LongRotMcpClient, type ProjectEntry } from "./mcp";

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
  onProgress: (progress: DownloadProgress) => void
): Promise<DownloadProgress> {
  await initializeWorkspace();
  const files = await collectFiles(client, "/The Long Rot", onProgress);
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
  return { stage: "Local download finished", completed, total: files.length, skipped };
}

async function collectFiles(
  client: LongRotMcpClient,
  path: string,
  onProgress: (progress: DownloadProgress) => void
): Promise<ProjectEntry[]> {
  onProgress({ stage: `Checking ${path}`, completed: 0, total: 0, skipped: 0 });
  const entries = await client.listFolder(path);
  const files = entries.filter((entry) => entry.type === "file");
  const folders = entries.filter((entry) => entry.type === "folder");
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
