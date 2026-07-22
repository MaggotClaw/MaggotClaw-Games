// Finding the sentence being read on a page-exact chapter.
//
// Narrated mode knows the sentence as plain text, pulled out of the Word file.
// The page it is drawn on is a PDF, and a PDF has no sentences — only runs of
// text with positions, broken wherever the typesetter felt like breaking them.
// A line ends mid-clause, a dash is its own run, and nothing carries a space at
// the end of a line. So the two have to be matched by their words.
//
// The rule throughout: a wrong highlight is worse than none. Every failure
// here returns nothing and the page is shown clean.

export interface PageTextItem {
  str: string;
}

export interface PageTextBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

// Word writes curly quotes, en and em dashes, and non-breaking spaces; the
// same passage extracted two different ways can differ in exactly these and
// nothing else. Every mapping is one character to one character on purpose —
// it keeps the normalised text the same length as what it came from, so each
// character can still be traced back to the run it belongs to.
const SAME_LENGTH_SWAPS: Record<string, string> = {
  "‘": "'", "’": "'", "‚": "'", "‛": "'",
  "“": '"', "”": '"', "„": '"', "‟": '"',
  "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "―": "-",
  " ": " ", " ": " ", " ": " ", "​": " "
};

function swap(character: string): string {
  return SAME_LENGTH_SWAPS[character] ?? character.toLowerCase();
}

/**
 * The plain form both sides are compared in: one kind of quote, one kind of
 * dash, no capitals — and no spaces at all.
 *
 * Dropping every space rather than tidying it is what makes this work on real
 * prose. A PDF breaks text into runs wherever it likes: a line ends with no
 * trailing space, so "a living thing," and "thick and breathing" arrive
 * joined; and an em dash is usually a run of its own, so "his eyes—deep-set"
 * arrives with gaps around the dash that the manuscript never had. Put spaces
 * back and the first case matches while the second breaks; take them all out
 * and both match, because spacing was never the thing being compared.
 */
export function normalizeForMatch(text: string): string {
  let out = "";
  for (const character of text) {
    if (/\s/.test(character)) continue;
    out += swap(character);
  }
  return out;
}

/** The page's text in that same plain form, with every character remembering
 *  which run it came from. */
export function indexPage(items: PageTextItem[]): { text: string; owner: number[] } {
  let text = "";
  const owner: number[] = [];
  items.forEach((item, index) => {
    for (const character of item.str ?? "") {
      if (/\s/.test(character)) continue;
      text += swap(character);
      owner.push(index);
    }
  });
  return { text, owner };
}

/**
 * Which runs on this page carry the sentence. Empty when the sentence is not
 * on this page, or is split across a page break, or is too short to identify
 * safely.
 */
export function locateSentence(items: PageTextItem[], sentence: string): number[] {
  const needle = normalizeForMatch(sentence);
  // Very short fragments ("Yes.", "He ran.") appear all over a chapter and
  // would light up the wrong line as often as the right one. Counted without
  // spaces, so this is about twelve real characters.
  if (needle.length < 12) return [];
  const { text, owner } = indexPage(items);
  const at = text.indexOf(needle);
  if (at < 0) return [];
  // A sentence appearing twice on one page cannot be told apart, so leave it.
  if (text.indexOf(needle, at + 1) >= 0) return [];
  const covered = new Set<number>();
  for (let i = at; i < at + needle.length; i += 1) {
    const item = owner[i];
    if (item !== undefined) covered.add(item);
  }
  return [...covered].sort((a, b) => a - b);
}

/**
 * One box per line rather than one per run: a sentence crossing four runs on
 * the same line should be lit as one bar, not four with seams down it.
 */
export function mergeRects(boxes: PageTextBox[], indices: number[]): PageTextBox[] {
  const chosen = indices
    .map((index) => boxes[index])
    .filter((box): box is PageTextBox => Boolean(box) && box.width > 0);
  if (!chosen.length) return [];
  const lines: PageTextBox[] = [];
  for (const box of [...chosen].sort((a, b) => a.top - b.top || a.left - b.left)) {
    const line = lines[lines.length - 1];
    // Same line if the two overlap vertically by most of their height —
    // baselines wobble slightly within a line and must not split it.
    const sameLine = line && Math.abs(box.top - line.top) < Math.max(box.height, line.height) * 0.6;
    if (sameLine) {
      const right = Math.max(line.left + line.width, box.left + box.width);
      line.left = Math.min(line.left, box.left);
      line.width = right - line.left;
      line.height = Math.max(line.height, box.height);
      line.top = Math.min(line.top, box.top);
    } else {
      lines.push({ ...box });
    }
  }
  return lines;
}
