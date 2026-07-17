import { useEffect, useRef, useState } from "react";
import { BrowserSpeechPlayer } from "./speech";

// Highlight any text on the page, press this, and it is read aloud. Press
// again to stop. Used in the chat, file windows, and the reader.
export function ReadSelectionButton({ rate = 1 }: { rate?: number }) {
  const player = useRef(new BrowserSpeechPlayer());
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => () => player.current.stop(), []);
  function toggle() {
    if (speaking) { player.current.stop(); setSpeaking(false); return; }
    const chosen = window.getSelection()?.toString().trim();
    if (!chosen) return;
    setSpeaking(true);
    player.current.speak(chosen.slice(0, 8000), rate, () => setSpeaking(false), () => setSpeaking(false));
  }
  return <button
    className="text-button"
    // Keep the highlight alive: without this, clicking the button can collapse
    // the selection before we read it.
    onMouseDown={(event) => event.preventDefault()}
    onClick={toggle}
    title="Highlight any text, then press this to hear it"
  >{speaking ? "■ Stop Reading" : "🔊 Read Highlighted"}</button>;
}
