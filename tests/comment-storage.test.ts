import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { loadRecoverableComments, loadSavedComments, saveComment } from "../src/storage";
import type { ReaderComment } from "../src/types";

function comment(status: ReaderComment["status"]): ReaderComment {
  return {
    id: crypto.randomUUID(),
    userId: "reader",
    readerName: "Reader",
    documentId: "document:revision",
    filePath: "/The Long Rot/Reader Copy.txt",
    exactFilename: "Reader Copy.txt",
    contentHash: "hash",
    segmentIndex: 3,
    paragraphIndex: 1,
    sentenceIndex: 2,
    charStart: 25,
    charEnd: 42,
    anchorText: "Exact anchor sentence.",
    audio: new Blob(["recording"], { type: "audio/webm" }),
    audioMimeType: "audio/webm",
    transcriptionOriginal: "Original words.",
    transcriptionConfirmed: "Confirmed words.",
    category: "General Comment",
    status,
    silenceAllowanceSeconds: 10,
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: new Date().toISOString()
  };
}

describe("comment recovery storage", () => {
  beforeEach(async () => {
    const recoverable = await loadRecoverableComments();
    await Promise.all(recoverable.map((item) => saveComment({ ...item, status: "discarded" })));
  });

  it("preserves audio and exact text coordinates for unfinished comments", async () => {
    const draft = comment("confirming");
    await saveComment(draft);
    const recovered = (await loadRecoverableComments()).find((item) => item.id === draft.id);
    expect(recovered).toMatchObject({
      documentId: "document:revision",
      segmentIndex: 3,
      paragraphIndex: 1,
      sentenceIndex: 2,
      charStart: 25,
      charEnd: 42,
      anchorText: "Exact anchor sentence.",
      transcriptionConfirmed: "Confirmed words."
    });
    expect(recovered?.audio?.size).toBeGreaterThan(0);
  });

  it("moves confirmed comments out of recovery and into saved comments", async () => {
    const saved = comment("saved");
    await saveComment(saved);
    expect((await loadRecoverableComments()).some((item) => item.id === saved.id)).toBe(false);
    expect((await loadSavedComments()).some((item) => item.id === saved.id)).toBe(true);
  });
});
