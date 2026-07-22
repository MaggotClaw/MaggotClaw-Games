// Deterministic "just say it" resolver. Turns a spoken/typed phrase such as
// "chapter 2", "ch 2 reader", "Silas", "the Blackwood", or "master codex" into
// the single best file to open — plus sensible alternatives. No AI, no network:
// pure grammar over the local file list, so it is instant and free.

import { compareVersions, type ParsedDoc } from "./projectDocs";

export interface QuickOpenResult {
  best: ParsedDoc | null;
  candidates: ParsedDoc[];
  interpretation: string;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, "twenty-one": 21, "twenty-two": 22, "twenty-three": 23,
  "twenty-four": 24, "twenty-five": 25, "twenty-six": 26, "twenty-seven": 27,
  "twenty-eight": 28, "twenty-nine": 29, thirty: 30
};

type Stage = "B" | "D" | "P" | "R" | "master" | "codex" | null;

// Reading preference within a chapter when no stage is named: the clean Reader
// Copy first, then the most advanced draft segment, then the chapter draft,
// then Blueprint.
const READ_ORDER: ParsedDoc["typeCode"][] = ["R", "P", "D", "B"];
// General ranking used for name matches — most authoritative/readable first.
const PREFER: Record<string, number> = { R: 0, codex: 1, master: 1, P: 2, D: 3, B: 4, other: 5 };

function logicalKey(d: ParsedDoc): string {
  if (d.chapter != null) return `ch${d.chapter}-${d.typeCode}${d.draftPart ?? ""}`;
  if (d.typeCode === "master") return "master";
  return `${d.typeCode}:${d.title.toLowerCase()}`;
}

// Collapse multiple versions of the same logical file down to the newest one.
export function latestVersions(docs: ParsedDoc[]): ParsedDoc[] {
  const map = new Map<string, ParsedDoc>();
  for (const d of docs) {
    const key = logicalKey(d);
    const cur = map.get(key);
    if (!cur || compareVersions(d.version, cur.version) > 0) map.set(key, d);
  }
  return [...map.values()];
}

function parseChapter(q: string): number | null {
  const digit = q.match(/\b(?:chapters?|chap|ch|c)\s*0*(\d{1,2})\b/);
  if (digit) return parseInt(digit[1], 10);
  const word = q.match(/\b(?:chapters?|chap|ch)\s+([a-z-]+)\b/);
  if (word && NUMBER_WORDS[word[1]] != null) return NUMBER_WORDS[word[1]];
  return null;
}

function parseStage(q: string): { code: Stage; part: number | null } {
  if (/\bmaster\b/.test(q)) return { code: "master", part: null };
  if (/\breader\b/.test(q)) return { code: "R", part: null };
  if (/\bblueprint\b/.test(q)) return { code: "B", part: null };
  // "Development" is the old name for the chapter draft; both still find it.
  // This has to be tried before the plain "draft" test below, or "chapter
  // draft" would be read as a draft segment.
  if (/\bchapter draft\b|\bdevelopment\b|\bdev\b/.test(q)) return { code: "D", part: null };
  if (/\bdraft\b|\bpart\b|\bp\d+\b/.test(q)) {
    const m = q.match(/\b(?:draft|part|p)\s*0*(\d+)\b/);
    return { code: "P", part: m ? parseInt(m[1], 10) : null };
  }
  if (/\bcodex\b/.test(q)) return { code: "codex", part: null };
  return { code: null, part: null };
}

// Strip the words we already interpreted (chapter, stage, filler) so what
// remains is a name to match against titles — "the Blackwood", "Silas".
function nameQuery(q: string): string {
  return q
    .replace(/\b(?:chapters?|chap|ch|c)\s*0*\d{1,2}\b/g, " ")
    .replace(/\b(?:reader copy|reader|blueprint|chapter draft|draft segment|development|dev|draft|segment|part|master codex|master|codex)\b/g, " ")
    .replace(/\bp\d+\b/g, " ")
    .replace(/\b(?:the|a|an|of|open|show|find|go|to|goto|pull|up|lets|let|s|please|check|read|view)\b/g, " ")
    .replace(/[^a-z0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function describeDoc(d: ParsedDoc): string {
  if (d.chapter != null) {
    const stage = d.typeCode === "P"
      ? `Draft${d.draftPart != null ? ` part ${d.draftPart}` : ""}`
      : d.typeLabel;
    const named = d.title.startsWith("Chapter") ? "" : ` — ${d.title}`;
    return `Chapter ${d.chapter} · ${stage}${named}`;
  }
  return d.title;
}

function chapterReadOrder(docs: ParsedDoc[]): ParsedDoc[] {
  return [...docs].sort((a, b) => {
    const ra = READ_ORDER.indexOf(a.typeCode);
    const rb = READ_ORDER.indexOf(b.typeCode);
    if (ra !== rb) return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
    // Within drafts, most advanced part first.
    return (b.draftPart ?? 0) - (a.draftPart ?? 0);
  });
}

function rankByName(name: string, docs: ParsedDoc[]): ParsedDoc[] {
  const tokens = name.split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const scored: { d: ParsedDoc; score: number }[] = [];
  for (const d of docs) {
    const hay = `${d.title} ${d.fileName}`.toLowerCase();
    let score = 0;
    for (const t of tokens) if (hay.includes(t)) score += 1;
    if (!score) continue;
    if (d.title.toLowerCase() === name) score += 5;
    if (/profiles/i.test(d.fileName)) score += 2; // a character/place profile
    scored.push({ d, score });
  }
  scored.sort((a, b) =>
    b.score - a.score ||
    (PREFER[a.d.typeCode] ?? 9) - (PREFER[b.d.typeCode] ?? 9) ||
    a.d.title.localeCompare(b.d.title)
  );
  return scored.map((s) => s.d);
}

export function resolveQuickOpen(query: string, allDocs: ParsedDoc[]): QuickOpenResult {
  const q = query.toLowerCase().trim();
  const empty: QuickOpenResult = { best: null, candidates: [], interpretation: "" };
  if (!q) return empty;

  const docs = latestVersions(allDocs);
  const chapter = parseChapter(q);
  const stage = parseStage(q);
  const name = nameQuery(q);

  // A named chapter number is the strongest, clearest signal.
  if (chapter != null) {
    const inChapter = docs.filter((d) => d.chapter === chapter);
    if (!inChapter.length) return { ...empty, interpretation: `Chapter ${chapter} — no files here yet` };
    let picked: ParsedDoc[];
    if (stage.code === "R" || stage.code === "B" || stage.code === "D") {
      picked = inChapter.filter((d) => d.typeCode === stage.code);
    } else if (stage.code === "P") {
      let ps = inChapter.filter((d) => d.typeCode === "P");
      if (stage.part != null) ps = ps.filter((d) => d.draftPart === stage.part);
      else ps = [...ps].sort((a, b) => (b.draftPart ?? 0) - (a.draftPart ?? 0));
      picked = ps;
    } else {
      picked = chapterReadOrder(inChapter);
    }
    const best = picked[0] ?? chapterReadOrder(inChapter)[0];
    return { best, candidates: chapterReadOrder(inChapter), interpretation: describeDoc(best) };
  }

  if (stage.code === "master") {
    const m = docs.find((d) => d.typeCode === "master") ?? null;
    return { best: m, candidates: m ? [m] : [], interpretation: m ? "Master Codex" : "" };
  }

  // A name on its own — a character, a place, a chapter's title.
  if (name) {
    const matches = rankByName(name, docs);
    if (matches.length) return { best: matches[0], candidates: matches.slice(0, 8), interpretation: describeDoc(matches[0]) };
  }

  if (stage.code === "codex") {
    const codexes = docs
      .filter((d) => d.typeCode === "codex" || d.typeCode === "master")
      .sort((a, b) => (PREFER[a.typeCode] ?? 9) - (PREFER[b.typeCode] ?? 9) || a.title.localeCompare(b.title));
    return { best: codexes[0] ?? null, candidates: codexes.slice(0, 8), interpretation: codexes[0] ? "Codex" : "" };
  }

  return empty;
}
