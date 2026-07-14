import { afterEach, describe, expect, it, vi } from "vitest";
import { CommentRecorder } from "../src/recorder";

class FakeRecognition {
  static latest: FakeRecognition;
  continuous = false;
  interimResults = false;
  lang = "";
  onresult: ((event: unknown) => void) | null = null;
  constructor() { FakeRecognition.latest = this; }
  start() {}
  stop() {}
  abort() {}
  emit(text: string, isFinal = false) {
    this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal })] });
  }
}

class FakeMediaRecorder {
  static isTypeSupported() { return true; }
  state = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_stream: unknown, _options?: unknown) {}
  start() { this.state = "recording"; }
  stop() { this.state = "inactive"; this.onstop?.(); }
}

class FakeAudioContext {
  createMediaStreamSource() { return { connect() {} }; }
  createAnalyser() { return { fftSize: 0, getByteTimeDomainData(samples: Uint8Array) { samples.fill(128); } }; }
  close() { return Promise.resolve(); }
}

function installSpeechFakes() {
  const fakeWindow = {
    SpeechRecognition: FakeRecognition,
    webkitSpeechRecognition: undefined,
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
  };
  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop() {} }] })) } });
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  vi.stubGlobal("AudioContext", FakeAudioContext);
}

afterEach(() => vi.unstubAllGlobals());

describe("live voice transcription", () => {
  it("publishes interim words immediately and preserves them when sending", async () => {
    installSpeechFakes();
    const recorder = new CommentRecorder();
    const updates: string[] = [];
    await recorder.start(() => undefined, (text) => updates.push(text));

    FakeRecognition.latest.emit("these words are still interim");
    const result = await recorder.stop();

    expect(updates).toEqual(["these words are still interim"]);
    expect(result.transcription).toBe("these words are still interim");
  });

  it("combines final and current interim speech for live insertion", async () => {
    installSpeechFakes();
    const recorder = new CommentRecorder();
    const updates: string[] = [];
    await recorder.start(() => undefined, (text) => updates.push(text));

    FakeRecognition.latest.emit("first completed phrase", true);
    FakeRecognition.latest.emit("and the words I am saying now");
    const result = await recorder.stop();

    expect(updates.at(-1)).toBe("first completed phrase and the words I am saying now");
    expect(result.transcription).toBe("first completed phrase and the words I am saying now");
  });
});
