import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface NativeSpeechEvent {
  text: string;
  isFinal: boolean;
}

export function listenForNativeSpeech(handler: (event: NativeSpeechEvent) => void): Promise<UnlistenFn> {
  return listen<NativeSpeechEvent>("native-speech", (event) => handler(event.payload));
}

export function startNativeDictation(): Promise<void> {
  return invoke("start_native_dictation");
}

export function stopNativeDictation(): Promise<void> {
  return invoke("stop_native_dictation");
}
