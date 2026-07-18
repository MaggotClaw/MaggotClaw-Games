// Which file is the reader's copy of a chapter.
//
// A chapter often exists twice: a plain text master the author keeps as the
// backup, and a styled Word document meant for people to actually read. Left
// alone the app guesses (newest version wins, Word breaks a tie) — this lets
// the owner say outright which one readers open.
//
// Like the file-access ratings, the picks live on Dropbox beside the project so
// every machine agrees, with a local copy for when Dropbox is unreachable.

import type { LongRotMcpClient } from "./mcp";
import { projectFile } from "./projects";

// chapter number -> the Dropbox path of the file readers should open.
export type ChapterFileMap = Record<number, string>;

export const chapterFilesPath = () => projectFile("chapter-files.json");
const STORAGE_KEY = "mcg-chapter-files";

export function loadChapterFiles(): ChapterFileMap {
  try { return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}")); } catch { return {}; }
}

export function saveChapterFiles(map: ChapterFileMap): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)); } catch { /* ignore */ }
}

// Passing an empty path clears the pick and hands the chapter back to the
// automatic rule — that is what "Automatic" in the dropdown does.
export function setChapterFile(chapter: number, dropboxPath: string): ChapterFileMap {
  const map = { ...loadChapterFiles() };
  if (dropboxPath) map[chapter] = dropboxPath;
  else delete map[chapter];
  saveChapterFiles(map);
  return map;
}

// Pure: keys that survive are real chapter numbers pointing at real paths.
function normalize(raw: unknown): ChapterFileMap {
  const map: ChapterFileMap = {};
  if (!raw || typeof raw !== "object") return map;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const chapter = Number(key);
    if (Number.isInteger(chapter) && chapter > 0 && typeof value === "string" && value.trim()) {
      map[chapter] = value;
    }
  }
  return map;
}

export function parseChapterFiles(json: string): ChapterFileMap {
  try { return normalize(JSON.parse(json)); } catch { return {}; }
}

export async function fetchSharedChapterFiles(client: LongRotMcpClient): Promise<ChapterFileMap> {
  try {
    const shared = parseChapterFiles(await client.readText(chapterFilesPath()));
    // Shared picks are the truth, but this machine's unpublished choices stay
    // on top of them — the same rule the access ratings follow.
    const merged = { ...shared, ...loadChapterFiles() };
    saveChapterFiles(merged);
    return merged;
  } catch {
    return loadChapterFiles();
  }
}

// Owner only: publish the picks so every reader opens what the author chose.
export async function publishChapterFiles(client: LongRotMcpClient): Promise<void> {
  await client.writeText(chapterFilesPath(), JSON.stringify(loadChapterFiles(), null, 2));
}
