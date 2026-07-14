import { useEffect, useMemo, useRef, useState } from "react";
import { createCodexAdapter } from "./desktopConversation";
import { CommentRecorder } from "./recorder";
import { responseParagraphs } from "./responseSegments";
import { BrowserSpeechPlayer } from "./speech";

type CompanionState = "idle" | "recording" | "review" | "response";

export function TalkScreen({ readerName, onBack }: { readerName: string; onBack: () => void }) {
  const [state, setState] = useState<CompanionState>("idle");
  const [transcript, setTranscript] = useState("");
  const [response, setResponse] = useState("");
  const [paragraphIndex, setParagraphIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [allowance, setAllowance] = useState(5);
  const [secondsRemaining, setSecondsRemaining] = useState(5);
  const [status, setStatus] = useState("Ready — uses your existing Codex account and free Windows voices");
  const recorder = useRef(new CommentRecorder());
  const player = useRef(new BrowserSpeechPlayer());
  const silenceDeadline = useRef(0);
  const allowanceRef = useRef(5);
  const finishing = useRef(false);
  const adapter = useMemo(createCodexAdapter, []);
  const [targetReady, setTargetReady] = useState(false);
  const paragraphs = useMemo(() => responseParagraphs(response), [response]);

  useEffect(() => () => { recorder.current.cancel(); player.current.stop(); }, []);

  useEffect(() => {
    if (!adapter.status) { setTargetReady(false); return; }
    void adapter.status().then((result) => {
      setTargetReady(result.ready);
      setStatus(result.detail);
    }).catch((error) => setStatus(message(error)));
  }, [adapter]);

  useEffect(() => {
    if (state !== "recording") return;
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((silenceDeadline.current - Date.now()) / 1000));
      setSecondsRemaining(remaining);
      if (remaining === 0 && !finishing.current) void finishTalking();
    }, 250);
    return () => window.clearInterval(timer);
  }, [state]);

  async function startTalking() {
    player.current.stop();
    setPlaying(false);
    setTranscript("");
    setAllowance(5);
    allowanceRef.current = 5;
    setSecondsRemaining(5);
    silenceDeadline.current = Date.now() + 5000;
    try {
      await recorder.current.start(
        () => { silenceDeadline.current = Date.now() + allowanceRef.current * 1000; },
        setTranscript
      );
      setState("recording");
      setStatus("Listening — you can add more quiet time whenever you need it");
    } catch (error) {
      setState("review");
      setStatus(`${message(error)} You can type your message instead.`);
    }
  }

  async function finishTalking() {
    if (finishing.current) return;
    finishing.current = true;
    try {
      const result = await recorder.current.stop();
      setTranscript((current) => result.transcription || current);
      setState("review");
      setStatus("Check the words before putting them into Codex");
    } finally {
      finishing.current = false;
    }
  }

  function addFiveSeconds() {
    allowanceRef.current += 5;
    setAllowance(allowanceRef.current);
    setSecondsRemaining((current) => current + 5);
    silenceDeadline.current += 5000;
  }

  async function copyForCodex() {
    try {
      await adapter.insertDraft(transcript);
      setStatus(targetReady ? "Draft inserted into Codex. Check it there before pressing Send." : "Copied. Go to Codex, click its message box, and press Ctrl+V. Check it before sending.");
    } catch (error) { setStatus(message(error)); }
  }

  async function loadCopiedResponse() {
    try {
      const copied = await adapter.readCopiedResponse();
      setResponse(copied);
      setParagraphIndex(0);
      setState("response");
      setStatus("Response loaded — ready to read aloud");
    } catch (error) { setStatus(message(error)); }
  }

  function speakAt(index: number) {
    const paragraph = paragraphs[index];
    if (!paragraph) { setPlaying(false); setStatus("Finished reading"); return; }
    setParagraphIndex(index);
    setPlaying(true);
    setStatus(`Reading paragraph ${index + 1} of ${paragraphs.length}`);
    player.current.speak(paragraph, rate, () => speakAt(index + 1), () => {
      setPlaying(false);
      setStatus("Windows speech needs attention. The written response is still available.");
    });
  }

  function pauseOrContinue() {
    if (playing && !player.current.paused) {
      player.current.pause();
      setPlaying(false);
      setStatus("Paused");
    } else if (player.current.paused) {
      player.current.resume();
      setPlaying(true);
      setStatus("Continuing");
    } else speakAt(paragraphIndex);
  }

  function moveParagraph(amount: number) {
    player.current.stop();
    setPlaying(false);
    const next = Math.max(0, Math.min(paragraphIndex + amount, Math.max(0, paragraphs.length - 1)));
    setParagraphIndex(next);
    setStatus(`Paragraph ${next + 1} of ${paragraphs.length}`);
  }

  return <main className="app-shell talk-shell">
    <header className="topbar"><button className="text-button" onClick={onBack}>← Reader Mode</button><span className="eyebrow">WINDOWS CODEX COMPANION</span><span>{readerName}</span></header>
    <section className="target-banner"><strong>Target: {adapter.target.name}</strong><span>{targetReady ? "Connected" : "Clipboard fallback"} • No API key • No separate AI charge</span></section>

    {state === "idle" && <>
      <section className="talk-heading"><p className="eyebrow">VOICE INPUT</p><h1>Talk to Codex.</h1><p>Speak here, check the words, then move them safely into your current Codex task.</p></section>
      <button className="talk-button" onClick={startTalking}><span>●</span> Start Talking</button>
      <button className="load-response" onClick={loadCopiedResponse}>Read a Copied Codex Response</button>
    </>}

    {state === "recording" && <section className="talk-recording"><div className="recording-pulse"/><h1>I’m listening.</h1><p>{transcript || "Speak now…"}</p><div className="silence-time"><span>Quiet time allowed</span><strong>{allowance} seconds</strong><small>{secondsRemaining} seconds remaining</small></div><div className="companion-actions"><button onClick={addFiveSeconds}>+ Add 5 Seconds</button><button className="send-talk" onClick={finishTalking}>Finish</button></div></section>}

    {state === "review" && <section className="talk-review"><h1>Check your message.</h1><label>Your words<textarea value={transcript} onChange={(event) => setTranscript(event.target.value)} rows={7}/></label><div className="companion-actions"><button onClick={startTalking}>Start Over</button><button onClick={() => { recorder.current.cancel(); setState("idle"); setTranscript(""); }}>Cancel</button><button className="send-talk" onClick={copyForCodex}>{targetReady ? "Put Draft Into Codex" : "Copy for Codex"}</button></div><div className="next-step"><strong>Next:</strong> {targetReady ? "Check the message in Codex. It will not send until you press Codex’s Send button." : <>Open Codex, click the message box, press <kbd>Ctrl</kbd> + <kbd>V</kbd>, and check the message before sending it.</>}</div><button className="load-response" onClick={loadCopiedResponse}>{targetReady ? "Get Latest Codex Response and Read It" : "I Copied the Codex Response — Read It"}</button></section>}

    {state === "response" && <section className="answer-card"><p className="eyebrow">SPOKEN RESPONSE</p><h1>Paragraph {paragraphIndex + 1} of {Math.max(1, paragraphs.length)}</h1><p>{paragraphs[paragraphIndex] || response}</p><div className="playback-grid"><button onClick={() => moveParagraph(-1)}>Previous Paragraph</button><button className="send-talk" onClick={pauseOrContinue}>{playing ? "Pause" : player.current.paused ? "Continue" : "Read Aloud"}</button><button onClick={() => moveParagraph(1)}>Next Paragraph</button><button onClick={() => speakAt(paragraphIndex)}>Repeat Paragraph</button><button onClick={() => { player.current.stop(); setPlaying(false); setStatus("Stopped"); }}>Stop</button><button onClick={() => setRate((value) => Math.max(.6, value - .1))}>Slower</button><button onClick={() => setRate((value) => Math.min(1.8, value + .1))}>Faster</button><button className="send-talk" onClick={() => { player.current.stop(); setState("idle"); setResponse(""); setTranscript(""); }}>Talk Again</button></div><p className="speed-label">Voice speed: {rate.toFixed(1)}×</p></section>}

    <footer className="safe-status">{status}</footer>
  </main>;
}

function message(error: unknown): string {
  return typeof error === "string" ? error : error instanceof Error ? error.message : "That operation could not be completed.";
}
