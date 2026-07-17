// Discord glue: where the team server lives, each person's Discord name, and the
// webhook that carries access requests straight into the owner's channel.
//
// The webhook URL is configuration, not a secret worth guarding — anyone with
// the app can post to that one channel and nothing else. It can be baked in
// here or pasted into Settings by the owner without a rebuild.

export const DEFAULT_DISCORD_INVITE = "";
export const DEFAULT_REQUEST_WEBHOOK = "";

export function getDiscordName(profile: string): string {
  try {
    return localStorage.getItem(`mcg-discord-name:${profile}`) || "";
  } catch {
    return "";
  }
}

export function setDiscordName(profile: string, discordName: string): void {
  try {
    localStorage.setItem(`mcg-discord-name:${profile}`, discordName.trim());
  } catch { /* ignore */ }
}

export function getRequestWebhook(): string {
  try {
    return (localStorage.getItem("mcg-discord-webhook") || DEFAULT_REQUEST_WEBHOOK).trim();
  } catch {
    return DEFAULT_REQUEST_WEBHOOK;
  }
}

export function setRequestWebhook(url: string): void {
  try {
    localStorage.setItem("mcg-discord-webhook", url.trim());
  } catch { /* ignore */ }
}

export function isDiscordWebhook(url: string): boolean {
  return /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+$/.test(url.trim());
}

// Compose the message the owner sees in Discord when someone asks for access.
export function requestAnnouncement(input: {
  name: string;
  discordName: string;
  currentRole: string;
  requestedRole: string;
  reason: string;
  code: string;
}): string {
  const who = input.discordName ? `${input.name} (Discord: ${input.discordName})` : input.name;
  const why = input.reason ? `\nReason: ${input.reason}` : "";
  return `**Access request** from ${who}\n${input.currentRole} → **${input.requestedRole}**${why}\n\nPaste this code in the app's Owner Dashboard to approve:\n\`${input.code}\``;
}

// Send through the Rust side because the webview's security policy only allows
// requests to the app itself. Returns true when Discord accepted the message.
export async function sendRequestToDiscord(content: string): Promise<boolean> {
  const url = getRequestWebhook();
  if (!isDiscordWebhook(url) || !("__TAURI_INTERNALS__" in window)) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("post_discord_webhook", { url, content });
    return true;
  } catch {
    return false;
  }
}
