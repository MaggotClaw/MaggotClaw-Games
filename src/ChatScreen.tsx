import { useEffect, useMemo, useState } from "react";
import { roleLabel, type ProjectRole } from "./permissions";

// The messaging area. The layout, rooms, and rules are real; the transport that
// carries messages between people is not built yet, so nothing sends. Rooms are
// filtered by role so a reader never sees the editors' room.

export interface ChatRoom {
  id: string;
  name: string;
  purpose: string;
  minRole: ProjectRole;
  kind: "room" | "direct";
}

export const CHAT_ROOMS: ChatRoom[] = [
  { id: "announcements", name: "Announcements", purpose: "Word from the author. Everyone can read; only the owner posts.", minRole: "reader", kind: "room" },
  { id: "readers", name: "Readers", purpose: "Talk about the book with other readers. No spoilers past the chapters released to you.", minRole: "reader", kind: "room" },
  { id: "questions", name: "Questions for the author", purpose: "Ask the author something. The owner sees everything raised here.", minRole: "reader", kind: "room" },
  { id: "editors", name: "Editors", purpose: "Craft, continuity, and revision talk between editors and the author.", minRole: "editor", kind: "room" },
  { id: "review", name: "Review queue chat", purpose: "Discussion attached to proposed changes waiting on OK GO.", minRole: "editor", kind: "room" },
  { id: "owner", name: "Owner only", purpose: "Private notes and admin matters.", minRole: "administrator", kind: "room" }
];

const ROLE_RANK: Record<ProjectRole, number> = { reader: 0, contributor: 1, reviewer: 2, editor: 3, support: 4, administrator: 5 };

export function visibleRooms(role: ProjectRole): ChatRoom[] {
  return CHAT_ROOMS.filter((room) => ROLE_RANK[role] >= ROLE_RANK[room.minRole]);
}

interface LocalMessage { author: string; text: string; at: string }

function loadRoomMessages(roomId: string): LocalMessage[] {
  try { return JSON.parse(localStorage.getItem(`mcg-chat:${roomId}`) || "[]") as LocalMessage[]; } catch { return []; }
}
function saveRoomMessages(roomId: string, list: LocalMessage[]): void {
  try { localStorage.setItem(`mcg-chat:${roomId}`, JSON.stringify(list.slice(-200))); } catch { /* ignore */ }
}

export function ChatScreen({ role, name, onBack, onOpenDiscord }: { role: ProjectRole; name: string; onBack: () => void; onOpenDiscord?: () => void }) {
  const rooms = useMemo(() => visibleRooms(role), [role]);
  const [activeId, setActiveId] = useState(rooms[0]?.id ?? "");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const active = rooms.find((room) => room.id === activeId) ?? rooms[0];

  useEffect(() => { if (active) setMessages(loadRoomMessages(active.id)); }, [active?.id]);

  function send() {
    if (!active || !draft.trim()) return;
    const next = [...messages, { author: name, text: draft.trim(), at: new Date().toISOString() }];
    setMessages(next);
    saveRoomMessages(active.id, next);
    setDraft("");
  }

  return <main className="app-shell chat-shell">
    <header className="topbar">
      <button className="text-button" onClick={onBack}>← Main Menu</button>
      <span className="eyebrow">Messages</span>
      <span className="who-chip">{name} · {roleLabel(role)}</span>
    </header>

    <section className="chat-body">
      <aside className="chat-rooms">
        <div className="chat-rooms-head">
          <h2>Rooms</h2>
          <button className="primary tiny" disabled title="Available once messaging is connected">New chat</button>
        </div>
        <ul>
          {rooms.map((room) => <li key={room.id}>
            <button className={room.id === activeId ? "active" : ""} onClick={() => setActiveId(room.id)}>
              <span className="room-hash">#</span>
              <span className="room-name">{room.name}</span>
            </button>
          </li>)}
        </ul>

        <div className="chat-rooms-head"><h2>Direct Messages</h2></div>
        <button className="primary tiny" onClick={() => {
          const text = window.prompt("What do you want to tell MaggotClaw?");
          if (!text || !text.trim()) return;
          void import("./discordLink").then(({ sendRequestToDiscord }) =>
            sendRequestToDiscord(`**Message to MaggotClaw** from ${name}:\n${text.trim().slice(0, 1700)}`)
          );
        }}>Message MaggotClaw</button>

        <div className="chat-rooms-head"><h2>Who's on</h2></div>
        <ul className="chat-presence">
          <li><span className="dot self" /> {name} <em>(you)</em></li>
          <li className="muted"><span className="dot" /> Nobody else yet</li>
        </ul>
      </aside>

      <section className="chat-thread">
        {active && <>
          <div className="chat-thread-head">
            <div><strong>#{active.name}</strong><small>{active.purpose}</small></div>
            <button className="text-button" disabled title="Calls need the messaging connection first">Start call</button>
          </div>

          <div className="chat-messages">
            {messages.length === 0
              ? <div className="chat-placeholder">
                  <strong>#{active.name} is quiet</strong>
                  <p>Post here, or open the full Messages window for voice calls and the whole team.</p>
                  {onOpenDiscord && <button className="primary" onClick={onOpenDiscord}>Open Messages window</button>}
                </div>
              : <ul className="chat-log">
                  {messages.map((m, i) => <li key={i}>
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
              placeholder={`Message #${active.name}…`}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }}
            />
            <button className="primary" disabled={!draft.trim()} onClick={send}>Send</button>
          </div>
          <p className="chat-note">Posts are saved on this computer for now; the shared connection carries them to everyone later.</p>
        </>}
      </section>
    </section>
  </main>;
}
