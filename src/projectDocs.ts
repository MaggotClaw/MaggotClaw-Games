// Shared, pure project-document model. Kept free of React and Tauri so the
// quick-open resolver and its tests can use it without pulling in the UI.

export interface ProjectDocument {
  dropboxPath: string;
  localRelativePath: string;
  revisionId: string | null;
  byteCount: number;
  status: string;
}

export interface ParsedDoc {
  doc: ProjectDocument;
  fileName: string;
  folder: string;
  chapter: number | null;
  typeCode: "B" | "D" | "P" | "R" | "codex" | "master" | "other";
  typeLabel: string;
  title: string;
  version: string | null;
  draftPart: number | null;
}

// Turn a filename into structured metadata using the project's naming standards.
export function parseDoc(doc: ProjectDocument): ParsedDoc {
  const parts = doc.localRelativePath.split(/[\\/]/);
  const fileName = parts[parts.length - 1];
  const folder = parts.length > 1 ? parts[0] : "Main folder";
  const versionMatch = fileName.match(/v(\d+(?:\.\d+)*)\.(?:txt|docx|pdf)$/i);
  const version = versionMatch ? versionMatch[1] : null;

  // Two naming conventions live here at once, and both must parse.
  //
  // The older one repeated the chapter number in words — "C01-A Chapter 01
  // Blueprint" — which said the same thing twice, so the newer one drops it.
  // Development also became Chapter Draft, Draft became Draft Segment, and the
  // letters were rearranged to match the words: Blueprint moved from A to B,
  // and B — which used to mean Development — now means Blueprint.
  //
  // That last swap is why the letter cannot be trusted to say what a file is:
  // "C01-B" means Development on an old name and Blueprint on a new one. The
  // label always says plainly which it is, so the label decides and the letter
  // is only read for a draft segment's number. Old names are still parsed,
  // because one file missed in a rename must not fall out of its chapter and
  // off the shelf in silence.
  //
  // Order matters in the labels: "Chapter Draft" and "Draft Segment" both
  // contain "Draft", so the longer names have to be tried first.
  const chap = fileName.match(
    /^C(\d+)-(A|B|D|R|P\d+)\s+(?:Chapter\s+\d+\s+)?(Blueprint|Development|Chapter Draft|Draft Segment|Reader Copy|Draft)(?:\s*-\s*(.+?))?\s*v[\d.]+\.(?:txt|docx|pdf)$/i
  );
  if (chap) {
    const letter = chap[2].toUpperCase();
    const label = chap[3].toLowerCase();
    const typeCode: ParsedDoc["typeCode"] =
      label === "blueprint" ? "B"
      : label === "reader copy" ? "R"
      : label === "development" || label === "chapter draft" ? "D"
      : "P";
    const draftPart = typeCode === "P" && letter.startsWith("P") ? parseInt(letter.slice(1), 10) : null;
    const chapterNum = parseInt(chap[1], 10);
    return {
      doc, fileName, folder, chapter: chapterNum, typeCode,
      typeLabel: chap[3], title: chap[4] ? chap[4].trim() : `Chapter ${chapterNum}`,
      version, draftPart
    };
  }

  if (/^0*0\s+Master Codex/i.test(fileName)) {
    return { doc, fileName, folder, chapter: null, typeCode: "master", typeLabel: "Master Codex", title: "Master Codex", version, draftPart: null };
  }

  const codex = fileName.match(/^(\d+)\s+Codex,\s*(.+?)\s*v[\d.]+\.(?:txt|docx)$/i);
  if (codex) {
    return { doc, fileName, folder, chapter: null, typeCode: "codex", typeLabel: "Codex", title: codex[2].trim(), version, draftPart: null };
  }

  const title = fileName.replace(/\.(txt|docx)$/i, "").replace(/\s*v[\d.]+$/i, "").replace(/^\(|\)$/g, "").trim();
  return { doc, fileName, folder, chapter: null, typeCode: "other", typeLabel: "Other", title, version, draftPart: null };
}

// Compare two "1.31" style version strings. Returns >0 when a is newer.
export function compareVersions(a: string | null, b: string | null): number {
  const pa = (a ?? "0").split(".").map((n) => Number(n) || 0);
  const pb = (b ?? "0").split(".").map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}
