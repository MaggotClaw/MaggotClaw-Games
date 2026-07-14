export function responseParagraphs(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

export interface ResponsePlaybackSegment {
  kind: "text" | "skipped";
  spokenText: string;
  hiddenText?: string;
}

export function responsePlaybackSegments(text: string, skipContentBoxes = true): ResponsePlaybackSegment[] {
  if (!skipContentBoxes) return responseParagraphs(text).map((spokenText) => ({ kind: "text", spokenText }));
  const segments: ResponsePlaybackSegment[] = [];
  const fence = /```[^\n]*\n([\s\S]*?)```/g;
  let cursor = 0;
  for (const match of text.matchAll(fence)) {
    const index = match.index ?? 0;
    responseParagraphs(text.slice(cursor, index)).forEach((spokenText) => segments.push({ kind: "text", spokenText }));
    segments.push({ kind: "skipped", spokenText: "Content box skipped.", hiddenText: match[1].trim() });
    cursor = index + match[0].length;
  }
  responseParagraphs(text.slice(cursor)).forEach((spokenText) => segments.push({ kind: "text", spokenText }));
  return segments;
}
