export type ConversationTargetChoice = "auto" | "claude" | "codex" | "antigravity";

export interface VoiceSettings {
  silenceSeconds: number;
  addSeconds: number;
  speechRate: number;
  readRepliesAutomatically: boolean;
  listenAfterReading: boolean;
  skipContentBoxes: boolean;
  // Prepend a short story-context block (who the mentioned names are) to each
  // message the companion sends, so the AI never guesses at canon.
  includeStoryContext: boolean;
  target: ConversationTargetChoice;
}

export const defaultVoiceSettings: VoiceSettings = {
  silenceSeconds: 2,
  addSeconds: 5,
  speechRate: 1,
  readRepliesAutomatically: true,
  listenAfterReading: true,
  skipContentBoxes: true,
  includeStoryContext: false,
  target: "antigravity"
};

function key(profile: string): string {
  return `maggotclaw-voice-settings:${profile || "local"}`;
}

export function loadVoiceSettings(profile: string): VoiceSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(key(profile)) || "{}");
    if (raw.target === "current") raw.target = "antigravity";
    return { ...defaultVoiceSettings, ...raw };
  } catch {
    return defaultVoiceSettings;
  }
}

export function saveVoiceSettings(profile: string, settings: VoiceSettings): void {
  localStorage.setItem(key(profile), JSON.stringify(settings));
}

