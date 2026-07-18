// End-of-chapter questions: the author writes two or three per chapter, and
// the app asks each reader when they finish. Answers travel through the
// normal comment pipeline, tagged to the chapter.

export type ChapterQuestions = Record<string, string[]>;   // chapter number -> questions

const STORAGE_KEY = "mcg-chapter-questions";

export function loadChapterQuestions(): ChapterQuestions {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as ChapterQuestions;
    return sanitizeChapterQuestions(raw);
  } catch {
    return {};
  }
}

export function saveChapterQuestions(map: ChapterQuestions): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeChapterQuestions(map))); } catch { /* ignore */ }
}

export function sanitizeChapterQuestions(raw: unknown): ChapterQuestions {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const clean: ChapterQuestions = {};
  for (const [chapter, questions] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d+$/.test(chapter) || !Array.isArray(questions)) continue;
    const kept = questions.filter((q): q is string => typeof q === "string" && q.trim().length > 0).map((q) => q.trim());
    if (kept.length) clean[chapter] = kept;
  }
  return clean;
}

export function questionsForChapter(chapter: number | null): string[] {
  if (chapter == null) return [];
  return loadChapterQuestions()[String(chapter)] ?? [];
}
