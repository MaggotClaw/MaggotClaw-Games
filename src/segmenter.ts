import type { Segment } from "./types";

const sentenceSegmenter = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter("en", { granularity: "sentence" })
  : null;

export function segmentDocument(content: string): Segment[] {
  const segments: Segment[] = [];
  const paragraphs = content.split(/\r?\n(?:\s*\r?\n)*/);
  let searchFrom = 0;

  paragraphs.forEach((paragraph, paragraphIndex) => {
    const trimmed = paragraph.trim();
    if (!trimmed) return;
    const paragraphStart = content.indexOf(trimmed, searchFrom);
    searchFrom = Math.max(searchFrom, paragraphStart + trimmed.length);
    const sentences = sentenceSegmenter
      ? Array.from(sentenceSegmenter.segment(trimmed), (part) => ({
          text: part.segment.trim(),
          index: part.index + (part.segment.length - part.segment.trimStart().length)
        }))
      : fallbackSentences(trimmed);

    sentences.filter((sentence) => sentence.text).forEach((sentence, sentenceIndex) => {
      const charStart = Math.max(0, paragraphStart) + sentence.index;
      segments.push({
        id: `${paragraphIndex}:${sentenceIndex}:${charStart}`,
        paragraphIndex,
        sentenceIndex,
        charStart,
        charEnd: charStart + sentence.text.length,
        text: sentence.text
      });
    });
  });

  return segments;
}

function fallbackSentences(text: string): Array<{ text: string; index: number }> {
  const results: Array<{ text: string; index: number }> = [];
  const matcher = /[^.!?]+(?:[.!?]+[\"'”’)]*|$)/g;
  for (const match of text.matchAll(matcher)) {
    const raw = match[0];
    const leading = raw.length - raw.trimStart().length;
    results.push({ text: raw.trim(), index: (match.index ?? 0) + leading });
  }
  return results;
}

export async function contentHash(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
