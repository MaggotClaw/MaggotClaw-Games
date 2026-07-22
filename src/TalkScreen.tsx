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
import { entitiesMentioned, parseRegistry, storyContextBlock, type StoryBrain } from "./storyBrain";

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
  const sentWords = useRef("");
  const baselineResponseText = useRef("");
  const fallbackTick = useRef(0);
  // True while an answer is still being written. The reader must not decide it
  // has finished simply because it caught up with the words so far.
  const stillArriving = useRef(false);
  const playbackCycle = useRef(0);
  const segmentsRef = useRef<ResponsePlaybackSegment[]>([]);
  const liveDraftInFlight = useRef(false);
  const pendingLiveDraft = useRef("");
  const lastInsertedDraft = useRef("");
  const nativeSpeechActive = useRef(false);
  const nativeTranscript = useRef(new NativeTranscriptAssembler());
  const registryBrain = useRef<StoryBrain | "failed" | null>(null);
  const heardMicrophone = useRef(false);
  const manualTestText = useRef<string | null>(null);
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
      // Must match openCompanionWindow and the .voice-floater arithmetic in
      // styles.css. This runs on a timer, so a stale number here silently
      // undoes the fit a few hundred milliseconds after it is applied — which
      // is how the bar kept ending up too short for its own buttons.
      safe(() => appWindow.setSize(new LogicalSize(companion ? 652 : 404, 92)));
      safe(() => appWindow.setAlwaysOnTop(true));
      // Above full-screen programs too, not just ordinary windows.
      safe(() => appWindow.setVisibleOnAllWorkspaces(true));
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

  // The bar stays above EVERYTHING, always — a browser, a document, anything.
  // It used to hand back always-on-top whenever the AI program wasn't in front,
  // which is why other windows could cover it. Windows also quietly clears the
  // topmost flag when other programs grab it, so re-assert on a slow timer.
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const appWindow = getCurrentWindow();
    const keepOnTop = () => { void appWindow.setAlwaysOnTop(true).catch(() => undefined); };
    keepOnTop();
    const timer = window.setInterval(keepOnTop, 2000);
    return () => window.clearInterval(timer);
  }, []);

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
      console.log("[talk] native speech event:", JSON.stringify(event));
      updateLiveDraft(nativeTranscript.current.update(event));
    }).then(keep);
    void listenForNativeSpeechNotice((notice) => {
      if (nativeSpeechActive.current) {
        console.log("[talk] native speech notice:", notice);
        setStatus(notice);
      }
    }).then(keep);
    void listenForNativeSpeechLevel((level) => {
      if (!nativeSpeechActive.current) return;
      console.log("[talk] native speech level:", level);
      setAudioLevel(level);
      if (level > 3) heardMicrophone.current = true;
    }).then(keep);
    void listenForNativeSpeechError((error) => {
      if (!nativeSpeechActive.current) return;
      console.log("[talk] native speech error:", error);
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
        setStatus(result.ready ? `${result.name} connected — press Start Talking` : `TARGET NOT READY: ${result.detail || "unknown"}`);
        document.title = result.ready ? "READY" : "NOT READY";
        if (!result.ready) timer = window.setTimeout(check, 2000);
      }).catch((error) => {
        if (stopped) return;
        setStatus(`STATUS CHECK FAILED: ${message(error)}`);
        document.title = "STATUS FAILED";
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
      .catch((error) => setStatus(`SPEECH INIT FAILED: ${message(error)} — voice button unavailable`));
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
    // If Stop (or a new turn) bumps the cycle while a slow poll is mid-flight,
    // that poll must never start reading a reply afterwards.
    const cycle = playbackCycle.current;
    const timer = window.setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        const waited = Date.now() - waitingStarted.current;
        // After ten minutes, don't give up — long thinking runs are normal.
        // Just check more gently and keep the ▶ escape hatch alive.
        if (waited > 10 * 60 * 1000) {
          fallbackTick.current += 1;
          if (fallbackTick.current % 8 !== 0) return;
          setStatus(`${targetName} is taking a long time — I'm still watching, and ▶ reads whatever is there now.`);
        }
        const responseState = await adapter.responseState!();
        if (cycle !== playbackCycle.current) { window.clearInterval(timer); return; }
        if (responseState.busy) sawBusy.current = true;
        if (responseState.busy && waited < 60000) {
          // Read it while it is still being written, rather than waiting for
          // the whole answer and then starting from the top.
          if (adapter.streamingReply) {
            const growing = (await adapter.streamingReply().catch(() => "")).trim();
            if (cycle !== playbackCycle.current) { window.clearInterval(timer); return; }
            if (growing && growing !== sentWords.current && growing !== baselineResponseText.current) {
              stillArriving.current = true;
              takeStreamedText(growing);
            }
          }
          if (!segmentsRef.current.length) setStatus(`${targetName} is answering…`);
          return;
        }
        // Claude virtualizes its message list, so Copy-button counts are unreliable there;
        // the primary signal is the Stop button appearing and then going away.
        const finishedAfterBusy = sawBusy.current && !responseState.busy && responseState.hasCompletedResponse;
        const finishedByCount = !responseState.busy && responseState.hasCompletedResponse
          && responseState.completedResponseCount > baselineResponseCount.current
          // Two seconds, not eight. The count already proves a new answer
          // arrived; the long floor was only guarding against a miscount, and
          // it cost several silent seconds on every single reply.
          && waited > 2000;
        if (finishedAfterBusy || finishedByCount) {
          const latest = await adapter.readCopiedResponse();
          if (cycle !== playbackCycle.current) { window.clearInterval(timer); return; }
          // Never read our own just-sent words back as the answer.
          if (latest.trim() && latest.trim() !== sentWords.current) {
            window.clearInterval(timer);
            // Already part-way through reading it aloud — add the rest rather
            // than starting the whole answer again from the beginning.
            if (segmentsRef.current.length) finishStreamedText(latest);
            else { stillArriving.current = false; beginReply(latest); }
            return;
          }
        }
        // Self-rescue: if the buttons we watch were renamed by an app update,
        // neither signal above ever fires. After 15 quiet seconds (or one
        // minute even if something claims to be busy — a stray "Stop" control
        // must not gag us forever), peek at the latest copyable text — if it
        // is new, that IS the reply, so read it instead of sitting silent.
        if (waited > 15000) {
          fallbackTick.current += 1;
          if (fallbackTick.current % 5 === 0) {
            const latest = (await adapter.readCopiedResponse().catch(() => "")).trim();
            if (cycle !== playbackCycle.current) { window.clearInterval(timer); return; }
            if (latest && latest !== baselineResponseText.current && latest !== sentWords.current) {
              window.clearInterval(timer);
              beginReply(latest);
              return;
            }
            setStatus(`Still waiting for ${targetName} — press ▶ to read the reply if it looks finished.`);
          }
        }
      } catch (error) {
        setStatus(`${message(error)} I’ll keep checking.`);
      } finally {
        checking = false;
      }
    }, 300);
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
    const pressed = (window as { event?: { shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } } | null)?.event;
    if (pressed?.shiftKey || pressed?.altKey || pressed?.ctrlKey || pressed?.metaKey) {
      manualTestText.current = (pressed.shiftKey ? "HELLO FROM SHIFT TEST" : pressed.altKey ? "ALT TEST MESSAGE" : pressed.ctrlKey ? "CTRL TEST MESSAGE" : "META TEST MESSAGE");
    } else {
      manualTestText.current = null;
    }
    document.title = "START TALKING";
    // Clear the previous answer before the next one starts arriving, or its
    // leftover sentences would be counted as part of the new reply.
    stillArriving.current = false;
    segmentsRef.current = [];
    setSegments([]);
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

  // A short canon block for the names just mentioned, built from the local
  // ID Registry so the AI never guesses who someone is. Loaded once per bar.
  async function storyContext(words: string): Promise<string> {
    try {
      if (!registryBrain.current) {
        const { invoke } = await import("@tauri-apps/api/core");
        const docs = await invoke<Array<{ localRelativePath: string; status: string }>>("list_project_documents");
        const registry = docs
          .filter((doc) => doc.status === "downloaded" && /ID Registry/i.test(doc.localRelativePath))
          .sort((a, b) => b.localRelativePath.localeCompare(a.localRelativePath))[0];
        if (!registry) { registryBrain.current = "failed"; return ""; }
        const text = await invoke<string>("read_project_document", { localRelativePath: registry.localRelativePath });
        registryBrain.current = parseRegistry(text);
      }
      if (registryBrain.current === "failed") return "";
      return storyContextBlock(entitiesMentioned(registryBrain.current, words));
    } catch {
      return "";
    }
  }

  async function finishAndSend() {
    if (finishing.current) return;
    finishing.current = true;
    setState("sending");
    setStatus("Finishing your message…");
    document.title = "FINISH AND SEND";
    try {
      if (nativeSpeechActive.current) {
        await stopNativeDictation();
        await new Promise((resolve) => window.setTimeout(resolve, 250));
        nativeSpeechActive.current = false;
      }
      const result = await recorder.current.stop();
      let words = (result.transcription || transcriptRef.current || transcript).trim();
      if (manualTestText.current) {
        words = manualTestText.current;
        manualTestText.current = null;
        console.log("[talk] finishAndSend manual test text");
      }
      console.log("[talk] finishAndSend words=", JSON.stringify(words), "transcription=", JSON.stringify(result.transcription), "transcript=", JSON.stringify(transcript), "transcriptRef=", JSON.stringify(transcriptRef.current));
      if (!words) {
        await adapter.clearDraft?.();
        setState("sending");
        setStatus("No words heard — sending silent test message…");
        words = "(silent test)";
        document.title = "SILENT TEST";
      }
      if (!adapter.sendMessage || !adapter.responseState) throw new Error("Automatic Send requires the installed Windows companion.");
      baselineResponseCount.current = (await adapter.responseState()).completedResponseCount;
      sentWords.current = words;
      fallbackTick.current = 0;
      baselineResponseText.current = baselineResponseCount.current > 0
        ? (await adapter.readCopiedResponse().catch(() => "")).trim()
        : "";
      const outgoing = settings.includeStoryContext ? `${await storyContext(words)}${words}` : words;
      console.log("[talk] sending:", JSON.stringify(outgoing));
      await adapter.sendMessage(outgoing);
      sawBusy.current = false;
      waitingStarted.current = Date.now();
      setState("waiting");
      setStatus(`Sent — waiting for ${targetName} to answer…`);
      document.title = "WAITING";
    } catch (error) {
      console.log("[talk] finishAndSend error:", error);
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

  // Read while the words are still arriving.
  //
  // One sentence is always held back: the voices are synthesised per segment,
  // so starting on the very first sentence means she often finishes speaking
  // before the next has arrived, and a stall mid-answer sounds worse than
  // starting a beat later.
  function takeStreamedText(text: string) {
    const parts = responsePlaybackSegments(text, settings.skipContentBoxes);
    const usable = parts.slice(0, Math.max(0, parts.length - 1));
    if (usable.length <= segmentsRef.current.length) return;
    const wasEmpty = segmentsRef.current.length === 0;
    segmentsRef.current = usable;
    setSegments(usable);
    if (wasEmpty) {
      setState("response");
      if (settings.readRepliesAutomatically) {
        const cycle = ++playbackCycle.current;
        window.setTimeout(() => speakAt(0, cycle), 120);
      }
    }
  }

  // The finished answer is the authority on what was said, but never on what
  // was already read out: once spoken, spoken. Only the tail is added.
  function finishStreamedText(text: string) {
    stillArriving.current = false;
    const parts = responsePlaybackSegments(text, settings.skipContentBoxes);
    if (parts.length > segmentsRef.current.length) {
      const merged = segmentsRef.current.concat(parts.slice(segmentsRef.current.length));
      segmentsRef.current = merged;
      setSegments(merged);
    }
  }

  function speakAt(index: number, cycle = playbackCycle.current) {
    if (cycle !== playbackCycle.current) return;
    const segment = segmentsRef.current[index];
    if (!segment) {
      // Caught up with a reply that is still being written — wait for the next
      // sentence rather than announcing the end of an unfinished answer.
      if (stillArriving.current) {
        window.setTimeout(() => speakAt(index, cycle), 300);
        return;
      }
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

  // The escape hatch while waiting: grab whatever the latest reply is and read
  // it now, without waiting for the automatic detection. If the answer is
  // still being written, stay patient rather than reading the previous one.
  async function forceReadReply() {
    try {
      const busyNow = await adapter.responseState?.().then((s) => s.busy).catch(() => false);
      if (busyNow) {
        setStatus(`${targetName} is still answering — I'll read it the moment it finishes.`);
        return;
      }
      setStatus("Reading the latest reply…");
      const latest = (await adapter.readCopiedResponse()).trim();
      if (latest) beginReply(latest);
      else setStatus("There is no finished reply to read yet.");
    } catch (error) {
      setStatus(message(error));
    }
  }

  // Highlight text anywhere, drag it onto the bar, and she reads it aloud —
  // same voice, same pause/skip controls as a reply.
  function readDroppedText(text: string) {
    const clean = text.trim();
    if (!clean) return;
    const parts = responsePlaybackSegments(clean, settings.skipContentBoxes);
    if (!parts.length) return;
    const cycle = ++playbackCycle.current;
    recorder.current.cancel();
    player.current.stop();
    if (nativeSpeechActive.current) {
      nativeSpeechActive.current = false;
      void stopNativeDictation().catch(() => undefined);
    }
    segmentsRef.current = parts;
    setSegments(parts);
    setSegmentIndex(0);
    setState("response");
    setStatus("Reading what you dropped in");
    window.setTimeout(() => speakAt(0, cycle), 150);
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
    // Nothing more is coming, so the reader must not sit waiting for it.
    stillArriving.current = false;
    setState("idle");
    setStatus("Stopped — press Start Talking when you are ready");
  }


  const reading = state === "response";
  const listening = state === "recording";
  const busy = state === "starting" || state === "sending" || state === "waiting";
  console.log("[talk] state=", state, "targetReady=", targetReady, "speechReady=", speechReady, "busy=", busy, "listening=", listening, "buttonDisabled=", busy || !targetReady || !speechReady || listening);

  const waveHeights = [8, 11, 18, 24, 18, 11, 8];
  const liveScale = .25 + Math.min(1, audioLevel / 45);

  return <main className={`voice-floater ${companion ? "companion" : ""} ${listening ? "is-listening" : ""} ${reading ? "is-reading" : ""}`} title={status}
    onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }}
    onDrop={(event) => { event.preventDefault(); readDroppedText(event.dataTransfer.getData("text/plain")); }}
    data-tauri-drag-region onMouseDown={(event) => { if (!(event.target as HTMLElement).closest("button") && "__TAURI_INTERNALS__" in window) void getCurrentWindow().startDragging().catch(() => undefined); }}>
    <button className="icon-control main-mic" aria-label="Start talking" title="TALK TEST" disabled={busy || !targetReady || !speechReady || listening} onClick={startTalking} />
    <button className="icon-control" aria-label={`Add ${settings.addSeconds} seconds`} title={`Add ${settings.addSeconds} seconds`} disabled={!listening} onClick={addTime}>＋</button>
    <span className={`voice-wave ${listening && audioLevel <= 3 ? "no-mic-sound" : ""}`} aria-label={listening ? `Microphone level ${audioLevel}` : "Voice waveform"}>{waveHeights.map((height, index) => <i key={index} style={listening ? { height: `${Math.max(3, Math.round(height * liveScale))}px` } : undefined} />)}</span>
    <span className="countdown-display">{secondsRemaining.toFixed(1)}s</span>
    <span className="debug-state" style={{position:'absolute',bottom:'2px',left:'4px',fontSize:'9px',color:'#0f0',background:'#0008',padding:'1px 4px',borderRadius:'3px',pointerEvents:'none'}}>{state} | ready={String(targetReady)} speech={String(speechReady)}</span>
    <button className="icon-control send-control" aria-label="Send now" title="Send now" disabled={!listening} onClick={finishAndSend}>➤</button>
    <button className="icon-control" aria-label={playing ? "Pause reading" : "Continue reading"} title={state === "waiting" ? "Read the reply now" : playing ? "Pause" : "Play"} disabled={!reading && state !== "waiting"} onClick={() => { if (state === "waiting") void forceReadReply(); else pauseOrContinue(); }}>{playing ? "Ⅱ" : "▶"}</button>
    <button className="icon-control" aria-label="Skip reply" title="Skip reply" disabled={!reading} onClick={skipReply}>≫</button>
    <button className="icon-control" aria-label="Settings" title="Settings" onClick={onSettings}>⚙</button>
    {companion && <button className="icon-control close-control" aria-label="Close companion" title="Close companion" onClick={onBack}>✕</button>}
    <button className="icon-control stop-control" aria-label="Stop everything" title="Stop everything" disabled={state === "idle"} onClick={stopEverything}>■</button>
  </main>;
}

function message(error: unknown): string {
  return typeof error === "string" ? error : error instanceof Error ? error.message : "That operation could not be completed.";
}
