export type ConversationTargetChoice = "auto" | "claude" | "codex";

export interface VoiceSettings {
  silenceSeconds: number;
  addSeconds: number;
  speechRate: number;
  readRepliesAutomatically: boolean;
  listenAfterReading: boolean;
  skipContentBoxes: boolean;
  target: ConversationTargetChoice;
}

export const defaultVoiceSettings: VoiceSettings = {
  silenceSeconds: 2,
  addSeconds: 5,
  speechRate: 1,
  readRepliesAutomatically: true,
  listenAfterReading: true,
  skipContentBoxes: true,
  target: "auto"
};

function key(profile: string): string {
  return `maggotclaw-voice-settings:${profile || "local"}`;
}

export function loadVoiceSettings(profile: string): VoiceSettings {
  try {
    return { ...defaultVoiceSettings, ...JSON.parse(localStorage.getItem(key(profile)) || "{}") };
  } catch {
    return defaultVoiceSettings;
  }
}

export function saveVoiceSettings(profile: string, settings: VoiceSettings): void {
  localStorage.setItem(key(profile), JSON.stringify(settings));
}

