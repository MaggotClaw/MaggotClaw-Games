// Discord glue: where the team server lives, each person's Discord name, and the
// webhook that carries access requests straight into the owner's channel.
//
// The webhook URL is configuration, not a secret worth guarding — anyone with
// the app can post to that one channel and nothing else. It can be baked in
// here or pasted into Settings by the owner without a rebuild.

export const DEFAULT_DISCORD_INVITE = "";
export const DEFAULT_REQUESTS_CHANNEL = "1210102876547055668";
export const DEFAULT_REQUEST_WEBHOOK = "https://discord.com/api/webhooks/1527522590636249158/qvNLNfNvWPeunVaIrSnghDpWScbINXuzVO36MVkTcQFilbZvDeG19H3J0eLeLDbd-gpC";

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
  try { return (localStorage.getItem("mcg-discord-requests-channel") || DEFAULT_REQUESTS_CHANNEL).trim(); } catch { return DEFAULT_REQUESTS_CHANNEL; }
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
    { botToken: getBotToken(), channelId: getRequestsChannelId(), limit: 100 }
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

// ---- Approvals that apply themselves ---------------------------------------
//
// The owner picks a role and presses Approve. A grant goes into the channel;
// the person's own app sees it, checks the unlock code really was issued to
// them, and raises their role on the spot. Nobody copies a code any more.

export interface RoleGrant {
  messageId: string;
  name: string;
  code: string;      // the unlock code, which carries the name and role
  sentAt: string;
}

export function grantMessage(name: string, roleLabelText: string, unlockCode: string): string {
  return `**Approved:** ${name} → ${roleLabelText}\n[GRANT] ${name} :: ${unlockCode}\n${name}, your app will unlock itself the next time you open it — there is nothing to copy.`;
}

// Pure: find grants among raw Discord messages. Exported for tests.
export function parseGrants(
  messages: Array<{ id?: string; content?: string; timestamp?: string }>
): RoleGrant[] {
  const found: RoleGrant[] = [];
  for (const message of messages) {
    const match = /\[GRANT\]\s+(.+?)\s+::\s+(MCG-KEY-[A-Za-z0-9_-]+-[A-Za-z0-9_-]+)/.exec(message?.content ?? "");
    if (!match) continue;
    found.push({
      messageId: message.id ?? "",
      name: match[1].trim(),
      code: match[2],
      sentAt: message.timestamp ?? ""
    });
  }
  return found;
}

export async function postRoleGrant(name: string, roleLabelText: string, unlockCode: string): Promise<boolean> {
  if (!("__TAURI_INTERNALS__" in window)) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  const content = grantMessage(name, roleLabelText, unlockCode);
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

// Anyone with the messaging key can look for a grant addressed to them.
export async function fetchRoleGrants(): Promise<RoleGrant[]> {
  if (!getBotToken() || !("__TAURI_INTERNALS__" in window)) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  const messages = await invoke<Array<{ id?: string; content?: string; timestamp?: string }>>(
    "fetch_discord_messages",
    { botToken: getBotToken(), channelId: getRequestsChannelId(), limit: 100, after: null }
  );
  return parseGrants(Array.isArray(messages) ? messages : []);
}

// A decline answered out loud: the requester's wait ends with a message
// instead of silence.
export async function postUnlockDecline(name: string): Promise<boolean> {
  if (!("__TAURI_INTERNALS__" in window)) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  const content = `**Request declined:** ${name}, the owner declined this access request for now. You can keep reading, and you can always ask again with a note about why.`;
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

// ---- Team chat relay --------------------------------------------------------
//
// Rooms and direct messages travel through one Discord channel (the relay).
// Every chat line is posted in a fixed shape the app can read back:
//   room message:   [#readers] Bob: the text
//   direct message: [@MaggotClaw] Bob: the text
// The channel doubles as a plain-language log the owner can read in Discord.

export interface RelayChatMessage {
  messageId: string;
  room: string | null;      // "#room" messages
  to: string | null;        // "@name" direct messages
  author: string;
  text: string;
  sentAt: string;
}

export function getRelayChannelId(): string {
  try { return (localStorage.getItem("mcg-discord-relay-channel") || getRequestsChannelId()).trim(); } catch { return getRequestsChannelId(); }
}
export function setRelayChannelId(id: string): void {
  try { localStorage.setItem("mcg-discord-relay-channel", id.trim()); } catch { /* ignore */ }
}

export function formatChatLine(input: { room?: string; to?: string; author: string; text: string }): string {
  const target = input.room ? `[#${input.room}]` : `[@${input.to ?? ""}]`;
  return `${target} ${input.author}: ${input.text}`.slice(0, 1900);
}

// Pure: recognise relay chat lines among raw Discord messages. Exported for tests.
export function parseChatLines(
  messages: Array<{ id?: string; content?: string; timestamp?: string; author?: { username?: string } }>
): RelayChatMessage[] {
  const found: RelayChatMessage[] = [];
  for (const message of messages) {
    const match = /^\[([#@])([^\]]+)\]\s+([^:]{1,60}):\s?([\s\S]+)$/.exec(message?.content ?? "");
    if (!match) continue;
    found.push({
      messageId: message.id ?? "",
      room: match[1] === "#" ? match[2].trim() : null,
      to: match[1] === "@" ? match[2].trim() : null,
      author: match[3].trim(),
      text: match[4].trim(),
      sentAt: message.timestamp ?? ""
    });
  }
  // Discord returns newest first; chat reads oldest first.
  return found.reverse();
}

// Snowflake ids are numeric strings; longer means newer, then lexicographic.
function newestId(a: string, b: string): string {
  if (a.length !== b.length) return a.length > b.length ? a : b;
  return a > b ? a : b;
}

function lastSeenKey(): string {
  return `mcg-relay-last-id:${getRelayChannelId()}`;
}

// Anyone with the messaging key can pull the relay channel. After the first
// pull, later pulls page forward from the last message this machine has seen,
// so a computer that was off for a week catches up on everything it missed
// instead of only the newest hundred lines.
export async function fetchRelayMessages(): Promise<RelayChatMessage[]> {
  if (!getBotToken() || !("__TAURI_INTERNALS__" in window)) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  type RawMessage = { id?: string; content?: string; timestamp?: string; author?: { username?: string } };
  const fetchPage = (after: string | null) => invoke<RawMessage[]>(
    "fetch_discord_messages",
    { botToken: getBotToken(), channelId: getRelayChannelId(), limit: 100, after }
  );

  let lastSeen = "";
  try { lastSeen = localStorage.getItem(lastSeenKey()) || ""; } catch { /* ignore */ }

  const collected: RawMessage[] = [];
  if (!lastSeen) {
    const page = await fetchPage(null);
    if (Array.isArray(page)) collected.push(...page);
  } else {
    let cursor = lastSeen;
    for (let pages = 0; pages < 5; pages += 1) {
      const page = await fetchPage(cursor);
      if (!Array.isArray(page) || !page.length) break;
      collected.push(...page);
      cursor = page.reduce((best, m) => (m.id ? newestId(best, m.id) : best), cursor);
      if (page.length < 100) break;
    }
    if (!collected.length) {
      // Nothing new since the cursor — refresh the newest page anyway so a
      // deleted cursor message can never freeze the pull.
      const page = await fetchPage(null);
      if (Array.isArray(page)) collected.push(...page);
    }
  }

  const newest = collected.reduce((best, m) => (m.id ? newestId(best, m.id) : best), lastSeen);
  if (newest) {
    try { localStorage.setItem(lastSeenKey(), newest); } catch { /* ignore */ }
  }
  return parseChatLines(collected);
}

// Post a chat line: through the bot when the key is present (reaches the relay
// channel), otherwise through the baked-in webhook so nobody is ever silenced.
export async function postRelayMessage(input: { room?: string; to?: string; author: string; text: string }): Promise<boolean> {
  if (!("__TAURI_INTERNALS__" in window)) return false;
  const content = formatChatLine(input);
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    if (getBotToken()) {
      await invoke("post_discord_bot_message", { botToken: getBotToken(), channelId: getRelayChannelId(), content });
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

// True once this computer can read team messages (bot key present).
export function messagingConnected(): boolean {
  return Boolean(getBotToken() && /^\d+$/.test(getRelayChannelId()));
}
