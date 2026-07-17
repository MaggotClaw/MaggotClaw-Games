import { useMemo, useState } from "react";
import { canPerform, roleLabel, type ProjectRole } from "./permissions";

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

const ROLE_RANK: Record<ProjectRole, number> = { reader: 0, contributor: 1, editor: 2, administrator: 3 };

export function visibleRooms(role: ProjectRole): ChatRoom[] {
  return CHAT_ROOMS.filter((room) => ROLE_RANK[role] >= ROLE_RANK[room.minRole]);
}

export function ChatScreen({ role, name, onBack, onOpenDiscord }: { role: ProjectRole; name: string; onBack: () => void; onOpenDiscord?: () => void }) {
  const rooms = useMemo(() => visibleRooms(role), [role]);
  const [activeId, setActiveId] = useState(rooms[0]?.id ?? "");
  const [draft, setDraft] = useState("");
  const active = rooms.find((room) => room.id === activeId) ?? rooms[0];

  return <main className="app-shell chat-shell">
    <header className="topbar">
      <button className="text-button" onClick={onBack}>← Main Menu</button>
      <span className="eyebrow">Messages</span>
      <span>{name} · {roleLabel(role)}</span>
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
              {room.minRole !== "reader" && <span className="room-lock" title={`${roleLabel(room.minRole)} and above`}>🔒</span>}
            </button>
          </li>)}
        </ul>

        <div className="chat-rooms-head"><h2>Direct messages</h2></div>
        <p className="chat-empty-note">People you can message will appear here once messaging is connected.</p>

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
            <div className="chat-placeholder">
              <strong>Messages run through Discord</strong>
              <p>Talk, share, and start voice calls in the MaggotClaw Messages window. Sign in once and it connects itself from then on.</p>
              {onOpenDiscord && <button className="primary" onClick={onOpenDiscord}>Open Messages window</button>}
            </div>
          </div>

          <div className="chat-composer">
            <textarea
              rows={2}
              value={draft}
              placeholder={`Message #${active.name}…`}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button className="primary" disabled title="Type in the Messages window for now">Send</button>
          </div>
          <p className="chat-note">The rooms listed here mirror how the Discord server is organised.</p>
        </>}
      </section>
    </section>
  </main>;
}
