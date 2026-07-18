// The narrator's pronunciation dictionary. The owner teaches her the invented
// names once ("Louvenia" → "loo-VEE-nee-ah") and every narrated sentence on
// every machine says them right. Applied as plain text substitution just
// before speech; the text on screen never changes.

export interface Pronunciation {
  say: string;   // the word as written in the book
  as: string;    // how the narrator should pronounce it
}

const STORAGE_KEY = "mcg-pronunciations";

export function loadPronunciations(): Pronunciation[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as Pronunciation[];
    return raw.filter((p) => p && typeof p.say === "string" && typeof p.as === "string" && p.say.trim() && p.as.trim());
  } catch {
    return [];
  }
}

export function savePronunciations(list: Pronunciation[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.filter((p) => p.say.trim() && p.as.trim())));
  } catch { /* ignore */ }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Pure: replace whole words, case-insensitively, longest names first so
// "Louvenia Blackwood" wins over "Louvenia".
export function applyPronunciations(text: string, list: Pronunciation[]): string {
  let spoken = text;
  const ordered = [...list].sort((a, b) => b.say.length - a.say.length);
  for (const entry of ordered) {
    const pattern = new RegExp(`\\b${escapeRegExp(entry.say.trim())}\\b`, "gi");
    spoken = spoken.replace(pattern, entry.as.trim());
  }
  return spoken;
}

// Convenience for the speech player: apply the saved dictionary.
export function pronounce(text: string): string {
  const list = loadPronunciations();
  return list.length ? applyPronunciations(text, list) : text;
}
