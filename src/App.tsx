import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LongRotMcpClient } from "./mcp";
import { contentHash, segmentDocument } from "./segmenter";
import { BrowserSpeechPlayer } from "./speech";
import { CommentRecorder } from "./recorder";
import { loadDocument, loadPosition, loadRecoverableComments, loadSavedComments, saveComment, saveDocument, savePosition } from "./storage";
import type { ConnectionSettings, DocumentRecord, ReaderComment, ReaderCopy } from "./types";

type Screen = "profile" | "library" | "reader" | "settings" | "comment" | "comments";
const USER_ID = "primary-reader";
const DEMO_TEXT = `Chapter 1\n\nThe rain had worked at the roof all night. By morning, every board in the house seemed to remember it.\n\nSilas stood at the window and watched the road disappear into Mourning Bend. He had promised himself he would not go back. The promise felt thinner in daylight.`;
const defaultSettings: ConnectionSettings = {
  endpoint: "__TAURI_INTERNALS__" in window ? "http://127.0.0.1:3000/mcp" : "/mcp",
  bearerToken: ""
};

function getSettings(): ConnectionSettings {
  try {
    return { ...defaultSettings, ...JSON.parse(localStorage.getItem("long-rot-connection") || "{}") };
  } catch {
    return defaultSettings;
  }
}

export function App() {
  const [readerName, setReaderName] = useState(() => localStorage.getItem("long-rot-reader-name") || "");
  const [screen, setScreen] = useState<Screen>(() => localStorage.getItem("long-rot-reader-name") ? "library" : "profile");
  const [settings, setSettings] = useState<ConnectionSettings>(getSettings);
  const [copies, setCopies] = useState<ReaderCopy[]>([]);
  const [document, setDocument] = useState<DocumentRecord | null>(null);
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [status, setStatus] = useState("Ready");
  const [loading, setLoading] = useState(false);
  const [comment, setComment] = useState<ReaderComment | null>(null);
  const [recoverable, setRecoverable] = useState<ReaderComment | null>(null);
  const [savedComments, setSavedComments] = useState<ReaderComment[]>([]);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [secondsRemaining, setSecondsRemaining] = useState(5);
  const player = useRef(new BrowserSpeechPlayer());
  const recorder = useRef(new CommentRecorder());
  const silenceDeadline = useRef(0);
  const silenceAllowance = useRef(5);
  const finishing = useRef(false);
  const indexRef = useRef(0);
  const documentRef = useRef<DocumentRecord | null>(null);
  const client = useMemo(() => new LongRotMcpClient(settings), [settings]);

  useEffect(() => {
    indexRef.current = segmentIndex;
    if (!document) return;
    void savePosition({
      id: `${USER_ID}:${document.id}`,
      userId: USER_ID,
      documentId: document.id,
      segmentIndex,
      updatedAt: new Date().toISOString()
    });
  }, [document, segmentIndex]);

  useEffect(() => () => player.current.stop(), []);

  useEffect(() => {
    void loadRecoverableComments().then((items) => setRecoverable(items[0] || null));
  }, []);

  useEffect(() => {
    if (screen !== "comment" || comment?.status !== "recording") return;
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((silenceDeadline.current - Date.now()) / 1000));
      setSecondsRemaining(remaining);
      if (remaining === 0 && !finishing.current) void finishComment();
    }, 250);
    return () => window.clearInterval(timer);
  }, [screen, comment?.status]);

  const speakAt = useCallback((index: number, activeDocument = documentRef.current) => {
    if (!activeDocument || !activeDocument.segments[index]) {
      setPlaying(false);
      setStatus("Finished");
      return;
    }
    setSegmentIndex(index);
    setPlaying(true);
    setStatus("Reading");
    player.current.speak(
      activeDocument.segments[index].text,
      rate,
      () => speakAt(indexRef.current + 1, activeDocument),
      () => {
        setPlaying(false);
        setStatus("Speech playback needs attention");
      }
    );
  }, [rate]);

  async function refreshCopies() {
    setLoading(true);
    setStatus("Connecting to project files…");
    try {
      const result = await client.listReaderCopies();
      setCopies(result);
      setStatus(result.length ? `${result.length} Reader Copies available` : "No Reader Copies found");
    } catch (error) {
      setStatus(`${message(error)} Nothing was changed.`);
    } finally {
      setLoading(false);
    }
  }

  async function openCopy(copy: ReaderCopy) {
    setLoading(true);
    setStatus("Opening Reader Copy…");
    try {
      const [content, revision] = await Promise.all([
        client.readText(copy.path),
        client.currentRevision(copy.path)
      ]);
      const hash = await contentHash(content);
      const id = `${copy.path}:${revision || hash}`;
      const record: DocumentRecord = {
        id,
        path: copy.path,
        name: copy.name,
        content,
        contentHash: hash,
        segments: segmentDocument(content),
        retrievedAt: new Date().toISOString()
      };
      await enterDocument(record);
    } catch (error) {
      setStatus(`${message(error)} Nothing was changed.`);
    } finally {
      setLoading(false);
    }
  }

  async function openDemo() {
    const hash = await contentHash(DEMO_TEXT);
    await enterDocument({
      id: `demo:${hash}`,
      path: "demo",
      name: "Sample Reader Copy",
      content: DEMO_TEXT,
      contentHash: hash,
      segments: segmentDocument(DEMO_TEXT),
      retrievedAt: new Date().toISOString()
    });
  }

  async function enterDocument(record: DocumentRecord) {
    const cached = await loadDocument(record.id);
    const chosen = cached || record;
    if (!cached) await saveDocument(record);
    const position = await loadPosition(USER_ID, chosen.id);
    documentRef.current = chosen;
    setDocument(chosen);
    setSegmentIndex(Math.min(position?.segmentIndex || 0, Math.max(0, chosen.segments.length - 1)));
    setStatus(position ? "Position restored" : "Ready to read");
    setScreen("reader");
  }

  function togglePlayback() {
    if (!document) return;
    if (playing && !player.current.paused) {
      player.current.pause();
      setPlaying(false);
      setStatus("Paused — position saved");
      return;
    }
    if (player.current.paused) {
      player.current.resume();
      setPlaying(true);
      setStatus("Reading");
      return;
    }
    speakAt(segmentIndex, document);
  }

  function moveBy(amount: number) {
    if (!document) return;
    player.current.stop();
    setPlaying(false);
    setSegmentIndex((current) => Math.max(0, Math.min(current + amount, document.segments.length - 1)));
    setStatus("Position saved");
  }

  function closeReader() {
    player.current.stop();
    setPlaying(false);
    documentRef.current = null;
    setDocument(null);
    setScreen("library");
    setStatus("Position saved on this device");
  }

  async function startComment() {
    if (!document) return;
    player.current.stop();
    setPlaying(false);
    const anchor = document.segments[segmentIndex];
    const now = new Date().toISOString();
    const draft: ReaderComment = {
      id: crypto.randomUUID(),
      userId: USER_ID,
      readerName,
      documentId: document.id,
      filePath: document.path,
      exactFilename: document.name,
      contentHash: document.contentHash,
      segmentIndex,
      paragraphIndex: anchor.paragraphIndex,
      sentenceIndex: anchor.sentenceIndex,
      charStart: anchor.charStart,
      charEnd: anchor.charEnd,
      anchorText: anchor.text,
      audio: null,
      audioMimeType: "",
      transcriptionOriginal: "",
      transcriptionConfirmed: "",
      category: "General Comment",
      status: "recording",
      silenceAllowanceSeconds: 5,
      createdAt: now,
      updatedAt: now
    };
    await saveComment(draft);
    setComment(draft);
    setRecoverable(draft);
    setLiveTranscript("");
    setSecondsRemaining(5);
    silenceAllowance.current = 5;
    silenceDeadline.current = Date.now() + 5000;
    setScreen("comment");
    try {
      await recorder.current.start(
        () => { silenceDeadline.current = Date.now() + silenceAllowance.current * 1000; },
        setLiveTranscript
      );
      setStatus("Recording comment");
    } catch (error) {
      const failed = { ...draft, status: "confirming" as const, updatedAt: new Date().toISOString() };
      await saveComment(failed);
      setComment(failed);
      setStatus(`${message(error)} You can type the comment instead. Your reading position is safe.`);
    }
  }

  async function finishComment() {
    if (!comment || finishing.current) return;
    finishing.current = true;
    try {
      const result = await recorder.current.stop();
      const transcription = result.transcription || liveTranscript;
      const updated: ReaderComment = {
        ...comment,
        audio: result.audio.size ? result.audio : comment.audio,
        audioMimeType: result.mimeType || comment.audioMimeType,
        transcriptionOriginal: transcription,
        transcriptionConfirmed: transcription,
        status: "confirming",
        updatedAt: new Date().toISOString()
      };
      await saveComment(updated);
      setComment(updated);
      setRecoverable(updated);
      setLiveTranscript(transcription);
      setStatus(result.audio.size ? "Recording saved on this device" : "Enter or confirm the comment text");
    } finally {
      finishing.current = false;
    }
  }

  async function addFiveSeconds() {
    if (!comment) return;
    const updated = {
      ...comment,
      silenceAllowanceSeconds: comment.silenceAllowanceSeconds + 5,
      updatedAt: new Date().toISOString()
    };
    silenceDeadline.current += 5000;
    silenceAllowance.current = updated.silenceAllowanceSeconds;
    setSecondsRemaining((value) => value + 5);
    setComment(updated);
    await saveComment(updated);
  }

  async function saveConfirmedComment() {
    if (!comment || !comment.transcriptionConfirmed.trim()) {
      setStatus("Please confirm the comment text before saving.");
      return;
    }
    const saved = { ...comment, status: "saved" as const, updatedAt: new Date().toISOString() };
    await saveComment(saved);
    setComment(null);
    setRecoverable(null);
    setScreen("reader");
    setStatus("Comment saved on this device — reading position preserved");
  }

  function updateCommentDraft(changes: Partial<ReaderComment>) {
    if (!comment) return;
    const updated = { ...comment, ...changes, updatedAt: new Date().toISOString() };
    setComment(updated);
    setRecoverable(updated);
    void saveComment(updated);
  }

  async function discardComment() {
    if (!comment) return;
    recorder.current.cancel();
    await saveComment({ ...comment, status: "discarded", updatedAt: new Date().toISOString() });
    setComment(null);
    setRecoverable(null);
    setScreen(document ? "reader" : "library");
    setStatus("Comment discarded. No project file was changed.");
  }

  async function resumeRecoverable() {
    if (!recoverable) return;
    const cached = await loadDocument(recoverable.documentId);
    if (!cached) {
      setStatus("The comment is safe, but its Reader Copy is not available on this device.");
      return;
    }
    documentRef.current = cached;
    setDocument(cached);
    setSegmentIndex(recoverable.segmentIndex);
    setComment({ ...recoverable, status: "confirming" });
    setLiveTranscript(recoverable.transcriptionConfirmed || recoverable.transcriptionOriginal);
    setScreen("comment");
    setStatus("Recovered comment and reading position");
  }

  function saveSettings(next: ConnectionSettings) {
    localStorage.setItem("long-rot-connection", JSON.stringify(next));
    setSettings(next);
    setScreen("library");
    setStatus("Connection settings saved on this device");
  }

  function saveProfile(name: string) {
    const clean = name.trim();
    if (!clean) return;
    localStorage.setItem("long-rot-reader-name", clean);
    setReaderName(clean);
    setScreen("library");
    setStatus(`Welcome, ${clean}`);
  }

  async function openSavedComments() {
    setSavedComments((await loadSavedComments()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    setScreen("comments");
  }

  function exportComments() {
    const records = savedComments.map(({ audio: _audio, ...record }) => ({
      ...record,
      audioPreservedOnThisDevice: Boolean(_audio?.size)
    }));
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), comments: records }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = `the-long-rot-comments-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (screen === "profile") {
    return <Profile initial={readerName} onContinue={saveProfile} />;
  }

  if (screen === "settings") {
    return <Settings initial={settings} onSave={saveSettings} onCancel={() => setScreen("library")} />;
  }

  if (screen === "comments") {
    return <main className="app-shell comments-shell">
      <header className="topbar"><button className="text-button" onClick={() => setScreen("library")}>← Reader Copies</button><span className="eyebrow">MY COMMENTS</span><span>{readerName}</span></header>
      <section className="comments-heading"><div><h1>Saved comments</h1><p>{savedComments.length} saved safely on this device.</p></div><button onClick={exportComments} disabled={!savedComments.length}>Export index</button></section>
      <section className="comments-list">
        {savedComments.length === 0 && <div className="empty-state"><strong>No comments yet</strong><p>Comments you confirm while reading will appear here.</p></div>}
        {savedComments.map((item) => <SavedCommentCard key={item.id} comment={item} />)}
      </section>
      <footer className="safe-status">No Reader Copy or official project file was changed.</footer>
    </main>;
  }

  if (screen === "comment" && comment) {
    const recording = comment.status === "recording";
    const audioUrl = comment.audio?.size ? URL.createObjectURL(comment.audio) : null;
    return <main className="app-shell comment-shell">
      <header className="topbar"><span className="eyebrow">READER COMMENT</span><span className="status-dot">Saved on this device</span></header>
      <section className="comment-heading">
        <p>{recording ? "Reading paused" : "Confirm your comment"}</p>
        <h1>{recording ? "Listening…" : "Did I capture that correctly?"}</h1>
        <blockquote>After: “{comment.anchorText}”</blockquote>
      </section>
      {recording ? <section className="recording-card">
        <div className="recording-pulse" aria-hidden="true" />
        <strong>Recording</strong>
        <p>{liveTranscript || "Speak naturally. Your original recording is preserved."}</p>
        <div className="silence-time"><span>Silence allowance</span><strong>{comment.silenceAllowanceSeconds} seconds</strong><small>{secondsRemaining} seconds remaining</small></div>
        <div className="comment-actions"><button className="add-time" onClick={addFiveSeconds}>+ Add 5 Seconds</button><button className="finish" onClick={finishComment}>Finish</button></div>
        <button className="discard-link" onClick={discardComment}>Cancel comment</button>
      </section> : <section className="confirmation-card">
        <label>Comment transcription<textarea value={comment.transcriptionConfirmed} onChange={(event) => updateCommentDraft({ transcriptionConfirmed: event.target.value })} rows={7} placeholder="Type the comment if automatic transcription is unavailable." /></label>
        <label>Comment type<select value={comment.category} onChange={(event) => updateCommentDraft({ category: event.target.value })}>{["General Comment", "Question", "Confusing", "Possible Error", "Favorite Part", "Character Issue", "Pacing Issue", "Continuity Issue"].map((category) => <option key={category}>{category}</option>)}</select></label>
        {audioUrl && <audio controls src={audioUrl}>Your browser cannot play this recording.</audio>}
        <div className="comment-actions"><button className="discard" onClick={discardComment}>Discard</button><button className="finish" onClick={saveConfirmedComment}>Save Comment</button></div>
      </section>}
      <footer className="safe-status">{status}</footer>
    </main>;
  }

  if (screen === "reader" && document) {
    const current = document.segments[segmentIndex];
    const progress = document.segments.length ? Math.round(((segmentIndex + 1) / document.segments.length) * 100) : 0;
    return (
      <main className="app-shell reader-shell">
        <header className="topbar">
          <button className="text-button" onClick={closeReader}>← Reader Copies</button>
          <span className="eyebrow">THE LONG ROT</span>
          <span className="status-dot" aria-label={status}>{status}</span>
        </header>
        <section className="reader-heading">
          <p className="eyebrow">Reader Copy</p>
          <h1>{cleanTitle(document.name)}</h1>
          <div className="progress-track" aria-label={`${progress}% complete`}><span style={{ width: `${progress}%` }} /></div>
          <p className="progress-label">{progress}% complete · Sentence {segmentIndex + 1} of {document.segments.length}</p>
        </section>
        <article className="reading-card" aria-live="polite">
          <p className="context">{document.segments[segmentIndex - 1]?.text}</p>
          <p className="current-sentence">{current?.text || "This file has no readable text."}</p>
          <p className="context">{document.segments[segmentIndex + 1]?.text}</p>
        </article>
        <section className="primary-controls" aria-label="Reading controls">
          <button className="control secondary" onClick={() => moveBy(-1)}>Back</button>
          <button className="control primary" onClick={togglePlayback}>{playing ? "Pause" : "Continue"}</button>
          <button className="control comment" onClick={startComment}>Comment</button>
        </section>
        <section className="secondary-controls">
          <button onClick={() => moveBy(-1)}>Repeat sentence</button>
          <button onClick={() => moveBy(1)}>Forward</button>
          <label>Speed
            <select value={rate} onChange={(event) => { player.current.stop(); setPlaying(false); setRate(Number(event.target.value)); }}>
              <option value="0.8">Slower</option><option value="1">Normal</option><option value="1.2">Faster</option>
            </select>
          </label>
        </section>
        <footer className="safe-status">{status}</footer>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <div><p className="eyebrow">THE LONG ROT</p><h1>Reader</h1><p>Choose a Reader Copy and continue where you left off.</p></div>
        <div className="header-actions"><button className="settings-button" onClick={openSavedComments}>My Comments</button><button className="settings-button" onClick={() => setScreen("settings")}>Connection</button><button className="profile-chip" onClick={() => setScreen("profile")}>{readerName}</button></div>
      </header>
      <section className="library-heading">
        <div><h2>Reader Copies</h2><p>{status}</p></div>
        <button className="refresh" onClick={refreshCopies} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
      </section>
      {recoverable && <section className="recovery-banner"><div><strong>Unfinished comment found</strong><p>Your recording and reading position are safe on this device.</p></div><button onClick={resumeRecoverable}>Recover</button></section>}
      <section className="copy-grid">
        {copies.map((copy) => (
          <button className="copy-card" key={copy.path} onClick={() => openCopy(copy)}>
            <span className="book-mark">LR</span><span><strong>{cleanTitle(copy.name)}</strong><small>Open Reader Copy</small></span><span aria-hidden="true">→</span>
          </button>
        ))}
        <button className="copy-card demo" onClick={openDemo}>
          <span className="book-mark">01</span><span><strong>Sample Reader Copy</strong><small>Try without connecting</small></span><span aria-hidden="true">→</span>
        </button>
      </section>
      <footer className="safe-status">No project files can be changed from this reader.</footer>
    </main>
  );
}

function Profile({ initial, onContinue }: { initial: string; onContinue: (name: string) => void }) {
  const [name, setName] = useState(initial);
  return <main className="app-shell profile-screen">
    <p className="eyebrow">THE LONG ROT</p><h1>Who is reading?</h1><p>Your name keeps every comment connected to the person who submitted it.</p>
    <label>Reader name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onContinue(name); }} /></label>
    <button className="continue-profile" disabled={!name.trim()} onClick={() => onContinue(name)}>Continue as {name.trim() || "reader"}</button>
  </main>;
}

function SavedCommentCard({ comment }: { comment: ReaderComment }) {
  const [audioUrl] = useState(() => comment.audio?.size ? URL.createObjectURL(comment.audio) : null);
  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);
  return <article className="saved-comment">
    <div className="comment-meta"><span>{comment.category}</span><time>{new Date(comment.createdAt).toLocaleString()}</time></div>
    <h2>{cleanTitle(comment.exactFilename)}</h2>
    <blockquote>“{comment.anchorText}”</blockquote>
    <p>{comment.transcriptionConfirmed}</p>
    <small>Paragraph {comment.paragraphIndex + 1}, sentence {comment.sentenceIndex + 1} · Submitted by {comment.readerName}</small>
    {audioUrl && <audio controls src={audioUrl}>Your browser cannot play this recording.</audio>}
  </article>;
}

function Settings({ initial, onSave, onCancel }: { initial: ConnectionSettings; onSave: (value: ConnectionSettings) => void; onCancel: () => void }) {
  const [endpoint, setEndpoint] = useState(initial.endpoint);
  const [bearerToken, setBearerToken] = useState(initial.bearerToken);
  return <main className="app-shell settings-panel">
    <p className="eyebrow">ADMINISTRATOR</p><h1>Project connection</h1>
    <p>Ordinary readers do not need this screen. Credentials stay on this device for the prototype.</p>
    <label>Connection address<input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} /></label>
    <label>Temporary bearer credential<input type="password" value={bearerToken} onChange={(event) => setBearerToken(event.target.value)} autoComplete="off" /></label>
    <p className="warning">For local development, use <code>/mcp</code> and configure the Vite proxy. Do not commit credentials.</p>
    <div className="form-actions"><button onClick={onCancel}>Cancel</button><button className="primary" onClick={() => onSave({ endpoint: endpoint.trim(), bearerToken })}>Save</button></div>
  </main>;
}

function cleanTitle(name: string): string {
  return name.replace(/\.txt$/i, "").replace(/\s+v\d+(?:\.\d+)*$/i, "");
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "The project connection failed.";
}
