import { useEffect, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { clampStep, findWalkthrough, markCompleted, progressLine, walkthroughsFor, type Walkthrough } from "./walkthrough";

// The guide window: floats above everything, takes you to the right screen,
// and tells you what to do there in plain words.
export function WalkthroughWindow({ isOwner, onClose }: { isOwner: boolean; onClose: () => void }) {
  const guides = walkthroughsFor(isOwner);
  const [chosen, setChosen] = useState<Walkthrough | null>(null);
  const [index, setIndex] = useState(0);

  // Stays on top even when Windows tries to take it back.
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const appWindow = getCurrentWindow();
    const keep = () => { void appWindow.setAlwaysOnTop(true).catch(() => undefined); };
    keep();
    const timer = window.setInterval(keep, 2000);
    return () => window.clearInterval(timer);
  }, []);

  // Opening a step takes the main window with it.
  useEffect(() => {
    if (!chosen) return;
    const step = chosen.steps[clampStep(chosen, index)];
    if (step?.screen) void emit("mcg://go-to-screen", step.screen).catch(() => undefined);
    // A step can open the page you need and put the text you must paste on
    // your clipboard, so there is nothing to hunt for or type.
    if (step?.open) {
      void import("@tauri-apps/api/core")
        .then(({ invoke }) => invoke("open_url", { url: step.open }))
        .catch(() => undefined);
    }
    if (step?.copy) void navigator.clipboard?.writeText(step.copy).catch(() => undefined);
  }, [chosen, index]);

  function finish() {
    if (chosen) markCompleted(chosen.id);
    setChosen(null);
    setIndex(0);
  }

  if (!chosen) {
    return <main className="walk-shell" data-tauri-drag-region onMouseDown={(event) => {
      if ((event.target as HTMLElement).closest("button, input, textarea, select, a")) return;
      if ("__TAURI_INTERNALS__" in window) void getCurrentWindow().startDragging().catch(() => undefined);
    }}>
      <header className="walk-head"><strong>What can I help you set up?</strong><button className="walk-close" onClick={onClose}>✕</button></header>
      <div className="walk-list">
        {guides.map((guide) => <button key={guide.id} onClick={() => { setChosen(guide); setIndex(0); }}>
          <strong>{guide.name}</strong><small>{guide.why}</small>
        </button>)}
      </div>
    </main>;
  }

  const step = chosen.steps[clampStep(chosen, index)];
  const last = index >= chosen.steps.length - 1;
  return <main className="walk-shell" data-tauri-drag-region onMouseDown={(event) => {
    if ((event.target as HTMLElement).closest("button, input, textarea, select, a")) return;
    if ("__TAURI_INTERNALS__" in window) void getCurrentWindow().startDragging().catch(() => undefined);
  }}>
    <header className="walk-head">
      <strong>{chosen.name}</strong>
      <span className="walk-progress">{progressLine(chosen, index)}</span>
      <button className="walk-close" onClick={onClose}>✕</button>
    </header>
    {step.heads && <p className="walk-heads">{step.heads}</p>}
    <p className="walk-say">{step.say}</p>
    <div className="walk-actions">
      <button onClick={() => (index === 0 ? finish() : setIndex(index - 1))}>{index === 0 ? "Back To List" : "← Back"}</button>
      <button className="primary" onClick={() => (last ? finish() : setIndex(index + 1))}>{last ? "All Done" : "Next →"}</button>
    </div>
  </main>;
}

export { findWalkthrough };
