// Cross-machine access without a server.
//
// A new person's app makes a REQUEST CODE they send to the owner however they
// like (text, email, chat). The owner pastes it into the Owner Dashboard,
// approves, and gets back an UNLOCK CODE to send them. Pasting that unlock code
// raises their role on their own machine.
//
// These are not secrets and not security: they carry a checksum so typos and
// truncation are caught, and the unlock code is tied to the person's name so it
// cannot be casually passed around. Everything here is pure and unit-tested.

import { ROLE_ORDER, type ProjectRole } from "./permissions";

export const REQUEST_PREFIX = "MCG-REQ";
export const UNLOCK_PREFIX = "MCG-KEY";
export const MESSAGING_PREFIX = "MCG-MSG";

export interface RequestPayload {
  name: string;
  currentRole: ProjectRole;
  requestedRole: ProjectRole;
  reason: string;
}

export interface UnlockPayload {
  name: string;
  role: ProjectRole;
  // Optional messaging connection carried along with an approval, so the person
  // can read and send team messages the moment their new role lands.
  messaging?: MessagingPayload;
}

// The messaging key: what an app needs to read and post in the team's Discord
// relay channel. Handed out by the owner as a pasteable code.
export interface MessagingPayload {
  botToken: string;
  channelId: string;
}

function b64urlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(code: string): string | null {
  try {
    const padded = code.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

// Short, stable checksum so a mistyped or clipped code is rejected instead of
// silently decoding into nonsense.
function checksum(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  return hash.toString(36).slice(0, 6).toUpperCase();
}

function isRole(value: unknown): value is ProjectRole {
  return typeof value === "string" && (ROLE_ORDER as string[]).includes(value);
}

function pack(prefix: string, payload: unknown): string {
  const body = b64urlEncode(JSON.stringify(payload));
  return `${prefix}-${checksum(body)}-${body}`;
}

function unpack(prefix: string, code: string): unknown {
  const trimmed = (code || "").trim().replace(/\s+/g, "");
  const head = `${prefix}-`;
  if (!trimmed.toUpperCase().startsWith(head)) return null;
  const rest = trimmed.slice(head.length);
  const split = rest.indexOf("-");
  if (split < 1) return null;
  const sum = rest.slice(0, split).toUpperCase();
  const body = rest.slice(split + 1);
  if (!body || checksum(body) !== sum) return null;
  const json = b64urlDecode(body);
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function makeRequestCode(payload: RequestPayload): string {
  return pack(REQUEST_PREFIX, {
    n: payload.name,
    c: payload.currentRole,
    r: payload.requestedRole,
    y: (payload.reason || "").slice(0, 300)
  });
}

export function parseRequestCode(code: string): RequestPayload | null {
  const raw = unpack(REQUEST_PREFIX, code) as Record<string, unknown> | null;
  if (!raw || typeof raw.n !== "string" || !raw.n.trim()) return null;
  if (!isRole(raw.c) || !isRole(raw.r)) return null;
  return {
    name: raw.n.trim(),
    currentRole: raw.c,
    requestedRole: raw.r,
    reason: typeof raw.y === "string" ? raw.y : ""
  };
}

export function makeUnlockCode(payload: UnlockPayload): string {
  const body: Record<string, unknown> = { n: payload.name, r: payload.role };
  if (payload.messaging?.botToken && payload.messaging.channelId) {
    body.mt = payload.messaging.botToken;
    body.mc = payload.messaging.channelId;
  }
  return pack(UNLOCK_PREFIX, body);
}

export function parseUnlockCode(code: string): UnlockPayload | null {
  const raw = unpack(UNLOCK_PREFIX, code) as Record<string, unknown> | null;
  if (!raw || typeof raw.n !== "string" || !raw.n.trim() || !isRole(raw.r)) return null;
  const messaging = typeof raw.mt === "string" && raw.mt.trim() && typeof raw.mc === "string" && /^\d+$/.test(raw.mc)
    ? { botToken: raw.mt.trim(), channelId: raw.mc }
    : undefined;
  return { name: raw.n.trim(), role: raw.r, messaging };
}

// A standalone messaging key, for people who already have the role they want
// but still need the team chat connected.
export function makeMessagingKey(payload: MessagingPayload): string {
  return pack(MESSAGING_PREFIX, { t: payload.botToken, c: payload.channelId });
}

export function parseMessagingKey(code: string): MessagingPayload | null {
  const raw = unpack(MESSAGING_PREFIX, code) as Record<string, unknown> | null;
  if (!raw || typeof raw.t !== "string" || !raw.t.trim()) return null;
  if (typeof raw.c !== "string" || !/^\d+$/.test(raw.c)) return null;
  return { botToken: raw.t.trim(), channelId: raw.c };
}

// An unlock code is meant for one person. Compare forgivingly (case/spacing) so
// a capitalisation difference does not lock someone out of their own grant.
export function unlockMatchesProfile(payload: UnlockPayload, profileName: string): boolean {
  const tidy = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
  return tidy(payload.name) === tidy(profileName);
}
