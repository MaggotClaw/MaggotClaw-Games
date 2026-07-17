// The reader's shelf: the finished Reader Copy of every chapter, taken from the
// downloaded local files. Readers see the whole book's shape, but only the
// chapters the owner has released can be opened. Pure and unit-tested.

import { canPerform, type ProjectRole } from "./permissions";
import { compareVersions, parseDoc, type ParsedDoc, type ProjectDocument } from "./projectDocs";

// Chapters a reader may open today. Everything else is listed but locked, so a
// reader can see the shape of the book without being told why.
export const DEFAULT_UNLOCKED_CHAPTERS: number[] = [1, 2, 3, 4];

const STORAGE_KEY = "mcg-unlocked-chapters";

// One entry per chapter, newest version wins, in chapter order.
export function readerCopies(docs: ProjectDocument[]): ParsedDoc[] {
  const byChapter = new Map<number, ParsedDoc>();
  for (const doc of docs) {
    if (doc.status !== "downloaded") continue;
    const parsed = parseDoc(doc);
    if (parsed.typeCode !== "R" || parsed.chapter == null) continue;
    const existing = byChapter.get(parsed.chapter);
    const isWord = (item: ParsedDoc) => /\.docx$/i.test(item.fileName);
    // The author's styled Word copy of a chapter always beats the plain text
    // one; otherwise the newest version wins.
    const wins = !existing
      || (isWord(parsed) && !isWord(existing))
      || (isWord(parsed) === isWord(existing) && compareVersions(parsed.version, existing.version) > 0);
    if (wins) {
      byChapter.set(parsed.chapter, parsed);
    }
  }
  return [...byChapter.values()].sort((a, b) => (a.chapter ?? 0) - (b.chapter ?? 0));
}

// The author sees everything; everyone else sees only released chapters.
export function isChapterUnlocked(
  chapter: number | null,
  role: ProjectRole,
  unlocked: number[] = DEFAULT_UNLOCKED_CHAPTERS
): boolean {
  if (canPerform(role, "manage")) return true;
  return chapter != null && unlocked.includes(chapter);
}

export function loadUnlockedChapters(): number[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_UNLOCKED_CHAPTERS;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) && parsed.every((n) => typeof n === "number")
      ? (parsed as number[])
      : DEFAULT_UNLOCKED_CHAPTERS;
  } catch {
    return DEFAULT_UNLOCKED_CHAPTERS;
  }
}

export function saveUnlockedChapters(chapters: number[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...new Set(chapters)].sort((a, b) => a - b)));
  } catch {
    /* ignore private-mode storage errors */
  }
}
