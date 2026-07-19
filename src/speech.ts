import { chosenVoice } from "./voices";
import { invoke } from "@tauri-apps/api/core";
import { pronounce } from "./pronunciation";

// Piper is the normal voice inside the installed Windows app. Browser speech
// remains a fallback so reading still works if a local voice resource is lost.
export class BrowserSpeechPlayer {
  private audio: HTMLAudioElement | null = null;
  private audioUrl = "";
  private keepAlive = 0;
  private watchdog = 0;
  private generation = 0;
  // Pause pressed while the next sentence was still being synthesized: honour
  // it when the audio arrives instead of playing over the user's pause.
  private pauseRequested = false;

  speak(rawText: string, rate: number, onEnd: () => void, onError: () => void): void {
    this.stop();
    this.pauseRequested = false;
    // Invented names are respelled for the voice only; the page keeps the
    // author's spelling.
    const text = pronounce(rawText);
    const generation = this.generation;

    if (!("__TAURI_INTERNALS__" in window)) {
      this.speakWithWindows(text, rate, generation, onEnd, onError);
      return;
    }

    void invoke<ArrayBuffer>("synthesize_piper_speech", { text, rate, voice: chosenVoice() })
      .then((bytes) => {
        if (generation !== this.generation) return;
        const audioUrl = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
        const audio = new Audio(audioUrl);
        this.audio = audio;
        this.audioUrl = audioUrl;
        if (this.pauseRequested) return;
        audio.onended = () => {
          if (generation !== this.generation) return;
          this.releaseAudio();
          onEnd();
        };
        audio.onerror = () => {
          if (generation !== this.generation) return;
          this.releaseAudio();
          this.speakWithWindows(text, rate, generation, onEnd, onError);
        };
        void audio.play().catch(() => {
          if (generation !== this.generation) return;
          this.releaseAudio();
          this.speakWithWindows(text, rate, generation, onEnd, onError);
        });
      })
      .catch(() => {
        if (generation !== this.generation) return;
        this.speakWithWindows(text, rate, generation, onEnd, onError);
      });
  }

  private speakWithWindows(text: string, rate: number, generation: number, onEnd: () => void, onError: () => void): void {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = rate;
    let finished = false;
    let started = false;
    const finish = (handler: () => void) => {
      if (finished || generation !== this.generation) return;
      finished = true;
      this.clearTimers();
      handler();
    };
    utterance.onstart = () => { started = true; };
    utterance.onend = () => finish(onEnd);
    utterance.onerror = () => finish(onError);
    window.speechSynthesis.speak(utterance);

    this.keepAlive = window.setInterval(() => {
      if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }
    }, 9000);
    this.watchdog = window.setInterval(() => {
      if (started && !window.speechSynthesis.speaking && !window.speechSynthesis.pending) finish(onEnd);
    }, 400);
  }

  private releaseAudio(): void {
    if (this.audio) {
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.pause();
      this.audio = null;
    }
    if (this.audioUrl) {
      URL.revokeObjectURL(this.audioUrl);
      this.audioUrl = "";
    }
  }

  private clearTimers(): void {
    if (this.keepAlive) { window.clearInterval(this.keepAlive); this.keepAlive = 0; }
    if (this.watchdog) { window.clearInterval(this.watchdog); this.watchdog = 0; }
  }

  pause(): void {
    this.pauseRequested = true;
    if (this.audio) this.audio.pause();
    else window.speechSynthesis.pause();
  }

  resume(): void {
    this.pauseRequested = false;
    if (this.audio) void this.audio.play();
    else window.speechSynthesis.resume();
  }

  stop(): void {
    this.generation += 1;
    this.pauseRequested = false;
    this.releaseAudio();
    this.clearTimers();
    window.speechSynthesis.cancel();
  }

  get paused(): boolean {
    if (this.pauseRequested) return true;
    return this.audio ? this.audio.paused && this.audio.currentTime > 0 && !this.audio.ended : window.speechSynthesis.paused;
  }
}
