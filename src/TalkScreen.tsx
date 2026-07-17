import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useMemo, useRef, useState } from "react";
import { createConversationAdapter } from "./desktopConversation";
import { deadlineAfterSpeech } from "./countdown";
import { listenForNativeSpeech, listenForNativeSpeechError, listenForNativeSpeechLevel, listenForNativeSpeechNotice, NativeTranscriptAssembler, prepareNativeDictation, startNativeDictation, stopNativeDictation } from "./nativeSpeech";
import { CommentRecorder } from "./recorder";
import { responsePlaybackSegments, type ResponsePlaybackSegment } from "./responseSegments";
import { BrowserSpeechPlayer } from "./speech";
import { loadVoiceSettings } from "./voiceSettings";

type CompanionState = "idle" | "starting" | "recording" | "sending" | "waiting" | "response";

export function TalkScreen({ readerName, onBack, onSettings, companion = false }: { readerName: string; onBack: () => void; onSettings: () => void; companion?: boolean }) {
  const settings = useMemo(() => loadVoiceSettings(readerName), [readerName]);
  const [state, setState] = useState<CompanionState>("idle");
  const [transcript, setTranscript] = useState("");
  const [segments, setSegments] = useState<ResponsePlaybackSegment[]>([]);
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(settings.silenceSeconds);
  const [status, setStatus] = useState("Ready — press Start Talking once");
  const [targetName, setTargetName] = useState("the AI program");
  const [targetReady, setTargetReady] = useState(false);
  const [speechReady, setSpeechReady] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [lastSkipped, setLastSkipped] = useState("");
  const recorder = useRef(new CommentRecorder());
  const player = useRef(new BrowserSpeechPlayer());
  const silenceDeadline = useRef(0);
  const lastVoiceAt = useRef(0);
  const heardWords = useRef(false);
  const finishing = useRef(false);
  const baselineResponseCount = useRef(0);
  const transcriptRef = useRef("");
  const sawBusy = useRef(false);
  const waitingStarted = useRef(0);
  const playbackCycle = useRef(0);
  const segmentsRef = useRef<ResponsePlaybackSegment[]>([]);
  const liveDraftInFlight = useRef(false);
  const pendingLiveDraft = useRef("");
  const lastInsertedDraft = useRef("");
  const nativeSpeechActive = useRef(false);
  const nativeTranscript = useRef(new NativeTranscriptAssembler());
  const heardMicrophone = useRef(false);
  const adapter = useMemo(() => createConversationAdapter(settings.target), [settings.target]);

  useEffect(() => {
    localStorage.setItem("long-rot-companion-active", "true");
    if (!("__TAURI_INTERNALS__" in window)) return;
    const appWindow = getCurrentWindow();
    // On a cold start straight into companion mode this effect runs before the
    // WebView2 window is ready, so the first resize is silently dropped and the
    // bar is stranded in a full-size, decorated window. Re-apply on a timer for
    // the first few seconds — fire-and-forget, never awaiting a call that could
    // hang while the window is still busy loading. One attempt lands once ready.
    const safe = (run: () => Promise<unknown>) => { void run().catch(() => undefined); };
    const applyCompact = () => {
      safe(() => appWindow.unmaximize());
      safe(() => appWindow.setDecorations(false));
      safe(() => appWindow.setShadow(false));
      safe(() => appWindow.setResizable(true));
      // The companion window is wider: its extra Close button needs room to
      // clear the oval's rounded right end. This runs on a timer, so it must
      // match the width the window was created with or it undoes the fix.
      safe(() => appWindow.setSize(new LogicalSize(companion ? 690 : 566, 96)));
      safe(() => appWindow.setAlwaysOnTop(true));
    };
    applyCompact();
    let ticks = 0;
    const resizeTimer = window.setInterval(() => {
      applyCompact();
      if (++ticks >= 20) window.clearInterval(resizeTimer);
    }, 300);
    return () => {
      window.clearInterval(resizeTimer);
      // In its own dedicated window, closing destroys the companion, so never
      // grow it back to full size. Only the old single-window mode restores.
      if (companion) return;
      void appWindow.setAlwaysOnTop(false);
      void appWindow.setDecorations(true);
      void appWindow.setShadow(true);
      void appWindow.setResizable(true);
      void appWindow.setSize(new LogicalSize(1120, 820));
    };
  }, []);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window) || !adapter.targetForeground) return;
    const appWindow = getCurrentWindow();
    const timer = window.setInterval(() => {
      void adapter.targetForeground!().then((targetActive) => {
        void appWindow.setAlwaysOnTop(document.hasFocus() || targetActive);
      }).catch(() => undefined);
    }, 900);
    return () => window.clearInterval(timer);
  }, [adapter]);

  useEffect(() => () => {
    playbackCycle.current += 1;
    recorder.current.cancel();
    player.current.stop();
  }, []);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let disposed = false;
    const removeListeners: Array<() => void> = [];
    const keep = (remove: () => void) => { if (disposed) remove(); else removeListeners.push(remove); };
    void listenForNativeSpeech((event) => {
      if (!nativeSpeechActive.current) return;
      updateLiveDraft(nativeTranscript.current.update(event));
    }).then(keep);
    void listenForNativeSpeechNotice((notice) => {
      if (nativeSpeechActive.current) setStatus(notice);
    }).then(keep);
    void listenForNativeSpeechLevel((level) => {
      if (!nativeSpeechActive.current) return;
      setAudioLevel(level);
      if (level > 3) heardMicrophone.current = true;
    }).then(keep);
    void listenForNativeSpeechError((error) => {
      if (!nativeSpeechActive.current) return;
      nativeSpeechActive.current = false;
      recorder.current.cancel();
      setState("idle");
      setStatus(`${error} Press Start Talking to try again.`);
    }).then(keep);
    return () => { disposed = true; removeListeners.forEach((remove) => remove()); };
  }, []);

  useEffect(() => {
    if (!adapter.status) {
      setSpeechReady(true);
      setStatus("The automatic loop requires the installed Windows application.");
      return;
    }
    let stopped = false;
    let timer = 0;
    const check = () => {
      void adapter.status!().then((result) => {
        if (stopped) return;
        setTargetReady(result.ready);
        if (result.name) setTargetName(result.name);
        setStatus(result.ready ? `${result.name} connected — press Start Talking` : result.detail);
        if (!result.ready) timer = window.setTimeout(check, 2000);
      }).catch((error) => {
        if (stopped) return;
        setStatus(message(error));
        timer = window.setTimeout(check, 2000);
      });
    };
    check();
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [adapter]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    void prepareNativeDictation()
      .then(() => setSpeechReady(true))
      .catch((error) => setStatus(`${message(error)} The voice button is unavailable.`));
  }, []);

  useEffect(() => {
    if (state !== "recording") return;
    const noSoundTimer = window.setTimeout(() => {
      if (!heardMicrophone.current) setStatus("No microphone sound is reaching the app. Windows may be using a different microphone.");
    }, 3000);
    const timer = window.setInterval(() => {
      if (!heardWords.current) {
        setSecondsRemaining(settings.silenceSeconds);
        return;
      }
      const now = Date.now();
      // New speech guarantees at least the normal silence allowance, but never
      // throws away time the user added with the + button.
      if (now - lastVoiceAt.current < 400) {
        silenceDeadline.current = deadlineAfterSpeech(silenceDeadline.current, now, settings.silenceSeconds);
      }
      const remaining = Math.max(0, Math.ceil((silenceDeadline.current - now) / 100) / 10);
      setSecondsRemaining(remaining);
      if (remaining === 0 && !finishing.current) void finishAndSend();
    }, 100);
    return () => { window.clearInterval(timer); window.clearTimeout(noSoundTimer); };
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
          setStatus(`${targetName} is answering…`);
          return;
        }
        // Claude virtualizes its message list, so Copy-button counts are unreliable there;
        // the primary signal is the Stop button appearing and then going away.
        const finishedAfterBusy = sawBusy.current && responseState.hasCompletedResponse;
        const finishedByCount = responseState.hasCompletedResponse
          && responseState.completedResponseCount > baselineResponseCount.current
          && Date.now() - waitingStarted.current > 8000;
        if (finishedAfterBusy || finishedByCount) {
          const latest = await adapter.readCopiedResponse();
          if (latest.trim()) {
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
  }, [state, adapter, targetName]);

  function updateLiveDraft(words: string) {
    setTranscript(words);
    transcriptRef.current = words;
    if (!words.trim()) return;
    heardWords.current = true;
    lastVoiceAt.current = Date.now();
    silenceDeadline.current = deadlineAfterSpeech(silenceDeadline.current, Date.now(), settings.silenceSeconds);
    pendingLiveDraft.current = words;
    void flushLiveDraft();
  }

  async function flushLiveDraft() {
    if (liveDraftInFlight.current) return;
    const words = pendingLiveDraft.current.trim();
    if (!words || words === lastInsertedDraft.current) return;
    pendingLiveDraft.current = "";
    liveDraftInFlight.current = true;
    try {
      await adapter.insertDraft(words);
      lastInsertedDraft.current = words;
    } catch (error) {
      setStatus(message(error));
    } finally {
      liveDraftInFlight.current = false;
      if (pendingLiveDraft.current.trim() && pendingLiveDraft.current.trim() !== lastInsertedDraft.current) void flushLiveDraft();
    }
  }

  async function startTalking() {
    if (state === "starting" || state === "waiting" || state === "sending") return;
    const startCycle = ++playbackCycle.current;
    player.current.stop();
    recorder.current.cancel();
    setPlaying(false);
    setTranscript("");
    transcriptRef.current = "";
    pendingLiveDraft.current = "";
    lastInsertedDraft.current = "";
    nativeTranscript.current.reset();
    heardWords.current = false;
    heardMicrophone.current = false;
    lastVoiceAt.current = 0;
    setAudioLevel(0);
    setSecondsRemaining(settings.silenceSeconds);
    silenceDeadline.current = Date.now() + settings.silenceSeconds * 1000;
    setState("starting");
    setStatus(`Preparing the microphone and ${targetName}…`);
    try {
      await adapter.clearDraft?.();
      if (startCycle !== playbackCycle.current) return;
      let useNativeSpeech = false;
      if ("__TAURI_INTERNALS__" in window) {
        try {
          nativeSpeechActive.current = true;
          await startNativeDictation();
          if (startCycle !== playbackCycle.current) {
            nativeSpeechActive.current = false;
            await stopNativeDictation().catch(() => undefined);
            return;
          }
          useNativeSpeech = true;
        } catch (error) {
          nativeSpeechActive.current = false;
          setStatus(`${message(error)} Using the backup speech engine.`);
        }
      }
      if (!useNativeSpeech) {
        await recorder.current.start(
          () => { if (heardWords.current) { lastVoiceAt.current = Date.now(); silenceDeadline.current = deadlineAfterSpeech(silenceDeadline.current, Date.now(), settings.silenceSeconds); } },
          updateLiveDraft,
          true
        );
      }
      if (startCycle !== playbackCycle.current) return;
      setState("recording");
      setStatus(`Listening — your words are appearing directly in ${targetName}`);
    } catch (error) {
      if (startCycle !== playbackCycle.current) return;
      nativeSpeechActive.current = false;
      void stopNativeDictation().catch(() => undefined);
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
      if (nativeSpeechActive.current) {
        await stopNativeDictation();
        await new Promise((resolve) => window.setTimeout(resolve, 250));
        nativeSpeechActive.current = false;
      }
      const result = await recorder.current.stop();
      const words = (result.transcription || transcriptRef.current || transcript).trim();
      if (!words) {
        await adapter.clearDraft?.();
        setState("idle");
        setStatus("I did not hear any words. Press Start Talking and try again.");
        return;
      }
      if (!adapter.sendMessage || !adapter.responseState) throw new Error("Automatic Send requires the installed Windows companion.");
      baselineResponseCount.current = (await adapter.responseState()).completedResponseCount;
      await adapter.sendMessage(words);
      sawBusy.current = false;
      waitingStarted.current = Date.now();
      setState("waiting");
      setStatus(`Sent — waiting for ${targetName} to answer…`);
    } catch (error) {
      setState("idle");
      setStatus(`${message(error)} Press Start Talking to try again.`);
    } finally {
      finishing.current = false;
    }
  }

  function addTime() {
    // Added time is a protected reprieve. Further speech cannot erase it.
    silenceDeadline.current += settings.addSeconds * 1000;
    setSecondsRemaining((current) => Math.round((current + settings.addSeconds) * 10) / 10);
  }

  function beginReply(text: string) {
    const parts = responsePlaybackSegments(text, settings.skipContentBoxes);
    if (!parts.length) {
      setState("idle");
      setStatus(`The ${targetName} response was empty. Press Start Talking to continue.`);
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
    nativeSpeechActive.current = false;
    setAudioLevel(0);
    void stopNativeDictation().catch(() => undefined);
    if (state === "starting" || state === "recording" || state === "sending") void adapter.clearDraft?.();
    setPlaying(false);
    setTranscript("");
    setState("idle");
    setStatus("Stopped — press Start Talking when you are ready");
  }


  const reading = state === "response";
  const listening = state === "recording";
  const busy = state === "starting" || state === "sending" || state === "waiting";

  const waveHeights = [8, 11, 18, 24, 18, 11, 8];
  const liveScale = .25 + Math.min(1, audioLevel / 45);

  return <main className={`voice-floater ${companion ? "companion" : ""} ${listening ? "is-listening" : ""} ${reading ? "is-reading" : ""}`} title={status} onPointerDown={(event) => { if (!(event.target as HTMLElement).closest("button") && "__TAURI_INTERNALS__" in window) { event.preventDefault(); void getCurrentWindow().startDragging(); } }}>
    <button className="icon-control main-mic" aria-label="Start talking" title="Talk" disabled={busy || !targetReady || !speechReady || listening} onClick={startTalking} />
    <button className="icon-control" aria-label={`Add ${settings.addSeconds} seconds`} title={`Add ${settings.addSeconds} seconds`} disabled={!listening} onClick={addTime}>＋</button>
    <span className={`voice-wave ${listening && audioLevel <= 3 ? "no-mic-sound" : ""}`} aria-label={listening ? `Microphone level ${audioLevel}` : "Voice waveform"}>{waveHeights.map((height, index) => <i key={index} style={listening ? { height: `${Math.max(3, Math.round(height * liveScale))}px` } : undefined} />)}</span>
    <span className="countdown-display">{secondsRemaining.toFixed(1)}s</span>
    <button className="icon-control send-control" aria-label="Send now" title="Send now" disabled={!listening} onClick={finishAndSend}>➤</button>
    <button className="icon-control" aria-label={playing ? "Pause reading" : "Continue reading"} title={playing ? "Pause" : "Play"} disabled={!reading} onClick={pauseOrContinue}>{playing ? "Ⅱ" : "▶"}</button>
    <button className="icon-control" aria-label="Skip reply" title="Skip reply" disabled={!reading} onClick={skipReply}>≫</button>
    <button className="icon-control stop-control" aria-label="Stop everything" title="Stop everything" disabled={state === "idle"} onClick={stopEverything}>■</button>
    <button className="icon-control" aria-label="Settings" title="Settings" onClick={onSettings}>⚙</button>
    {companion && <button className="icon-control close-control" aria-label="Close companion" title="Close companion" onClick={onBack}>✕</button>}
  </main>;
}

function message(error: unknown): string {
  return typeof error === "string" ? error : error instanceof Error ? error.message : "That operation could not be completed.";
}
