import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createConversationAdapter } from "./desktopConversation";
import { loadVoiceSettings } from "./voiceSettings";

// The OK GO button: the brake on the whole workflow made physical.
//
// It floats above whatever the author is doing, moves wherever he drags it,
// and never fires the instant it is pressed — three, two, one, and only then
// does "OK GO" go through to the AI. Any press during the countdown calls it
// off. Nothing is approved by accident.

type Phase = "ready" | "counting" | "sending" | "sent" | "failed";

export function OkGoButton({ readerName, onClose }: { readerName: string; onClose: () => void }) {
  const settings = loadVoiceSettings(readerName);
  const [phase, setPhase] = useState<Phase>("ready");
  const [count, setCount] = useState(3);
  const [note, setNote] = useState("");
  const timer = useRef(0);
  const adapter = useRef(createConversationAdapter(settings.target));

  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current); }, []);

  // Stays above everything. Windows can quietly clear the topmost flag when
  // another program grabs it, so keep re-asserting.
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const appWindow = getCurrentWindow();
    const keepOnTop = () => { void appWindow.setAlwaysOnTop(true).catch(() => undefined); };
    keepOnTop();
    const keeper = window.setInterval(keepOnTop, 2000);
    return () => window.clearInterval(keeper);
  }, []);

  function cancel(reason = "Called off. Nothing was sent.") {
    if (timer.current) { window.clearInterval(timer.current); timer.current = 0; }
    setPhase("ready");
    setCount(3);
    setNote(reason);
  }

  function press() {
    if (phase === "counting") { cancel(); return; }
    if (phase === "sending") return;
    setNote("");
    setPhase("counting");
    setCount(3);
    timer.current = window.setInterval(() => {
      setCount((current) => {
        if (current > 1) return current - 1;
        window.clearInterval(timer.current);
        timer.current = 0;
        void send();
        return 0;
      });
    }, 1000);
  }

  async function send() {
    setPhase("sending");
    try {
      if (!adapter.current.sendMessage) throw new Error("The installed Windows app is needed to send OK GO.");
      await adapter.current.sendMessage("OK GO");
      setPhase("sent");
      setNote("OK GO sent.");
      window.setTimeout(() => { setPhase("ready"); setCount(3); }, 2200);
    } catch (error) {
      setPhase("failed");
      setNote(error instanceof Error ? error.message : "OK GO could not be sent.");
      window.setTimeout(() => { setPhase("ready"); setCount(3); }, 3200);
    }
  }

  const label = phase === "counting" ? String(count)
    : phase === "sending" ? "…"
    : phase === "sent" ? "SENT"
    : phase === "failed" ? "!"
    : "OK GO";

  return <main
    className={`okgo-shell ${phase}`}
    // Dragging anywhere but the buttons moves the whole thing.
    data-tauri-drag-region
    onMouseDown={(event) => {
      if ((event.target as HTMLElement).closest("button")) return;
      if (!("__TAURI_INTERNALS__" in window)) return;
      void getCurrentWindow().startDragging().catch(() => undefined);
    }}
  >
    <button className="okgo-button" onClick={press} title={phase === "counting" ? "Press again to call it off" : "Press to approve — three seconds to change your mind"}>
      {label}
    </button>
    <div className="okgo-side">
      <span className="okgo-note">{note || (phase === "counting" ? "Press again to stop" : "Approve")}</span>
      <button className="okgo-close" onClick={onClose} title="Close">✕</button>
    </div>
  </main>;
}
