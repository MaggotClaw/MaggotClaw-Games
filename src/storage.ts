import { openDB, type DBSchema } from "idb";
import type { DocumentRecord, ReaderComment, ReadingPosition } from "./types";

interface ReaderDb extends DBSchema {
  documents: { key: string; value: DocumentRecord };
  positions: { key: string; value: ReadingPosition };
  comments: { key: string; value: ReaderComment; indexes: { "by-status": string } };
}

const database = openDB<ReaderDb>("the-long-rot-reader", 2, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) {
      db.createObjectStore("documents", { keyPath: "id" });
      db.createObjectStore("positions", { keyPath: "id" });
    }
    if (oldVersion < 2) {
      const comments = db.createObjectStore("comments", { keyPath: "id" });
      comments.createIndex("by-status", "status");
    }
  }
});

export async function saveDocument(document: DocumentRecord): Promise<void> {
  await (await database).put("documents", document);
}

export async function savePosition(position: ReadingPosition): Promise<void> {
  await (await database).put("positions", position);
}

export async function loadPosition(userId: string, documentId: string): Promise<ReadingPosition | undefined> {
  return (await database).get("positions", `${userId}:${documentId}`);
}

export async function loadDocument(documentId: string): Promise<DocumentRecord | undefined> {
  return (await database).get("documents", documentId);
}

export async function saveComment(comment: ReaderComment): Promise<void> {
  await (await database).put("comments", comment);
}

export async function loadComment(commentId: string): Promise<ReaderComment | undefined> {
  return (await database).get("comments", commentId);
}

export async function loadRecoverableComments(): Promise<ReaderComment[]> {
  const db = await database;
  const comments = await db.getAll("comments");
  return comments
    .filter((comment) => ["recording", "recorded", "confirming"].includes(comment.status))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function loadSavedComments(): Promise<ReaderComment[]> {
  return (await database).getAllFromIndex("comments", "by-status", "saved");
}
