import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useMemo, useRef, useState } from "react";
import { createCodexAdapter } from "./desktopConversation";
import { CommentRecorder } from "./recorder";
import { responsePlaybackSegments, type ResponsePlaybackSegment } from "./responseSegments";
import { BrowserSpeechPlayer } from "./speech";
import { loadVoiceSettings } from "./voiceSettings";

type CompanionState = "idle" | "recording" | "sending" | "waiting" | "response";

export function TalkScreen({ readerName, onBack, onSettings }: { readerName: string; onBack: () => void; onSettings: () => void }) {
  const settings = useMemo(() => loadVoiceSettings(readerName), [readerName]);
  const [state, setState] = useState<CompanionState>("idle");
  const [transcript, setTranscript] = useState("");
  const [segments, setSegments] = useState<ResponsePlaybackSegment[]>([]);
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(settings.silenceSeconds);
  const [status, setStatus] = useState("Ready — press Start Talking once");
  const [targetReady, setTargetReady] = useState(false);
  const [lastSkipped, setLastSkipped] = useState("");
  const recorder = useRef(new CommentRecorder());
  const player = useRef(new BrowserSpeechPlayer());
  const silenceDeadline = useRef(0);
  const heardWords = useRef(false);
  const finishing = useRef(false);
  const baselineResponse = useRef("");
  const sawBusy = useRef(false);
  const waitingStarted = useRef(0);
  const playbackCycle = useRef(0);
  const segmentsRef = useRef<ResponsePlaybackSegment[]>([]);
  const liveDraftTimer = useRef<number | null>(null);
  const adapter = useMemo(createCodexAdapter, []);

  useEffect(() => {
    localStorage.setItem("long-rot-companion-active", "true");
    if (!("__TAURI_INTERNALS__" in window)) return;
    const appWindow = getCurrentWindow();
    void appWindow.setAlwaysOnTop(true);
    void appWindow.setDecorations(false);
    void appWindow.setResizable(true).then(() => appWindow.setSize(new LogicalSize(230, 72))).then(() => appWindow.setResizable(false));
    return () => {
      void appWindow.setAlwaysOnTop(false);
      void appWindow.setDecorations(true);
      void appWindow.setResizable(true);
      void appWindow.setSize(new LogicalSize(1120, 820));
    };
  }, []);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window) || !adapter.targetForeground) return;
    const appWindow = getCurrentWindow();
    const timer = window.setInterval(() => {
      void adapter.targetForeground!().then((codexActive) => {
        void appWindow.setAlwaysOnTop(document.hasFocus() || codexActive);
      }).catch(() => undefined);
    }, 900);
    return () => window.clearInterval(timer);
  }, [adapter]);

  useEffect(() => () => {
    playbackCycle.current += 1;
    recorder.current.cancel();
    player.current.stop();
    if (liveDraftTimer.current !== null) window.clearTimeout(liveDraftTimer.current);
  }, []);

  useEffect(() => {
    if (!adapter.status) {
      setStatus("The automatic loop requires the installed Windows application.");
      return;
    }
    void adapter.status().then((result) => {
      setTargetReady(result.ready);
      setStatus(result.ready ? "Codex connected — press Start Talking" : result.detail);
    }).catch((error) => setStatus(message(error)));
  }, [adapter]);

  useEffect(() => {
    if (state !== "recording") return;
    const timer = window.setInterval(() => {
      if (!heardWords.current) {
        setSecondsRemaining(settings.silenceSeconds);
        return;
      }
      const remaining = Math.max(0, Math.ceil((silenceDeadline.current - Date.now()) / 100) / 10);
      setSecondsRemaining(remaining);
      if (remaining === 0 && !finishing.current) void finishAndSend();
    }, 100);
    return () => window.clearInterval(timer);
  }, [state, settings.silenceSeconds]);

  useEffect(() => {
    if (state !== "waiting" || !adapter.responseState) return;
    let checking = false;
    const timer = window.setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        const responseState = await adapter.responseState!();
        if (responseState.busy) {
          sawBusy.current = true;
          setStatus("Codex is answering…");
          return;
        }
        const oldEnough = Date.now() - waitingStarted.current > 2500;
        if ((sawBusy.current || oldEnough) && responseState.hasCompletedResponse) {
          const latest = await adapter.readCopiedResponse();
          if (latest.trim() && latest.trim() !== baselineResponse.current.trim()) {
            window.clearInterval(timer);
            beginReply(latest);
          }
        }
        if (Date.now() - waitingStarted.current > 10 * 60 * 1000) {
          window.clearInterval(timer);
          setState("idle");
          setStatus("Stopped waiting after ten minutes. Press Start Talking when ready.");
        }
      } catch (error) {
        setStatus(`${message(error)} I’ll keep checking.`);
      } finally {
        checking = false;
      }
    }, 1200);
    return () => window.clearInterval(timer);
  }, [state, adapter]);

  function updateLiveDraft(words: string) {
    setTranscript(words);
    if (!words.trim()) return;
    heardWords.current = true;
    silenceDeadline.current = Date.now() + settings.silenceSeconds * 1000;
    if (liveDraftTimer.current !== null) window.clearTimeout(liveDraftTimer.current);
    liveDraftTimer.current = window.setTimeout(() => {
      void adapter.insertDraft(words).catch((error) => setStatus(message(error)));
    }, 180);
  }

  async function startTalking() {
    if (state === "waiting" || state === "sending") return;
    playbackCycle.current += 1;
    player.current.stop();
    recorder.current.cancel();
    setPlaying(false);
    setTranscript("");
    heardWords.current = false;
    setSecondsRemaining(settings.silenceSeconds);
    silenceDeadline.current = Date.now() + settings.silenceSeconds * 1000;
    try {
      await adapter.clearDraft?.();
      await recorder.current.start(
        () => { if (heardWords.current) silenceDeadline.current = Date.now() + settings.silenceSeconds * 1000; },
        updateLiveDraft
      );
      setState("recording");
      setStatus("Listening — your words are appearing directly in Codex");
    } catch (error) {
      setState("idle");
      setStatus(`${message(error)} Microphone access is required.`);
    }
  }

  async function finishAndSend() {
    if (finishing.current) return;
    finishing.current = true;
    setState("sending");
    setStatus("Finishing your message…");
    try {
      const result = await recorder.current.stop();
      const words = (result.transcription || transcript).trim();
      if (!words) {
        await adapter.clearDraft?.();
        setState("idle");
        setStatus("I did not hear any words. Press Start Talking and try again.");
        return;
      }
      if (!adapter.sendMessage || !adapter.responseState) throw new Error("Automatic Send requires the installed Windows companion.");
      try { baselineResponse.current = await adapter.readCopiedResponse(); } catch { baselineResponse.current = ""; }
      await adapter.sendMessage(words);
      sawBusy.current = false;
      waitingStarted.current = Date.now();
      setState("waiting");
      setStatus("Sent — waiting for Codex to answer…");
    } catch (error) {
      setState("idle");
      setStatus(`${message(error)} Press Start Talking to try again.`);
    } finally {
      finishing.current = false;
    }
  }

  function addTime() {
    silenceDeadline.current += settings.addSeconds * 1000;
    setSecondsRemaining((current) => Math.round((current + settings.addSeconds) * 10) / 10);
  }

  function beginReply(text: string) {
    const parts = responsePlaybackSegments(text, settings.skipContentBoxes);
    if (!parts.length) {
      setState("idle");
      setStatus("The Codex response was empty. Press Start Talking to continue.");
      return;
    }
    segmentsRef.current = parts;
    setSegments(parts);
    setSegmentIndex(0);
    setState("response");
    if (settings.readRepliesAutomatically) {
      const cycle = ++playbackCycle.current;
      window.setTimeout(() => speakAt(0, cycle), 250);
    } else {
      setStatus("Reply ready — press Read Reply or Start Talking");
    }
  }

  function speakAt(index: number, cycle = playbackCycle.current) {
    if (cycle !== playbackCycle.current) return;
    const segment = segmentsRef.current[index];
    if (!segment) {
      setPlaying(false);
      if (settings.listenAfterReading) {
        setStatus("Finished reading — listening again…");
        window.setTimeout(() => { if (cycle === playbackCycle.current) void startTalking(); }, 650);
      } else {
        setState("idle");
        setStatus("Finished reading — press Start Talking when ready");
      }
      return;
    }
    if (segment.kind === "skipped" && segment.hiddenText) setLastSkipped(segment.hiddenText);
    setSegmentIndex(index);
    setPlaying(true);
    setStatus(`Reading part ${index + 1} of ${segmentsRef.current.length}`);
    player.current.speak(segment.spokenText, settings.speechRate, () => speakAt(index + 1, cycle), () => {
      setPlaying(false);
      setStatus("Windows speech stopped. Press Continue, Read Again, or Start Talking.");
    });
  }

  function pauseOrContinue() {
    if (playing && !player.current.paused) {
      player.current.pause(); setPlaying(false); setStatus("Reading paused");
    } else if (player.current.paused) {
      player.current.resume(); setPlaying(true); setStatus("Reading continued");
    } else speakAt(segmentIndex);
  }

  function movePart(amount: number) {
    playbackCycle.current += 1;
    player.current.stop();
    const next = Math.max(0, Math.min(segmentIndex + amount, Math.max(0, segments.length - 1)));
    setSegmentIndex(next);
    segmentsRef.current = segments;
    speakAt(next, playbackCycle.current);
  }

  function readSkippedBox() {
    if (!lastSkipped) return;
    playbackCycle.current += 1;
    player.current.stop();
    setPlaying(true);
    setStatus("Reading the skipped content box");
    const cycle = playbackCycle.current;
    player.current.speak(lastSkipped, settings.speechRate, () => speakAt(segmentIndex + 1, cycle), () => setPlaying(false));
  }

  function skipReply() {
    playbackCycle.current += 1;
    player.current.stop();
    setPlaying(false);
    if (settings.listenAfterReading) void startTalking();
    else { setState("idle"); setStatus("Reply skipped — press Start Talking when ready"); }
  }

  function stopEverything() {
    playbackCycle.current += 1;
    recorder.current.cancel();
    player.current.stop();
    if (liveDraftTimer.current !== null) window.clearTimeout(liveDraftTimer.current);
    if (state === "recording" || state === "sending") void adapter.clearDraft?.();
    setPlaying(false);
    setTranscript("");
    setState("idle");
    setStatus("Stopped — press Start Talking when you are ready");
  }

  function leaveCompanion() {
    localStorage.removeItem("long-rot-companion-active");
    stopEverything();
    onBack();
  }

  const reading = state === "response";
  const listening = state === "recording";
  const busy = state === "sending" || state === "waiting";
  const current = segments[segmentIndex];

  const stateLabel = listening ? heardWords.current ? `${secondsRemaining.toFixed(1)}s` : "Listening" : busy ? "Waiting" : reading ? current?.kind === "skipped" ? "Box skipped" : `Reading ${segmentIndex + 1}/${segments.length}` : targetReady ? "Ready" : "No Codex";
  return <main className={`voice-floater ${listening ? "is-listening" : ""} ${reading ? "is-reading" : ""}`} title={status}>
    <button className="drag-handle" aria-label="Move voice bar" title="Drag to move" onPointerDown={() => { if ("__TAURI_INTERNALS__" in window) void getCurrentWindow().startDragging(); }}>⠿</button>
    <button className="icon-control" aria-label="Targets" title="Targets" onClick={leaveCompanion}>⌂</button>
    <button className="icon-control main-mic" aria-label={reading ? playing ? "Pause reading" : "Continue reading" : "Start talking"} title={reading ? playing ? "Pause" : "Continue" : "Talk"} disabled={busy || (!reading && (!targetReady || listening))} onClick={reading ? pauseOrContinue : startTalking}>{reading ? playing ? "Ⅱ" : "▶" : listening ? "●" : "🎙"}</button>
    <button className="icon-control" aria-label={`Add ${settings.addSeconds} seconds`} title={`Add ${settings.addSeconds} seconds`} disabled={!listening} onClick={addTime}>＋</button>
    <button className="icon-control" aria-label="Send now or next part" title={listening ? "Send now" : "Next part"} disabled={!listening && !reading} onClick={listening ? finishAndSend : () => movePart(1)}>{listening ? "➤" : "≫"}</button>
    <button className="icon-control" aria-label="Repeat or read skipped box" title={lastSkipped && reading ? "Read skipped box" : "Repeat"} disabled={!reading} onClick={lastSkipped && reading ? readSkippedBox : () => speakAt(segmentIndex)}>↻</button>
    <button className="icon-control" aria-label="Skip reply" title="Skip reply" disabled={!reading} onClick={skipReply}>≫|</button>
    <button className="icon-control stop-control" aria-label="Stop everything" title="Stop everything" disabled={state === "idle"} onClick={stopEverything}>■</button>
    <button className="icon-control" aria-label="Settings" title="Settings" onClick={onSettings}>⚙</button>
    <span className="floater-state">{stateLabel}</span>
  </main>;
}

function message(error: unknown): string {
  return typeof error === "string" ? error : error instanceof Error ? error.message : "That operation could not be completed.";
}
