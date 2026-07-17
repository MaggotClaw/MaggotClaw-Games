import { useCallback, useEffect, useMemo, useState } from "react";
import { canPerform, roleLabel, type ProjectRole } from "./permissions";
import {
  fetchRelayMessages, getBotToken, getRelayChannelId, messagingConnected,
  postRelayMessage, setBotToken, setRelayChannelId, type RelayChatMessage
} from "./discordLink";
import { makeMessagingKey, parseMessagingKey } from "./accessCodes";
import { addContact, directMessageTargets, loadContacts, recordJoin, removeContact, type Contact } from "./contacts";
import { ReadSelectionButton } from "./ReadSelectionButton";

// The messaging area. Rooms and direct messages travel through the team's
// Discord relay channel, so people on different computers see each other.
// Everything also lands in local storage, so the log survives offline.

export interface ChatRoom {
  id: string;
  name: string;
  purpose: string;
  minRole: ProjectRole;
  ownerPostsOnly?: boolean;
}

export const CHAT_ROOMS: ChatRoom[] = [
  { id: "announcements", name: "Announcements", purpose: "Word from the author. Everyone can read; only the owner posts.", minRole: "reader", ownerPostsOnly: true },
  { id: "readers", name: "Readers", purpose: "Talk about the book with other readers. No spoilers past the chapters released to you.", minRole: "reader" },
  { id: "questions", name: "Questions for the author", purpose: "Ask the author something. The owner sees everything raised here.", minRole: "reader" },
  { id: "editors", name: "Editors", purpose: "Craft, continuity, and revision talk between editors and the author.", minRole: "editor" },
  { id: "review", name: "Review queue chat", purpose: "Discussion attached to proposed changes waiting on OK GO.", minRole: "editor" },
  { id: "owner", name: "Owner only", purpose: "Private notes and admin matters.", minRole: "administrator" }
];

const ROLE_RANK: Record<ProjectRole, number> = { reader: 0, contributor: 1, reviewer: 2, editor: 3, support: 4, administrator: 5 };

export function visibleRooms(role: ProjectRole): ChatRoom[] {
  return CHAT_ROOMS.filter((room) => ROLE_RANK[role] >= ROLE_RANK[room.minRole]);
}

// The owner's fixed handle on the wire, so "Message MaggotClaw" works before
// anyone knows the owner's profile name.
export const OWNER_HANDLE = "MaggotClaw";

export interface LocalMessage { id: string; author: string; text: string; at: string }

function readThreadStore(storeKey: string): LocalMessage[] {
  try {
    const raw = JSON.parse(localStorage.getItem(storeKey) || "[]") as Array<Partial<LocalMessage>>;
    return raw.filter((m) => typeof m.text === "string").map((m, i) => ({
      id: m.id || `old-${i}-${m.at ?? ""}`,
      author: m.author ?? "unknown",
      text: m.text ?? "",
      at: m.at ?? new Date(0).toISOString()
    }));
  } catch { return []; }
}

function loadThread(key: string): LocalMessage[] {
  const current = readThreadStore(`mcg-chat:${key}`);
  // Earlier builds stored room logs under the bare room id; fold them in once.
  if (key.startsWith("room:")) {
    const legacy = readThreadStore(`mcg-chat:${key.slice(5)}`);
    if (legacy.length) {
      const merged = mergeThread(legacy, current);
      saveThread(key, merged);
      try { localStorage.removeItem(`mcg-chat:${key.slice(5)}`); } catch { /* ignore */ }
      return merged;
    }
  }
  return current;
}
function saveThread(key: string, list: LocalMessage[]): void {
  try { localStorage.setItem(`mcg-chat:${key}`, JSON.stringify(list.slice(-200))); } catch { /* ignore */ }
}

// Pure: fold relay messages into a local thread without duplicates. A relayed
// copy of a message we sent optimistically replaces the optimistic one.
export function mergeThread(local: LocalMessage[], incoming: LocalMessage[]): LocalMessage[] {
  const merged = [...local];
  for (const message of incoming) {
    if (merged.some((m) => m.id === message.id)) continue;
    const echo = merged.findIndex((m) =>
      m.id.startsWith("local-") && m.author === message.author && m.text === message.text);
    if (echo >= 0) { merged[echo] = message; continue; }
    merged.push(message);
  }
  return merged.sort((a, b) => a.at.localeCompare(b.at));
}

// Pure: which thread does a relay message belong to, seen by this person?
export function threadKeyFor(message: RelayChatMessage, viewerName: string, viewerIsOwner: boolean): string | null {
  if (message.room) return `room:${message.room}`;
  const to = (message.to ?? "").trim();
  const me = viewerName.trim().toLowerCase();
  const isToMe = to.toLowerCase() === me || (viewerIsOwner && to === OWNER_HANDLE);
  const isFromMe = message.author.trim().toLowerCase() === me;
  if (isToMe) return `dm:${message.author.trim().toLowerCase()}`;
  if (isFromMe) return `dm:${to.toLowerCase()}`;
  return null;
}

export function ChatScreen({ role, name, onBack, onOpenDiscord }: { role: ProjectRole; name: string; onBack: () => void; onOpenDiscord?: () => void }) {
  const rooms = useMemo(() => visibleRooms(role), [role]);
  const isOwner = canPerform(role, "manage");
  const [activeKey, setActiveKey] = useState(rooms[0] ? `room:${rooms[0].id}` : "");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [contacts, setContacts] = useState<Contact[]>(loadContacts);
  const [connected, setConnected] = useState(messagingConnected);
  const [note, setNote] = useState("");
  const [pulling, setPulling] = useState(false);

  const activeRoom = activeKey.startsWith("room:") ? rooms.find((r) => r.id === activeKey.slice(5)) : undefined;
  const activeDm = activeKey.startsWith("dm:") ? activeKey.slice(3) : null;
  const dmTargets = useMemo(() => directMessageTargets(contacts, isOwner, name), [contacts, isOwner, name]);

  const storageKey = activeKey.startsWith("room:") ? `room:${activeKey.slice(5)}` : activeKey;

  useEffect(() => {
    if (activeKey.startsWith("room:")) setMessages(loadThread(`room:${activeKey.slice(5)}`));
    else if (activeKey) setMessages(loadThread(activeKey));
  }, [activeKey]);

  // Pull the relay and sort every message into its thread. Quiet on failure —
  // the local log still shows.
  const pullRelay = useCallback(async () => {
    if (!messagingConnected()) return;
    setPulling(true);
    try {
      const relayed = await fetchRelayMessages();
      const byThread = new Map<string, LocalMessage[]>();
      for (const message of relayed) {
        const key = threadKeyFor(message, name, isOwner);
        if (!key) continue;
        (byThread.get(key) ?? byThread.set(key, []).get(key)!).push({
          id: message.messageId, author: message.author, text: message.text, at: message.sentAt
        });
        // Anyone heard on the relay is a real person: attach them to contacts.
        if (message.author.trim().toLowerCase() !== name.trim().toLowerCase()) recordJoin(message.author, "");
      }
      for (const [key, incoming] of byThread) saveThread(key, mergeThread(loadThread(key), incoming));
      setContacts(loadContacts());
      setMessages(loadThread(storageKey));
      setNote("");
    } catch {
      setNote("Messages Could Not Be Refreshed — Showing This Computer's Copy");
    } finally {
      setPulling(false);
    }
  }, [name, isOwner, storageKey]);

  useEffect(() => { void pullRelay(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function send() {
    const text = draft.trim();
    if (!text || !activeKey) return;
    const local: LocalMessage = { id: `local-${crypto.randomUUID()}`, author: name, text, at: new Date().toISOString() };
    const next = [...messages, local];
    setMessages(next);
    saveThread(storageKey, next);
    setDraft("");
    const sent = await postRelayMessage(activeRoom
      ? { room: activeRoom.id, author: name, text }
      : { to: activeDm === "maggotclaw" ? OWNER_HANDLE : (dmTargets.find((c) => c.name.toLowerCase() === activeDm)?.name ?? activeDm ?? ""), author: name, text });
    setNote(sent ? "" : "Sent To This Computer Only — The Team Connection Did Not Answer");
  }

  function connectMessaging() {
    const pasted = window.prompt("Paste the Messaging Key the owner sent you:");
    if (!pasted || !pasted.trim()) return;
    const key = parseMessagingKey(pasted);
    if (!key) { setNote("That Messaging Key Was Not Recognised"); return; }
    setBotToken(key.botToken);
    setRelayChannelId(key.channelId);
    setConnected(true);
    setNote("Messaging Connected — Pulling The Team's Messages");
    void pullRelay();
  }

  async function copyMessagingKey() {
    const code = makeMessagingKey({ botToken: getBotToken(), channelId: getRelayChannelId() });
    try {
      await navigator.clipboard?.writeText(code);
      setNote("Messaging Key Copied — Send It To Whoever You Want Chatting Here");
    } catch {
      window.prompt("Copy this Messaging Key:", code);
    }
  }

  function addFriend() {
    const discordName = window.prompt("Their Discord name (they attach automatically when they join the app):");
    if (!discordName || !discordName.trim()) return;
    setContacts(addContact(discordName, discordName));
  }

  const composerLocked = Boolean(activeRoom?.ownerPostsOnly && !isOwner);
  const activeTitle = activeRoom ? `#${activeRoom.name}` : activeDm === "maggotclaw" ? "MaggotClaw" : (dmTargets.find((c) => c.name.toLowerCase() === activeDm)?.name ?? activeDm ?? "");

  return <main className="app-shell chat-shell">
    <header className="topbar">
      <button className="text-button" onClick={onBack}>← Back</button>
      <span className="eyebrow">Messages</span>
      <ReadSelectionButton />
      <span className="who-chip">{name} · {roleLabel(role)}</span>
    </header>

    <section className="chat-body">
      <aside className="chat-rooms">
        <div className="chat-rooms-head">
          <h2>Rooms</h2>
          <button className="primary tiny" onClick={() => void pullRelay()} disabled={pulling || !connected} title={connected ? "Pull the latest team messages" : "Connect messaging first"}>{pulling ? "…" : "Refresh"}</button>
        </div>
        <ul>
          {rooms.map((room) => <li key={room.id}>
            <button className={activeKey === `room:${room.id}` ? "active" : ""} onClick={() => setActiveKey(`room:${room.id}`)}>
              <span className="room-hash">#</span>
              <span className="room-name">{room.name}</span>
            </button>
          </li>)}
        </ul>

        <div className="chat-rooms-head"><h2>Direct Messages</h2>{isOwner && <button className="primary tiny" onClick={addFriend}>Add A Friend</button>}</div>
        <ul>
          {!isOwner && <li>
            <button className={activeKey === "dm:maggotclaw" ? "active" : ""} onClick={() => setActiveKey("dm:maggotclaw")}>
              <span className="room-hash">@</span>
              <span className="room-name">Message MaggotClaw</span>
            </button>
          </li>}
          {dmTargets.map((contact) => <li key={contact.name}>
            <button className={activeKey === `dm:${contact.name.toLowerCase()}` ? "active" : ""} onClick={() => setActiveKey(`dm:${contact.name.toLowerCase()}`)}>
              <span className="room-hash">@</span>
              <span className="room-name">Message {contact.name}</span>
            </button>
            {isOwner && <button className="text-button tiny-remove" title="Remove from Direct Messages" onClick={() => setContacts(removeContact(contact.name))}>✕</button>}
          </li>)}
        </ul>

        {!connected && <button className="primary tiny" onClick={connectMessaging}>Connect Messaging</button>}
        {isOwner && connected && <button className="primary tiny" onClick={() => void copyMessagingKey()}>Copy Messaging Key</button>}

        <div className="chat-rooms-head"><h2>Who's Here</h2></div>
        <ul className="chat-presence">
          <li><span className="dot self" /> {name} <em>(you)</em></li>
          {contacts.filter((c) => c.name.toLowerCase() !== name.toLowerCase()).map((c) =>
            <li key={c.name} className={c.attached ? "" : "muted"}><span className={c.attached ? "dot self" : "dot"} /> {c.name}{c.attached ? "" : " (invited)"}</li>)}
          {contacts.length === 0 && <li className="muted"><span className="dot" /> Nobody else yet</li>}
        </ul>
      </aside>

      <section className="chat-thread">
        {activeKey && <>
          <div className="chat-thread-head">
            <div><strong>{activeTitle}</strong><small>{activeRoom?.purpose ?? "A private conversation. Only the two of you read it."}</small></div>
            <button className="text-button" onClick={onOpenDiscord} disabled={!onOpenDiscord} title="Voice calls run in the full Messages window">Start call</button>
          </div>

          <div className="chat-messages">
            {messages.length === 0
              ? <div className="chat-placeholder">
                  <strong>{activeTitle} is quiet</strong>
                  <p>Post here, or open the full Messages window for voice calls and the whole team.</p>
                  {onOpenDiscord && <button className="primary" onClick={onOpenDiscord}>Open Messages window</button>}
                </div>
              : <ul className="chat-log">
                  {messages.map((m) => <li key={m.id}>
                    <span className="chat-author">{m.author}</span>
                    <time>{new Date(m.at).toLocaleString()}</time>
                    <p>{m.text}</p>
                  </li>)}
                </ul>}
          </div>

          <div className="chat-composer">
            <textarea
              rows={2}
              value={draft}
              placeholder={composerLocked ? "Only the owner posts announcements." : `Message ${activeTitle}…`}
              disabled={composerLocked}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }}
            />
            <button className="primary" disabled={!draft.trim() || composerLocked} onClick={() => void send()}>Send</button>
          </div>
          <p className="chat-note">{note || (connected
            ? "Messages travel through the team's Discord channel and are kept on this computer too."
            : "Messages stay on this computer until the owner sends you a Messaging Key.")}</p>
        </>}
      </section>
    </section>
  </main>;
}
