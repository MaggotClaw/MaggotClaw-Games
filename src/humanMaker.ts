// The Human Maker: the app's prose-audit engine, built to the author's own
// "91 Codex, Human Maker" file. It scans a passage for the mechanical tells
// that flag prose as machine-written and reports each hit in the author's own
// numbering and language, under the Ward Directive.
//
// It is a DETECTOR and CHECKLIST, run entirely on this computer — the book
// never leaves the machine. The humanizing rewrite itself is still the
// author's "Ok Go" to an AI with this report in hand; a rule engine can find
// the tells but cannot write in a living voice.
//
// Rule sources (used as reference; our own clean implementation): the author's
// Human Maker codex, plus the MIT-licensed harshaneel/humanize levers and the
// llmstrip / write-good rule sets.

export type TellCategory =
  | "Punctuation & Syntax"
  | "Word Choice & Repetition"
  | "Tone & Voice"
  | "Description & Exposition"
  | "Structure & Flow"
  | "Dialogue";

export interface Tell {
  n: number;
  category: TellCategory;
  title: string;
  fix: string;
  auto: boolean; // true when this engine can flag it; false = read-aloud checklist
}

export interface Finding {
  tell: number;
  category: TellCategory;
  title: string;
  severity: "high" | "medium" | "low";
  detail: string;      // what was found, in plain words
  excerpt: string;     // the offending text, trimmed
  fix: string;
}

export interface AuditStats {
  words: number;
  sentences: number;
  paragraphs: number;
  avgSentenceWords: number;
  sentenceVariety: number;   // std-dev of sentence length; low = uniform
  emDashesPer1000: number;
  singleLineParagraphs: number;
}

export interface AuditReport {
  stats: AuditStats;
  findings: Finding[];
  score: number;             // 0 (very machine) .. 100 (reads human)
  verdict: string;
  checklist: Tell[];         // the human-judgment tells to read for
}

// ---- The author's full tell catalogue (his numbering) ----------------------

export const TELLS: Tell[] = [
  { n: 1, category: "Punctuation & Syntax", title: "Em-dash overuse", fix: "Most become periods or commas. Keep an em-dash only where a genuine interruption earns it — roughly one or two per page.", auto: true },
  { n: 2, category: "Punctuation & Syntax", title: "Staccato one-line paragraphs", fix: "Fold most fragments back into full paragraphs. Reserve the isolated line for one or two earned moments per chapter.", auto: true },
  { n: 3, category: "Punctuation & Syntax", title: "Formulaic sentence structure", fix: "Vary hard. Let a long winding sentence be followed by a three-word one. Ward's music lives in the variation.", auto: true },
  { n: 4, category: "Punctuation & Syntax", title: "Perfect grammatical symmetry", fix: "Break the symmetry. Let one list item run long and another sit blunt.", auto: false },
  { n: 5, category: "Punctuation & Syntax", title: "Missing contractions", fix: "Use contractions wherever the voice and era allow, especially in dialogue.", auto: true },
  { n: 6, category: "Punctuation & Syntax", title: "Passive voice dominance", fix: "Active, direct statements. Somebody does something.", auto: true },
  { n: 7, category: "Punctuation & Syntax", title: "Repetitive sentence openings", fix: "Vary openings. Track it across the page, not just the paragraph.", auto: true },
  { n: 8, category: "Word Choice & Repetition", title: "AI favorite words", fix: "Cut on sight. Replace with the plain word or nothing.", auto: true },
  { n: 9, category: "Word Choice & Repetition", title: "Overused transitions", fix: "Trust silence. Let ideas touch without a connector.", auto: true },
  { n: 10, category: "Word Choice & Repetition", title: "Business jargon & vague authority words", fix: "Cut. Say the specific thing instead.", auto: true },
  { n: 11, category: "Word Choice & Repetition", title: "Inflated significance language", fix: "Cut the frame. Show the thing mattering instead of announcing it.", auto: true },
  { n: 12, category: "Word Choice & Repetition", title: "Repetitive word choices", fix: "Each striking word gets used once, then retired.", auto: true },
  { n: 13, category: "Word Choice & Repetition", title: "Triplet framing & compulsive alliteration", fix: "Break triplets into twos, fours, or a single item. Alliteration survives only by accident.", auto: true },
  { n: 14, category: "Word Choice & Repetition", title: "Keyword stuffing", fix: "Say it once, then use pronouns, synonyms, or nothing.", auto: true },
  { n: 15, category: "Tone & Voice", title: "Hedging language", fix: "Assert. Even uncertainty gets written with forward momentum.", auto: true },
  { n: 16, category: "Tone & Voice", title: "Uniform, unnaturally consistent tone", fix: "Let the voice move with the scene. Tension tightens sentences; grief loosens them.", auto: false },
  { n: 17, category: "Tone & Voice", title: "No personal voice", fix: "Filter everything through the POV character's obsessions, vocabulary, and blind spots.", auto: false },
  { n: 18, category: "Tone & Voice", title: "Flat, uniform polish", fix: "Leave imperfection in. A slightly awkward phrase that sounds like a person beats a perfect one that sounds like a machine.", auto: false },
  { n: 19, category: "Tone & Voice", title: "Absence of voice instability", fix: "Let the narration destabilize when the character does.", auto: false },
  { n: 20, category: "Tone & Voice", title: "Absence of contradiction or doubt", fix: "Let a thought get revised mid-page. Let the narrator be wrong and correct course.", auto: false },
  { n: 21, category: "Tone & Voice", title: "No tangential asides", fix: "Follow a thought one step off the path occasionally, the way a mind does, then come back.", auto: false },
  { n: 22, category: "Tone & Voice", title: "Avoidance of first person", fix: "Use \"I\" where a person would (author-voice documents, not the novel's close third).", auto: false },
  { n: 23, category: "Tone & Voice", title: "No genuine humor or idiosyncrasy", fix: "Humor comes from character and situation or not at all.", auto: false },
  { n: 24, category: "Tone & Voice", title: "High noun density, low emotional markers", fix: "Let stance leak in. Emotion breathes through the narrative, it is not reported by it.", auto: false },
  { n: 25, category: "Description & Exposition", title: "Character inventory blocks", fix: "Cut the block. Scatter physical details across action, each arriving when it matters.", auto: false },
  { n: 26, category: "Description & Exposition", title: "Emotionless exposition mixed with forced emotion", fix: "Emotion threads through description continuously via POV, or the reach gets cut.", auto: false },
  { n: 27, category: "Description & Exposition", title: "Lack of sensory grounding", fix: "Root every scene in particular sensory detail tied to place.", auto: false },
  { n: 28, category: "Description & Exposition", title: "Missing cultural or temporal specificity", fix: "Details particular to 1877 Saint Barrow Parish, or they don't go in.", auto: false },
  { n: 29, category: "Description & Exposition", title: "Personified callbacks on inanimate objects", fix: "Objects carry meaning through what characters do with them, not through granted memory.", auto: true },
  { n: 30, category: "Description & Exposition", title: "Artificial narrative flair", fix: "A metaphor survives only if it comes from the POV character's world. Kill anything that sounds written.", auto: false },
  { n: 31, category: "Description & Exposition", title: "Hallucinated specifics", fix: "Every hard fact checks against the Master Bible or period research.", auto: false },
  { n: 32, category: "Description & Exposition", title: "Overly confident declarations on uncertain ground", fix: "The narration only knows what the POV character can know.", auto: false },
  { n: 33, category: "Structure & Flow", title: "Too-perfect transitions", fix: "Allow hard cuts. A scene can end mid-beat.", auto: false },
  { n: 34, category: "Structure & Flow", title: "Weak global coherence", fix: "Every scene advances character, plot, or dread. If it only maintains, load it or cut it.", auto: false },
  { n: 35, category: "Structure & Flow", title: "Repetition without advancement", fix: "Each return to an image or idea must add something new.", auto: false },
  { n: 36, category: "Structure & Flow", title: "Overly neat conclusions", fix: "End on image, action, or implication. Never on recap.", auto: false },
  { n: 37, category: "Structure & Flow", title: "Uniform paragraph lengths", fix: "Vary block size the way breath varies. A one-sentence paragraph against a half-page one.", auto: true },
  { n: 38, category: "Structure & Flow", title: "Abrupt unintended style shifts", fix: "One voice governs the chapter. Read the full chapter aloud to catch seams.", auto: false },
  { n: 39, category: "Structure & Flow", title: "All problems presented as solvable", fix: "Let some things stay unresolved on the page. This story runs on unresolved weight.", auto: false },
  { n: 40, category: "Dialogue", title: "Dialogue without friction", fix: "Add interruptions, half-answers, subject changes. People answer the question they wish was asked.", auto: false },
  { n: 41, category: "Dialogue", title: "No physical life inside dialogue", fix: "Hands stay busy. Dialogue happens over tasks, meals, distances.", auto: false },
  { n: 42, category: "Dialogue", title: "Overly explanatory dialogue", fix: "People imply, deflect, and lie. The truth of a scene lives under the words.", auto: false },
  { n: 43, category: "Dialogue", title: "Sanitized speech", fix: "Characters talk the way those people talked, within the author's standing choices.", auto: false },
  { n: 44, category: "Dialogue", title: "Generic character names", fix: "Names come from era, region, family, and community.", auto: false },
  { n: 45, category: "Dialogue", title: "No personal experience in the prose", fix: "Ground in specific knowledge and research — labor, weather, animals, tools, grief written from the inside.", auto: false }
];

const tell = (n: number) => TELLS.find((t) => t.n === n)!;

// ---- Word and phrase lists -------------------------------------------------

const AI_WORDS = [
  "delve", "delving", "leverage", "leveraging", "pivotal", "comprehensive", "innovative",
  "cutting-edge", "nuanced", "dynamic", "meticulous", "meticulously", "invaluable", "essential",
  "robust", "seamless", "seamlessly", "showcase", "showcasing", "vibrant", "harness", "harnessing",
  "unlock", "unlocking", "tapestry", "testament", "realm", "landscape", "underscore", "underscores",
  "myriad", "plethora", "intricate", "bustling", "elevate", "elevates", "navigate", "navigating",
  "foster", "fostering", "profound", "boasts", "endeavor", "utilize", "utilizing"
];

const TRANSITIONS = [
  "furthermore", "additionally", "moreover", "in conclusion", "consequently",
  "nevertheless", "notably", "importantly", "ultimately", "subsequently"
];

const JARGON = ["game-changing", "game changer", "streamline", "streamlined", "streamlining", "synergy", "optimize"];

const INFLATED = [
  "plays a vital role", "plays a pivotal role", "plays a crucial role", "serves as a testament",
  "leaves a lasting impact", "stands as a reminder", "a testament to", "it is important to note",
  "it is worth noting", "it should be noted", "serves as a", "stands as a"
];

const HEDGES = ["perhaps", "arguably", "generally", "relatively", "somewhat", "virtually", "seemingly", "presumably", "tends to", "could be seen as"];

// Missing-contraction pairs: pattern -> suggestion.
const CONTRACTIONS: Array<[RegExp, string]> = [
  [/\bdo not\b/gi, "don't"], [/\bdoes not\b/gi, "doesn't"], [/\bdid not\b/gi, "didn't"],
  [/\bwill not\b/gi, "won't"], [/\bcannot\b/gi, "can't"], [/\bcan not\b/gi, "can't"],
  [/\bis not\b/gi, "isn't"], [/\bare not\b/gi, "aren't"], [/\bwas not\b/gi, "wasn't"],
  [/\bwere not\b/gi, "weren't"], [/\bwould not\b/gi, "wouldn't"], [/\bshould not\b/gi, "shouldn't"],
  [/\bcould not\b/gi, "couldn't"], [/\bhave not\b/gi, "haven't"], [/\bhas not\b/gi, "hasn't"],
  [/\bhad not\b/gi, "hadn't"], [/\bshe is\b/gi, "she's"], [/\bhe is\b/gi, "he's"], [/\bthey are\b/gi, "they're"]
];

// ---- Text helpers ----------------------------------------------------------

// The banner every project file opens with. It is bookkeeping, not prose, and
// counting it produced nonsense: the title block was reported as a staccato
// one-line paragraph, and its lines were audited for voice.
//
//   ═════════════════════════
//   THE LONG ROT
//
//   Chapter 01 - The Bounty
//   Version 2.1
//   ═════════════════════════
export function stripFileHeader(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const isRule = (line: string) => /^[═=—–_-]{8,}\s*$/.test(line.trim());
  const first = lines.findIndex(isRule);
  if (first !== -1) {
    const second = lines.findIndex((line, index) => index > first && isRule(line));
    // Only a genuine header: a rule, a short title block, and a closing rule.
    if (second !== -1 && second - first <= 8) return lines.slice(second + 1).join("\n");
  }
  // No banner. Drop a bare "Version 1.2" line if the file opens with one.
  const start = lines.findIndex((line) => line.trim() && !/^(version\s+[\d.]+|chapter\s+\d+.*)$/i.test(line.trim()));
  return start > 0 ? lines.slice(start).join("\n") : lines.join("\n");
}

// Manuscripts arrive in three shapes, and guessing wrong changes every count
// that follows:
//   · hard-wrapped  — one paragraph spans several short lines, blank line between
//   · one line each — a whole paragraph per line, blank line between
//   · one line each — a whole paragraph per line, NO blank line between
// Splitting only on blank lines read the third kind as a handful of enormous
// paragraphs: a 253-paragraph chapter came back as 13.
export function splitParagraphs(text: string, stripHeader = true): string[] {
  const body = stripHeader ? stripFileHeader(text) : text;
  const tidy = (value: string) => value.replace(/\s+/g, " ").trim();
  const blocks = body.split(/\r?\n\s*\r?\n+/).map((block) => block.replace(/\r\n/g, "\n")).filter((block) => block.trim());
  const paragraphs: string[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter((line) => line.trim());
    // Hard-wrapped lines are short by definition — they were broken to fit a
    // margin. Long ones are whole paragraphs that happen to sit together.
    const longest = Math.max(...lines.map((line) => line.trim().length));
    if (lines.length > 1 && longest > 160) paragraphs.push(...lines.map(tidy));
    else paragraphs.push(tidy(block));
  }
  return paragraphs.filter(Boolean);
}

export function splitSentences(text: string): string[] {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return [];
  if (typeof Intl.Segmenter === "function") {
    const seg = new Intl.Segmenter("en", { granularity: "sentence" });
    return Array.from(seg.segment(flat), (s) => s.segment.trim()).filter(Boolean);
  }
  return flat.match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [flat];
}

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z][a-z'-]*/g) ?? [];
}

function trim(text: string, max = 90): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max) + "…" : clean;
}

function stdDev(nums: number[]): number {
  if (nums.length < 2) return 0;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  return Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length);
}

function countMatches(text: string, needle: string): number {
  const pattern = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
  return (text.match(pattern) ?? []).length;
}

// ---- The audit -------------------------------------------------------------

export function auditProse(text: string): AuditReport {
  const findings: Finding[] = [];
  // Every count below is a rate against the word total, so the header has to
  // go once, here — leaving it in inflates the word count and quietly softens
  // every per-thousand figure in the report.
  const body = stripFileHeader(text);
  const paragraphs = splitParagraphs(body, false);
  const sentences = splitSentences(body);
  const allWords = words(body);
  const wordCount = allWords.length || 1;
  const per1000 = (n: number) => (n / wordCount) * 1000;

  const add = (n: number, severity: Finding["severity"], detail: string, excerpt: string) => {
    const t = tell(n);
    findings.push({ tell: n, category: t.category, title: t.title, severity, detail, excerpt, fix: t.fix });
  };

  // Tell 1 — em-dash overuse
  const emDashes = (body.match(/—|--|–/g) ?? []).length;
  const emPer1000 = per1000(emDashes);
  if (emPer1000 > 6) {
    add(1, emPer1000 > 12 ? "high" : "medium", `${emDashes} em-dashes — about ${emPer1000.toFixed(1)} per 1,000 words (a human runs one or two a page).`, "");
  }

  // Tell 2 — staccato one-line paragraphs
  const shortParas = paragraphs.filter((p) => splitSentences(p).length <= 1 && words(p).length <= 12);
  if (paragraphs.length >= 6 && shortParas.length / paragraphs.length > 0.28) {
    add(2, "medium", `${shortParas.length} of ${paragraphs.length} paragraphs are single short lines used as drumbeats.`, trim(shortParas[0] ?? ""));
  }

  // Tell 3 — formulaic sentence structure (low burstiness)
  const lengths = sentences.map((s) => words(s).length).filter((n) => n > 0);
  const variety = stdDev(lengths);
  const avgLen = lengths.reduce((a, b) => a + b, 0) / (lengths.length || 1);
  if (lengths.length >= 8 && variety < 4.2) {
    add(3, variety < 3 ? "high" : "medium", `Sentence lengths barely vary (average ${avgLen.toFixed(0)} words, spread ${variety.toFixed(1)}). Human rhythm rises and breaks.`, "");
  }

  // Tell 5 — missing contractions
  let missing = 0; let firstMissing = "";
  for (const [pattern, suggestion] of CONTRACTIONS) {
    const hits = body.match(pattern);
    if (hits) { missing += hits.length; if (!firstMissing) firstMissing = `"${hits[0]}" → "${suggestion}"`; }
  }
  // Density, not a flat count: three in a short passage matters, five across a
  // long chapter does not.
  if (missing >= 3 && per1000(missing) > 4) {
    add(5, "low", `${missing} phrases that a person would contract, e.g. ${firstMissing}.`, "");
  }

  // Tell 6 — passive voice
  const passive = body.match(/\b(was|were|is|are|been|being|be)\s+(\w+ed|\w+en|born|done|made|known|held|kept|told|built|found|given|taken|shown)\b/gi) ?? [];
  if (per1000(passive.length) > 12) add(6, "medium", `${passive.length} likely passive constructions. Prefer somebody doing something.`, trim(passive[0] ?? ""));

  // Tell 7 — repetitive sentence openings
  const openers = new Map<string, number>();
  for (const s of sentences) {
    const first = words(s)[0];
    if (first && !["the", "a", "an", "and", "but", "he", "she", "it", "they"].includes(first)) {
      openers.set(first, (openers.get(first) ?? 0) + 1);
    }
  }
  const worstOpener = [...openers.entries()].sort((a, b) => b[1] - a[1])[0];
  if (worstOpener && worstOpener[1] >= 4) add(7, "medium", `${worstOpener[1]} sentences open with "${worstOpener[0]}". Vary the way in.`, "");

  // Tell 8/9/10/11/15 — word and phrase lists
  const scanList = (n: number, list: string[], severity: Finding["severity"], label: string) => {
    const hits: string[] = [];
    for (const term of list) {
      const c = countMatches(body, term);
      if (c > 0) hits.push(`${term}${c > 1 ? ` (×${c})` : ""}`);
    }
    if (hits.length) add(n, severity, `${label}: ${hits.slice(0, 8).join(", ")}${hits.length > 8 ? "…" : ""}.`, "");
  };
  scanList(8, AI_WORDS, "high", "Machine-favorite words");
  scanList(9, TRANSITIONS, "medium", "Scaffold transitions");
  scanList(10, JARGON, "high", "Business jargon");
  scanList(11, INFLATED, "high", "Inflated-significance phrasing");
  scanList(15, HEDGES, "low", "Hedging words");

  // Tell 12 — repeated striking words (rare word used repeatedly)
  const common = new Set(["about", "after", "again", "their", "there", "would", "could", "which", "where", "these", "those", "through", "before", "against", "toward", "around", "under", "while", "still", "every", "other", "never", "first"]);
  const freq = new Map<string, number>();
  for (const w of allWords) if (w.length >= 7 && !common.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1);
  const overused = [...freq.entries()].filter(([, c]) => c >= 4).sort((a, b) => b[1] - a[1]).slice(0, 4);
  if (overused.length) add(12, "low", `Striking words repeated: ${overused.map(([w, c]) => `${w} (×${c})`).join(", ")}. Use once, then retire.`, "");

  // Tell 13 — triplet framing (three consecutive very short sentences)
  for (let i = 0; i + 2 < sentences.length; i += 1) {
    const three = [sentences[i], sentences[i + 1], sentences[i + 2]];
    if (three.every((s) => { const w = words(s).length; return w >= 1 && w <= 3; })) {
      add(13, "medium", "Three clipped sentences in a row read as a manufactured drumbeat.", trim(three.join(" ")));
      break;
    }
  }
  // Also "X, Y, and Z" adjective triplets, flagged only if several appear
  const adjTriplets = body.match(/\b(\w+ly|\w+ed|\w+ing|\w+)\s*,\s*(\w+)\s*,\s+and\s+(\w+)/gi) ?? [];
  if (adjTriplets.length >= 3) add(13, "low", `${adjTriplets.length} three-part "X, Y, and Z" groupings. Break some into twos or fours.`, trim(adjTriplets[0] ?? ""));

  // Tell 29 — personified inanimate callbacks ("a pan that still remembered")
  const personified = body.match(/\b(that|which|who)\s+(still\s+)?(remembered|knew|waited|watched|listened|understood|wanted)\b/gi) ?? [];
  if (personified.length) add(29, "low", `Objects handed human memory or intent (${personified.length}). Let characters carry the meaning instead.`, trim(personified[0] ?? ""));

  // Tell 37 — uniform paragraph lengths
  const paraLengths = paragraphs.map((p) => words(p).length);
  if (paragraphs.length >= 6 && stdDev(paraLengths) < 12 && (paraLengths.reduce((a, b) => a + b, 0) / paragraphs.length) > 25) {
    add(37, "low", "Paragraphs are all about the same size. Vary block length the way breath varies.", "");
  }

  const stats: AuditStats = {
    words: wordCount,
    sentences: sentences.length,
    paragraphs: paragraphs.length,
    avgSentenceWords: Math.round(avgLen),
    sentenceVariety: Math.round(variety * 10) / 10,
    emDashesPer1000: Math.round(emPer1000 * 10) / 10,
    singleLineParagraphs: shortParas.length
  };

  // Score: weight the hits, normalize a little to length, keep it honest.
  const weight = findings.reduce((sum, f) => sum + (f.severity === "high" ? 3 : f.severity === "medium" ? 2 : 1), 0);
  const score = Math.max(0, Math.min(100, Math.round(100 - weight * 6)));
  const verdict = score >= 85 ? "Reads Human — Only Light Tells" :
    score >= 65 ? "Mostly Human — A Few Tells To Clear" :
    score >= 40 ? "Several Machine Tells — Worth A Humanizing Pass" :
    "Strong Machine Fingerprint — Run The Full Ok Go Rewrite";

  return { stats, findings: findings.sort((a, b) => rank(b.severity) - rank(a.severity)), score, verdict, checklist: TELLS.filter((t) => !t.auto) };
}

function rank(s: Finding["severity"]): number {
  return s === "high" ? 3 : s === "medium" ? 2 : 1;
}

// ---- Who may use it --------------------------------------------------------
// The Human Maker is the author's tool: owner-only by default. The door is
// built but closed — the owner opens it for particular people by name, not for
// a whole rank at once. Trusting one editor is not the same as trusting every
// editor there will ever be.

const SHARE_KEY = "mcg-human-maker-editors";

// Older builds stored a single "true" here, meaning every editor. That is
// still honoured on read so nobody loses access on upgrade, and the Settings
// screen turns it into real names the first time it is saved.
export const LEGACY_EVERYONE = "true";

export function humanMakerNames(): string[] {
  try {
    const raw = localStorage.getItem(SHARE_KEY);
    if (!raw || raw === "false") return [];
    if (raw === LEGACY_EVERYONE) return [LEGACY_EVERYONE];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === "string" && Boolean(n.trim())) : [];
  } catch {
    return [];
  }
}

export function setHumanMakerNames(names: string[]): void {
  try {
    const clean = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
    localStorage.setItem(SHARE_KEY, JSON.stringify(clean));
  } catch { /* ignore */ }
}

// Pure: may this person open the Human Maker? The owner always can — the
// question only ever arises for everybody else.
export function humanMakerAllows(names: string[], person: string): boolean {
  if (names.includes(LEGACY_EVERYONE)) return true;
  const wanted = person.trim().toLowerCase();
  return Boolean(wanted) && names.some((n) => n.trim().toLowerCase() === wanted);
}

// True while the old all-editors setting is still in force, so the Settings
// screen can say so plainly instead of showing an empty list.
export const humanMakerSharedWithEveryEditor = (): boolean => humanMakerNames().includes(LEGACY_EVERYONE);

// A prompt-ready block the author can hand to the AI for the rewrite pass.
export function auditForAI(report: AuditReport, chapterName: string): string {
  const lines = report.findings.map((f) => `- Tell ${f.tell} (${f.title}): ${f.detail}${f.excerpt ? ` [${f.excerpt}]` : ""} — Fix: ${f.fix}`);
  return [
    `Humanizing pass for "${chapterName}", under the Jesmyn Ward directive and the Human Maker filter.`,
    `Audit score ${report.score}/100 — ${report.verdict}.`,
    ``,
    `Machine tells the detector found (clear these while preserving story, canon, locked lines, and the Ward voice):`,
    ...lines,
    ``,
    `Also read for the human-judgment tells the detector cannot see: ${report.checklist.map((t) => t.n).join(", ")}.`,
    `Do not touch Master Bible canon, locked lines, chapter events, or the reveal schedule.`
  ].join("\n");
}
