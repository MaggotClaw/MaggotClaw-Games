import { describe, expect, it } from "vitest";
import { NativeTranscriptAssembler } from "../src/nativeSpeech";

describe("native Windows dictation assembly", () => {
  it("shows changing hypotheses without duplicating them", () => {
    const transcript = new NativeTranscriptAssembler();
    expect(transcript.update({ text: "voice", isFinal: false })).toBe("voice");
    expect(transcript.update({ text: "voice companion", isFinal: false })).toBe("voice companion");
  });

  it("keeps completed phrases while the next phrase is still being spoken", () => {
    const transcript = new NativeTranscriptAssembler();
    expect(transcript.update({ text: "first phrase", isFinal: true })).toBe("first phrase");
    expect(transcript.update({ text: "second phrase in progress", isFinal: false })).toBe("first phrase second phrase in progress");
    expect(transcript.update({ text: "second phrase", isFinal: true })).toBe("first phrase second phrase");
  });
});
