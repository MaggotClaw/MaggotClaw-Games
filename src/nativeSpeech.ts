import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface NativeSpeechEvent {
  text: string;
  isFinal: boolean;
}

export class NativeTranscriptAssembler {
  private finalParts: string[] = [];

  reset(): void { this.finalParts = []; }

  update(event: NativeSpeechEvent): string {
    const text = event.text.trim();
    if (event.isFinal && text) this.finalParts.push(text);
    return [...this.finalParts, ...(event.isFinal || !text ? [] : [text])].join(" ");
  }
}

export function listenForNativeSpeech(handler: (event: NativeSpeechEvent) => void): Promise<UnlistenFn> {
  return listen<NativeSpeechEvent>("native-speech", (event) => handler(event.payload));
}

export function listenForNativeSpeechNotice(handler: (message: string) => void): Promise<UnlistenFn> {
  return listen<string>("native-speech-notice", (event) => handler(event.payload));
}

export function listenForNativeSpeechError(handler: (message: string) => void): Promise<UnlistenFn> {
  return listen<string>("native-speech-error", (event) => handler(event.payload));
}

export function prepareNativeDictation(): Promise<void> {
  return invoke("prepare_native_dictation");
}

export function startNativeDictation(): Promise<void> {
  return invoke("start_native_dictation");
}

export function stopNativeDictation(): Promise<void> {
  return invoke("stop_native_dictation");
}
