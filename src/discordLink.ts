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

// ---- Owner side: reading the requests channel with the bot key -------------

export function getBotToken(): string {
  try { return (localStorage.getItem("mcg-discord-bot-token") || "").trim(); } catch { return ""; }
}
export function setBotToken(token: string): void {
  try { localStorage.setItem("mcg-discord-bot-token", token.trim()); } catch { /* ignore */ }
}
export function getRequestsChannelId(): string {
  try { return (localStorage.getItem("mcg-discord-requests-channel") || "").trim(); } catch { return ""; }
}
export function setRequestsChannelId(id: string): void {
  try { localStorage.setItem("mcg-discord-requests-channel", id.trim()); } catch { /* ignore */ }
}
export function discordReadingConfigured(): boolean {
  return Boolean(getBotToken() && /^\d+$/.test(getRequestsChannelId()));
}

export interface DiscordRequestMessage {
  messageId: string;
  author: string;
  sentAt: string;
  code: string;
}

// Pure: pull MCG-REQ codes out of raw Discord messages. Exported for tests.
export function extractRequestCodes(
  messages: Array<{ id?: string; content?: string; timestamp?: string; author?: { username?: string } }>
): DiscordRequestMessage[] {
  const found: DiscordRequestMessage[] = [];
  for (const message of messages) {
    const match = /MCG-REQ-[A-Z0-9]+-[A-Za-z0-9_-]+/.exec(message?.content ?? "");
    if (!match) continue;
    found.push({
      messageId: message.id ?? "",
      author: message.author?.username ?? "unknown",
      sentAt: message.timestamp ?? "",
      code: match[0]
    });
  }
  return found;
}

// Message ids the owner has already handled, so the same request is not shown
// again on every check.
const HANDLED_KEY = "mcg-discord-handled-messages";
export function handledMessageIds(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(HANDLED_KEY) || "[]") as string[]); } catch { return new Set(); }
}
export function markMessageHandled(messageId: string): void {
  try {
    const ids = [...handledMessageIds(), messageId];
    localStorage.setItem(HANDLED_KEY, JSON.stringify(ids.slice(-500)));
  } catch { /* ignore */ }
}

export async function fetchDiscordRequests(): Promise<DiscordRequestMessage[]> {
  if (!discordReadingConfigured() || !("__TAURI_INTERNALS__" in window)) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  const messages = await invoke<Array<{ id?: string; content?: string; timestamp?: string; author?: { username?: string } }>>(
    "fetch_discord_messages",
    { botToken: getBotToken(), channelId: getRequestsChannelId(), limit: 50 }
  );
  const handled = handledMessageIds();
  return extractRequestCodes(Array.isArray(messages) ? messages : []).filter((m) => !handled.has(m.messageId));
}

// Post the unlock code back into the channel so the person sees it in Discord.
export async function postUnlockToDiscord(name: string, roleLabelText: string, unlockCode: string): Promise<boolean> {
  if (!("__TAURI_INTERNALS__" in window)) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  const content = `**Approved:** ${name} → ${roleLabelText}\n${name}, paste this into the app under "Enter unlock code":\n\`${unlockCode}\``;
  try {
    if (discordReadingConfigured()) {
      await invoke("post_discord_bot_message", { botToken: getBotToken(), channelId: getRequestsChannelId(), content });
      return true;
    }
    const url = getRequestWebhook();
    if (isDiscordWebhook(url)) {
      await invoke("post_discord_webhook", { url, content });
      return true;
    }
  } catch { /* fall through */ }
  return false;
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
