// The reader's shelf: the finished Reader Copy of every chapter, taken from the
// downloaded local files. Readers see the whole book's shape, but only the
// chapters the owner has released can be opened. Pure and unit-tested.

import { canPerform, type ProjectRole } from "./permissions";
import { compareVersions, parseDoc, type ParsedDoc, type ProjectDocument } from "./projectDocs";
import type { LongRotMcpClient } from "./mcp";

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
    // The newest version always wins, whatever its format — an old Word file
    // must never shadow a newer text revision. On a version tie, the author's
    // styled Word copy beats the plain text one.
    const cmp = existing ? compareVersions(parsed.version, existing.version) : 1;
    const wins = !existing
      || cmp > 0
      || (cmp === 0 && isWord(parsed) && !isWord(existing));
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

// ---- Chapter releases shared through Dropbox -------------------------------
// The owner picks released chapters on the dashboard and publishes the list;
// every reader's app pulls it during the startup check, so releasing Chapter 5
// reaches everyone without a new build.

export const RELEASES_DROPBOX_PATH = "/The Long Rot/.mcg/released-chapters.json";

// A chapter can also be scheduled: it unlocks by itself on its date, with no
// republishing — release waves on a calendar.
export interface ScheduledRelease {
  chapter: number;
  on: string;               // YYYY-MM-DD
}

const SCHEDULE_KEY = "mcg-scheduled-releases";

export function loadScheduledReleases(): ScheduledRelease[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SCHEDULE_KEY) || "[]") as ScheduledRelease[];
    return raw.filter((s) => s && typeof s.chapter === "number" && /^\d{4}-\d{2}-\d{2}$/.test(s.on ?? ""));
  } catch {
    return [];
  }
}

export function saveScheduledReleases(list: ScheduledRelease[]): void {
  try { localStorage.setItem(SCHEDULE_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

// Pure: everything released outright plus every scheduled chapter whose day
// has arrived.
export function effectiveReleased(released: number[], scheduled: ScheduledRelease[], today: string): number[] {
  const due = scheduled.filter((s) => s.on <= today).map((s) => s.chapter);
  return [...new Set([...released, ...due])].sort((a, b) => a - b);
}

export function parseReleasedChapters(json: string): number[] | null {
  const file = parseReleasesFile(json);
  return file ? file.released : null;
}

// Accepts both the old plain-array format and the newer object with a
// schedule, so older published files keep working.
export function parseReleasesFile(json: string): { released: number[]; scheduled: ScheduledRelease[] } | null {
  try {
    const raw = JSON.parse(json) as unknown;
    if (Array.isArray(raw)) {
      if (!raw.every((n) => typeof n === "number")) return null;
      return { released: [...new Set(raw as number[])].sort((a, b) => a - b), scheduled: [] };
    }
    if (raw && typeof raw === "object") {
      const box = raw as { released?: unknown; scheduled?: unknown };
      const released = Array.isArray(box.released) && box.released.every((n) => typeof n === "number")
        ? [...new Set(box.released as number[])].sort((a, b) => a - b)
        : [];
      const scheduled = Array.isArray(box.scheduled)
        ? (box.scheduled as ScheduledRelease[]).filter((s) => s && typeof s.chapter === "number" && /^\d{4}-\d{2}-\d{2}$/.test(s.on ?? ""))
        : [];
      return { released, scheduled };
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchSharedReleases(client: LongRotMcpClient): Promise<number[] | null> {
  try {
    const file = parseReleasesFile(await client.readText(RELEASES_DROPBOX_PATH));
    if (!file) return null;
    saveScheduledReleases(file.scheduled);
    const effective = effectiveReleased(file.released, file.scheduled, new Date().toISOString().slice(0, 10));
    saveUnlockedChapters(effective);
    return effective;
  } catch {
    // Never published yet, or the bridge is off — keep the local list.
    return null;
  }
}

export async function publishReleases(client: LongRotMcpClient): Promise<void> {
  await client.writeText(RELEASES_DROPBOX_PATH, JSON.stringify({
    released: loadUnlockedChapters(),
    scheduled: loadScheduledReleases()
  }));
}
