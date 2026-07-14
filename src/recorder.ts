export interface RecordingResult {
  audio: Blob;
  mimeType: string;
  transcription: string;
}

type SpeechRecognitionEventLike = Event & {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
};

type SpeechRecognitionLike = EventTarget & {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export class CommentRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private recognition: SpeechRecognitionLike | null = null;
  private transcriptParts: string[] = [];
  private latestTranscript = "";
  private resolveStop: ((result: RecordingResult) => void) | null = null;
  private audioContext: AudioContext | null = null;
  private activityTimer: number | null = null;

  async start(onSpeechActivity: () => void, onTranscript: (text: string) => void): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const preferred = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
    this.mediaRecorder = new MediaRecorder(this.stream, preferred ? { mimeType: preferred } : undefined);
    this.chunks = [];
    this.transcriptParts = [];
    this.latestTranscript = "";
    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size) this.chunks.push(event.data);
    };
    this.mediaRecorder.start(1000);
    this.startActivityDetection(onSpeechActivity);
    this.startSpeechRecognition(onSpeechActivity, onTranscript);
  }

  stop(): Promise<RecordingResult> {
    if (!this.mediaRecorder || this.mediaRecorder.state === "inactive") {
      return Promise.resolve({ audio: new Blob(), mimeType: "", transcription: this.latestTranscript.trim() });
    }
    return new Promise((resolve) => {
      const mediaRecorder = this.mediaRecorder!;
      this.resolveStop = resolve;
      mediaRecorder.onstop = () => {
        const mimeType = mediaRecorder.mimeType || this.chunks[0]?.type || "audio/webm";
        const audio = new Blob(this.chunks, { type: mimeType });
        this.cleanup();
        this.resolveStop?.({ audio, mimeType, transcription: this.latestTranscript.trim() });
        this.resolveStop = null;
      };
      this.recognition?.stop();
      mediaRecorder.stop();
    });
  }

  cancel(): void {
    if (this.mediaRecorder?.state !== "inactive") this.mediaRecorder?.stop();
    this.recognition?.abort();
    this.cleanup();
  }

  private startSpeechRecognition(onSpeechActivity: () => void, onTranscript: (text: string) => void) {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result[0]?.transcript?.trim() || "";
        if (text) onSpeechActivity();
        if (result.isFinal && text) this.transcriptParts.push(text);
        else interim += `${text} `;
      }
      this.latestTranscript = `${this.transcriptParts.join(" ")} ${interim}`.trim();
      onTranscript(this.latestTranscript);
    };
    this.recognition = recognition;
    recognition.start();
  }

  private startActivityDetection(onSpeechActivity: () => void) {
    if (!this.stream) return;
    this.audioContext = new AudioContext();
    const source = this.audioContext.createMediaStreamSource(this.stream);
    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    this.activityTimer = window.setInterval(() => {
      analyser.getByteTimeDomainData(samples);
      let energy = 0;
      for (const sample of samples) {
        const centered = (sample - 128) / 128;
        energy += centered * centered;
      }
      const rms = Math.sqrt(energy / samples.length);
      if (rms > 0.025) onSpeechActivity();
    }, 150);
  }

  private cleanup() {
    if (this.activityTimer !== null) window.clearInterval(this.activityTimer);
    this.activityTimer = null;
    void this.audioContext?.close();
    this.audioContext = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.mediaRecorder = null;
    this.recognition = null;
  }
}
