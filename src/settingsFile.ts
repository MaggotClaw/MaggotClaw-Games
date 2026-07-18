// Carrying your settings between installs.
//
// Everything the app remembers lives in this computer's browser storage, which
// Windows ties to the app's identity. Change that identity — or move to a new
// computer — and the settings are still on disk but out of reach. Export writes
// them to one file; Import reads it back.
//
// Secrets travel in this file (the Discord bot key, and the project file keys
// if they are set), so it is treated as private: kept in Documents, never sent
// anywhere, and the app says so plainly before writing it.

export const SETTINGS_FILE_NAME = "MaggotClaw Games Settings Backup.json";

// Every key worth carrying. Anything not listed — logs, caches, counters —
// is deliberately left behind.
const EXACT_KEYS = [
  "long-rot-reader-name",
  "long-rot-connection",
  "mcg-discord-bot-token",
  "mcg-discord-webhook",
  "mcg-discord-requests-channel",
  "mcg-discord-relay-channel",
  "mcg-dropbox-creds",
  "mcg-reader-catalog-url",
  "mcg-unlocked-chapters",
  "mcg-scheduled-releases",
  "mcg-file-access",
  "mcg-pronunciations",
  "mcg-chapter-questions",
  "mcg-people",
  "mcg-contacts",
  "mcg-projects",
  "mcg-active-project",
  "mcg-human-maker-editors",
  "mcg-claude-access",
  "mcg-share-diagnostics"
];

// Keys that carry a profile name on the end, e.g. "mcg-nickname:MaggotClaw".
const PREFIXES = [
  "mcg-profile-role:",
  "mcg-profile-pin:",
  "mcg-nickname:",
  "mcg-discord-name:",
  "mcg-reader-profile:",
  "maggotclaw-voice-settings:",
  "mcg-listening:"
];

export type SettingsBundle = Record<string, string>;

export function collectSettings(): SettingsBundle {
  const bundle: SettingsBundle = {};
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      const wanted = EXACT_KEYS.includes(key) || PREFIXES.some((prefix) => key.startsWith(prefix));
      if (!wanted) continue;
      const value = localStorage.getItem(key);
      if (value !== null) bundle[key] = value;
    }
  } catch { /* ignore */ }
  return bundle;
}

// Pure: fold a bundle back in. Returns how many settings were restored.
// Anything unrecognised is ignored rather than trusted.
export function applySettings(bundle: unknown): number {
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) return 0;
  let restored = 0;
  for (const [key, value] of Object.entries(bundle as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    const wanted = EXACT_KEYS.includes(key) || PREFIXES.some((prefix) => key.startsWith(prefix));
    if (!wanted) continue;
    try { localStorage.setItem(key, value); restored += 1; } catch { /* ignore */ }
  }
  return restored;
}

export function describeBundle(bundle: SettingsBundle): string {
  const has = (key: string) => Object.keys(bundle).some((k) => k === key || k.startsWith(key));
  const parts: string[] = [];
  if (has("long-rot-reader-name")) parts.push("your name");
  if (has("mcg-profile-role:")) parts.push("your role");
  if (has("mcg-discord-bot-token")) parts.push("the Discord key");
  if (has("mcg-dropbox-creds")) parts.push("the project file keys");
  if (has("mcg-people")) parts.push("your people");
  if (has("mcg-pronunciations")) parts.push("narrator pronunciations");
  if (has("mcg-unlocked-chapters")) parts.push("released chapters");
  return parts.length ? parts.join(", ") : "nothing recognisable";
}
