export class BrowserSpeechPlayer {
  private utterance: SpeechSynthesisUtterance | null = null;

  speak(text: string, rate: number, onEnd: () => void, onError: () => void): void {
    this.stop();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = rate;
    utterance.onend = onEnd;
    utterance.onerror = onError;
    this.utterance = utterance;
    window.speechSynthesis.speak(utterance);
  }

  pause(): void {
    window.speechSynthesis.pause();
  }

  resume(): void {
    window.speechSynthesis.resume();
  }

  stop(): void {
    window.speechSynthesis.cancel();
    this.utterance = null;
  }

  get paused(): boolean {
    return window.speechSynthesis.paused;
  }
}
