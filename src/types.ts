export interface ReaderCopy {
  name: string;
  path: string;
  type: "file";
}

export interface Segment {
  id: string;
  paragraphIndex: number;
  sentenceIndex: number;
  charStart: number;
  charEnd: number;
  text: string;
}

export interface DocumentRecord {
  html?: string;
  id: string;
  path: string;
  name: string;
  contentHash: string;
  content: string;
  segments: Segment[];
  retrievedAt: string;
}

export interface ReadingPosition {
  id: string;
  userId: string;
  documentId: string;
  segmentIndex: number;
  updatedAt: string;
}

export interface ConnectionSettings {
  endpoint: string;
  bearerToken: string;
}

export type CommentStatus = "recording" | "recorded" | "confirming" | "saved" | "discarded";

export interface ReaderComment {
  id: string;
  userId: string;
  readerName: string;
  documentId: string;
  filePath: string;
  exactFilename: string;
  contentHash: string;
  segmentIndex: number;
  paragraphIndex: number;
  sentenceIndex: number;
  charStart: number;
  charEnd: number;
  anchorText: string;
  audio: Blob | null;
  audioMimeType: string;
  transcriptionOriginal: string;
  transcriptionConfirmed: string;
  category: string;
  status: CommentStatus;
  silenceAllowanceSeconds: number;
  createdAt: string;
  updatedAt: string;
}
