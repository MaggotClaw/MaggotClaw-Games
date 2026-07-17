import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LongRotMcpClient } from "./mcp";
import { contentHash, segmentDocument, unwrapHardLines } from "./segmenter";
import { BrowserSpeechPlayer } from "./speech";
import { CommentRecorder } from "./recorder";
import { TalkScreen } from "./TalkScreen";
import { ProjectExplorer } from "./ProjectExplorer";
import { deleteComment, loadDocument, loadPosition, loadRecoverableComments, loadSavedComments, saveComment, saveDocument, savePosition } from "./storage";
import type { ConnectionSettings, DocumentRecord, ReaderComment } from "./types";
import { loadVoiceSettings, saveVoiceSettings, type VoiceSettings } from "./voiceSettings";
import { downloadProject, formatWorkspaceTime, initializeWorkspace, openWorkspace, workspaceStatus, type DownloadProgress, type WorkspaceStatus } from "./projectWorkspace";
import { canPerform, profileRole, realProfileRole, getViewAs, setViewAs, roleLabel, ROLE_ORDER, setProfileRole, type ProjectRole } from "./permissions";
import { decideAccessRequest, pendingRequests, submitAccessRequest, type AccessRequest } from "./accessRequests";
import { makeRequestCode, makeUnlockCode, parseRequestCode, parseUnlockCode, unlockMatchesProfile } from "./accessCodes";
import { isChapterUnlocked, loadUnlockedChapters, readerCopies } from "./readerCopies";
import type { ParsedDoc, ProjectDocument } from "./projectDocs";
import { invoke } from "@tauri-apps/api/core";
import { UpdateChecker } from "./UpdateChecker";
import { ChatScreen } from "./ChatScreen";
import { getDiscordName, setDiscordName, getRequestWebhook, setRequestWebhook, isDiscordWebhook, requestAnnouncement, sendRequestToDiscord, fetchDiscordRequests, postUnlockToDiscord, markMessageHandled, discordReadingConfigured, getBotToken, setBotToken, getRequestsChannelId, setRequestsChannelId, type DiscordRequestMessage } from "./discordLink";

type Screen = "profile" | "home" | "projects" | "project-workspace" | "project-explorer" | "project-zero" | "project-review" | "library" | "reader" | "settings" | "comment" | "comments" | "talk" | "voice-targets" | "dashboard" | "request-access" | "unlock" | "chat" | "directions";

function BrandLogo({ compact = false }: { compact?: boolean }) {
  return <img className={compact ? "brand-logo compact" : "brand-logo"} src="/maggotclaw-modern.png" alt="MaggotClaw Games" />;
}

// The hub banner: the MaggotClaw mark with the app version tucked in its corner.
function BannerWithVersion() {
  const [version, setVersion] = useState("");
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) { setVersion("dev"); return; }
    void import("@tauri-apps/api/app").then(({ getVersion }) => getVersion()).then(setVersion).catch(() => undefined);
  }, []);
  return <div className="banner-block">
    <img className="brand-logo banner" src="/maggotclaw-modern.png" alt="MaggotClaw Games" />
    {version && <span className="banner-version">v{version}</span>}
  </div>;
}
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

// The Voice Companion runs in its own small window loaded with the "#companion"
// URL hash, so the main hub window stays open and visible behind it.
const WINDOW_HASH = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
// A chapter or file opened in its own window carries its path in the hash.
const DOC_WINDOW_PATH = WINDOW_HASH.startsWith("doc:") ? decodeURIComponent(WINDOW_HASH.slice(4)) : null;
const FILE_WINDOW_PATH = WINDOW_HASH.startsWith("file:") ? decodeURIComponent(WINDOW_HASH.slice(5)) : null;

function windowLabelFor(prefix: string, relative: string): string {
  let hash = 5381;
  for (let i = 0; i < relative.length; i += 1) hash = ((hash * 33) ^ relative.charCodeAt(i)) >>> 0;
  return prefix + "-" + hash.toString(36);
}

// Every chapter or file opens in its own window, so several can sit side by side.
export async function openContentWindow(kind: "doc" | "file", relative: string, title: string): Promise<void> {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const label = windowLabelFor(kind, relative);
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    try { await existing.show(); await existing.setFocus(); } catch { /* ignore */ }
    return;
  }
  // eslint-disable-next-line no-new
  new WebviewWindow(label, {
    url: "index.html#" + kind + ":" + encodeURIComponent(relative),
    title,
    width: kind === "doc" ? 1000 : 900,
    height: 800,
    resizable: true,
    focus: true
  });
}

const IS_COMPANION_WINDOW =
  typeof window !== "undefined" && window.location.hash.replace(/^#/, "") === "companion";

async function openCompanionWindow(): Promise<void> {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const existing = await WebviewWindow.getByLabel("companion");
  if (existing) {
    try { await existing.show(); await existing.setFocus(); } catch { /* ignore */ }
    return;
  }
  // Born small and frameless so it never appears full size, and always-on-top so
  // it floats over the target AI program the way a floating toolbar should.
  // eslint-disable-next-line no-new
  new WebviewWindow("companion", {
    url: "index.html#companion",
    title: "MaggotClaw Voice Companion",
    // Wide enough that the extra companion-only Close (✕) clears the oval's
    // rounded right end instead of being clipped by it.
    width: 690,
    height: 96,
    resizable: true,
    decorations: false,
    transparent: true,
    shadow: false,
    alwaysOnTop: true,
    center: false,
    focus: true
  });
}

// Discord runs inside the app in its own MaggotClaw window. The webview keeps
// its sign-in between launches, so after the first login it connects itself.
async function openDiscordWindow(): Promise<void> {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const existing = await WebviewWindow.getByLabel("discord");
  if (existing) {
    try { await existing.show(); await existing.setFocus(); } catch { /* ignore */ }
    return;
  }
  // eslint-disable-next-line no-new
  new WebviewWindow("discord", {
    url: "https://discord.com/app",
    title: "MaggotClaw Messages",
    width: 1100,
    height: 780,
    resizable: true,
    focus: true
  });
}

async function closeCurrentWindow(): Promise<void> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  try { await getCurrentWindow().close(); } catch { /* ignore */ }
}

// From the companion window, hand settings back to the main hub window rather
// than shrinking or replacing anything: focus the hub, ask it to open Settings,
// then close the little bar.
async function requestMainSettingsFromCompanion(): Promise<void> {
  try {
    const { emit } = await import("@tauri-apps/api/event");
    await emit("mcg://open-settings");
  } catch { /* ignore */ }
  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const main = await WebviewWindow.getByLabel("main");
    if (main) { await main.show(); await main.setFocus(); }
  } catch { /* ignore */ }
  await closeCurrentWindow();
}

export function App() {
  const [readerName, setReaderName] = useState(() => localStorage.getItem("long-rot-reader-name") || "");
  const [screen, setScreen] = useState<Screen>(() => localStorage.getItem("long-rot-reader-name") ? "home" : "profile");
  const [settings, setSettings] = useState<ConnectionSettings>(getSettings);
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
  const [workspace, setWorkspace] = useState<WorkspaceStatus | null>(null);
  const [workspaceProgress, setWorkspaceProgress] = useState<DownloadProgress | null>(null);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [requests, setRequests] = useState<AccessRequest[]>(() => pendingRequests());
  const [requestCode, setRequestCode] = useState("");
  const [shelf, setShelf] = useState<ParsedDoc[]>([]);
  const [readMyself, setReadMyself] = useState(false);
  const [unlockedChapters] = useState<number[]>(() => loadUnlockedChapters());
  const refreshRequests = useCallback(() => setRequests(pendingRequests()), []);

  function openVoiceTarget(target: VoiceSettings["target"]) {
    const current = loadVoiceSettings(readerName);
    saveVoiceSettings(readerName, { ...current, target });
    if ("__TAURI_INTERNALS__" in window) {
      // Keep the main hub visible and open the compact bar as its own window.
      setScreen("home");
      void openCompanionWindow();
    } else {
      // Browser development has no second OS window; fall back to embedded mode.
      setScreen("talk");
    }
  }
  const player = useRef(new BrowserSpeechPlayer());
  const recorder = useRef(new CommentRecorder());
  const silenceDeadline = useRef(0);
  const silenceAllowance = useRef(5);
  const finishing = useRef(false);
  const indexRef = useRef(0);
  const documentRef = useRef<DocumentRecord | null>(null);
  const client = useMemo(() => new LongRotMcpClient(settings), [settings]);
  const role = profileRole(readerName);

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

  // Chapter window: load its document and land directly on the reading screen.
  useEffect(() => {
    if (!DOC_WINDOW_PATH || !("__TAURI_INTERNALS__" in window)) return;
    void (async () => {
      try {
        let content: string;
        let html: string | undefined;
        if (/docx$/i.test(DOC_WINDOW_PATH)) {
          const bytes = await invoke<number[]>("read_project_document_bytes", { localRelativePath: DOC_WINDOW_PATH });
          const buffer = new Uint8Array(bytes).buffer;
          const mammoth = await import("mammoth/mammoth.browser");
          content = (await mammoth.extractRawText({ arrayBuffer: buffer })).value.trim();
          html = (await mammoth.convertToHtml({ arrayBuffer: buffer })).value;
        } else {
          content = unwrapHardLines(await invoke<string>("read_project_document", { localRelativePath: DOC_WINDOW_PATH }));
        }
        const hash = await contentHash(content);
        await enterDocument({
          id: "local:" + DOC_WINDOW_PATH + ":" + hash,
          path: "local:" + DOC_WINDOW_PATH,
          name: DOC_WINDOW_PATH.split("/").pop() ?? DOC_WINDOW_PATH,
          content,
          html,
          contentHash: hash,
          segments: segmentDocument(content),
          retrievedAt: new Date().toISOString()
        });
      } catch {
        setStatus("This chapter could not be opened.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The chapter shelf loads itself when Reader Mode opens, so it is never empty
  // waiting on a Refresh press.
  useEffect(() => {
    if (screen !== "library" || !("__TAURI_INTERNALS__" in window)) return;
    void refreshCopies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  // The main hub listens for the companion window's request to open Settings.
  useEffect(() => {
    if (IS_COMPANION_WINDOW || !("__TAURI_INTERNALS__" in window)) return;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen("mcg://open-settings", () => setScreen("settings")).then((un) => { unlisten = un; })
    );
    return () => { if (unlisten) unlisten(); };
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

  // The shelf is built from the downloaded local files, so reading works with no
  // Dropbox connection at all.
  async function refreshCopies() {
    setLoading(true);
    setStatus("Reading your local chapters…");
    try {
      const docs = await invoke<ProjectDocument[]>("list_project_documents");
      // Word files dropped into 01 Originals join the shelf as first-class
      // chapters (and outrank the plain-text copy of the same chapter).
      const wordFiles = await invoke<string[]>("list_workspace_docx").catch(() => [] as string[]);
      for (const relative of wordFiles) {
        docs.push({ dropboxPath: `local:${relative}`, localRelativePath: relative, revisionId: null, byteCount: 0, status: "downloaded" });
      }
      const shelf = readerCopies(docs);
      setShelf(shelf);
      const open = shelf.filter((item) => isChapterUnlocked(item.chapter, role, unlockedChapters)).length;
      setStatus(shelf.length ? `${shelf.length} chapters · ${open} available to read` : "No chapters downloaded yet");
    } catch (error) {
      setStatus(`${message(error)} Nothing was changed.`);
    } finally {
      setLoading(false);
    }
  }

  async function openCopy(copy: ParsedDoc) {
    if (!isChapterUnlocked(copy.chapter, role, unlockedChapters)) {
      setStatus(`Chapter ${copy.chapter} is not released yet.`);
      return;
    }
    if ("__TAURI_INTERNALS__" in window) {
      void openContentWindow("doc", copy.doc.localRelativePath, copy.title.startsWith("Chapter") ? "Chapter " + copy.chapter : copy.title);
      return;
    }
    setLoading(true);
    setStatus("Opening chapter…");
    try {
      let content: string;
      let html: string | undefined;
      if (/\.docx$/i.test(copy.fileName)) {
        // The author's styled Word file: extract clean text for narration and
        // real formatting for the read-myself page.
        const bytes = await invoke<number[]>("read_project_document_bytes", { localRelativePath: copy.doc.localRelativePath });
        const buffer = new Uint8Array(bytes).buffer;
        const mammoth = await import("mammoth/mammoth.browser");
        content = (await mammoth.extractRawText({ arrayBuffer: buffer })).value.trim();
        html = (await mammoth.convertToHtml({ arrayBuffer: buffer })).value;
      } else {
        content = unwrapHardLines(await invoke<string>("read_project_document", { localRelativePath: copy.doc.localRelativePath }));
      }
      const hash = await contentHash(content);
      await enterDocument({
        id: `${copy.doc.dropboxPath}:${copy.doc.revisionId || hash}`,
        path: copy.doc.dropboxPath,
        name: copy.fileName,
        content,
        html,
        contentHash: hash,
        segments: segmentDocument(content),
        retrievedAt: new Date().toISOString()
      });
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
    if (DOC_WINDOW_PATH) { void closeCurrentWindow(); return; }
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

  function saveProfile(name: string, discordName = "", wantedRole: ProjectRole = "reader") {
    const clean = name.trim();
    if (!clean) return;
    localStorage.setItem("long-rot-reader-name", clean);
    if (discordName.trim()) setDiscordName(clean, discordName);
    setReaderName(clean);
    const startingRole = profileRole(clean);
    // Anything above the starting role becomes a request to the owner.
    if (ROLE_ORDER.indexOf(wantedRole) > ROLE_ORDER.indexOf(startingRole) && wantedRole !== "administrator") {
      submitAccessRequest({ name: clean, currentRole: startingRole, requestedRole: wantedRole, reason: "Chosen during onboarding" });
      refreshRequests();
      const code = makeRequestCode({ name: clean, currentRole: startingRole, requestedRole: wantedRole, reason: "Chosen during onboarding" });
      void sendRequestToDiscord(requestAnnouncement({
        name: clean, discordName: discordName.trim(), currentRole: roleLabel(startingRole),
        requestedRole: roleLabel(wantedRole), reason: "Chosen during onboarding", code
      })).then((sent) => {
        if (sent) {
          setScreen("home");
          setStatus("Your request was sent to the owner. You can read while you wait.");
        } else {
          setRequestCode(code);
          setScreen("request-access");
        }
      });
      return;
    }
    setScreen("home");
    setStatus(`Welcome, ${clean}`);
  }

  async function openSavedComments() {
    setSavedComments((await loadSavedComments()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    setScreen("comments");
  }

  async function openProjects() {
    // Projects is the working area. A reader is offered the request instead of a
    // door they cannot walk through.
    if (!canPerform(role, "review")) {
      setRequestCode("");
      setScreen("request-access");
      return;
    }
    setScreen("projects");
  }

  function openDashboard() {
    refreshRequests();
    setScreen("dashboard");
  }

  function decideRequest(id: string, approve: boolean) {
    decideAccessRequest(id, approve, readerName);
    refreshRequests();
    setStatus(approve ? "Access granted. The reader's role has been raised." : "Request declined. Nothing was changed for that reader.");
  }

  function sendAccessRequest(requestedRole: ProjectRole, reason: string) {
    submitAccessRequest({ name: readerName, currentRole: role, requestedRole, reason });
    refreshRequests();
    const code = makeRequestCode({ name: readerName, currentRole: role, requestedRole, reason });
    // Discord carries the request straight to the owner when the webhook is
    // configured; the copy/paste code remains the fallback path.
    void sendRequestToDiscord(requestAnnouncement({
      name: readerName, discordName: getDiscordName(readerName), currentRole: roleLabel(role),
      requestedRole: roleLabel(requestedRole), reason, code
    })).then((sent) => {
      if (sent) {
        setScreen("home");
        setStatus("Your request was sent to the owner. You can keep reading while you wait.");
      } else {
        setRequestCode(code);
      }
    });
  }

  // Applies an unlock code the owner sent back. The code names its recipient, so
  // it only works for the profile it was granted to.
  function redeemUnlockCode(code: string): string {
    const payload = parseUnlockCode(code);
    if (!payload) return "That unlock code was not recognised. Check it was copied in full.";
    if (!unlockMatchesProfile(payload, readerName)) return `That unlock code was issued to ${payload.name}, not ${readerName}.`;
    setProfileRole(readerName, payload.role);
    setScreen("home");
    setStatus(`Access granted. You are now ${roleLabel(payload.role)}.`);
    return "";
  }

  // The owner pressing Upload Approved IS the OK GO: everything sitting in
  // 05 Approved Uploads goes to Dropbox, then moves to 06 Exports/Uploaded.
  async function uploadApproved() {
    setWorkspaceBusy(true);
    try {
      const files = await invoke<string[]>("list_approved_uploads");
      if (!files.length) { setStatus("Nothing is waiting in 05 Approved Uploads."); return; }
      let sent = 0;
      const failures: string[] = [];
      for (const relative of files) {
        try {
          const content = await invoke<string>("read_approved_upload", { localRelativePath: relative });
          await client.writeText(`/The Long Rot/${relative}`, content);
          await invoke("archive_approved_upload", { localRelativePath: relative });
          sent += 1;
          setStatus(`Uploaded ${relative} (${sent}/${files.length})`);
        } catch (error) {
          failures.push(`${relative}: ${message(error)}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      setStatus(failures.length
        ? `Uploaded ${sent} of ${files.length}. Problems: ${failures[0]}`
        : `Uploaded ${sent} file${sent === 1 ? "" : "s"} to Dropbox and archived them under 06 Exports/Uploaded.`);
    } catch (error) {
      setStatus(`${message(error)} Nothing was changed.`);
    } finally {
      setWorkspaceBusy(false);
    }
  }

  async function openLongRotWorkspace() {
    setScreen("project-workspace");
    try {
      setWorkspace(await workspaceStatus());
    } catch (error) {
      setStatus(message(error));
    }
  }

  async function prepareWorkspace() {
    setWorkspaceBusy(true);
    try {
      const result = await initializeWorkspace();
      setWorkspace(result);
      setStatus("Local project workspace is ready. Dropbox was not contacted.");
    } catch (error) {
      setStatus(message(error));
    } finally {
      setWorkspaceBusy(false);
    }
  }

  async function downloadWorkspace() {
    setWorkspaceBusy(true);
    setWorkspaceProgress(null);
    try {
      const result = await downloadProject(client, setWorkspaceProgress);
      setWorkspace(await workspaceStatus());
      setStatus(`${result.completed} text files saved locally. ${result.skipped} other files need binary download support. Dropbox was not changed.`);
    } catch (error) {
      setStatus(`${message(error)} Dropbox was not changed.`);
    } finally {
      setWorkspaceBusy(false);
    }
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

  if (FILE_WINDOW_PATH) {
    return <FileWindow relative={FILE_WINDOW_PATH} />;
  }

  if (IS_COMPANION_WINDOW) {
    // This window shows only the compact voice bar; the hub lives in its own window.
    return <TalkScreen
      readerName={readerName || "Reader"}
      companion
      onBack={() => { void closeCurrentWindow(); }}
      onSettings={() => { void requestMainSettingsFromCompanion(); }}
    />;
  }

  if (screen === "profile") {
    return <Profile initial={readerName} onContinue={saveProfile} />;
  }

  if (screen === "talk") {
    return <TalkScreen readerName={readerName} onBack={() => setScreen("voice-targets")} onSettings={() => { localStorage.removeItem("long-rot-companion-active"); setScreen("settings"); }} />;
  }

  if (screen === "settings") {
    return <Settings initial={settings} onSave={saveSettings} onCancel={() => setScreen("home")} />;
  }

  if (screen === "request-access") {
    return <RequestAccess role={role} code={requestCode} onSend={sendAccessRequest} onCancel={() => { setRequestCode(""); setScreen("home"); }} />;
  }

  if (screen === "unlock") {
    return <RedeemUnlock name={readerName} onRedeem={redeemUnlockCode} onCancel={() => setScreen("home")} />;
  }

  if (screen === "dashboard") {
    return <OwnerDashboard requests={requests} onDecide={decideRequest} onBack={() => setScreen("home")} />;
  }

  if (screen === "chat") {
    return <ChatScreen role={role} name={readerName} onBack={() => setScreen("home")} onOpenDiscord={() => { void openDiscordWindow(); }} />;
  }

  if (screen === "directions") {
    return <main className="app-shell directions-shell">
      <header className="topbar"><button className="text-button" onClick={() => setScreen("home")}>← Back</button><span className="eyebrow">Directions</span><span className="who-chip">{readerName} · {roleLabel(role)}</span></header>
      <section className="projects-heading"><h1>Finding your way around</h1><p>What each part of MaggotClaw Games does.</p></section>
      <section className="directions-grid">
        <article><h2>Reader Mode</h2><p>The book itself. Pick a chapter, then choose Narrated (she reads to you, sentence by sentence) or Read myself (a normal book page). Locked chapters are not released yet. Press Comment while reading to record a note tied to the exact sentence.</p></article>
        <article><h2>Voice Companion</h2><p>Talk out loud and your words are typed into Claude or Codex for you. The little bar floats above the AI program: microphone to start, + to add time, ➤ to send now, ■ to stop, ✕ to close.</p></article>
        <article><h2>Projects</h2><p>The working side. Open The Long Rot to see the workspace: Explore Files browses every chapter and codex, Chapters shows what is finished, Codex is the story brain, and the search finds every mention of anything. Download or Update refreshes your local copies from Dropbox.</p></article>
        <article><h2>Messages</h2><p>Rooms for readers, editors, and the author. Post in a room, or open the full Messages window (Discord) for voice calls. Access requests also land there for the owner.</p></article>
        <article><h2>Requesting more access</h2><p>Everyone starts as a Reader. Request access sends your ask to the owner; when approved you get an unlock code — paste it under Enter unlock code and your new role is live.</p></article>
        <article><h2>Owner Dashboard</h2><p>Owner only: approvals waiting, requests pulled from Discord, and the paste-a-code fallback. Approving posts the unlock code back automatically.</p></article>
        <article><h2>Settings</h2><p>Voice Companion choices, updates and the share link, and for the owner: Discord keys and View as — see the whole app the way a Reader or Editor sees it, then click your name to come back.</p></article>
      </section>
    </main>;
  }

  if (screen === "home") {
    return <main className="app-shell home-shell">
      <header className="hero"><BannerWithVersion /></header>
      <section className="home-toolbar">
        {canPerform(role, "manage") && <button className="pill-button chip" onClick={openDashboard}>Owner Dashboard{requests.length > 0 && <span className="pending-badge">{requests.length}</span>}</button>}
        <button className="pill-button chip" onClick={() => setScreen("settings")}>Settings</button>
        <button className="pill-button chip" onClick={() => setScreen("directions")}>Directions</button>
        {getViewAs()
          ? <button className="pill-button chip" onClick={() => { setViewAs(null); window.location.reload(); }}>Viewing as {roleLabel(role)} — back</button>
          : <button className="pill-button chip" onClick={() => setScreen("profile")}>{readerName || "Start Here"}</button>}
      </section>
      {readerName === "Test Profile" && <div className="test-mode-banner">TEST PROFILE — LOCAL ONLY — NOTHING IS SYNCHRONIZED</div>}
      {!canPerform(role, "manage") && <section className="welcome-strip">
        <span className="reader-note">You can read and comment right away. Need to edit? <button className="text-button inline" onClick={() => { setRequestCode(""); setScreen("request-access"); }}>Request access</button> · <button className="text-button inline" onClick={() => setScreen("unlock")}>Enter unlock code</button></span>
      </section>}
      <section className="mode-grid">
        <button className="mode-card" onClick={() => setScreen("library")}><img className="mode-icon image-icon" src="/long-rot-icon.png" alt="The Long Rot" /><span><strong>Reader Mode</strong><small>Read or listen, save your place, and record comments.</small></span><span>→</span></button>
        <button className="mode-card voice-mode" onClick={() => setScreen("voice-targets")}><span className="mode-icon voice-mic-mark" aria-hidden="true" /><span><strong>Voice Companion</strong><small>Talk with Claude or Codex now. ChatGPT will be added later.</small></span><span>→</span></button>
        <button className="mode-card project-mode" onClick={openProjects}><img className="mode-icon image-icon" src="/mcg-social-circle.png" alt="MaggotClaw Games" /><span><strong>Projects</strong><small>{canPerform(role, "review") ? "Open a project, review its local files, and use the actions allowed for your role." : "Editing the project files needs approval from the owner."}</small></span><span>→</span></button>
        <button className="mode-card chat-mode" onClick={() => setScreen("chat")}><span className="mode-icon chat-mark" aria-hidden="true" /><span><strong>Messages</strong><small>Rooms and voice calls for readers, editors, and the author.</small></span><span>→</span></button>
      </section>
    </main>;
  }

  if (screen === "projects") {
    return <main className="app-shell projects-list-shell">
      <header className="topbar"><button className="text-button" onClick={() => setScreen("home")}>← Back</button><span className="eyebrow">PROJECTS</span><span className="who-chip">{readerName} · {roleLabel(role)}</span></header>
      <section className="projects-heading"><h1>Your projects</h1><p>Select a project to open its local workspace and available actions.</p></section>
      <section className="project-tiles"><button className="project-tile" onClick={openLongRotWorkspace}><img className="project-placeholder project-icon-image" src="/long-rot-icon.png" alt="The Long Rot" /><span><strong>The Long Rot</strong><small>Local workspace ready · Dropbox connection needs attention</small></span><span>Open →</span></button><button className="project-tile project-zero-tile" onClick={() => setScreen("project-zero")}><img className="project-placeholder project-icon-image" src="/project-zero-icon.svg" alt="Project Zero Author" /><span><strong>Project Zero Author</strong><small>Project added · Local workspace and connection not configured yet</small></span><span>Open →</span></button></section>
    </main>;
  }

  if (screen === "project-zero") {
    return <main className="app-shell project-shell">
      <header className="topbar"><button className="text-button" onClick={() => setScreen("projects")}>← Back</button><span className="eyebrow">PROJECT ZERO AUTHOR</span><span className="who-chip">{readerName} · {roleLabel(role)}</span></header>
      <section className="project-heading"><div><p className="eyebrow">PROJECT ADDED</p><h1>Project Zero Author</h1><p>This project is selectable. Its local filing structure and remote source still need to be configured.</p></div><span className="role-badge">{roleLabel(role)}</span></section>
      <section className="workspace-card"><div><span>Local workspace</span><strong>Not prepared</strong><small>No Project Zero Author files have been created or changed.</small></div><div><span>Remote files</span><strong>Not connected</strong><small>No Dropbox location or other source has been assigned.</small></div><div><span>Project actions</span><strong>Safely locked</strong><small>Download and upload stay unavailable until the project source is explicitly configured.</small></div></section>
      <section className="workspace-actions"><button disabled>Prepare Workspace</button><button disabled>Download or Update</button>{canPerform(role, "review") && <button disabled>Review Changes</button>}{canPerform(role, "upload") && <button disabled>Upload Approved</button>}</section>
      <footer className="safe-status">Project Zero Author has been added to the app. Nothing was synchronized.</footer>
    </main>;
  }

  if (screen === "project-review") {
    return <main className="app-shell project-shell">
      <header className="topbar"><button className="text-button" onClick={() => setScreen("project-workspace")}>← Back</button><span className="eyebrow">REVIEW QUEUE</span><span className="who-chip">{readerName} · {roleLabel(role)}</span></header>
      <section className="projects-heading"><h1>Proposed changes</h1><p>Nothing is waiting for review yet. Future AI and human drafts will appear here before anything can be approved for upload.</p></section>
      <section className="empty-state"><strong>No proposed changes</strong><p>Dropbox remains unchanged.</p></section>
    </main>;
  }

  if (screen === "project-explorer") {
    return <ProjectExplorer onBack={() => setScreen("project-workspace")} />;
  }

  if (screen === "project-workspace") {
    return <main className="app-shell project-shell">
      <header className="topbar"><button className="text-button" onClick={() => setScreen("projects")}>← Back</button><span className="eyebrow">LOCAL PROJECT WORKSPACE</span><span className="who-chip">{readerName} · {roleLabel(role)}</span></header>
      <section className="project-heading"><div><p className="eyebrow">THE LONG ROT</p><h1>Project workspace</h1><p>Dropbox stays the shared source. The AI works from safe copies on this computer.</p></div><span className="role-badge">{roleLabel(role)}</span></section>
      <section className="workspace-card">
        <div><span>Local workspace</span><strong>{workspace?.initialized ? "Ready" : "Not prepared yet"}</strong><small>{workspace?.workspacePath || "The standard MaggotClaw Games Projects folder will be used."}</small></div>
        <div><span>Files downloaded</span><strong>{workspace?.downloadedFiles || 0}</strong><small>{workspace?.pendingBinaryFiles || 0} Word, PDF, image, or other binary files waiting for expanded MCP download support.<br/>Last completed file save: {formatWorkspaceTime(workspace?.lastDownloadAt || null)}</small></div>
        <div><span>Dropbox uploads</span><strong>Disabled</strong><small>No button or command in this build can upload, replace, move, or delete a Dropbox file.</small></div>
      </section>
      {workspaceProgress && <section className="download-progress"><strong>{workspaceProgress.stage}</strong><p>{workspaceProgress.completed} of {workspaceProgress.total || "?"} text files saved · {workspaceProgress.skipped} other files recorded</p></section>}
      <section className="workspace-actions">
        <button className="primary" onClick={() => setScreen("project-explorer")} disabled={!workspace?.downloadedFiles}>Explore Files</button>
        <button onClick={prepareWorkspace} disabled={workspaceBusy}>{workspace?.initialized ? "Check Local Folders" : "Prepare Local Workspace"}</button>
        {canPerform(role, "download") && <button className="primary" onClick={downloadWorkspace} disabled={workspaceBusy}>{workspaceBusy ? "Working…" : "Download or Update"}</button>}
        {canPerform(role, "review") && <button onClick={() => setScreen("project-review")} disabled={workspaceBusy}>Review Changes</button>}
        {canPerform(role, "manage")
          ? <button className="primary" onClick={() => { if (window.confirm("Upload everything in 05 Approved Uploads to Dropbox? This changes the real project files.")) void uploadApproved(); }} disabled={workspaceBusy}>Upload Approved</button>
          : canPerform(role, "upload") && <button title="Uploads run from the owner's account for now." disabled>Upload Approved</button>}
        <button onClick={() => void openWorkspace()} disabled={!workspace?.initialized || workspaceBusy}>Open Local Folder</button>
      </section>
      <section className="folder-map"><h2>What the app creates</h2><ol><li><strong>01 Originals</strong><span>Exact downloaded text files. The AI does not edit these.</span></li><li><strong>03 AI Context</strong><span>Markdown copies with source, revision, and checksum information.</span></li><li><strong>04 Proposed Changes</strong><span>Future AI and human drafts—not official project files.</span></li><li><strong>07 Backups</strong><span>Old local originals saved before a changed download replaces them.</span></li></ol></section>
      <footer className="safe-status">{status}</footer>
    </main>;
  }

  if (screen === "voice-targets") {
    return <main className="app-shell target-screen"><header className="topbar"><button className="text-button" onClick={() => setScreen("home")}>← Back</button><span className="eyebrow">VOICE COMPANION</span><span>{readerName}</span></header><section className="library-heading"><div><h2>Choose the program</h2><p>The companion controls the normal Windows program you already use.</p></div></section><section className="target-grid"><button className="target-card available" onClick={() => openVoiceTarget("claude")}><strong>Claude</strong><small>Available now</small></button><button className="target-card available" onClick={() => openVoiceTarget("codex")}><strong>Codex</strong><small>Available now</small></button><button className="target-card" disabled><strong>ChatGPT</strong><small>Coming later</small></button></section></main>;
  }

  if (screen === "comments") {
    return <main className="app-shell comments-shell">
      <header className="topbar"><button className="text-button" onClick={() => setScreen("library")}>← Back</button><span className="eyebrow">MY COMMENTS</span><span>{readerName}</span></header>
      <section className="comments-heading"><div><h1>Saved Comments</h1><p>{savedComments.length} saved safely on this device.</p></div><button onClick={exportComments} disabled={!savedComments.length}>Save comments file</button><button className="primary" disabled={!savedComments.length} onClick={async () => {
        setStatus("Sending comments to the owner…");
        let sent = 0;
        for (const item of savedComments) {
          const text = `**Reader comment** from ${item.readerName}
${item.exactFilename} — paragraph ${item.paragraphIndex + 1}, sentence ${item.sentenceIndex + 1}
"${item.anchorText}"
${item.transcriptionConfirmed}`.slice(0, 1800);
          if (await sendRequestToDiscord(text)) sent += 1;
          await new Promise((resolve) => setTimeout(resolve, 350));
        }
        setStatus(sent ? `Sent ${sent} comment${sent === 1 ? "" : "s"} to the owner.` : "The comments could not be sent — they are still saved here.");
      }}>Submit Comments</button></section>
      <section className="comments-list">
        {savedComments.length === 0 && <div className="empty-state"><strong>No comments yet</strong><p>Comments you confirm while reading will appear here.</p></div>}
        {savedComments.map((item) => <SavedCommentCard key={item.id} comment={item} onDelete={async () => { await deleteComment(item.id); setSavedComments(await loadSavedComments()); }} />)}
      </section>
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
          <button className="text-button" onClick={closeReader}>← Back</button>
          <span className="eyebrow">The Long Rot</span>
          <span className="status-dot" aria-label={status}>{status}</span>
        </header>
        <section className="reader-heading">
          <p className="eyebrow">Chapter</p>
          <h1>{cleanTitle(document.name)}</h1>
          <div className="progress-track" aria-label={`${progress}% complete`}><span style={{ width: `${progress}%` }} /></div>
          <p className="progress-label">{progress}% complete · Sentence {segmentIndex + 1} of {document.segments.length}</p>
        </section>
        <div className="read-mode-toggle" role="group" aria-label="Reading mode">
          <button className={readMyself ? "" : "active"} onClick={() => setReadMyself(false)}>Narrated</button>
          <button className={readMyself ? "active" : ""} onClick={() => { player.current.stop(); setPlaying(false); setReadMyself(true); }}>Read myself</button>
        </div>
        {readMyself
          ? (document.html
            ? <article className="reading-card self-read word-styled" dangerouslySetInnerHTML={{ __html: document.html }} />
            : <article className="reading-card self-read">
                {Object.values(document.segments.reduce<Record<number, string[]>>((acc, segment) => {
                  (acc[segment.paragraphIndex] ??= []).push(segment.text);
                  return acc;
                }, {})).map((sentences, index) => <p key={index}>{sentences.join(" ")}</p>)}
              </article>)
          : <article className="reading-card" aria-live="polite">
              <p className="context">{document.segments[segmentIndex - 1]?.text}</p>
              <p className="current-sentence">{current?.text || "This file has no readable text."}</p>
              <p className="context">{document.segments[segmentIndex + 1]?.text}</p>
            </article>}
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
      <section className="home-toolbar page">
        <button className="pill-button chip" onClick={() => setScreen("home")}>← Back</button>
        <button className="pill-button chip" onClick={openSavedComments}>My Comments</button>
        <button className="pill-button chip" onClick={() => setScreen("settings")}>Settings</button>
        <button className="pill-button chip" onClick={refreshCopies} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
        <span className="who-chip">{readerName} · {roleLabel(role)}</span>
      </section>
      <header className="hero">
        <div><BrandLogo compact /><h1>Reader Mode</h1><p>{status}</p></div>
      </header>
      {recoverable && <section className="recovery-banner"><div><strong>Unfinished comment found</strong><p>Your recording and reading position are safe on this device.</p></div><button onClick={resumeRecoverable}>Recover</button></section>}
      <section className="copy-grid">
        {shelf.map((copy) => {
          const open = isChapterUnlocked(copy.chapter, role, unlockedChapters);
          return <button
            className={`copy-card ${open ? "" : "locked"}`}
            key={copy.doc.localRelativePath}
            onClick={() => void openCopy(copy)}
            disabled={!open}
            title={open ? "Open this chapter" : "Not released yet"}
          >
            <img className="book-mark image-mark" src="/long-rot-icon.png" alt="" aria-hidden="true" />
            <span>
              <strong>Chapter {String(copy.chapter).padStart(2, "0")}{copy.title.startsWith("Chapter") ? "" : ` — ${copy.title}`}</strong>
              <small>{open ? `Read now · v${copy.version ?? "?"}` : "Locked — not released yet"}</small>
            </span>
            <span aria-hidden="true">{open ? "→" : "🔒"}</span>
          </button>;
        })}
        {shelf.length === 0 && <button className="copy-card demo" onClick={openDemo}>
          <span className="book-mark">01</span><span><strong>Sample Reader Copy</strong><small>Try without connecting</small></span><span aria-hidden="true">→</span>
        </button>}
      </section>
    </main>
  );
}

function Profile({ initial, onContinue }: { initial: string; onContinue: (name: string, discordName: string, wantedRole: ProjectRole) => void }) {
  const [name, setName] = useState(initial);
  const [discordName, setDiscord] = useState(() => initial ? getDiscordName(initial) : "");
  const [wantedRole, setWantedRole] = useState<ProjectRole>("reader");
  const options: Array<{ value: ProjectRole; label: string; hint: string }> = [
    { value: "reader", label: "Reader", hint: "Read and comment — starts right now" },
    { value: "contributor", label: "Contributor", hint: "Suggest and propose changes — needs approval" },
    { value: "reviewer", label: "Reviewer", hint: "Review reader feedback and proposals — needs approval" },
    { value: "editor", label: "Editor / Maintainer", hint: "Edit and maintain the project — needs approval" },
    { value: "support", label: "Technical Support", hint: "Keep the machinery running — needs approval" }
  ];
  return <main className="app-shell profile-screen">
    <BrandLogo />
    <div className="love-banner" role="status">Whatever you do, don't forget… <strong>MaggotClaw Loves You!!!</strong></div>
    <p>Three quick things and you're in. Everyone starts as a <strong>Reader</strong> — anything more goes to the owner for approval, and you can read while you wait.</p>

    <label>1. Your name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label>

    <fieldset className="role-picker"><legend>2. What do you want to do here?</legend>
      {options.map((option) => <label key={option.value} className={wantedRole === option.value ? "role-option picked" : "role-option"}>
        <input type="radio" name="wanted-role" value={option.value} checked={wantedRole === option.value} onChange={() => setWantedRole(option.value)} />
        <span className="role-bubble" aria-hidden="true" />
        <span><strong>{option.label}</strong><small>{option.hint}</small></span>
      </label>)}
    </fieldset>

    <label>3. Your Discord name (for team messages)
      <input value={discordName} placeholder="Leave blank if you don't have one yet" onChange={(event) => setDiscord(event.target.value)} />
    </label>
    <button className="text-button" onClick={() => { void openDiscordWindow(); }}>Open Discord to sign in or create an account →</button>

    <button className="continue-profile" disabled={!name.trim()} onClick={() => onContinue(name, discordName, wantedRole)}>Get Started</button>
  </main>;
}

// One project file in its own window: full text (or Word formatting), with
// read-highlighted-aloud. Several of these can be open side by side.
function FileWindow({ relative }: { relative: string }) {
  const [text, setText] = useState("Opening…");
  const [html, setHtml] = useState<string | null>(null);
  const voice = useRef(new BrowserSpeechPlayer());
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => () => voice.current.stop(), []);
  useEffect(() => {
    void (async () => {
      try {
        if (/docx$/i.test(relative)) {
          const bytes = await invoke<number[]>("read_project_document_bytes", { localRelativePath: relative });
          const buffer = new Uint8Array(bytes).buffer;
          const mammoth = await import("mammoth/mammoth.browser");
          setText((await mammoth.extractRawText({ arrayBuffer: buffer })).value.trim());
          setHtml((await mammoth.convertToHtml({ arrayBuffer: buffer })).value);
        } else {
          setText(await invoke<string>("read_project_document", { localRelativePath: relative }));
        }
      } catch {
        setText("This file could not be opened from the local workspace.");
      }
    })();
  }, [relative]);
  function readSelection() {
    if (speaking) { voice.current.stop(); setSpeaking(false); return; }
    const chosen = window.getSelection()?.toString().trim();
    if (!chosen) return;
    setSpeaking(true);
    voice.current.speak(chosen.slice(0, 4000), 1, () => setSpeaking(false), () => setSpeaking(false));
  }
  const name = relative.split("/").pop() ?? relative;
  return <main className="app-shell file-window">
    <header className="topbar">
      <button className="text-button" onClick={() => { void closeCurrentWindow(); }}>← Back</button>
      <span className="eyebrow">{name}</span>
      <button className="text-button" onClick={readSelection}>{speaking ? "■ Stop reading" : "🔊 Read highlighted"}</button>
    </header>
    {html ? <div className="doc-word" dangerouslySetInnerHTML={{ __html: html }} /> : <pre className="file-text">{text}</pre>}
  </main>;
}

function CodeBox({ label, code, hint }: { label: string; code: string; hint: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard?.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  }
  return <div className="code-box">
    <span className="code-label">{label}</span>
    <code className="code-value">{code}</code>
    <div className="code-actions">
      <button className="primary tiny" onClick={() => void copy()}>{copied ? "Copied ✓" : "Copy code"}</button>
      <small>{hint}</small>
    </div>
  </div>;
}

function RequestAccess({ role, code, onSend, onCancel }: { role: ProjectRole; code: string; onSend: (role: ProjectRole, reason: string) => void; onCancel: () => void }) {
  // Offer only roles above the current one — you cannot request less, and you
  // cannot request the owner role (that stays with the author).
  const options = ROLE_ORDER.filter((r) => ROLE_ORDER.indexOf(r) > ROLE_ORDER.indexOf(role) && r !== "administrator");
  const [requested, setRequested] = useState<ProjectRole>(options[options.length - 1] ?? "editor");
  const [reason, setReason] = useState("");

  if (code) {
    return <main className="app-shell settings-panel">
      <BrandLogo compact /><p className="eyebrow">REQUEST ACCESS</p><h1>Send this to the owner</h1>
      <p>Copy the code below and send it to the owner any way you like — text, email, chat. They approve it and send you back an unlock code.</p>
      <CodeBox label="Your request code" code={code} hint="Send it to the owner, then use “Enter unlock code” when they reply." />
      <div className="form-actions"><button className="primary" onClick={onCancel}>Done</button></div>
    </main>;
  }

  return <main className="app-shell settings-panel">
    <BrandLogo compact /><p className="eyebrow">REQUEST ACCESS</p><h1>Ask for more access</h1>
    <p>You are a <strong>{roleLabel(role)}</strong>. Your request goes to the owner for approval — access is never granted automatically.</p>
    <label>Access you're requesting<select value={requested} onChange={(event) => setRequested(event.target.value as ProjectRole)}>
      {options.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
    </select></label>
    <label>Why do you need it? (optional)<textarea rows={4} value={reason} placeholder="A short note helps the owner decide." onChange={(event) => setReason(event.target.value)} /></label>
    <div className="form-actions"><button onClick={onCancel}>Cancel</button><button className="primary" disabled={!options.length} onClick={() => onSend(requested, reason)}>Send request</button></div>
  </main>;
}

function RedeemUnlock({ name, onRedeem, onCancel }: { name: string; onRedeem: (code: string) => string; onCancel: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  return <main className="app-shell settings-panel">
    <BrandLogo compact /><p className="eyebrow">UNLOCK ACCESS</p><h1>Enter your unlock code</h1>
    <p>Paste the unlock code the owner sent you. It was issued to <strong>{name}</strong>.</p>
    <label>Unlock code<textarea rows={3} value={code} placeholder="MCG-KEY-…" onChange={(event) => { setCode(event.target.value); setError(""); }} /></label>
    {error && <p className="update-status warn">{error}</p>}
    <div className="form-actions"><button onClick={onCancel}>Cancel</button><button className="primary" disabled={!code.trim()} onClick={() => setError(onRedeem(code))}>Unlock</button></div>
  </main>;
}

function OwnerDashboard({ requests, onDecide, onBack }: { requests: AccessRequest[]; onDecide: (id: string, approve: boolean) => void; onBack: () => void }) {
  const [pasted, setPasted] = useState("");
  const [incoming, setIncoming] = useState<ReturnType<typeof parseRequestCode>>(null);
  const [codeError, setCodeError] = useState("");
  const [granted, setGranted] = useState<{ name: string; role: ProjectRole; code: string } | null>(null);

  function readCode() {
    const parsed = parseRequestCode(pasted);
    if (!parsed) { setCodeError("That request code was not recognised. Check it was copied in full."); setIncoming(null); return; }
    setCodeError("");
    setGranted(null);
    setIncoming(parsed);
  }

  const [inbox, setInbox] = useState<DiscordRequestMessage[]>([]);
  const [inboxBusy, setInboxBusy] = useState(false);
  const [inboxNote, setInboxNote] = useState("");

  async function checkDiscord() {
    setInboxBusy(true);
    setInboxNote("");
    try {
      const found = await fetchDiscordRequests();
      setInbox(found);
      setInboxNote(found.length ? "" : "No new requests waiting on Discord.");
    } catch (error) {
      setInboxNote(message(error));
    } finally {
      setInboxBusy(false);
    }
  }

  async function decideDiscordRequest(item: DiscordRequestMessage, approve: boolean) {
    const parsed = parseRequestCode(item.code);
    if (!parsed) { setInboxNote("That message's code is damaged — handle it by hand in Discord."); return; }
    if (approve) {
      const unlock = makeUnlockCode({ name: parsed.name, role: parsed.requestedRole });
      const posted = await postUnlockToDiscord(parsed.name, roleLabel(parsed.requestedRole), unlock);
      setInboxNote(posted
        ? `Approved. The unlock code was posted in Discord for ${parsed.name}.`
        : "Approved, but Discord could not be reached — send the code by hand.");
      if (!posted) { setGranted({ name: parsed.name, role: parsed.requestedRole, code: unlock }); }
    } else {
      setInboxNote(`Declined ${parsed.name}'s request. Nothing changed.`);
    }
    markMessageHandled(item.messageId);
    setInbox((current) => current.filter((entry) => entry.messageId !== item.messageId));
  }

  return <main className="app-shell dashboard-shell">
    <header className="topbar"><button className="text-button" onClick={onBack}>← Back</button><span className="eyebrow">OWNER DASHBOARD</span><span>Author / Owner</span></header>
    <section className="projects-heading"><h1>Things that need you</h1><p>Approvals and communications routed to the owner. Approving a request raises that person's role immediately.</p></section>

    <section className="dash-section">
      <h2>Requests from Discord</h2>
      {discordReadingConfigured()
        ? <>
            <p className="board-hint">Pulls new access requests straight out of your Discord channel. Approving posts the unlock code back automatically.</p>
            <div className="form-actions"><button className="primary" onClick={() => void checkDiscord()} disabled={inboxBusy}>{inboxBusy ? "Checking…" : "Check Discord"}</button></div>
            {inboxNote && <p className="board-hint">{inboxNote}</p>}
            {inbox.map((item) => {
              const parsed = parseRequestCode(item.code);
              return <div key={item.messageId} className="request-card">
                <div className="request-who"><strong>{parsed?.name ?? item.author}</strong><span>{parsed ? `${roleLabel(parsed.currentRole)} → ${roleLabel(parsed.requestedRole)}` : "unreadable request"}</span></div>
                {parsed?.reason && <p className="request-reason">"{parsed.reason}"</p>}
                <time>{item.sentAt ? new Date(item.sentAt).toLocaleString() : ""} · via Discord ({item.author})</time>
                <div className="request-actions">
                  <button onClick={() => void decideDiscordRequest(item, false)}>Decline</button>
                  <button className="primary" onClick={() => void decideDiscordRequest(item, true)}>Approve</button>
                </div>
              </div>;
            })}
          </>
        : <p className="board-hint">Add the bot key and channel ID in Settings → Owner to see requests here without leaving the app.</p>}
    </section>

    <section className="dash-section">
      <h2>Approve someone on another computer</h2>
      <p className="board-hint">Paste the request code they sent you. Approving produces an unlock code to send back — that is what raises their access on their machine.</p>
      <label>Their request code<textarea rows={3} value={pasted} placeholder="MCG-REQ-…" onChange={(event) => { setPasted(event.target.value); setCodeError(""); }} /></label>
      {codeError && <p className="update-status warn">{codeError}</p>}
      <div className="form-actions"><button className="primary" disabled={!pasted.trim()} onClick={readCode}>Read code</button></div>

      {incoming && !granted && <div className="request-card">
        <div className="request-who"><strong>{incoming.name}</strong><span>{roleLabel(incoming.currentRole)} → {roleLabel(incoming.requestedRole)}</span></div>
        {incoming.reason && <p className="request-reason">"{incoming.reason}"</p>}
        <div className="request-actions">
          <button onClick={() => { setIncoming(null); setPasted(""); }}>Decline</button>
          <button className="primary" onClick={() => setGranted({ name: incoming.name, role: incoming.requestedRole, code: makeUnlockCode({ name: incoming.name, role: incoming.requestedRole }) })}>Approve</button>
        </div>
      </div>}

      {granted && <CodeBox
        label={`Unlock code for ${granted.name} — ${roleLabel(granted.role)}`}
        code={granted.code}
        hint={`Send this back to ${granted.name}. They paste it into “Enter unlock code”.`}
      />}
    </section>

    <section className="dash-section">
      <h2>Awaiting approval <span className="pending-badge">{requests.length}</span></h2>
      {requests.length === 0
        ? <div className="empty-state"><strong>Nothing waiting</strong><p>When someone requests more access, it appears here.</p></div>
        : <ul className="request-list">{requests.map((r) => <li key={r.id} className="request-card">
            <div className="request-who"><strong>{r.name}</strong><span>{roleLabel(r.currentRole)} → {roleLabel(r.requestedRole)}</span></div>
            {r.reason && <p className="request-reason">"{r.reason}"</p>}
            <time>{new Date(r.createdAt).toLocaleString()}</time>
            <div className="request-actions"><button onClick={() => onDecide(r.id, false)}>Decline</button><button className="primary" onClick={() => onDecide(r.id, true)}>Approve</button></div>
          </li>)}</ul>}
    </section>

    <section className="dash-section">
      <h2>Messages</h2>
      <div className="empty-state"><strong>No messages yet</strong><p>Team messages between readers, editors, and the owner will collect here.</p></div>
    </section>

    <footer className="safe-status">Approvals are recorded on this computer. Cross-device requests arrive once the shared connection is turned on.</footer>
  </main>;
}

function SavedCommentCard({ comment, onDelete }: { comment: ReaderComment; onDelete?: () => void }) {
  const [audioUrl] = useState(() => comment.audio?.size ? URL.createObjectURL(comment.audio) : null);
  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);
  return <article className="saved-comment">
    <div className="comment-meta"><span>{comment.category}</span><time>{new Date(comment.createdAt).toLocaleString()}</time></div>
    <h2>{cleanTitle(comment.exactFilename)}</h2>
    <blockquote>“{comment.anchorText}”</blockquote>
    <p>{comment.transcriptionConfirmed}</p>
    <small>Paragraph {comment.paragraphIndex + 1}, sentence {comment.sentenceIndex + 1} · Submitted by {comment.readerName}</small>
    {onDelete && <button className="text-button comment-delete" onClick={() => { if (window.confirm("Delete this comment? This cannot be undone.")) void onDelete(); }}>Delete</button>}
    {audioUrl && <audio controls src={audioUrl}>Your browser cannot play this recording.</audio>}
  </article>;
}

function Settings({ initial, onSave, onCancel }: { initial: ConnectionSettings; onSave: (value: ConnectionSettings) => void; onCancel: () => void }) {
  const [endpoint, setEndpoint] = useState(initial.endpoint);
  const [bearerToken, setBearerToken] = useState(initial.bearerToken);
  const profile = localStorage.getItem("long-rot-reader-name") || "local";
  const [voice, setVoice] = useState<VoiceSettings>(() => loadVoiceSettings(profile));
  const isOwner = canPerform(realProfileRole(profile), "manage");
  const viewAs = getViewAs();
  const [webhook, setWebhook] = useState(getRequestWebhook);
  const [botToken, setBotTokenState] = useState(getBotToken);
  const [channelId, setChannelIdState] = useState(getRequestsChannelId);
  function updateVoice(changes: Partial<VoiceSettings>) { setVoice((current) => ({ ...current, ...changes })); }
  function saveAll() { saveVoiceSettings(profile, voice); onSave({ endpoint: endpoint.trim(), bearerToken }); }
  return <main className="app-shell settings-panel">
    <button className="text-button mode-back" onClick={onCancel}>← Back</button>
    <BrandLogo compact /><p className="eyebrow">Profile settings</p><h1>Voice Companion</h1>
    <p>These settings are saved for {profile} on this computer.</p>
    <label>Talk to<select value={voice.target} onChange={(event) => updateVoice({ target: event.target.value as VoiceSettings["target"] })}><option value="auto">Auto (whichever is open)</option><option value="claude">Claude</option><option value="codex">Codex</option></select></label>
    <label>Send after silence<input type="number" min="0.5" max="30" step="0.5" value={voice.silenceSeconds} onChange={(event) => updateVoice({ silenceSeconds: Number(event.target.value) })} /></label>
    <label>Add Time button<input type="number" min="1" max="120" step="1" value={voice.addSeconds} onChange={(event) => updateVoice({ addSeconds: Number(event.target.value) })} /></label>
    <div className="voice-choice"><span>Reading voice</span><strong>Cori Neural · Local</strong><small>Natural UK English. Runs privately on this computer with no API charge.</small></div>
    <label>Reading speed<select value={voice.speechRate} onChange={(event) => updateVoice({ speechRate: Number(event.target.value) })}><option value="0.8">Slower</option><option value="1">Normal</option><option value="1.2">Faster</option><option value="1.4">Much faster</option></select></label>
    <label className="check-setting"><input type="checkbox" checked={voice.readRepliesAutomatically} onChange={(event) => updateVoice({ readRepliesAutomatically: event.target.checked })} /> Read replies automatically</label>
    <label className="check-setting"><input type="checkbox" checked={voice.listenAfterReading} onChange={(event) => updateVoice({ listenAfterReading: event.target.checked })} /> Listen again after reading</label>
    <label className="check-setting"><input type="checkbox" checked={voice.skipContentBoxes} onChange={(event) => updateVoice({ skipContentBoxes: event.target.checked })} /> Skip code and output boxes</label>
    {isOwner && <>
      <hr/><p className="eyebrow">View the app as someone else</p>
      <fieldset className="role-picker compact"><legend>See every screen the way they see it. Click your name on the main page to come back.</legend>
        {(["administrator", "editor", "reviewer", "contributor", "reader", "support"] as ProjectRole[]).map((option) => <label key={option} className={(viewAs ?? "administrator") === option ? "role-option picked" : "role-option"}>
          <input type="radio" name="view-as" checked={(viewAs ?? "administrator") === option} onChange={() => { setViewAs(option === "administrator" ? null : option); window.location.reload(); }} />
          <span className="role-bubble" aria-hidden="true" />
          <span><strong>{roleLabel(option)}</strong></span>
        </label>)}
      </fieldset>
    </>}
    <hr/><p className="eyebrow">Updates</p>
    <UpdateChecker configurable />
    {isOwner && <>
      <hr/><p className="eyebrow">Owner — access requests via Discord</p>
      <label>Discord webhook for the requests channel
        <input value={webhook} placeholder="https://discord.com/api/webhooks/…" onChange={(event) => { setWebhook(event.target.value); setRequestWebhook(event.target.value); }} autoComplete="off" />
      </label>
      {webhook && !isDiscordWebhook(webhook) && <small className="update-status warn">That does not look like a Discord webhook address.</small>}
      {webhook && isDiscordWebhook(webhook) && <small className="update-status ok">Access requests will arrive in your Discord channel automatically.</small>}
      <label>Discord bot key (lets the app read the requests channel)
        <input type="password" value={botToken} placeholder="Paste the bot token from the Discord Developer Portal" onChange={(event) => { setBotTokenState(event.target.value); setBotToken(event.target.value); }} autoComplete="off" />
      </label>
      <label>Requests channel ID
        <input value={channelId} placeholder="Right-click the channel → Copy Channel ID" onChange={(event) => { setChannelIdState(event.target.value); setRequestsChannelId(event.target.value); }} autoComplete="off" />
      </label>
      {discordReadingConfigured() && <small className="update-status ok">Two-way Discord is on: the Owner Dashboard can pull requests and post approvals.</small>}
    </>}
    <hr/><p className="eyebrow">ADVANCED CONNECTION</p>
    <label>Connection address<input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} /></label>
    <label>Temporary bearer credential<input type="password" value={bearerToken} onChange={(event) => setBearerToken(event.target.value)} autoComplete="off" /></label>
    <p className="warning">These technical controls will move behind administrator support access in a future build.</p>
    <div className="form-actions"><button onClick={onCancel}>Cancel</button><button className="primary" onClick={saveAll}>Save</button></div>
  </main>;
}

function cleanTitle(name: string): string {
  return name.replace(/\.txt$/i, "").replace(/\s+v\d+(?:\.\d+)*$/i, "");
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "The project connection failed.";
}
