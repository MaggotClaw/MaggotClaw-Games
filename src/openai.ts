import { invoke } from "@tauri-apps/api/core";

export interface ConversationTurn {
  role: "user" | "assistant";
  text: string;
  createdAt: string;
}

function requireDesktop(): void {
  if (!("__TAURI_INTERNALS__" in window)) {
    throw new Error("Live AI conversation is available in the installed Windows application.");
  }
}

export async function hasOpenAiKey(): Promise<boolean> {
  if (!("__TAURI_INTERNALS__" in window)) return false;
  return invoke<boolean>("has_openai_api_key");
}

export async function saveOpenAiKey(apiKey: string): Promise<void> {
  requireDesktop();
  await invoke("save_openai_api_key", { apiKey });
}

export async function transcribeAudio(audio: Blob): Promise<string> {
  requireDesktop();
  const bytes = Array.from(new Uint8Array(await audio.arrayBuffer()));
  return invoke<string>("openai_transcribe", { audio: bytes, mimeType: audio.type || "audio/webm" });
}

export async function requestAnswer(input: string, conversation: ConversationTurn[]): Promise<string> {
  requireDesktop();
  return invoke<string>("openai_respond", { input, conversation });
}

export async function speakAnswer(text: string): Promise<HTMLAudioElement> {
  requireDesktop();
  const bytes = await invoke<number[]>("openai_speech", { text });
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "audio/mpeg" }));
  const audio = new Audio(url);
  audio.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
  await audio.play();
  return audio;
}
