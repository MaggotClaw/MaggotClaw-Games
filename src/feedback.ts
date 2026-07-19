// Feedback, and the quiet record of how the app is behaving.
//
// Anyone can rate a part of the app, send an idea, or report a problem. The
// app also keeps a local note of any error it hits and a plain count of which
// screens get used, so a report says what actually went wrong instead of "it
// broke". Nothing is sent anywhere until the person presses send.

export type FeedbackKind = "rating" | "idea" | "problem";

export interface FeedbackItem {
  id: string;
  kind: FeedbackKind;
  area: string;          // which part of the app
  rating?: number;       // 1..5 for ratings
  text: string;
  from: string;
  at: string;
  sent: boolean;
}

export const FEEDBACK_AREAS = [
  "Reader Mode", "The Narrator's Voice", "Voice Companion", "Messages",
  "Projects And Files", "Onboarding", "The App Overall"
];

const ITEMS_KEY = "mcg-feedback";
const ERRORS_KEY = "mcg-error-log";
const USAGE_KEY = "mcg-usage";
const SHARE_KEY = "mcg-share-diagnostics";

// ---- Feedback --------------------------------------------------------------

export function loadFeedback(): FeedbackItem[] {
  try { return JSON.parse(localStorage.getItem(ITEMS_KEY) || "[]") as FeedbackItem[]; } catch { return []; }
}

export function saveFeedback(list: FeedbackItem[]): void {
  try { localStorage.setItem(ITEMS_KEY, JSON.stringify(list.slice(-200))); } catch { /* ignore */ }
}

export function addFeedback(item: Omit<FeedbackItem, "id" | "at" | "sent">): FeedbackItem[] {
  const next = [...loadFeedback(), { ...item, id: crypto.randomUUID(), at: new Date().toISOString(), sent: false }];
  saveFeedback(next);
  return next;
}

export function markFeedbackSent(id: string): FeedbackItem[] {
  const next = loadFeedback().map((item) => item.id === id ? { ...item, sent: true } : item);
  saveFeedback(next);
  return next;
}

// Pure: the message the author receives.
export function feedbackMessage(item: FeedbackItem): string {
  const head = item.kind === "rating" ? `**Rating** ${"★".repeat(item.rating ?? 0)}${"☆".repeat(5 - (item.rating ?? 0))}`
    : item.kind === "idea" ? "**Idea**" : "**Problem**";
  return `${head} — ${item.area}\nFrom: ${item.from || "someone"}\n\n${item.text}`.slice(0, 1800);
}

// ---- What went wrong -------------------------------------------------------

export interface ErrorNote {
  at: string;
  what: string;
  where: string;
}

export function loadErrors(): ErrorNote[] {
  try { return JSON.parse(localStorage.getItem(ERRORS_KEY) || "[]") as ErrorNote[]; } catch { return []; }
}

export function recordError(what: string, where: string): void {
  try {
    const note: ErrorNote = { at: new Date().toISOString(), what: what.slice(0, 300), where: where.slice(0, 200) };
    localStorage.setItem(ERRORS_KEY, JSON.stringify([...loadErrors(), note].slice(-50)));
  } catch { /* ignore */ }
}

export function clearErrors(): void {
  try { localStorage.removeItem(ERRORS_KEY); } catch { /* ignore */ }
}

// Catch the errors the app would otherwise swallow silently.
export function watchForErrors(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("error", (event) => {
    recordError(event.message || "Unknown error", `${event.filename ?? ""}:${event.lineno ?? 0}`);
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = (event as PromiseRejectionEvent).reason;
    recordError(reason instanceof Error ? reason.message : String(reason), "a background task");
  });
}

// ---- Which parts actually get used ----------------------------------------

export type Usage = Record<string, number>;

export function loadUsage(): Usage {
  try { return JSON.parse(localStorage.getItem(USAGE_KEY) || "{}") as Usage; } catch { return {}; }
}

export function noteUsage(what: string): void {
  try {
    const usage = loadUsage();
    usage[what] = (usage[what] ?? 0) + 1;
    localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
  } catch { /* ignore */ }
}

export function shareDiagnostics(): boolean {
  try { return localStorage.getItem(SHARE_KEY) !== "false"; } catch { return true; }
}

export function setShareDiagnostics(on: boolean): void {
  try { localStorage.setItem(SHARE_KEY, on ? "true" : "false"); } catch { /* ignore */ }
}

// Pure: a plain-language report of how this copy has been behaving. Only ever
// counts and error messages — never a word of anyone's writing or reading.
export function diagnosticsReport(version: string, usage: Usage, errors: ErrorNote[]): string {
  const used = Object.entries(usage).sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([what, count]) => `${what} ×${count}`).join(", ");
  const recent = errors.slice(-5).map((e) => `- ${new Date(e.at).toLocaleString()}: ${e.what} (${e.where})`);
  return [
    `App version: ${version || "unknown"}`,
    used ? `Most used: ${used}` : "Most used: nothing recorded yet",
    errors.length ? `Problems recorded: ${errors.length}` : "No problems recorded",
    ...recent
  ].join("\n").slice(0, 1200);
}

// ---- What other people have told him ---------------------------------------
// Feedback is posted into the owner's Discord channel, alongside access
// requests. Until now it stayed there: the Tell MaggotClaw page listed only
// what this computer had sent, so the owner never saw anyone else's.

export interface ArrivedFeedback {
  kind: FeedbackKind;
  area: string;
  rating?: number;
  text: string;
  from: string;
  at: string;
}

// Pure: pick the feedback out of a channel that also carries request codes and
// unlock grants. Every feedback message opens with the kind in bold, which is
// what feedbackMessage writes above.
export function parseArrivedFeedback(
  messages: Array<{ content?: string; timestamp?: string; author?: { username?: string } }>
): ArrivedFeedback[] {
  const found: ArrivedFeedback[] = [];
  for (const message of messages) {
    const content = (message.content ?? "").trim();
    const head = content.match(/^\*\*(Rating|Idea|Problem)\*\*\s*(★*☆*)?\s*—\s*(.+)$/m);
    if (!head) continue;
    const kind = head[1].toLowerCase() as FeedbackKind;
    const stars = (head[2] ?? "").split("★").length - 1;
    const from = content.match(/^From:\s*(.+)$/m)?.[1]?.trim();
    // Everything below the "From:" line is what the person actually wrote.
    const body = content.split(/^From:.*$/m)[1]?.trim() ?? "";
    found.push({
      kind,
      area: head[3].trim(),
      ...(kind === "rating" && stars ? { rating: stars } : {}),
      text: body,
      from: from || message.author?.username || "someone",
      at: message.timestamp ?? ""
    });
  }
  // Newest first, and a problem outranks an idea outranks a rating: something
  // broken matters more than something wished for.
  const weight = (kind: FeedbackKind) => (kind === "problem" ? 0 : kind === "idea" ? 1 : 2);
  return found.sort((a, b) => weight(a.kind) - weight(b.kind) || b.at.localeCompare(a.at));
}

export async function fetchArrivedFeedback(botToken: string, channelId: string): Promise<ArrivedFeedback[]> {
  if (!("__TAURI_INTERNALS__" in window)) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  const messages = await invoke<Array<{ content?: string; timestamp?: string; author?: { username?: string } }>>(
    "fetch_discord_messages", { botToken, channelId, limit: 100 }
  );
  return parseArrivedFeedback(Array.isArray(messages) ? messages : []);
}
