// Reader links: the no-secrets way friends get the book.
//
// The owner's app creates a read-only Dropbox shared link for every file that
// readers are allowed to have, and writes one small catalog describing them
// (plus the released-chapter list). The catalog itself gets a shared link, and
// THAT single address is all a reader's app ever holds — no keys, no bridge,
// nothing that can write or leak. Links always serve the current file
// contents, so revisions reach readers with no republishing.

import { invoke } from "@tauri-apps/api/core";
import type { LongRotMcpClient } from "./mcp";
import { ROLE_ORDER, type ProjectRole } from "./permissions";
import { loadAccessMap, roleMayDownload, accessMapPath, type FileAccessLevel } from "./fileAccess";
import { activeProject, projectFile } from "./projects";
import { effectiveReleased, loadScheduledReleases, loadUnlockedChapters, saveScheduledReleases, saveUnlockedChapters, releasesPath, type ScheduledRelease } from "./readerCopies";
import { loadPronunciations, savePronunciations, type Pronunciation } from "./pronunciation";
import { loadChapterQuestions, saveChapterQuestions, sanitizeChapterQuestions, type ChapterQuestions } from "./chapterQuestions";
import { getUpdateManifestUrl, setUpdateManifestUrl } from "./updates";
import type { DownloadProgress } from "./projectWorkspace";

export interface CatalogFile {
  path: string;             // dropbox path inside the project
  name: string;
  url: string;              // read-only shared link
  access: FileAccessLevel;  // lowest role that needs it
}

export interface ReaderCatalog {
  updatedAt: string;
  released: number[];
  files: CatalogFile[];
  // The narrator's pronunciation dictionary rides along, so every reader's
  // voice says the invented names the way the author taught it.
  pronunciations?: Pronunciation[];
  // Chapters that unlock themselves on a date.
  scheduled?: ScheduledRelease[];
  // The author's end-of-chapter questions.
  questions?: ChapterQuestions;
  // Where new versions of the app are published.
  updateUrl?: string;
}

export const catalogPath = () => projectFile("reader-catalog.json");
const CATALOG_URL_KEY = "mcg-reader-catalog-url";

export function getCatalogUrl(): string {
  try { return localStorage.getItem(CATALOG_URL_KEY) || ""; } catch { return ""; }
}

export function setCatalogUrl(url: string): void {
  try {
    if (url.trim()) localStorage.setItem(CATALOG_URL_KEY, url.trim());
    else localStorage.removeItem(CATALOG_URL_KEY);
  } catch { /* ignore */ }
}

export function parseCatalog(json: string): ReaderCatalog | null {
  try {
    const raw = JSON.parse(json) as Partial<ReaderCatalog>;
    if (!Array.isArray(raw.files)) return null;
    const files = raw.files.filter((file): file is CatalogFile =>
      Boolean(file && typeof file.path === "string" && typeof file.url === "string" && typeof file.name === "string"));
    const released = Array.isArray(raw.released) && raw.released.every((n) => typeof n === "number")
      ? (raw.released as number[])
      : [];
    const pronunciations = Array.isArray(raw.pronunciations)
      ? raw.pronunciations.filter((p): p is Pronunciation =>
          Boolean(p && typeof p.say === "string" && typeof p.as === "string" && p.say.trim() && p.as.trim()))
      : undefined;
    const scheduled = Array.isArray(raw.scheduled)
      ? (raw.scheduled as ScheduledRelease[]).filter((s) => s && typeof s.chapter === "number" && /^\d{4}-\d{2}-\d{2}$/.test(s.on ?? ""))
      : undefined;
    const questions = raw.questions ? sanitizeChapterQuestions(raw.questions) : undefined;
    const updateUrl = typeof raw.updateUrl === "string" && raw.updateUrl.startsWith("https://") ? raw.updateUrl : undefined;
    return { updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "", released, files, pronunciations, scheduled, questions, updateUrl };
  } catch {
    return null;
  }
}

// Which catalog entries this role receives. Unrated entries stay open, the
// same rule downloads use everywhere else.
export function catalogFilesForRole(catalog: ReaderCatalog, role: ProjectRole): CatalogFile[] {
  return catalog.files.filter((file) => {
    if (!file.access) return true;
    if (file.access === "excluded") return false;
    return ROLE_ORDER.indexOf(role) >= ROLE_ORDER.indexOf(file.access);
  });
}

// ---- Owner side: publish ----------------------------------------------------

export async function publishReaderLinks(
  client: LongRotMcpClient,
  creds: { appKey: string; appSecret: string; refreshToken: string },
  onProgress: (progress: DownloadProgress) => void
): Promise<string> {
  const access = loadAccessMap();
  onProgress({ stage: "Checking the project on Dropbox", completed: 0, total: 0, skipped: 0 });
  const everything: Array<{ name: string; path: string; type: string }> = [];
  const walk = async (path: string) => {
    for (const entry of await client.listFolder(path)) {
      if (entry.type === "folder") {
        if (entry.name !== ".mcg") await walk(entry.path);
      } else {
        everything.push(entry);
      }
    }
  };
  await walk(activeProject().dropboxRoot);
  const shareable = everything.filter((file) =>
    file.path !== accessMapPath()
    && file.path !== releasesPath()
    && file.path !== catalogPath()
    && access[file.path] !== "excluded");

  const files: CatalogFile[] = [];
  let completed = 0;
  for (const file of shareable) {
    onProgress({ stage: `Making a reader link for ${file.name}`, completed, total: shareable.length, skipped: 0 });
    const url = await invoke<string>("dropbox_shared_link", { creds, path: file.path });
    files.push({ path: file.path, name: file.name, url, access: access[file.path] ?? "reader" });
    completed += 1;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  const catalog: ReaderCatalog = {
    updatedAt: new Date().toISOString(),
    released: loadUnlockedChapters(),
    files,
    pronunciations: loadPronunciations(),
    scheduled: loadScheduledReleases(),
    questions: loadChapterQuestions(),
    updateUrl: getUpdateManifestUrl() || undefined
  };
  onProgress({ stage: "Publishing the catalog", completed, total: shareable.length, skipped: 0 });
  await client.writeText(catalogPath(), JSON.stringify(catalog, null, 2));
  const catalogUrl = await invoke<string>("dropbox_shared_link", { creds, path: catalogPath() });
  setCatalogUrl(catalogUrl);
  return catalogUrl;
}

// ---- Reader side: download --------------------------------------------------

export async function fetchCatalog(): Promise<ReaderCatalog | null> {
  const url = getCatalogUrl();
  if (!url || !("__TAURI_INTERNALS__" in window)) return null;
  const text = await invoke<string>("fetch_dropbox_link_text", { url });
  const catalog = parseCatalog(text);
  if (catalog) {
    if (catalog.scheduled) saveScheduledReleases(catalog.scheduled);
    const effective = effectiveReleased(catalog.released, catalog.scheduled ?? [], new Date().toISOString().slice(0, 10));
    if (effective.length) {
      saveUnlockedChapters(effective);
      catalog.released = effective;
    }
    if (catalog.pronunciations) savePronunciations(catalog.pronunciations);
    if (catalog.questions) saveChapterQuestions(catalog.questions);
    if (catalog.updateUrl) setUpdateManifestUrl(catalog.updateUrl);
  }
  return catalog;
}

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "json", "jsonl", "csv", "tsv", "yaml", "yml",
  "xml", "html", "htm", "css", "js", "jsx", "ts", "tsx", "rs", "ps1",
  "log", "ini", "toml"
]);

export async function downloadProjectViaLinks(
  role: ProjectRole,
  onProgress: (progress: DownloadProgress) => void
): Promise<DownloadProgress> {
  await invoke("initialize_project_workspace");
  onProgress({ stage: "Reading the catalog from MaggotClaw", completed: 0, total: 0, skipped: 0 });
  const catalog = await fetchCatalog();
  if (!catalog) throw new Error("The reader catalog could not be read. Ask MaggotClaw for a fresh Messaging Key.");
  const mine = catalogFilesForRole(catalog, role);
  let completed = 0;
  let skipped = 0;
  const failures: string[] = [];
  for (const file of mine) {
    try {
      const extension = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";
      if (extension && !TEXT_EXTENSIONS.has(extension)) {
        await invoke("record_project_binary_file", { dropboxPath: file.path });
        skipped += 1;
        onProgress({ stage: `Skipped ${file.name}; binary download support is not available yet`, completed, total: mine.length, skipped });
        continue;
      }
      onProgress({ stage: `Downloading ${file.name}`, completed, total: mine.length, skipped });
      const content = await invoke<string>("fetch_dropbox_link_text", { url: file.url });
      await invoke("save_project_text_file", { dropboxPath: file.path, content, revisionId: null });
      completed += 1;
      onProgress({ stage: `Saved ${file.name}`, completed, total: mine.length, skipped });
    } catch {
      failures.push(file.name);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const parts = [`${completed} saved`];
  if (skipped) parts.push(`${skipped} waiting on binary support`);
  if (failures.length) parts.push(`${failures.length} had problems: ${failures[0]}${failures.length > 1 ? "…" : ""}`);
  return { stage: `Update finished — ${parts.join(" · ")}.`, completed, total: mine.length, skipped };
}

// This machine can download without any keys at all.
export function readerLinksConfigured(): boolean {
  return Boolean(getCatalogUrl());
}
