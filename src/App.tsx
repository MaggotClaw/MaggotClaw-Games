import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { filesDirectConfigured, getDropboxCreds, LongRotMcpClient, setDropboxCreds } from "./mcp";
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
import { fetchSharedReleases, isChapterUnlocked, loadUnlockedChapters, publishReleases, readerCopies, saveUnlockedChapters } from "./readerCopies";
import { listenForNativeSpeech, NativeTranscriptAssembler, startNativeDictation, stopNativeDictation } from "./nativeSpeech";
import type { ParsedDoc, ProjectDocument } from "./projectDocs";
import { invoke } from "@tauri-apps/api/core";
import { UpdateChecker } from "./UpdateChecker";
import { ChatScreen } from "./ChatScreen";
import { getDiscordName, setDiscordName, getRequestWebhook, setRequestWebhook, isDiscordWebhook, requestAnnouncement, sendRequestToDiscord, fetchDiscordRequests, postUnlockToDiscord, postUnlockDecline, markMessageHandled, discordReadingConfigured, getBotToken, setBotToken, getRequestsChannelId, setRequestsChannelId, getRelayChannelId, setRelayChannelId, messagingConnected, type DiscordRequestMessage } from "./discordLink";
import { checkProjectSync, syncNote } from "./startupSync";
import { ACCESS_LEVEL_LABELS, fetchSharedAccessMap, loadAccessMap, publishAccessMap, setFileAccess, type FileAccessMap } from "./fileAccess";
import { getNickname } from "./profileInfo";
import { downloadProjectViaLinks, fetchCatalog, getCatalogUrl, publishReaderLinks, readerLinksConfigured } from "./readerLinks";
import { loadPronunciations, savePronunciations, type Pronunciation } from "./pronunciation";
import { addListeningSeconds, listeningLine, loadListeningStats, recordChapterFinished } from "./listeningStats";
import { loadChapterQuestions, questionsForChapter, saveChapterQuestions } from "./chapterQuestions";
import { loadScheduledReleases, saveScheduledReleases } from "./readerCopies";
import { postRelayMessage } from "./discordLink";
import { latestProgressReports } from "./ChatScreen";
import { auditForAI, auditProse, humanMakerSharedWithEditors, setHumanMakerSharedWithEditors, type AuditReport } from "./humanMaker";
import { OkGoButton } from "./OkGoButton";
import { WalkthroughWindow } from "./WalkthroughWindow";
import { loadPeople, parseProfileMessage, publishPeople, removePerson, savePeople, sortedPeople, upsertPerson, type Person } from "./people";
import { addFeedback, diagnosticsReport, FEEDBACK_AREAS, feedbackMessage, loadErrors, loadFeedback, loadUsage, markFeedbackSent, noteUsage, setShareDiagnostics, shareDiagnostics, watchForErrors } from "./feedback";
import { activeProject, addProject, allProjects, applyActiveProject, isSafeDropboxRoot, isSafeProjectName, removeProject, setActiveProjectId } from "./projects";
import {
  actionsPath, actionLog, claudeAccessOn, claudeInstructions, describeAction,
  handledIds, logAction, markHandled, needsOkGo, parseActions, setClaudeAccess,
  updateLogState, type ActionRecord, type ClaudeAction
} from "./claudeActions";
import { recordJoin } from "./contacts";
import { EMPTY_READER_PROFILE, hasProfilePin, isValidPin, loadReaderProfile, readerProfileSummary, saveReaderProfile, setNickname, setProfilePin, type ReaderProfile } from "./profileInfo";
import { ReadSelectionButton } from "./ReadSelectionButton";

type Screen = "profile" | "home" | "projects" | "project-workspace" | "project-explorer" | "project-zero" | "project-review" | "workspace-files" | "library" | "reader" | "settings" | "comment" | "comments" | "talk" | "voice-targets" | "dashboard" | "request-access" | "unlock" | "chat" | "directions" | "idea" | "human-maker" | "claude-access" | "people" | "feedback";

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

// The OK GO button lives in its own small always-on-top window so it can float
// over Claude and be dragged anywhere on the screen.
const IS_OKGO_WINDOW =
  typeof window !== "undefined" && window.location.hash.replace(/^#/, "") === "okgo";

const IS_WALK_WINDOW =
  typeof window !== "undefined" && window.location.hash.replace(/^#/, "") === "walkthrough";

async function openWalkthroughWindow(): Promise<void> {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const existing = await WebviewWindow.getByLabel("walkthrough");
  if (existing) {
    try { await existing.show(); await existing.setFocus(); } catch { /* ignore */ }
    return;
  }
  // eslint-disable-next-line no-new
  new WebviewWindow("walkthrough", {
    url: "index.html#walkthrough",
    title: "Show Me How",
    width: 380, height: 340, resizable: true, decorations: false,
    transparent: true, shadow: false, alwaysOnTop: true, center: false, focus: true
  });
}

async function openOkGoWindow(): Promise<void> {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const existing = await WebviewWindow.getByLabel("okgo");
  if (existing) {
    try { await existing.show(); await existing.setFocus(); } catch { /* ignore */ }
    return;
  }
  // eslint-disable-next-line no-new
  new WebviewWindow("okgo", {
    url: "index.html#okgo",
    title: "OK GO",
    width: 250,
    height: 110,
    resizable: false,
    decorations: false,
    transparent: true,
    shadow: false,
    alwaysOnTop: true,
    center: false,
    focus: true
  });
}

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
    // Let dragged-in text reach the page itself, so dropping a highlighted
    // passage onto the bar reads it aloud.
    dragDropEnabled: false,
    // Sized to hug the buttons: mic almost touching the left curve, Close (✕)
    // right at the rounded end. Must match applyCompact in TalkScreen.
    width: 406,
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
  // The narrator speed a person chose at onboarding (or in Settings) follows
  // them into every chapter and every window.
  const [rate, setRate] = useState(() => {
    const saved = loadVoiceSettings(localStorage.getItem("long-rot-reader-name") || "local").speechRate;
    return [0.8, 1, 1.2].includes(saved) ? saved : 1;
  });
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
  const [syncMessage, setSyncMessage] = useState("");
  const [discordWaiting, setDiscordWaiting] = useState(0);
  const [commentsSending, setCommentsSending] = useState(false);
  const [commentsNote, setCommentsNote] = useState("");
  const [ideaText, setIdeaText] = useState("");
  const [ideaListening, setIdeaListening] = useState(false);
  const [sleepMinutes, setSleepMinutes] = useState(0);
  const [claudeLog, setClaudeLog] = useState<ActionRecord[]>(actionLog);
  const [claudeOn, setClaudeOn] = useState(claudeAccessOn);
  const [people, setPeople] = useState<Person[]>(() => sortedPeople(loadPeople()));
  const [peopleBusy, setPeopleBusy] = useState(false);
  const [feedbackArea, setFeedbackArea] = useState(FEEDBACK_AREAS[0]);
  const [feedbackKind, setFeedbackKind] = useState<"rating" | "idea" | "problem">("rating");
  const [feedbackRating, setFeedbackRating] = useState(5);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [shareDiag, setShareDiag] = useState(shareDiagnostics);
  const [appVersion, setAppVersion] = useState("");
  const [projectList, setProjectList] = useState(allProjects);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectRoot, setNewProjectRoot] = useState("");
  const sleepDeadline = useRef(0);
  const lastStopAt = useRef(0);
  const [shelf, setShelf] = useState<ParsedDoc[]>([]);
  const [readMyself, setReadMyself] = useState(false);
  const [unlockedChapters, setUnlockedChapters] = useState<number[]>(() => loadUnlockedChapters());
  const [docFailed, setDocFailed] = useState(false);
  const refreshRequests = useCallback(() => setRequests(pendingRequests()), []);
  const startupRan = useRef(false);
  const settingsReturn = useRef<Screen>("home");
  // Comment dictation runs through the bundled Windows helper — the browser
  // speech engine does not exist inside the installed app.
  const commentDictation = useRef(new NativeTranscriptAssembler());
  const commentDictationActive = useRef(false);

  function openSettingsFrom(from: Screen) {
    settingsReturn.current = from;
    setScreen("settings");
  }

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
        // Every window names its project before reading, so a chapter window
        // never looks in the wrong project's folder.
        await applyActiveProject();
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
        setDocFailed(true);
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

  // The Projects tile tells the truth about the workspace instead of a
  // hard-coded warning.
  useEffect(() => {
    if (screen !== "projects" || !("__TAURI_INTERNALS__" in window)) return;
    void workspaceStatus().then(setWorkspace).catch(() => undefined);
  }, [screen]);

  // The main hub listens for the companion window's request to open Settings.
  useEffect(() => {
    if (IS_COMPANION_WINDOW || !("__TAURI_INTERNALS__" in window)) return;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen("mcg://open-settings", () => openSettingsFrom("home")).then((un) => { unlisten = un; })
    );
    return () => { if (unlisten) unlisten(); };
  }, []);

  // The guide window takes this window with it, step by step.
  useEffect(() => {
    if (IS_COMPANION_WINDOW || IS_OKGO_WINDOW || IS_WALK_WINDOW || !("__TAURI_INTERNALS__" in window)) return;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen<string>("mcg://go-to-screen", (event) => {
        const wanted = event.payload as Screen;
        if (wanted === "settings") settingsReturn.current = "home";
        setScreen(wanted);
      }).then((un) => { unlisten = un; })
    );
    return () => { if (unlisten) unlisten(); };
  }, []);

  // Watch for problems, and keep a plain count of what gets used.
  useEffect(() => { watchForErrors(); }, []);
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) { setAppVersion("dev"); return; }
    void import("@tauri-apps/api/app").then(({ getVersion }) => getVersion()).then(setAppVersion).catch(() => undefined);
  }, []);
  useEffect(() => { if (screen) noteUsage(screen); }, [screen]);

  // Startup checks in the main hub only: verify local files against Dropbox,
  // pull the shared chapter releases, and check for waiting Discord requests —
  // all quietly in the background. Nothing is downloaded or changed. Runs once
  // per session, including the session where someone just finished onboarding.
  useEffect(() => {
    if (IS_COMPANION_WINDOW || DOC_WINDOW_PATH || FILE_WINDOW_PATH || !("__TAURI_INTERNALS__" in window)) return;
    if (!readerName || startupRan.current) return;
    startupRan.current = true;
    void applyActiveProject();
    if (getDropboxCreds() || !readerLinksConfigured()) {
      void fetchSharedReleases(client).then((released) => { if (released) setUnlockedChapters(released); }).catch(() => undefined);
      void checkProjectSync(client).then((result) => setSyncMessage(syncNote(result))).catch(() => undefined);
    } else {
      // Link-based readers: the catalog carries the released-chapter list.
      void fetchCatalog().then((catalog) => { if (catalog?.released.length) setUnlockedChapters(catalog.released); }).catch(() => undefined);
    }
    if (canPerform(realProfileRole(readerName), "manage") && discordReadingConfigured()) {
      void fetchDiscordRequests().then((found) => setDiscordWaiting(found.length)).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readerName]);

  // ---- Claude's hands ------------------------------------------------------
  // Carry out one request. Anything that touches the book itself is not run
  // here — it is queued for OK GO by the poller below.
  const runClaudeAction = useCallback(async (action: ClaudeAction): Promise<string> => {
    switch (action.kind) {
      case "open_screen": {
        const allowed: Screen[] = ["home", "library", "reader", "settings", "projects", "project-workspace", "project-explorer", "human-maker", "chat", "dashboard", "idea", "comments", "workspace-files", "directions"];
        const wanted = action.screen as Screen;
        if (!allowed.includes(wanted)) throw new Error(`There is no screen called ${action.screen}.`);
        if (wanted === "settings") settingsReturn.current = "home";
        setScreen(wanted);
        return `Opened ${wanted}.`;
      }
      case "set_setting": {
        const current = loadVoiceSettings(readerName || "local");
        const numeric = ["speechRate", "silenceSeconds", "addSeconds"];
        const flags = ["readRepliesAutomatically", "listenAfterReading", "skipContentBoxes", "includeStoryContext"];
        if (numeric.includes(action.setting!)) {
          const value = Number(action.value);
          if (!Number.isFinite(value)) throw new Error("That setting needs a number.");
          saveVoiceSettings(readerName || "local", { ...current, [action.setting!]: value });
          if (action.setting === "speechRate") setRate(value);
        } else if (flags.includes(action.setting!)) {
          saveVoiceSettings(readerName || "local", { ...current, [action.setting!]: Boolean(action.value) });
        } else {
          throw new Error(`${action.setting} is not a setting Claude can change.`);
        }
        return `${action.setting} is now ${String(action.value)}.`;
      }
      case "add_pronunciation": {
        const next = [...loadPronunciations().filter((p) => p.say.toLowerCase() !== action.say!.toLowerCase()), { say: action.say!, as: action.as! }];
        savePronunciations(next);
        return `The narrator now says "${action.say}" as "${action.as}".`;
      }
      case "make_note": {
        const saved = await invoke<string>("save_idea_note", { content: action.text });
        return `Saved ${saved}.`;
      }
      case "new_file": {
        await invoke("write_workspace_file", { localRelativePath: action.path, content: action.text ?? "" });
        return `Wrote ${action.path}.`;
      }
      case "say": {
        player.current.speak(action.text!.slice(0, 2000), rate, () => undefined, () => undefined);
        return "Read aloud.";
      }
      case "move_file": {
        await invoke("move_workspace_file", { fromRelative: action.path, toRelative: action.to });
        return `Moved ${action.path} to ${action.to}.`;
      }
      case "release_chapters": {
        const next = [...new Set([...loadUnlockedChapters(), ...(action.chapters ?? [])])].sort((a, b) => a - b);
        saveUnlockedChapters(next);
        setUnlockedChapters(next);
        await publishReleases(client).catch(() => undefined);
        return `Released chapters ${next.join(", ")}.`;
      }
      case "propose_edit": {
        const original = await invoke<string>("read_project_document", { localRelativePath: action.path });
        if (!original.includes(action.find!)) throw new Error("That passage was not found in the file, so nothing was changed.");
        const updated = original.replace(action.find!, action.replace!);
        await invoke("write_workspace_file", { localRelativePath: `01 Originals/${action.path!.replace(/^01 Originals\//, "")}`, content: updated });
        return `Rewrote a passage in ${action.path}.`;
      }
      default:
        throw new Error("Claude asked for something this app does not know how to do.");
    }
  }, [readerName, rate, client]);

  // Watch Dropbox for Claude's action file.
  useEffect(() => {
    if (IS_COMPANION_WINDOW || IS_OKGO_WINDOW || DOC_WINDOW_PATH || FILE_WINDOW_PATH) return;
    if (!("__TAURI_INTERNALS__" in window) || !readerName) return;
    let stopped = false;
    const poll = async () => {
      if (stopped || !claudeAccessOn()) return;
      try {
        const actions = parseActions(await client.readText(actionsPath()));
        const handled = handledIds();
        for (const action of actions) {
          if (handled.has(action.id)) continue;
          markHandled(action.id);
          if (needsOkGo(action.kind)) {
            setClaudeLog(logAction(action, "waiting", "Waiting for your OK GO."));
            setStatus(`Claude is asking to ${describeAction(action).toLowerCase()} — press OK GO on the Claude screen.`);
            continue;
          }
          try {
            const note = await runClaudeAction(action);
            setClaudeLog(logAction(action, "done", note));
          } catch (error) {
            setClaudeLog(logAction(action, "failed", message(error)));
          }
        }
      } catch { /* no action file yet, or the bridge is off */ }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 8000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [readerName, client, runClaudeAction]);

  // Listening stats tick while narration plays; the sleep timer watches the
  // same clock and puts the book down gently when time is up.
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      addListeningSeconds(readerName || "local", 5);
      if (sleepDeadline.current && Date.now() > sleepDeadline.current) {
        player.current.stop();
        setPlaying(false);
        sleepDeadline.current = 0;
        setSleepMinutes(0);
        setStatus("Sleep Timer — your place is saved. Goodnight.");
      }
    }, 5000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // Idea dictation mirrors the live transcript into the note.
  useEffect(() => {
    if (screen === "idea" && ideaListening) setIdeaText(liveTranscript);
  }, [liveTranscript, screen, ideaListening]);

  // Comment dictation: the helper's words stream into the live transcript and
  // keep the silence countdown honest while a comment is being recorded.
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let unlisten: (() => void) | undefined;
    void listenForNativeSpeech((event) => {
      if (!commentDictationActive.current) return;
      const words = commentDictation.current.update(event);
      if (!words.trim()) return;
      setLiveTranscript(words);
      silenceDeadline.current = Date.now() + silenceAllowance.current * 1000;
    }).then((remove) => { unlisten = remove; });
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

  // A finished chapter counts toward the listening stats and (with consent
  // wording shown at onboarding) tells the author how far this reader is.
  const reportProgress = useCallback((percent: number) => {
    const active = documentRef.current;
    if (!active || !readerName || !messagingConnected() || canPerform(profileRole(readerName), "manage")) return;
    const text = `${cleanTitle(active.name)} · ${Math.min(100, Math.max(0, Math.round(percent)))}%`;
    try {
      if (localStorage.getItem("mcg-progress-last") === text) return;
      localStorage.setItem("mcg-progress-last", text);
    } catch { /* ignore */ }
    void postRelayMessage({ room: "progress", author: readerName, text });
  }, [readerName]);

  const speakAt = useCallback((index: number, activeDocument = documentRef.current) => {
    if (!activeDocument || !activeDocument.segments[index]) {
      setPlaying(false);
      setStatus("Finished");
      if (activeDocument && activeDocument.segments.length > 0 && index >= activeDocument.segments.length) {
        recordChapterFinished(readerName || "local");
        reportProgress(100);
      }
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
  }, [rate, readerName, reportProgress]);

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
    // Audiobook-style resume: start one sentence back so the scene re-forms.
    const restored = Math.min(position?.segmentIndex || 0, Math.max(0, chosen.segments.length - 1));
    setSegmentIndex(Math.max(0, restored - (restored > 0 ? 1 : 0)));
    setStatus(position ? "Position restored — starting one sentence back for context" : "Ready to read");
    setScreen("reader");
  }

  function togglePlayback() {
    if (!document) return;
    if (playing && !player.current.paused) {
      player.current.pause();
      setPlaying(false);
      lastStopAt.current = Date.now();
      setStatus("Paused — position saved");
      return;
    }
    if (player.current.paused) {
      player.current.resume();
      setPlaying(true);
      setStatus("Reading");
      return;
    }
    // Coming back after a real break: step one sentence back so the thread of
    // the scene re-forms, the way audiobooks rewind a few seconds.
    const awayMinutes = lastStopAt.current ? (Date.now() - lastStopAt.current) / 60000 : 0;
    if (awayMinutes > 5 && segmentIndex > 0) {
      const from = segmentIndex - 1;
      setSegmentIndex(from);
      speakAt(from, document);
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
    if (document?.segments.length) {
      reportProgress(((segmentIndex + 1) / document.segments.length) * 100);
    }
    if (DOC_WINDOW_PATH) { void closeCurrentWindow(); return; }
    player.current.stop();
    setPlaying(false);
    lastStopAt.current = Date.now();
    documentRef.current = null;
    setDocument(null);
    setScreen("library");
    setStatus("Position saved on this device");
  }

  async function startComment(category = "General Comment") {
    if (!document || !document.segments.length) return;
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
      category,
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
      const inApp = "__TAURI_INTERNALS__" in window;
      await recorder.current.start(
        () => { silenceDeadline.current = Date.now() + silenceAllowance.current * 1000; },
        setLiveTranscript,
        // The installed app has no browser speech engine; the bundled Windows
        // dictation helper transcribes instead.
        !inApp
      );
      if (inApp) {
        try {
          commentDictation.current.reset();
          commentDictationActive.current = true;
          await startNativeDictation();
        } catch {
          commentDictationActive.current = false;
        }
      }
      setStatus("Recording comment");
    } catch (error) {
      const failed = { ...draft, status: "confirming" as const, updatedAt: new Date().toISOString() };
      await saveComment(failed);
      setComment(failed);
      setStatus(`${message(error)} You can type the comment instead. Your reading position is safe.`);
    }
  }

  // One tap, no interruption: a reaction anchored to the current sentence,
  // saved as a comment with no audio, sent with the normal Submit.
  async function quickReaction(label: string) {
    if (!document || !document.segments.length) return;
    const anchor = document.segments[segmentIndex];
    const now = new Date().toISOString();
    await saveComment({
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
      transcriptionOriginal: label,
      transcriptionConfirmed: label,
      category: `Reaction — ${label}`,
      status: "saved",
      silenceAllowanceSeconds: 0,
      createdAt: now,
      updatedAt: now
    });
    setStatus(`${label} — noted right here. It goes to MaggotClaw with your next Submit.`);
  }

  async function finishComment() {
    if (!comment || finishing.current) return;
    finishing.current = true;
    try {
      if (commentDictationActive.current) {
        commentDictationActive.current = false;
        // A short beat lets the last spoken words arrive before stopping.
        await new Promise((resolve) => window.setTimeout(resolve, 250));
        await stopNativeDictation().catch(() => undefined);
      }
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
    if (commentDictationActive.current) {
      commentDictationActive.current = false;
      void stopNativeDictation().catch(() => undefined);
    }
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
    // Return to wherever Settings was opened from — Save and Cancel agree.
    setScreen(settingsReturn.current);
    setStatus("Settings saved on this device");
  }

  function saveProfile(info: { name: string; discordName?: string; wantedRole?: ProjectRole; nickname?: string; pin?: string; readingSpeed?: number; details?: ReaderProfile }) {
    const clean = info.name.trim();
    if (!clean) return;
    const discordName = info.discordName ?? "";
    const wantedRole = info.wantedRole ?? "reader";
    localStorage.setItem("long-rot-reader-name", clean);
    if (discordName.trim()) setDiscordName(clean, discordName);
    if (info.nickname?.trim()) setNickname(clean, info.nickname);
    // Their answers stay on their machine, and go to the author once so he
    // knows who is reading his book.
    if (info.details) {
      const known = loadReaderProfile(clean);
      saveReaderProfile(clean, info.details);
      const changed = JSON.stringify(known) !== JSON.stringify(info.details);
      if (changed && Object.values(info.details).some((value) => value.trim())) {
        void sendRequestToDiscord(readerProfileSummary(clean, roleLabel(wantedRole), info.details));
      }
    }
    if (info.pin && isValidPin(info.pin)) void setProfilePin(clean, info.pin);
    if (info.readingSpeed) {
      const voiceNow = loadVoiceSettings(clean);
      saveVoiceSettings(clean, { ...voiceNow, speechRate: info.readingSpeed });
    }
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
    // Projects is the working area. A reader is told plainly why the door is
    // shut and offered the way through it, rather than being silently moved.
    if (!canPerform(role, "review")) {
      if (window.confirm("Projects is the working area — editing the book needs the owner's approval.\n\nWould you like to ask MaggotClaw for access now?")) {
        setRequestCode("");
        setScreen("request-access");
      }
      return;
    }
    setScreen("projects");
  }

  function openDashboard() {
    refreshRequests();
    setScreen("dashboard");
  }

  function decideRequest(id: string, approve: boolean) {
    const request = requests.find((r) => r.id === id);
    decideAccessRequest(id, approve, readerName);
    // An approved person becomes (or updates) a messaging contact, so their
    // name can appear under Direct Messages at the right level.
    if (approve && request) recordJoin(request.name, "", request.requestedRole);
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
    // Approvals can carry the team messaging connection along for free.
    if (payload.messaging) {
      setBotToken(payload.messaging.botToken);
      setRelayChannelId(payload.messaging.channelId);
    }
    setScreen("home");
    setStatus(`Access granted. You are now ${roleLabel(payload.role)}.${payload.messaging ? " Team messaging is connected." : ""}`);
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
          await client.writeText(`${activeProject().dropboxRoot}/${relative}`, content);
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
      // With keys, talk to Dropbox (or the bridge) directly; without keys, a
      // reader's machine downloads through its no-secrets catalog links.
      const result = getDropboxCreds() || !readerLinksConfigured()
        ? await downloadProject(client, role, setWorkspaceProgress)
        : await downloadProjectViaLinks(role, setWorkspaceProgress);
      setWorkspace(await workspaceStatus());
      setStatus(`${result.stage} Dropbox was not changed.`);
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

  // A chapter window is only ever a chapter: while it loads (or if it fails)
  // it shows a simple message, never a second copy of the whole hub.
  if (DOC_WINDOW_PATH && !document) {
    return <main className="app-shell">
      <header className="topbar"><button className="text-button" onClick={() => { void closeCurrentWindow(); }}>← Close</button><span className="eyebrow">{activeProject().name}</span></header>
      <section className="empty-state" style={{ marginTop: 40 }}>
        <strong>{docFailed ? "This chapter could not be opened." : "Opening chapter…"}</strong>
        <p>{docFailed ? "The file may have moved or been renamed. Close this window and refresh the shelf." : "One moment."}</p>
      </section>
    </main>;
  }

  if (FILE_WINDOW_PATH) {
    return <FileWindow relative={FILE_WINDOW_PATH} />;
  }

  if (IS_WALK_WINDOW) {
    return <WalkthroughWindow isOwner={canPerform(realProfileRole(readerName), "manage")} onClose={() => { void closeCurrentWindow(); }} />;
  }

  if (IS_OKGO_WINDOW) {
    return <OkGoButton readerName={readerName || "Reader"} onClose={() => { void closeCurrentWindow(); }} />;
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
    return <TalkScreen readerName={readerName} onBack={() => setScreen("voice-targets")} onSettings={() => { localStorage.removeItem("long-rot-companion-active"); openSettingsFrom("talk"); }} />;
  }

  if (screen === "settings") {
    return <Settings initial={settings} onSave={saveSettings} onCancel={() => setScreen(settingsReturn.current)} />;
  }

  if (screen === "idea") {
    return <main className="app-shell settings-panel">
      <button className="text-button mode-back" onClick={() => {
        if (ideaListening) { commentDictationActive.current = false; setIdeaListening(false); void stopNativeDictation().catch(() => undefined); }
        setScreen("home");
      }}>← Back</button>
      <BrandLogo compact /><p className="eyebrow">NOTE TO SELF</p><h1>Catch The Idea</h1>
      <p>Speak or type it. It lands dated in 02 Working Files → Ideas — never touching the book until you promote it.</p>
      <label>The idea<textarea rows={8} value={ideaText} placeholder="Speak, or type here…" onChange={(event) => setIdeaText(event.target.value)} /></label>
      <div className="form-actions">
        {"__TAURI_INTERNALS__" in window && <button onClick={() => {
          if (ideaListening) {
            commentDictationActive.current = false;
            setIdeaListening(false);
            void stopNativeDictation().catch(() => undefined);
            setStatus("Stopped listening — tidy the words, then Save.");
          } else {
            commentDictation.current.reset();
            setLiveTranscript(ideaText);
            commentDictationActive.current = true;
            setIdeaListening(true);
            void startNativeDictation().catch(() => { commentDictationActive.current = false; setIdeaListening(false); setStatus("The microphone could not start — type the idea instead."); });
          }
        }}>{ideaListening ? "■ Stop Listening" : "🎤 Speak The Idea"}</button>}
        <button className="primary" disabled={!ideaText.trim()} onClick={() => {
          if (ideaListening) { commentDictationActive.current = false; setIdeaListening(false); void stopNativeDictation().catch(() => undefined); }
          void invoke<string>("save_idea_note", { content: ideaText })
            .then((saved) => { setIdeaText(""); setScreen("home"); setStatus(`Idea saved — ${saved}`); })
            .catch((error) => setStatus(message(error)));
        }}>Save Idea</button>
      </div>
      <footer className="safe-status">{status}</footer>
    </main>;
  }

  if (screen === "request-access") {
    return <RequestAccess role={role} code={requestCode} onSend={sendAccessRequest} onCancel={() => { setRequestCode(""); setScreen("home"); }} />;
  }

  if (screen === "unlock") {
    return <RedeemUnlock name={readerName} onRedeem={redeemUnlockCode} onCancel={() => setScreen("home")} />;
  }

  if (screen === "dashboard") {
    return <OwnerDashboard requests={requests} onDecide={decideRequest} onBack={() => setScreen("home")} client={client} onReleasesChanged={setUnlockedChapters} />;
  }

  if (screen === "chat") {
    return <ChatScreen role={role} name={readerName} onBack={() => setScreen("home")} onOpenDiscord={() => { void openDiscordWindow(); }} />;
  }

  if (screen === "directions") {
    return <main className="app-shell directions-shell">
      <header className="topbar"><button className="text-button" onClick={() => setScreen("home")}>← Back</button><span className="eyebrow">Directions</span><span className="who-chip">{readerName} · {roleLabel(role)}</span></header>
      <section className="projects-heading"><h1>Finding Your Way Around</h1><p>What each part of MaggotClaw Games does.</p></section>
      <section className="directions-grid">
        <article><h2>Reader Mode</h2><p>The book itself. Pick a chapter, then choose Narrated (she reads to you, sentence by sentence) or Read myself (a normal book page). Locked chapters are not released yet. Press Comment while reading to record a note tied to the exact sentence.</p></article>
        <article><h2>Voice Companion</h2><p>Talk out loud and your words are typed into Claude or Codex for you. The little bar floats above the AI program: microphone to start, + to add time, ➤ to send now, ■ to stop, ✕ to close.</p></article>
        <article><h2>Projects</h2><p>The working side. Open a project to see its workspace: Explore Files browses every chapter and codex, Chapters shows what is finished, Codex is the story brain, and the search finds every mention of anything. Download or Update refreshes your local copies from Dropbox.</p></article>
        <article><h2>Messages</h2><p>Rooms for readers, editors, and the author. Post in a room, or open the full Messages window (Discord) for voice calls. Access requests also land there for the owner.</p></article>
        <article><h2>Requesting more access</h2><p>Everyone starts as a Reader. Request access sends your ask to the owner; when approved you get an unlock code — paste it under Enter unlock code and your new role is live.</p></article>
        <article><h2>Owner Dashboard</h2><p>Owner only: approvals waiting, requests pulled from Discord, and the paste-a-code fallback. Approving posts the unlock code back automatically.</p></article>
        {canPerform(role, "manage") && <article className="owner-directions"><h2>For MaggotClaw — One-Time Setup</h2><p>1. Settings → Owner → Project Files → <strong>Import From The Bridge</strong>, then Save. Your computer now talks to Dropbox itself — the bridge no longer needs to run.<br/>2. Projects → your project → View The File List → rate the files → <strong>Publish Reader Links</strong>. This makes the read-only links friends download the book through.<br/>3. Messages → <strong>Copy Messaging Key</strong>. Send that one key privately to each friend — it connects their chat and their book downloads.</p></article>}
        {canPerform(role, "manage") && <article className="owner-directions"><h2>For MaggotClaw — Everyday</h2><p><strong>Release a chapter:</strong> Owner Dashboard → Released Chapters → tick it → Publish. Every reader's app picks it up when it next opens.<br/><strong>Someone asks for access:</strong> the alert appears when the app opens; approve from the dashboard and the unlock code posts back to Discord by itself.<br/><strong>Push your writing:</strong> Download or Update pulls the latest; files you drop in 05 Approved Uploads go up with Upload Approved. Revised chapters reach readers automatically — links always serve the newest version.<br/><strong>New app version for everyone:</strong> ask your assistant to build and push the update; friends get it from Check For Updates.</p></article>}
        <article><h2>Settings</h2><p>Voice Companion choices, updates and the share link, and for the owner: Discord keys and View as — see the whole app the way a Reader or Editor sees it, then click your name to come back.</p></article>
        <article><h2>The OK GO Button</h2><p>A small green button that floats over everything and can be dragged anywhere you like. Press it and it counts down three, two, one before "OK GO" goes through to the AI — press again during the countdown to call it off. Nothing is ever approved by accident.</p></article>
        {canPerform(role, "manage") && <article className="owner-directions"><h2>For MaggotClaw — Human Maker</h2><p>Your prose bench. Pick a chapter or paste a passage and press Run The Audit: it scans against your own Human Maker codex — all forty-five tells, your numbering, your fixes — entirely on this computer.<br/>The mechanical tells are caught automatically. The ones no machine can judge (voice, flair, subtext, dialogue friction) are listed underneath to read aloud for.<br/><strong>Copy Audit For The Rewrite</strong> puts the findings, the Ward Directive, and the canon protections on your clipboard — paste that to Claude with the passage and say Ok Go.</p></article>}
      </section>
    </main>;
  }

  if (screen === "home") {
    return <main className="app-shell home-shell">
      <span className="who-chip home-corner">{readerName || "Guest"} · {roleLabel(role)}</span>
      <header className="hero"><BannerWithVersion /></header>
      <section className="home-toolbar">
        {canPerform(role, "manage") && <button className="pill-button chip" onClick={openDashboard}>Owner Dashboard{(requests.length + discordWaiting) > 0 && <span className="pending-badge">{requests.length + discordWaiting}</span>}</button>}
        <button className="pill-button chip" onClick={() => openSettingsFrom("home")}>Settings</button>
        <button className="pill-button chip" onClick={() => setScreen("directions")}>Directions</button>
        {getViewAs()
          ? <button className="pill-button chip" onClick={() => { setViewAs(null); window.location.reload(); }}>Viewing as {roleLabel(role)} — back</button>
          : <button className="pill-button chip" onClick={() => setScreen("profile")}>{readerName || "Start Here"}</button>}
        {"__TAURI_INTERNALS__" in window && <button className="pill-button chip" onClick={() => { setIdeaText(""); setScreen("idea"); }}>Note To Self</button>}
        {/* The author's own bench — owner-only unless he shares it with editors. */}
        {(canPerform(role, "manage") || (humanMakerSharedWithEditors() && canPerform(role, "upload"))) &&
          <button className="pill-button chip" onClick={() => setScreen("human-maker")}>Human Maker</button>}
        {"__TAURI_INTERNALS__" in window && canPerform(role, "propose") &&
          <button className="pill-button chip" onClick={() => { void openOkGoWindow(); }}>OK GO Button</button>}
        {"__TAURI_INTERNALS__" in window && <button className="pill-button chip" onClick={() => { void openWalkthroughWindow(); }}>Show Me How</button>}
        <button className="pill-button chip" onClick={() => setScreen("feedback")}>Tell MaggotClaw</button>
        {canPerform(role, "manage") && <button className="pill-button chip" onClick={() => setScreen("people")}>People</button>}
        {canPerform(role, "manage") && <button className="pill-button chip" onClick={() => setScreen("claude-access")}>
          Claude{claudeLog.some((r) => r.state === "waiting") && <span className="pending-badge">{claudeLog.filter((r) => r.state === "waiting").length}</span>}
        </button>}
      </section>
      {readerName === "Test Profile" && <div className="test-mode-banner">TEST PROFILE — LOCAL ONLY — NOTHING IS SYNCHRONIZED</div>}
      {discordWaiting > 0 && canPerform(role, "manage") && <section className="welcome-strip">
        <span className="reader-note"><strong>{discordWaiting} Access Request{discordWaiting === 1 ? " Is" : "s Are"} Waiting On Discord.</strong> <button className="text-button inline" onClick={openDashboard}>Open The Owner Dashboard</button></span>
      </section>}
      {syncMessage && <section className="welcome-strip">
        <span className="reader-note">{syncMessage}. {syncMessage.includes("Newer") && <button className="text-button inline" onClick={() => { void openLongRotWorkspace(); }}>Open The Workspace To Update</button>}</span>
      </section>}
      {!canPerform(role, "manage") && <section className="welcome-strip">
        <span className="reader-note">You can read and comment right away. Need to edit? <button className="text-button inline" onClick={() => { setRequestCode(""); setScreen("request-access"); }}>Request access</button> · <button className="text-button inline" onClick={() => setScreen("unlock")}>Enter unlock code</button></span>
      </section>}
      <section className="mode-grid">
        <button className="mode-card" onClick={() => setScreen("library")}><img className="mode-icon image-icon" src={activeProject().icon} alt="" /><span><strong>Reader Mode</strong><small>Read or listen, save your place, and record comments.</small></span><span>→</span></button>
        <button className="mode-card voice-mode" onClick={() => setScreen("voice-targets")}><span className="mode-icon voice-mic-mark" aria-hidden="true" /><span><strong>Voice Companion</strong><small>Talk with Claude or Codex now. ChatGPT will be added later.</small></span><span>→</span></button>
        <button className="mode-card project-mode" onClick={openProjects}><img className="mode-icon image-icon" src="/mcg-social-circle.png" alt="MaggotClaw Games" /><span><strong>Projects</strong><small>{canPerform(role, "review") ? "Open a project, review its local files, and use the actions allowed for your role." : "Editing the project files needs approval from the owner."}</small></span><span>→</span></button>
        <button className="mode-card chat-mode" onClick={() => setScreen("chat")}><span className="mode-icon chat-mark" aria-hidden="true" /><span><strong>Messages</strong><small>Rooms and voice calls for readers, editors, and the author.</small></span><span>→</span></button>
      </section>
    </main>;
  }

  if (screen === "projects") {
    return <main className="app-shell projects-list-shell">
      <header className="topbar"><button className="text-button" onClick={() => setScreen("home")}>← Back</button><span className="eyebrow">PROJECTS</span><span className="who-chip">{readerName} · {roleLabel(role)}</span></header>
      <section className="projects-heading"><h1>Your Projects</h1><p>Select a project to open its local workspace and available actions.</p></section>
      <section className="project-tiles">
        {projectList.map((project) => {
          const isActive = project.id === activeProject().id;
          return <button key={project.id} className={project.id === "project-zero" ? "project-tile project-zero-tile" : "project-tile"} onClick={() => {
            if (project.id === "project-zero") { setActiveProjectId(project.id); void applyActiveProject(); setScreen("project-zero"); return; }
            setActiveProjectId(project.id);
            void applyActiveProject().then(() => openLongRotWorkspace());
          }}>
            <img className="project-placeholder project-icon-image" src={project.icon} alt="" />
            <span><strong>{project.name}</strong><small>{project.id === "project-zero"
              ? "Project added · Folder ready on Dropbox, nothing in it yet"
              : isActive && workspace?.initialized
                ? `${workspace.downloadedFiles} Files On This Computer${syncMessage ? ` · ${syncMessage}` : ""}`
                : "Open To Set Up"}</small></span>
            <span>Open →</span>
          </button>;
        })}
      </section>
      {canPerform(role, "manage") && <section className="dash-section">
        <h2>Add A Project</h2>
        <p className="board-hint">MaggotClaw Games can work on anything. Give the project a name and the Dropbox folder its files live in.</p>
        <div className="pronun-row">
          <input value={newProjectName} placeholder="Project name" onChange={(event) => setNewProjectName(event.target.value)} />
          <input value={newProjectRoot} placeholder="/Folder On Dropbox" onChange={(event) => setNewProjectRoot(event.target.value)} />
          <button className="primary tiny" disabled={!isSafeProjectName(newProjectName) || !isSafeDropboxRoot(newProjectRoot)} onClick={() => {
            addProject(newProjectName, newProjectRoot);
            setProjectList(allProjects());
            setNewProjectName(""); setNewProjectRoot("");
            setStatus("Project added. Open it to set up its local workspace.");
          }}>Add</button>
        </div>
        {projectList.filter((p) => !p.builtIn).map((p) => <div key={p.id} className="pronun-row">
          <input value={`${p.name} — ${p.dropboxRoot}`} readOnly />
          <button className="text-button" onClick={() => { removeProject(p.id); setProjectList(allProjects()); }}>✕</button>
        </div>)}
      </section>}
    </main>;
  }

  if (screen === "project-zero") {
    return <main className="app-shell project-shell">
      <header className="topbar"><button className="text-button" onClick={() => setScreen("projects")}>← Back</button><span className="eyebrow">PROJECT ZERO AUTHOR</span><span className="who-chip">{readerName} · {roleLabel(role)}</span></header>
      <section className="project-heading"><div><p className="eyebrow">PROJECT ADDED</p><h1>Project Zero Author</h1><p>This project is selectable. Its local filing structure and remote source still need to be configured.</p></div></section>
      <section className="workspace-card"><div><span>Local workspace</span><strong>Not prepared</strong><small>No Project Zero Author files have been created or changed.</small></div><div><span>Remote files</span><strong>Not connected</strong><small>No Dropbox location or other source has been assigned.</small></div><div><span>Project actions</span><strong>Safely locked</strong><small>Download and upload stay unavailable until the project source is explicitly configured.</small></div></section>
      <section className="workspace-actions"><button disabled>Prepare Workspace</button><button disabled>Download or Update</button>{canPerform(role, "review") && <button disabled>Review Changes</button>}{canPerform(role, "upload") && <button disabled>Upload Approved</button>}</section>
      <footer className="safe-status">Project Zero Author has been added to the app. Nothing was synchronized.</footer>
    </main>;
  }

  if (screen === "project-review") {
    return <main className="app-shell project-shell">
      <header className="topbar"><button className="text-button" onClick={() => setScreen("project-workspace")}>← Back</button><span className="eyebrow">REVIEW QUEUE</span><span className="who-chip">{readerName} · {roleLabel(role)}</span></header>
      <section className="projects-heading"><h1>Proposed Changes</h1><p>Nothing is waiting for review yet. Future AI and human drafts will appear here before anything can be approved for upload.</p></section>
      <section className="empty-state"><strong>No proposed changes</strong><p>Dropbox remains unchanged.</p></section>
    </main>;
  }

  if (screen === "project-explorer") {
    return <ProjectExplorer onBack={() => setScreen("project-workspace")} />;
  }

  if (screen === "people") {
    return <main className="app-shell project-shell">
      <header className="topbar"><button className="text-button" onClick={() => setScreen("home")}>← Back</button><span className="eyebrow">PEOPLE</span><span className="who-chip">{readerName} · {roleLabel(role)}</span></header>
      <section className="projects-heading"><h1>Your People</h1><p>Everyone in the circle, what they told you when they joined, and how to reach them.</p></section>

      <section className="form-actions">
        <button className="primary" disabled={peopleBusy} onClick={() => {
          setPeopleBusy(true);
          void fetchDiscordRequests().then(() => undefined).catch(() => undefined);
          // Pull the onboarding summaries people's apps posted.
          void (async () => {
            try {
              const { invoke } = await import("@tauri-apps/api/core");
              const messages = await invoke<Array<{ content?: string }>>("fetch_discord_messages", {
                botToken: getBotToken(), channelId: getRequestsChannelId(), limit: 100, after: null
              });
              let roster = loadPeople();
              let found = 0;
              for (const message of Array.isArray(messages) ? messages : []) {
                const parsed = parseProfileMessage(message.content ?? "");
                if (parsed) { roster = upsertPerson(roster, parsed); found += 1; }
              }
              savePeople(roster);
              setPeople(sortedPeople(roster));
              setStatus(found ? `Found ${found} joining message${found === 1 ? "" : "s"}.` : "No new joining messages on Discord.");
            } catch (error) {
              setStatus(message(error));
            } finally {
              setPeopleBusy(false);
            }
          })();
        }}>{peopleBusy ? "Checking…" : "Check Discord For New People"}</button>
        <button disabled={peopleBusy || !people.length} onClick={() => {
          setPeopleBusy(true);
          void publishPeople(client, people)
            .then((written) => setStatus(`${written} people files written to the project's People folder on Dropbox.`))
            .catch(() => setStatus("The people files could not be written. Nothing was changed."))
            .finally(() => setPeopleBusy(false));
        }}>Save People Files To Dropbox</button>
      </section>

      <section className="comments-list">
        {people.length === 0 && <div className="empty-state"><strong>Nobody yet</strong><p>When someone finishes onboarding, their answers arrive in Discord — press Check Discord For New People and they land here.</p></div>}
        {people.map((person) => <article key={person.name} className="saved-comment">
          <div className="comment-meta"><span>{roleLabel(person.role)}</span><time>{person.joinedAt ? new Date(person.joinedAt).toLocaleDateString() : ""}</time></div>
          <h2>{person.name}{person.nickname ? ` — “${person.nickname}”` : ""}</h2>
          <div className="person-rows">
            {person.email && <span>✉ <a href={`mailto:${person.email}`} onClick={(e) => { e.preventDefault(); void import("@tauri-apps/api/core").then(({ invoke }) => invoke("open_url", { url: `mailto:${person.email}` })); }}>{person.email}</a></span>}
            {person.phone && <span>☎ {person.phone}</span>}
            {person.where && <span>📍 {person.where}</span>}
            {person.discord && <span>💬 {person.discord}</span>}
            {person.furthest && <span>📖 {person.furthest}</span>}
          </div>
          {person.reads && <p><strong>Reads:</strong> {person.reads}</p>}
          {person.authors && <p><strong>Favourites:</strong> {person.authors}</p>}
          {person.avoid && <p><strong>Rather not read:</strong> {person.avoid}</p>}
          {person.notes && <p><strong>Notes:</strong> {person.notes}</p>}
          <div className="request-actions">
            <label>Role<select value={person.role} onChange={(event) => {
              const next = upsertPerson(people, { name: person.name, role: event.target.value as ProjectRole });
              savePeople(next); setPeople(sortedPeople(next));
            }}>{ROLE_ORDER.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}</select></label>
            <button onClick={() => { setScreen("chat"); }}>Message</button>
            <button onClick={() => { if (window.confirm(`Remove ${person.name} from your people list? Their files on Dropbox stay where they are.`)) { const next = removePerson(people, person.name); savePeople(next); setPeople(sortedPeople(next)); } }}>Remove</button>
          </div>
        </article>)}
      </section>
      <footer className="safe-status">{status}</footer>
    </main>;
  }

  if (screen === "feedback") {
    const mine = loadFeedback();
    return <main className="app-shell project-shell">
      <header className="topbar"><button className="text-button" onClick={() => setScreen("home")}>← Back</button><span className="eyebrow">TELL MAGGOTCLAW</span><span className="who-chip">{readerName} · {roleLabel(role)}</span></header>
      <section className="projects-heading"><h1>What Do You Think?</h1><p>Rate a part of the app, send an idea, or report a problem. Nothing leaves this computer until you press send.</p></section>

      <section className="dash-section">
        <label>What is this about?<select value={feedbackArea} onChange={(event) => setFeedbackArea(event.target.value)}>
          {FEEDBACK_AREAS.map((area) => <option key={area}>{area}</option>)}
        </select></label>
        <label>Is this a rating, an idea, or a problem?<select value={feedbackKind} onChange={(event) => setFeedbackKind(event.target.value as typeof feedbackKind)}>
          <option value="rating">A rating</option><option value="idea">An idea</option><option value="problem">A problem</option>
        </select></label>
        {feedbackKind === "rating" && <div className="star-row">
          {[1, 2, 3, 4, 5].map((n) => <button key={n} className={n <= feedbackRating ? "star on" : "star"} onClick={() => setFeedbackRating(n)}>★</button>)}
        </div>}
        <label>Tell MaggotClaw in your own words<textarea rows={5} value={feedbackText} placeholder={feedbackKind === "problem" ? "What happened, and what were you doing?" : feedbackKind === "idea" ? "What would make this better?" : "What did you like or dislike?"} onChange={(event) => setFeedbackText(event.target.value)} /></label>
        <label className="check-setting"><input type="checkbox" checked={shareDiag} onChange={(event) => { setShareDiag(event.target.checked); setShareDiagnostics(event.target.checked); }} /> Include what went wrong technically (helps fix it — never includes your reading or writing)</label>
        <div className="form-actions">
          <button className="primary" disabled={!feedbackText.trim() || feedbackBusy} onClick={() => {
            setFeedbackBusy(true);
            const list = addFeedback({ kind: feedbackKind, area: feedbackArea, rating: feedbackKind === "rating" ? feedbackRating : undefined, text: feedbackText.trim(), from: readerName });
            const item = list[list.length - 1];
            const body = shareDiag && feedbackKind === "problem"
              ? `${feedbackMessage(item)}\n\n---\n${diagnosticsReport(appVersion, loadUsage(), loadErrors())}`
              : feedbackMessage(item);
            void sendRequestToDiscord(body).then((sent) => {
              if (sent) markFeedbackSent(item.id);
              setStatus(sent ? "Sent to MaggotClaw. Thank you." : "Saved here — it will go when the connection is back.");
              setFeedbackText("");
            }).finally(() => setFeedbackBusy(false));
          }}>{feedbackBusy ? "Sending…" : "Send To MaggotClaw"}</button>
        </div>
      </section>

      {mine.length > 0 && <section className="dash-section">
        <h2>What You Have Sent</h2>
        <ul className="request-list">{[...mine].reverse().slice(0, 20).map((item) => <li key={item.id} className="request-card">
          <div className="request-who"><strong>{item.kind === "rating" ? `${"★".repeat(item.rating ?? 0)} ${item.area}` : `${item.kind === "idea" ? "Idea" : "Problem"} — ${item.area}`}</strong><span className={item.sent ? "update-status ok" : "update-status warn"}>{item.sent ? "sent" : "waiting"}</span></div>
          <p className="request-reason">{item.text}</p>
        </li>)}</ul>
      </section>}
      <footer className="safe-status">{status}</footer>
    </main>;
  }

  if (screen === "claude-access") {
    const waiting = claudeLog.filter((r) => r.state === "waiting");
    return <main className="app-shell project-shell">
      <header className="topbar"><button className="text-button" onClick={() => setScreen("home")}>← Back</button><span className="eyebrow">CLAUDE</span><span className="who-chip">{readerName} · {roleLabel(role)}</span></header>
      <section className="projects-heading"><h1>Claude's Hands</h1><p>What Claude is allowed to do inside the app, everything it has done, and anything waiting on your OK GO.</p></section>

      <section className="dash-section">
        <label className="check-setting"><input type="checkbox" checked={claudeOn} onChange={(event) => { setClaudeOn(event.target.checked); setClaudeAccess(event.target.checked); }} /> Let Claude act inside this app</label>
        <p className="board-hint">When this is on, the app checks Dropbox every few seconds for Claude's requests. Opening screens, changing settings, teaching the narrator, saving notes and new files happen straight away. Rewrites, file moves, and chapter releases wait for your OK GO below.</p>
        <div className="form-actions"><button className="primary" onClick={() => { void navigator.clipboard?.writeText(claudeInstructions()).then(() => setStatus("Instructions copied — paste them to Claude.")).catch(() => undefined); }}>Copy The Instructions For Claude</button></div>
      </section>

      <section className="dash-section">
        <h2>Waiting For Your OK GO <span className="pending-badge">{waiting.length}</span></h2>
        {waiting.length === 0
          ? <div className="empty-state"><strong>Nothing waiting</strong><p>Anything Claude asks that would change the book itself appears here first.</p></div>
          : waiting.map((record) => <article key={record.action.id} className="request-card">
              <div className="request-who"><strong>{describeAction(record.action)}</strong><span>{new Date(record.at).toLocaleString()}</span></div>
              {record.action.why && <p className="request-reason">"{record.action.why}"</p>}
              {record.action.kind === "propose_edit" && <div className="diff-box">
                <div className="diff-side was"><span>Was</span><p>{record.action.find}</p></div>
                <div className="diff-side becomes"><span>Becomes</span><p>{record.action.replace}</p></div>
              </div>}
              <div className="request-actions">
                <button onClick={() => { setClaudeLog(updateLogState(record.action.id, "declined", "You declined it. Nothing was changed.")); }}>Decline</button>
                <button className="primary" onClick={() => {
                  void runClaudeAction(record.action)
                    .then((note) => setClaudeLog(updateLogState(record.action.id, "approved", note)))
                    .catch((error) => setClaudeLog(updateLogState(record.action.id, "failed", message(error))));
                }}>OK GO</button>
              </div>
            </article>)}
      </section>

      <section className="dash-section">
        <h2>Everything Claude Has Done</h2>
        {claudeLog.length === 0
          ? <div className="empty-state"><strong>Nothing yet</strong><p>Turn the switch on, hand Claude the instructions, and its work shows up here.</p></div>
          : <ul className="request-list">{claudeLog.slice(0, 60).map((record) => <li key={record.action.id + record.at} className="request-card">
              <div className="request-who"><strong>{describeAction(record.action)}</strong><span className={record.state === "failed" ? "update-status warn" : "update-status ok"}>{record.state}</span></div>
              <p className="request-reason">{record.note}</p>
              <time>{new Date(record.at).toLocaleString()}</time>
            </li>)}</ul>}
      </section>
      <footer className="safe-status">{status}</footer>
    </main>;
  }

  if (screen === "human-maker") {
    return <HumanMakerScreen readerName={readerName} role={role} onBack={() => setScreen("home")} />;
  }

  if (screen === "workspace-files") {
    return <WorkspaceFilesScreen role={role} readerName={readerName} client={client} onBack={() => setScreen("project-workspace")} />;
  }

  if (screen === "project-workspace") {
    return <main className="app-shell project-shell">
      <header className="topbar"><button className="text-button" onClick={() => setScreen("projects")}>← Back</button><span className="eyebrow">LOCAL PROJECT WORKSPACE</span><span className="who-chip">{readerName} · {roleLabel(role)}</span></header>
      <section className="project-heading"><div><p className="eyebrow">THE LONG ROT</p><h1>Project Workspace</h1><p>Dropbox stays the shared source. The AI works from safe copies on this computer.</p></div></section>
      <section className="workspace-card">
        <div><span>Local workspace</span><strong>{workspace?.initialized ? "Ready" : "Not prepared yet"}</strong><small>{workspace?.workspacePath || "The standard MaggotClaw Games Projects folder will be used."}</small></div>
        <div><span>Files downloaded</span><strong>{workspace?.downloadedFiles || 0}</strong><small>{workspace?.pendingBinaryFiles || 0} Word, PDF, image, or other binary files waiting for expanded MCP download support.<br/>Last completed file save: {formatWorkspaceTime(workspace?.lastDownloadAt || null)}{syncMessage ? <><br/>{syncMessage}</> : null}<br/><button className="text-button inline" onClick={() => setScreen("workspace-files")} disabled={!workspace?.downloadedFiles}>View The File List →</button></small></div>
        <div><span>Dropbox Uploads</span><strong>{canPerform(role, "manage") ? "Owner Only" : "Locked"}</strong><small>{canPerform(role, "manage") ? "Upload Approved sends everything in 05 Approved Uploads to Dropbox." : "Uploads run from the owner\u2019s account."}</small></div>
      </section>
      {workspaceProgress && <section className="download-progress"><strong>{workspaceProgress.stage}</strong><p>{workspaceProgress.completed} of {workspaceProgress.total || "?"} text files saved · {workspaceProgress.skipped} other files recorded</p></section>}
      <section className="workspace-actions">
        <button className="primary" onClick={() => setScreen("project-explorer")} disabled={!workspace?.downloadedFiles}>Explore Files</button>
        {!workspace?.initialized && <button onClick={prepareWorkspace} disabled={workspaceBusy}>Prepare Local Folders</button>}
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
    return <main className="app-shell target-screen"><header className="topbar"><button className="text-button" onClick={() => setScreen("home")}>← Back</button><span className="eyebrow">Voice Companion</span><span className="who-chip">{readerName} · {roleLabel(role)}</span></header><section className="library-heading"><div><h2>Choose the program</h2><p>The companion controls the normal Windows program you already use.</p></div></section><section className="home-toolbar page"><button className="pill-button chip" onClick={() => openSettingsFrom("voice-targets")}>Voice Settings</button></section><section className="target-grid"><button className="target-card available" onClick={() => openVoiceTarget("claude")}><strong>Claude</strong><small>Available now</small></button><button className="target-card available" onClick={() => openVoiceTarget("codex")}><strong>Codex</strong><small>Available now</small></button><button className="target-card" disabled><strong>ChatGPT</strong><small>Coming later</small></button></section></main>;
  }

  if (screen === "comments") {
    const unsent = savedComments.filter((item) => !item.submittedAt);
    return <main className="app-shell comments-shell">
      <header className="topbar"><button className="text-button" onClick={() => setScreen("library")}>← Back</button><span className="eyebrow">My Comments</span><span className="who-chip">{readerName} · {roleLabel(role)}</span></header>
      <section className="comments-heading"><div><h1>Saved Comments</h1><p>{savedComments.length} saved safely on this device.</p></div><button onClick={exportComments} disabled={!savedComments.length}>Save Comments File</button><button className="primary" disabled={!unsent.length || commentsSending} onClick={async () => {
        setCommentsSending(true);
        setCommentsNote(`Sending ${unsent.length} comment${unsent.length === 1 ? "" : "s"} to the owner…`);
        let sent = 0;
        let failed = 0;
        try {
          for (const item of unsent) {
            const body = `**Reader comment** from ${item.readerName}
${item.exactFilename} — paragraph ${item.paragraphIndex + 1}, sentence ${item.sentenceIndex + 1}
"${item.anchorText}"
${item.transcriptionConfirmed}`;
            const clipped = body.length > 1800;
            if (await sendRequestToDiscord(clipped ? body.slice(0, 1750) + "\n… (the full comment is longer — kept on the reader's device)" : body)) {
              sent += 1;
              await saveComment({ ...item, submittedAt: new Date().toISOString() });
            } else {
              failed += 1;
            }
            await new Promise((resolve) => setTimeout(resolve, 350));
          }
          setSavedComments((await loadSavedComments()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
          setCommentsNote(failed
            ? `Sent ${sent}. ${failed} could not be sent — they stay marked unsent and will go next time.`
            : sent ? `Sent ${sent} comment${sent === 1 ? "" : "s"} to the owner.` : "The comments could not be sent — they are still saved here. Nothing was lost.");
        } finally {
          setCommentsSending(false);
        }
      }}>{commentsSending ? "Sending…" : unsent.length ? `Submit ${unsent.length} New Comment${unsent.length === 1 ? "" : "s"}` : "All Comments Sent"}</button></section>
      {commentsNote && <p className="board-hint">{commentsNote}</p>}
      <section className="comments-list">
        {savedComments.length === 0 && <div className="empty-state"><strong>No comments yet</strong><p>Comments you confirm while reading will appear here.</p></div>}
        {savedComments.map((item) => <SavedCommentCard key={item.id} comment={item} onDelete={async () => { await deleteComment(item.id); setSavedComments(await loadSavedComments()); }} />)}
      </section>
    </main>;
  }

  if (screen === "comment" && comment) {
    const recording = comment.status === "recording";
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
        <CommentAudio blob={comment.audio} />
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
          <span className="eyebrow">{activeProject().name}</span>
          <span className="who-chip">{readerName} · {roleLabel(role)}</span>
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
        <section className="reaction-row" aria-label="Quick reactions">
          {["Loved It", "Confused", "Scared", "Bored"].map((label) =>
            <button key={label} disabled={!document.segments.length} onClick={() => void quickReaction(label)}>{label}</button>)}
        </section>
        <section className="primary-controls" aria-label="Reading controls">
          <button className="control secondary" onClick={() => moveBy(-1)}>Previous</button>
          <button className="control primary" onClick={togglePlayback}>{playing ? "Pause" : "Continue"}</button>
          <button className="control comment" onClick={() => void startComment()} disabled={!document.segments.length}>Comment</button>
        </section>
        <section className="secondary-controls">
          <button onClick={() => { player.current.stop(); speakAt(segmentIndex); }}>Repeat Sentence</button>
          <button onClick={() => moveBy(1)}>Forward</button>
          <ReadSelectionButton rate={rate} />
          <label>Speed
            <select value={rate} onChange={(event) => {
              const next = Number(event.target.value);
              player.current.stop(); setPlaying(false); setRate(next);
              // The choice sticks: every chapter and window reads at this speed.
              saveVoiceSettings(readerName || "local", { ...loadVoiceSettings(readerName || "local"), speechRate: next });
            }}>
              <option value="0.8">Slower</option><option value="1">Normal</option><option value="1.2">Faster</option>
            </select>
          </label>
          <label>Sleep
            <select value={sleepMinutes} onChange={(event) => {
              const minutes = Number(event.target.value);
              setSleepMinutes(minutes);
              sleepDeadline.current = minutes ? Date.now() + minutes * 60000 : 0;
              setStatus(minutes ? `Sleep Timer set — she stops in ${minutes} minutes and saves your place.` : "Sleep Timer off");
            }}>
              <option value="0">Off</option><option value="15">15 Min</option><option value="30">30 Min</option><option value="60">60 Min</option>
            </select>
          </label>
        </section>
        {(() => {
          const questions = questionsForChapter(chapterNumberFromName(document.name));
          return questions.length ? <section className="question-card">
            <h2>Questions From MaggotClaw About This Chapter</h2>
            {questions.map((question) => <button key={question} onClick={() => void startComment(`Answer — ${question.slice(0, 80)}`)}>{question}</button>)}
          </section> : null;
        })()}
        <footer className="safe-status">{status}</footer>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="home-toolbar page">
        <button className="pill-button chip" onClick={() => setScreen("home")}>← Back</button>
        <button className="pill-button chip" onClick={openSavedComments}>My Comments</button>
        <button className="pill-button chip" onClick={() => openSettingsFrom("library")}>Settings</button>
        {"__TAURI_INTERNALS__" in window && <button className="pill-button chip" disabled={workspaceBusy || loading} onClick={() => {
          // The reader's own download door — Projects is gated, the shelf is not.
          void (async () => { await downloadWorkspace(); await refreshCopies(); })();
        }}>{workspaceBusy ? "Updating…" : "Get The Latest Chapters"}</button>}
        <button className="pill-button chip" onClick={refreshCopies} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
        <span className="who-chip">{readerName} · {roleLabel(role)}</span>
      </section>
      <header className="hero">
        <div><BrandLogo compact /><h1>Reader Mode</h1><p>{status}</p>
        {listeningLine(loadListeningStats(readerName)) && <p className="board-hint">{listeningLine(loadListeningStats(readerName))}</p>}</div>
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

function Profile({ initial, onContinue }: { initial: string; onContinue: (info: { name: string; discordName: string; wantedRole: ProjectRole; nickname: string; pin: string; readingSpeed: number; details: ReaderProfile }) => void }) {
  const [name, setName] = useState(initial);
  // A returning person's saved details come back with them — revisiting this
  // screen must never silently reset anything.
  const [nickname, setNicknameState] = useState(() => initial ? getNickname(initial) : "");
  const [discordName, setDiscord] = useState(() => initial ? getDiscordName(initial) : "");
  const [wantedRole, setWantedRole] = useState<ProjectRole>("reader");
  const [pin, setPin] = useState("");
  const [pinAgain, setPinAgain] = useState("");
  const [readingSpeed, setReadingSpeed] = useState(() => {
    const saved = initial ? loadVoiceSettings(initial).speechRate : 1;
    return [0.8, 1, 1.2, 1.4].includes(saved) ? saved : 1;
  });
  const [step, setStep] = useState(1);
  const [details, setDetails] = useState<ReaderProfile>(() => initial ? loadReaderProfile(initial) : { ...EMPTY_READER_PROFILE });
  const set = (changes: Partial<ReaderProfile>) => setDetails((current) => ({ ...current, ...changes }));
  const options: Array<{ value: ProjectRole; label: string; hint: string }> = [
    { value: "reader", label: "Reader", hint: "Read and comment — starts right now" },
    { value: "contributor", label: "Contributor", hint: "Suggest and propose changes — needs approval" },
    { value: "reviewer", label: "Reviewer", hint: "Review reader feedback and proposals — needs approval" },
    { value: "editor", label: "Editor", hint: "Work on the book itself — needs approval" },
    { value: "manager", label: "Editor / Manager", hint: "Work on the book and approve other people — needs approval" },
    { value: "support", label: "Technical Support", hint: "Keep the machinery running — needs approval" }
  ];
  // A returning profile already has its PIN; a brand-new one sets it here.
  const pinAlreadySet = Boolean(name.trim()) && hasProfilePin(name.trim());
  const pinOk = pinAlreadySet || (isValidPin(pin) && pin === pinAgain);
  const pinProblem = !pinAlreadySet && pin && (!isValidPin(pin) ? "The PIN is exactly four digits." : pin !== pinAgain ? "The two PINs do not match yet." : "");
  return <main className="app-shell profile-screen">
    <BrandLogo />
    <div className="love-banner" role="status">Whatever you do, don't forget… <strong>MaggotClaw Loves You!!!</strong></div>
    <div className="step-row" aria-label={`Step ${step} of 3`}>
      {[1, 2, 3].map((n) => <span key={n} className={n === step ? "step-dot on" : n < step ? "step-dot done" : "step-dot"}>{n}</span>)}
    </div>

    {step === 1 && <>
      <p><strong>Who are you?</strong> Everyone starts as a Reader — anything more goes to MaggotClaw for approval, and you can read while you wait.</p>

      <label>Your name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>What should we call you? (optional)
        <input value={nickname} placeholder="A nickname, if you like one better" onChange={(event) => setNicknameState(event.target.value)} />
      </label>
      <label>Email address
        <input type="email" value={details.email} placeholder="so MaggotClaw can reach you" onChange={(event) => set({ email: event.target.value })} />
      </label>
      <label>Phone (optional)
        <input value={details.phone} placeholder="only if you want texts about new chapters" onChange={(event) => set({ phone: event.target.value })} />
      </label>
      <label>What state or part of the world are you in?
        <input value={details.where} placeholder="Louisiana, Ontario, Yorkshire…" onChange={(event) => set({ where: event.target.value })} />
      </label>
      <label>Your Discord name (for team messages)
        <input value={discordName} placeholder="Leave blank if you don't have one yet" onChange={(event) => setDiscord(event.target.value)} />
      </label>
      <button className="text-button" onClick={() => { void openDiscordWindow(); }}>Open Discord to sign in or create an account →</button>

      <button className="continue-profile" disabled={!name.trim()} onClick={() => setStep(2)}>Next</button>
    </>}

    {step === 2 && <>
      <p><strong>What do you read?</strong> This tells MaggotClaw whose eyes he's getting. Answer what you like and skip the rest.</p>

      <label>What do you usually read?
        <textarea rows={2} value={details.reads} placeholder="Horror, southern gothic, history, true crime, whatever's around…" onChange={(event) => set({ reads: event.target.value })} />
      </label>
      <label>Favourite authors
        <input value={details.authors} placeholder="Who do you always come back to?" onChange={(event) => set({ authors: event.target.value })} />
      </label>
      <label>Have you read for a writer before?
        <select value={details.betaBefore} onChange={(event) => set({ betaBefore: event.target.value })}>
          <option value="">— Choose one —</option>
          <option>No, this is my first time</option>
          <option>A little</option>
          <option>Yes, plenty</option>
        </select>
      </label>
      <label>How much do you usually read in a week?
        <select value={details.pace} onChange={(event) => set({ pace: event.target.value })}>
          <option value="">— Choose one —</option>
          <option>A few pages when I can</option>
          <option>An hour or two</option>
          <option>Several hours</option>
          <option>I read constantly</option>
        </select>
      </label>
      <label>Do you prefer being read to, or reading it yourself?
        <select value={details.prefers} onChange={(event) => set({ prefers: event.target.value })}>
          <option value="">— Choose one —</option>
          <option>Read to me</option>
          <option>I'll read it myself</option>
          <option>Both, depending on the day</option>
        </select>
      </label>
      <label>Anything you would rather not read? (this book is dark)
        <input value={details.avoid} placeholder="Tell MaggotClaw now and he'll warn you" onChange={(event) => set({ avoid: event.target.value })} />
      </label>
      <label>Who invited you?
        <input value={details.invitedBy} onChange={(event) => set({ invitedBy: event.target.value })} />
      </label>

      <div className="form-actions"><button onClick={() => setStep(1)}>← Back</button><button className="continue-profile" onClick={() => setStep(3)}>Next</button></div>
    </>}

    {step === 3 && <>
      <p><strong>How you'll use it.</strong> Last few.</p>

      <label>What do you want to do here?
        <select value={wantedRole} onChange={(event) => setWantedRole(event.target.value as ProjectRole)}>
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <small className="board-hint">{options.find((o) => o.value === wantedRole)?.hint}</small>

      <label>How fast should the narrator read to you?
        <select value={readingSpeed} onChange={(event) => setReadingSpeed(Number(event.target.value))}>
          <option value="0.8">Slower</option><option value="1">Normal</option><option value="1.2">Faster</option><option value="1.4">Much Faster</option>
        </select>
      </label>

      <label>Anything else MaggotClaw should know? (optional)
        <textarea rows={2} value={details.notes} onChange={(event) => set({ notes: event.target.value })} />
      </label>

      {pinAlreadySet
        ? <p className="board-hint">Your recovery PIN is already saved for this name.</p>
        : <>
            <label>Pick a four-digit PIN
              <input inputMode="numeric" maxLength={4} value={pin} placeholder="1234" onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} />
            </label>
            <label>Type the PIN again
              <input inputMode="numeric" maxLength={4} value={pinAgain} onChange={(event) => setPinAgain(event.target.value.replace(/\D/g, ""))} />
            </label>
            <small className="board-hint">Your name and PIN together identify you if you ever move to a new computer. The PIN itself is never stored or shared.</small>
            {pinProblem && <p className="update-status warn">{pinProblem}</p>}
          </>}
      <small className="board-hint">So MaggotClaw can cheer you on, the app shares how far you have read — never your comments until you choose to send them.</small>

      <div className="form-actions">
        <button onClick={() => setStep(2)}>← Back</button>
        <button className="continue-profile" disabled={!name.trim() || !pinOk} onClick={() => {
          // "Test Profile" is the local test identity with full owner controls —
          // nobody should wander into it by accident.
          if (name.trim() === "Test Profile" && !window.confirm("Test Profile is the local test identity with full owner controls on this computer. Is that really what you want?")) return;
          onContinue({ name, discordName, wantedRole, nickname, pin, readingSpeed, details });
        }}>Get Started</button>
      </div>
    </>}
  </main>;
}
// One project file in its own window: full text (or Word formatting), with
// read-highlighted-aloud. Several of these can be open side by side.
function FileWindow({ relative }: { relative: string }) {
  const [text, setText] = useState("Opening…");
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        await applyActiveProject();
        if (/docx$/i.test(relative)) {
          const bytes = await invoke<number[]>("read_project_document_bytes", { localRelativePath: relative });
          const buffer = new Uint8Array(bytes).buffer;
          const mammoth = await import("mammoth/mammoth.browser");
          setText((await mammoth.extractRawText({ arrayBuffer: buffer })).value.trim());
          setHtml((await mammoth.convertToHtml({ arrayBuffer: buffer })).value);
        } else {
          // Old files were hard-wrapped at a fixed line width. Repair that on
          // every read: paragraphs flow to the window, blank lines stay.
          setText(unwrapHardLines(await invoke<string>("read_project_document", { localRelativePath: relative })));
        }
      } catch {
        setText("This file could not be opened from the local workspace.");
      }
    })();
  }, [relative]);
  const name = relative.split("/").pop() ?? relative;
  return <main className="app-shell file-window">
    <header className="topbar">
      <button className="text-button" onClick={() => { void closeCurrentWindow(); }}>← Back</button>
      <span className="eyebrow">{name}</span>
      <ReadSelectionButton />
    </header>
    {html ? <div className="doc-word" dangerouslySetInnerHTML={{ __html: html }} /> : <pre className="file-text">{text}</pre>}
  </main>;
}

// Every downloaded file, with the owner's access rating beside it. The rating
// names the lowest role that needs the file; Download or Update obeys it on
// every machine once the owner publishes the ratings to Dropbox.
function WorkspaceFilesScreen({ role, readerName, client, onBack }: { role: ProjectRole; readerName: string; client: LongRotMcpClient; onBack: () => void }) {
  const isOwner = canPerform(role, "manage");
  const [docs, setDocs] = useState<ProjectDocument[]>([]);
  const [access, setAccess] = useState<FileAccessMap>(loadAccessMap);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    void invoke<ProjectDocument[]>("list_project_documents")
      .then((files) => setDocs(files.sort((a, b) => a.localRelativePath.localeCompare(b.localRelativePath))))
      .catch(() => setNote("The local file list could not be read."));
    // Start from the shared ratings so this machine can never publish an
    // empty or stale map over the real one.
    void fetchSharedAccessMap(client).then(({ map }) => setAccess(map)).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function publish() {
    setBusy(true);
    try {
      await publishAccessMap(client);
      setNote("File Access Published — every machine now downloads by these ratings.");
    } catch (error) {
      setNote(error instanceof Error && error.message.includes("no ratings yet")
        ? error.message
        : "The ratings are saved on this computer, but Dropbox could not be reached to share them.");
    } finally {
      setBusy(false);
    }
  }
  async function publishLinks() {
    const creds = getDropboxCreds();
    if (!creds) { setNote("Reader Links need the project file keys — Settings → Owner → Project Files first."); return; }
    setBusy(true);
    try {
      await publishAccessMap(client).catch(() => undefined);
      await publishReaderLinks(client, creds, (progress) => setNote(progress.stage));
      setNote("Reader Links published. Copy Messaging Key in Messages now carries read-only book downloads for friends.");
    } catch (error) {
      setNote(`${error instanceof Error ? error.message : "Reader Links could not be published."} Nothing readers already have was changed.`);
    } finally {
      setBusy(false);
    }
  }
  const levelLabel = (path: string) => ACCESS_LEVEL_LABELS.find((l) => l.value === (access[path] ?? "reader"))?.label ?? "Reader And Up";
  return <main className="app-shell project-shell">
    <header className="topbar"><button className="text-button" onClick={onBack}>← Back</button><span className="eyebrow">DOWNLOADED FILES</span><span className="who-chip">{readerName} · {roleLabel(role)}</span></header>
    <section className="projects-heading"><h1>Every File On This Computer</h1><p>{isOwner
      ? "Rate each file with the lowest role that needs it. People only download what their role calls for, so their AI stays focused. Publish to share the ratings with every machine."
      : "The files your role downloads. The owner decides which files each role needs."}</p></section>
    {isOwner && <section className="form-actions">
      <button className="primary" onClick={() => void publish()} disabled={busy}>{busy ? "Publishing…" : "Publish File Access To Dropbox"}</button>
      <button className="primary" onClick={() => void publishLinks()} disabled={busy} title="Read-only links for friends — no keys leave your machine">{busy ? "Working…" : "Publish Reader Links"}</button>
      {readerLinksConfigured() && <small className="update-status ok">Reader Links are live — friend keys carry read-only downloads.</small>}
    </section>}
    {note && <p className="board-hint">{note}</p>}
    <section className="comments-list">
      {docs.length === 0 && <div className="empty-state"><strong>Nothing downloaded yet</strong><p>Run Download or Update in the workspace first.</p></div>}
      {docs.map((file) => <article key={file.dropboxPath} className="saved-comment">
        <div className="comment-meta"><span>{file.status === "downloaded" ? "Downloaded" : "Waiting For Binary Support"}</span><span>{file.byteCount ? `${Math.max(1, Math.round(file.byteCount / 1024))} KB` : ""}</span></div>
        <h2>{file.localRelativePath}</h2>
        {isOwner
          ? <label>Who needs this file<select value={access[file.dropboxPath] ?? "reader"} onChange={(event) => setAccess(setFileAccess(file.dropboxPath, event.target.value as FileAccessMap[string]))}>
              {ACCESS_LEVEL_LABELS.map((level) => <option key={level.value} value={level.value}>{level.label}</option>)}
            </select></label>
          : <small>{levelLabel(file.dropboxPath)}</small>}
      </article>)}
    </section>
  </main>;
}

// The Human Maker: the author's prose-audit bench. Runs his own Human Maker
// codex against a chapter, entirely on this computer, and reports every
// mechanical tell in his numbering — then hands the findings to the AI for the
// Ok Go rewrite.
function HumanMakerScreen({ readerName, role, onBack }: { readerName: string; role: ProjectRole; onBack: () => void }) {
  const [docs, setDocs] = useState<ProjectDocument[]>([]);
  const [chosen, setChosen] = useState("");
  const [text, setText] = useState("");
  const [report, setReport] = useState<AuditReport | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [showDirective, setShowDirective] = useState(false);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    void invoke<ProjectDocument[]>("list_project_documents")
      .then((files) => setDocs(files.filter((f) => f.status === "downloaded" && /\.(txt|md)$/i.test(f.localRelativePath))))
      .catch(() => undefined);
  }, []);

  async function loadChapter(relative: string) {
    setChosen(relative);
    setReport(null);
    if (!relative) { setText(""); return; }
    setBusy(true);
    try {
      setText(unwrapHardLines(await invoke<string>("read_project_document", { localRelativePath: relative })));
      setNote("");
    } catch {
      setNote("That file could not be opened from the local workspace.");
    } finally {
      setBusy(false);
    }
  }

  function runAudit() {
    if (!text.trim()) { setNote("Pick a chapter or paste some prose first."); return; }
    setReport(auditProse(text));
    setNote("");
  }

  async function copyForAI() {
    if (!report) return;
    const brief = auditForAI(report, chosen ? chosen.split("/").pop()! : "this passage");
    try {
      await navigator.clipboard?.writeText(brief);
      setNote("Audit copied. Paste it to Claude with the passage and say Ok Go for the humanizing pass.");
    } catch {
      setNote("The clipboard was not available.");
    }
  }

  const grouped = report
    ? [...new Map(report.findings.map((f) => [f.category, report.findings.filter((x) => x.category === f.category)])).entries()]
    : [];

  return <main className="app-shell project-shell">
    <header className="topbar">
      <button className="text-button" onClick={onBack}>← Back</button>
      <span className="eyebrow">HUMAN MAKER</span>
      <span className="who-chip">{readerName} · {roleLabel(role)}</span>
    </header>
    <section className="projects-heading">
      <h1>Human Maker</h1>
      <p>The de-machine filter from your own codex, run on this computer. Nothing leaves the machine.</p>
    </section>

    <section className="dash-section">
      <button className="text-button" onClick={() => setShowDirective(!showDirective)}>{showDirective ? "▾" : "▸"} The Ward Directive And Your Standing Rules</button>
      {showDirective && <div className="directive-box">
        <p><strong>Ward Directive:</strong> Lyrical prose rooted in Southern storytelling. Raw emotional honesty — tender and brutally honest. Mythic undercurrents in the ordinary. Beauty inside imperfection. Intimate sensory language; emotion breathes through the narrative rather than being announced. Musical sentences whose rhythm rises and breaks. Grounded in this place and community, reaching toward universal truth. Elevated, never pretentious.</p>
        <p><strong>Description density:</strong> dial at 4 — a few sharp sensory details, then move on.</p>
        <p><strong>Name clarity:</strong> in crowded scenes use names, never an ambiguous "he" or "she".</p>
        <p><strong>Mark time:</strong> state plainly when time passes, so the reader always knows when they are.</p>
        <p className="board-hint">The filter never bans a technique outright — it bans the mechanical, compulsive, uniform use of it. Once a chapter is style; every page is a fingerprint.</p>
      </div>}
    </section>

    <section className="dash-section">
      <h2>What Am I Auditing?</h2>
      <label>A chapter from your workspace
        <select value={chosen} onChange={(event) => void loadChapter(event.target.value)}>
          <option value="">— Choose a file, or paste below —</option>
          {docs.map((doc) => <option key={doc.localRelativePath} value={doc.localRelativePath}>{doc.localRelativePath}</option>)}
        </select>
      </label>
      <label>Or paste the prose
        <textarea rows={8} value={text} placeholder="Paste a passage here…" onChange={(event) => { setText(event.target.value); setReport(null); }} />
      </label>
      <div className="form-actions">
        <button className="primary" disabled={busy || !text.trim()} onClick={runAudit}>{busy ? "Opening…" : "Run The Audit"}</button>
        {report && <button onClick={() => void copyForAI()}>Copy Audit For The Rewrite</button>}
      </div>
      {note && <p className="board-hint">{note}</p>}
    </section>

    {report && <>
      <section className="workspace-card">
        <div><span>Verdict</span><strong>{report.score}/100</strong><small>{report.verdict}</small></div>
        <div><span>The passage</span><strong>{report.stats.words.toLocaleString()} words</strong><small>{report.stats.sentences} sentences · {report.stats.paragraphs} paragraphs · average {report.stats.avgSentenceWords} words a sentence</small></div>
        <div><span>Rhythm</span><strong>Spread {report.stats.sentenceVariety}</strong><small>Under about 4 reads mechanical · {report.stats.emDashesPer1000} em-dashes per 1,000 words · {report.stats.singleLineParagraphs} single-line paragraphs</small></div>
      </section>

      <section className="dash-section">
        <h2>Tells Found <span className="pending-badge">{report.findings.length}</span></h2>
        {report.findings.length === 0
          ? <div className="empty-state"><strong>No mechanical tells caught</strong><p>Now read it aloud against the checklist below — the tells that matter most are the ones no machine can see.</p></div>
          : grouped.map(([category, items]) => <div key={category} className="tell-group">
              <h3>{category}</h3>
              {items.map((finding, index) => <article key={`${finding.tell}-${index}`} className={`tell-card ${finding.severity}`}>
                <div className="comment-meta"><span>Tell {finding.tell} · {finding.title}</span><span className={`sev ${finding.severity}`}>{finding.severity === "high" ? "Strong" : finding.severity === "medium" ? "Clear" : "Light"}</span></div>
                <p>{finding.detail}</p>
                {finding.excerpt && <blockquote>“{finding.excerpt}”</blockquote>}
                <small><strong>Fix:</strong> {finding.fix}</small>
              </article>)}
            </div>)}
      </section>

      <section className="dash-section">
        <h2>Read Aloud For These</h2>
        <p className="board-hint">No rule engine can catch these — they are the ones that decide whether the prose has a person behind it. Read the passage aloud and judge each.</p>
        <ul className="request-list">
          {report.checklist.map((item) => <li key={item.n} className="request-card">
            <div className="request-who"><strong>Tell {item.n} · {item.title}</strong><span>{item.category}</span></div>
            <p className="request-reason">{item.fix}</p>
          </li>)}
        </ul>
      </section>
    </>}
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
  // Default to the gentlest step up — nobody should accidentally ask the
  // owner for Technical Support powers.
  const [requested, setRequested] = useState<ProjectRole>(options[0] ?? "contributor");
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
    <BrandLogo compact /><p className="eyebrow">REQUEST ACCESS</p><h1>Ask For More Access</h1>
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

function OwnerDashboard({ requests, onDecide, onBack, client, onReleasesChanged }: { requests: AccessRequest[]; onDecide: (id: string, approve: boolean) => void; onBack: () => void; client: LongRotMcpClient; onReleasesChanged: (released: number[]) => void }) {
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
  // The dashboard checks Discord by itself the moment it opens.
  useEffect(() => { if (discordReadingConfigured()) void checkDiscord(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const [inboxBusy, setInboxBusy] = useState(false);
  const [inboxNote, setInboxNote] = useState("");
  const [released, setReleased] = useState<number[]>(loadUnlockedChapters);
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [releaseNote, setReleaseNote] = useState("");
  const [scheduled, setScheduled] = useState(loadScheduledReleases);
  const [scheduleChapter, setScheduleChapter] = useState("");
  const [scheduleDate, setScheduleDate] = useState("");
  const [pronunciations, setPronunciations] = useState<Pronunciation[]>(loadPronunciations);
  const [pronunSay, setPronunSay] = useState("");
  const [pronunAs, setPronunAs] = useState("");
  const [questionChapter, setQuestionChapter] = useState("");
  const [questionText, setQuestionText] = useState("");
  const [questionMap, setQuestionMap] = useState(loadChapterQuestions);
  const progressReports = latestProgressReports();

  function addSchedule() {
    const chapter = Number(scheduleChapter);
    if (!Number.isInteger(chapter) || chapter < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(scheduleDate)) return;
    const next = [...scheduled.filter((s) => s.chapter !== chapter), { chapter, on: scheduleDate }].sort((a, b) => a.chapter - b.chapter);
    setScheduled(next);
    saveScheduledReleases(next);
    setScheduleChapter("");
    setScheduleDate("");
  }

  function addPronunciation() {
    if (!pronunSay.trim() || !pronunAs.trim()) return;
    const next = [...pronunciations.filter((p) => p.say.toLowerCase() !== pronunSay.trim().toLowerCase()), { say: pronunSay.trim(), as: pronunAs.trim() }];
    setPronunciations(next);
    savePronunciations(next);
    setPronunSay("");
    setPronunAs("");
  }

  function saveQuestions() {
    const chapter = Number(questionChapter);
    if (!Number.isInteger(chapter) || chapter < 1) return;
    const questions = questionText.split("\n").map((q) => q.trim()).filter(Boolean);
    const next = { ...questionMap };
    if (questions.length) next[String(chapter)] = questions;
    else delete next[String(chapter)];
    setQuestionMap(next);
    saveChapterQuestions(next);
    setQuestionText("");
    setQuestionChapter("");
  }

  function toggleRelease(chapter: number) {
    const next = released.includes(chapter)
      ? released.filter((n) => n !== chapter)
      : [...released, chapter].sort((a, b) => a - b);
    setReleased(next);
    saveUnlockedChapters(next);
    onReleasesChanged(next);
  }

  async function publishReleaseList() {
    setReleaseBusy(true);
    try {
      await publishReleases(client);
      setReleaseNote("Published. Every reader's app picks the new list up when it next opens.");
    } catch {
      setReleaseNote("The list is saved on this computer, but Dropbox could not be reached to share it. Try again with the bridge running.");
    } finally {
      setReleaseBusy(false);
    }
  }

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
      // Codes posted into the shared channel never carry the messaging key —
      // the key travels privately via Copy Messaging Key in Messages.
      const unlock = makeUnlockCode({ name: parsed.name, role: parsed.requestedRole });
      recordJoin(parsed.name, "", parsed.requestedRole);
      const posted = await postUnlockToDiscord(parsed.name, roleLabel(parsed.requestedRole), unlock);
      setInboxNote(posted
        ? `Approved. The unlock code was posted in Discord for ${parsed.name}.`
        : "Approved, but Discord could not be reached — the request stays in the inbox; send the code by hand.");
      if (!posted) {
        setGranted({ name: parsed.name, role: parsed.requestedRole, code: unlock });
        // Not marked handled: if the owner walks away, the request comes back
        // on the next check instead of vanishing unanswered.
        return;
      }
    } else {
      // The person on the other machine deserves to hear a no, not silence.
      void postUnlockDecline(parsed.name);
      setInboxNote(`Declined ${parsed.name}'s request. They were told in Discord.`);
    }
    markMessageHandled(item.messageId);
    setInbox((current) => current.filter((entry) => entry.messageId !== item.messageId));
  }

  return <main className="app-shell dashboard-shell">
    <header className="topbar"><button className="text-button" onClick={onBack}>← Back</button><span className="eyebrow">Owner Dashboard</span><span className="who-chip">{(localStorage.getItem("long-rot-reader-name") || "Owner")} · Author / Owner</span></header>
    <section className="projects-heading"><h1>Things That Need You</h1><p>Approvals and communications routed to the owner. Approving a request raises that person's role immediately.</p></section>

    <section className="dash-section">
      <h2>Requests From Discord</h2>
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
      <h2>Approve Someone On Another Computer</h2>
      <p className="board-hint">Paste the request code they sent you. Approving produces an unlock code to send back — that is what raises their access on their machine.</p>
      <label>Their request code<textarea rows={3} value={pasted} placeholder="MCG-REQ-…" onChange={(event) => { setPasted(event.target.value); setCodeError(""); }} /></label>
      {codeError && <p className="update-status warn">{codeError}</p>}
      <div className="form-actions"><button className="primary" disabled={!pasted.trim()} onClick={readCode}>Read code</button></div>

      {incoming && !granted && <div className="request-card">
        <div className="request-who"><strong>{incoming.name}</strong><span>{roleLabel(incoming.currentRole)} → {roleLabel(incoming.requestedRole)}</span></div>
        {incoming.reason && <p className="request-reason">"{incoming.reason}"</p>}
        <div className="request-actions">
          <button onClick={() => { setIncoming(null); setPasted(""); }}>Decline</button>
          <button className="primary" onClick={() => { recordJoin(incoming.name, "", incoming.requestedRole); setGranted({ name: incoming.name, role: incoming.requestedRole, code: makeUnlockCode({ name: incoming.name, role: incoming.requestedRole, messaging: ownerMessagingPayload() }) }); }}>Approve</button>
        </div>
      </div>}

      {granted && <CodeBox
        label={`Unlock code for ${granted.name} — ${roleLabel(granted.role)}`}
        code={granted.code}
        hint={`Send this back to ${granted.name}. They paste it into “Enter unlock code”.`}
      />}
    </section>

    <section className="dash-section">
      <h2>Awaiting Approval <span className="pending-badge">{requests.length}</span></h2>
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
      <h2>Released Chapters</h2>
      <p className="board-hint">Tick the chapters readers may open. Publish sends the list to Dropbox so every reader's app picks it up the next time it opens.</p>
      <div className="release-grid">
        {Array.from({ length: Math.max(12, ...released.map((n) => n + 2)) }, (_, i) => i + 1).map((chapter) => <label key={chapter} className={released.includes(chapter) ? "release-chip on" : "release-chip"}>
          <input type="checkbox" checked={released.includes(chapter)} onChange={() => toggleRelease(chapter)} />
          {String(chapter).padStart(2, "0")}
        </label>)}
      </div>
      <p className="board-hint">Or put a chapter on the calendar — it unlocks itself on that day.</p>
      <div className="pronun-row">
        <input value={scheduleChapter} inputMode="numeric" placeholder="Chapter" style={{ maxWidth: 90 }} onChange={(event) => setScheduleChapter(event.target.value.replace(/\D/g, ""))} />
        <input type="date" value={scheduleDate} onChange={(event) => setScheduleDate(event.target.value)} />
        <button className="primary tiny" disabled={!scheduleChapter || !scheduleDate} onClick={addSchedule}>Schedule</button>
      </div>
      {scheduled.length > 0 && <div className="release-grid">{scheduled.map((s) => <label key={s.chapter} className="release-chip">
        {String(s.chapter).padStart(2, "0")} · {s.on}
        <button className="text-button tiny-remove" style={{ position: "static", transform: "none" }} onClick={() => { const next = scheduled.filter((x) => x.chapter !== s.chapter); setScheduled(next); saveScheduledReleases(next); }}>✕</button>
      </label>)}</div>}
      <div className="form-actions"><button className="primary" disabled={releaseBusy} onClick={() => void publishReleaseList()}>{releaseBusy ? "Publishing…" : "Publish Releases To Every Reader"}</button></div>
      {releaseNote && <p className="board-hint">{releaseNote}</p>}
    </section>

    <section className="dash-section">
      <h2>Reader Progress</h2>
      {progressReports.length === 0
        ? <div className="empty-state"><strong>No progress reports yet</strong><p>As friends read, their furthest chapter appears here — refreshed whenever Messages refreshes.</p></div>
        : <ul className="request-list">{progressReports.map((report) => <li key={report.author} className="request-card">
            <div className="request-who"><strong>{report.author}</strong><span>{report.text}</span></div>
            <time>{report.at ? new Date(report.at).toLocaleString() : ""}</time>
          </li>)}</ul>}
    </section>

    <section className="dash-section">
      <h2>Narrator Pronunciations</h2>
      <p className="board-hint">Teach the voice your invented names once. Publish Reader Links to carry them to every reader's narrator.</p>
      {pronunciations.map((entry) => <div key={entry.say} className="pronun-row">
        <input value={entry.say} readOnly />
        <input value={entry.as} readOnly />
        <button className="text-button" onClick={() => { const next = pronunciations.filter((p) => p.say !== entry.say); setPronunciations(next); savePronunciations(next); }}>✕</button>
      </div>)}
      <div className="pronun-row">
        <input value={pronunSay} placeholder="Written (Louvenia)" onChange={(event) => setPronunSay(event.target.value)} />
        <input value={pronunAs} placeholder="Spoken (loo-VEE-nee-ah)" onChange={(event) => setPronunAs(event.target.value)} />
        <button className="primary tiny" disabled={!pronunSay.trim() || !pronunAs.trim()} onClick={addPronunciation}>Add</button>
      </div>
    </section>

    <section className="dash-section">
      <h2>End-Of-Chapter Questions</h2>
      <p className="board-hint">Two or three per chapter, one per line. Readers are asked when they finish; answers arrive as comments. Publish Reader Links to share.</p>
      {Object.entries(questionMap).map(([chapter, questions]) => <div key={chapter} className="request-card">
        <div className="request-who"><strong>Chapter {chapter}</strong><span>{questions.length} question{questions.length === 1 ? "" : "s"}</span></div>
        <div className="request-actions">
          <button onClick={() => { setQuestionChapter(chapter); setQuestionText(questions.join("\n")); }}>Edit</button>
          <button onClick={() => { const next = { ...questionMap }; delete next[chapter]; setQuestionMap(next); saveChapterQuestions(next); }}>Remove</button>
        </div>
      </div>)}
      <div className="pronun-row">
        <input value={questionChapter} inputMode="numeric" placeholder="Chapter" style={{ maxWidth: 90 }} onChange={(event) => setQuestionChapter(event.target.value.replace(/\D/g, ""))} />
      </div>
      <label>Questions (one per line)<textarea rows={3} value={questionText} placeholder={"Did you trust Vina here?\nWhere did you get bored?"} onChange={(event) => setQuestionText(event.target.value)} /></label>
      <div className="form-actions"><button className="primary" disabled={!questionChapter} onClick={saveQuestions}>Save Chapter Questions</button></div>
    </section>

    <section className="dash-section">
      <h2>Messages</h2>
      <div className="empty-state"><strong>Team chat lives in Messages</strong><p>Rooms and direct messages are on the main page under Messages. Anything sent to MaggotClaw arrives in your direct messages there.</p></div>
    </section>

    <footer className="safe-status">{discordReadingConfigured()
      ? "Two-way Discord is on: requests and approvals travel automatically."
      : "Approvals are recorded on this computer. Add the Discord keys in Settings → Owner to receive requests from other machines automatically."}</footer>
  </main>;
}

// One audio player per recording, with its object URL cleaned up on unmount —
// building the URL inline in a render leaks one per keystroke.
function CommentAudio({ blob }: { blob: Blob | null }) {
  const [audioUrl] = useState(() => blob?.size ? URL.createObjectURL(blob) : null);
  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);
  if (!audioUrl) return null;
  return <audio controls src={audioUrl}>Your browser cannot play this recording.</audio>;
}

function SavedCommentCard({ comment, onDelete }: { comment: ReaderComment; onDelete?: () => void }) {
  const [audioUrl] = useState(() => comment.audio?.size ? URL.createObjectURL(comment.audio) : null);
  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);
  return <article className="saved-comment">
    <div className="comment-meta"><span>{comment.category}</span>{comment.submittedAt && <span className="update-status ok">Sent To The Owner</span>}<time>{new Date(comment.createdAt).toLocaleString()}</time></div>
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
  const [relayChannel, setRelayChannelState] = useState(getRelayChannelId);
  const savedDropbox = getDropboxCreds();
  const [dropboxKey, setDropboxKey] = useState(savedDropbox?.appKey ?? "");
  const [dropboxSecret, setDropboxSecret] = useState(savedDropbox?.appSecret ?? "");
  const [dropboxRefresh, setDropboxRefresh] = useState(savedDropbox?.refreshToken ?? "");
  const [dropboxNote, setDropboxNote] = useState("");
  const [shareHumanMaker, setShareHumanMaker] = useState(humanMakerSharedWithEditors);

  async function importFromBridge() {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const found = await invoke<{ appKey: string; appSecret: string; refreshToken: string }>("read_bridge_env");
      setDropboxKey(found.appKey);
      setDropboxSecret(found.appSecret);
      setDropboxRefresh(found.refreshToken);
      setDropboxNote("Keys imported from the bridge. Press Save to keep them.");
    } catch (error) {
      setDropboxNote(message(error));
    }
  }
  function updateVoice(changes: Partial<VoiceSettings>) { setVoice((current) => ({ ...current, ...changes })); }
  // A cleared or nonsense number must never save: 0 seconds of silence would
  // send a message after the very first word.
  const bounded = (value: number, min: number, max: number, fallback: number) =>
    Number.isFinite(value) && value >= min && value <= max ? value : fallback;
  function saveAll() {
    saveVoiceSettings(profile, {
      ...voice,
      silenceSeconds: bounded(voice.silenceSeconds, 0.5, 30, 2),
      addSeconds: bounded(voice.addSeconds, 1, 120, 5)
    });
    if (isOwner) {
      setRequestWebhook(webhook);
      setBotToken(botToken);
      setRequestsChannelId(channelId);
      setRelayChannelId(relayChannel);
    }
    if (dropboxKey.trim() && dropboxSecret.trim() && dropboxRefresh.trim()) {
      setDropboxCreds({ appKey: dropboxKey, appSecret: dropboxSecret, refreshToken: dropboxRefresh });
    } else if (!dropboxKey.trim() && !dropboxSecret.trim() && !dropboxRefresh.trim()) {
      setDropboxCreds(null);
    }
    onSave({ endpoint: endpoint.trim() || defaultSettings.endpoint, bearerToken });
  }
  return <main className="app-shell settings-panel">
    <button className="text-button mode-back" onClick={onCancel}>← Back</button>
    <BrandLogo compact /><p className="eyebrow">Settings</p><h1>Settings</h1>
    <p>Saved for {profile} on this computer when you press Save.</p>
    <p className="eyebrow">Voice Companion</p>
    <label>Talk to<select value={voice.target} onChange={(event) => updateVoice({ target: event.target.value as VoiceSettings["target"] })}><option value="claude">Claude</option><option value="codex">Codex</option></select></label>
    <label>Send after silence<input type="number" min="0.5" max="30" step="0.5" value={voice.silenceSeconds} onChange={(event) => updateVoice({ silenceSeconds: Number(event.target.value) })} /></label>
    <label>Add Time button<input type="number" min="1" max="120" step="1" value={voice.addSeconds} onChange={(event) => updateVoice({ addSeconds: Number(event.target.value) })} /></label>
    <div className="voice-choice"><span>Reading voice</span><strong>Cori Neural · Local</strong><small>Natural UK English. Runs privately on this computer with no API charge.</small></div>
    <label>Reading speed<select value={voice.speechRate} onChange={(event) => updateVoice({ speechRate: Number(event.target.value) })}><option value="0.8">Slower</option><option value="1">Normal</option><option value="1.2">Faster</option><option value="1.4">Much faster</option></select></label>
    <label className="check-setting"><input type="checkbox" checked={voice.readRepliesAutomatically} onChange={(event) => updateVoice({ readRepliesAutomatically: event.target.checked })} /> Read replies automatically</label>
    <label className="check-setting"><input type="checkbox" checked={voice.listenAfterReading} onChange={(event) => updateVoice({ listenAfterReading: event.target.checked })} /> Listen again after reading</label>
    <label className="check-setting"><input type="checkbox" checked={voice.skipContentBoxes} onChange={(event) => updateVoice({ skipContentBoxes: event.target.checked })} /> Skip code and output boxes</label>
    <label className="check-setting"><input type="checkbox" checked={voice.includeStoryContext} onChange={(event) => updateVoice({ includeStoryContext: event.target.checked })} /> Send story context with my words (who mentioned names are, from the codex)</label>
    {isOwner && <>
      <hr/><p className="eyebrow">View the app as someone else</p>
      <fieldset className="role-picker compact"><legend>See every screen the way they see it. Click your name on the main page to come back.</legend>
        {(["administrator", "support", "manager", "editor", "reviewer", "contributor", "reader"] as ProjectRole[]).map((option) => <label key={option} className={(viewAs ?? "administrator") === option ? "role-option picked" : "role-option"}>
          <input type="radio" name="view-as" checked={(viewAs ?? "administrator") === option} onChange={() => { setViewAs(option === "administrator" ? null : option); window.location.reload(); }} />
          <span className="role-bubble" aria-hidden="true" />
          <span><strong>{roleLabel(option)}</strong></span>
        </label>)}
      </fieldset>
    </>}
    <hr/><p className="eyebrow">Updates</p>
    <UpdateChecker configurable />
    {isOwner && <>
      <hr/><p className="eyebrow">Owner — Human Maker</p>
      <label className="check-setting"><input type="checkbox" checked={shareHumanMaker} onChange={(event) => { setShareHumanMaker(event.target.checked); setHumanMakerSharedWithEditors(event.target.checked); }} /> Let editors use the Human Maker too</label>
      <small className="board-hint">Off by default — the prose bench is yours alone. Turn it on to hand it to a trusted editor.</small>
      <hr/><p className="eyebrow">Owner — access requests via Discord</p>
      <label>Discord webhook for the requests channel
        <input value={webhook} placeholder="https://discord.com/api/webhooks/…" onChange={(event) => setWebhook(event.target.value)} autoComplete="off" />
      </label>
      {webhook && !isDiscordWebhook(webhook) && <small className="update-status warn">That does not look like a Discord webhook address.</small>}
      {webhook && isDiscordWebhook(webhook) && <small className="update-status ok">Access requests will arrive in your Discord channel automatically.</small>}
      <label>Discord bot key (lets the app read the requests channel)
        <input type="password" value={botToken} placeholder="Paste the bot token from the Discord Developer Portal" onChange={(event) => setBotTokenState(event.target.value)} autoComplete="off" />
      </label>
      <label>Requests channel ID
        <input value={channelId} placeholder="Right-click the channel → Copy Channel ID" onChange={(event) => setChannelIdState(event.target.value)} autoComplete="off" />
      </label>
      <label>Team chat channel ID (rooms and direct messages travel here)
        <input value={relayChannel} placeholder="Uses the requests channel unless you set one" onChange={(event) => setRelayChannelState(event.target.value)} autoComplete="off" />
      </label>
      <small className="board-hint">These Discord details are stored when you press Save — Cancel leaves them untouched.</small>
      <hr/><p className="eyebrow">Owner — project files (Dropbox)</p>
      <p className="board-hint">With these keys saved, the app reads and writes the project files itself — the bridge no longer needs to be running, here or on anyone else's computer. Copy Messaging Key in Messages carries them to your friends.</p>
      <div className="form-actions"><button onClick={() => void importFromBridge()}>Import From The Bridge</button></div>
      <label>Dropbox app key
        <input value={dropboxKey} onChange={(event) => setDropboxKey(event.target.value)} autoComplete="off" />
      </label>
      <label>Dropbox app secret
        <input type="password" value={dropboxSecret} onChange={(event) => setDropboxSecret(event.target.value)} autoComplete="off" />
      </label>
      <label>Dropbox refresh token
        <input type="password" value={dropboxRefresh} onChange={(event) => setDropboxRefresh(event.target.value)} autoComplete="off" />
      </label>
      {dropboxNote && <small className="board-hint">{dropboxNote}</small>}
      {filesDirectConfigured() && <small className="update-status ok">Direct file access is on — downloads and uploads work without the bridge.</small>}
      {discordReadingConfigured() && <small className="update-status ok">Two-way Discord is on: the Owner Dashboard can pull requests and post approvals.</small>}
    </>}
    {/* Technical plumbing stays with the owner and technical support — a
        reader can only break their own downloads with it. */}
    {canPerform(realProfileRole(profile), "manage") && <>
      <hr/><p className="eyebrow">ADVANCED CONNECTION</p>
      <label>Connection address<input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} /></label>
      {endpoint.trim() !== defaultSettings.endpoint && <button className="text-button" onClick={() => setEndpoint(defaultSettings.endpoint)}>Reset To The Standard Address</button>}
      <label>Temporary bearer credential<input type="password" value={bearerToken} onChange={(event) => setBearerToken(event.target.value)} autoComplete="off" /></label>
    </>}
    <div className="form-actions"><button onClick={onCancel}>Cancel</button><button className="primary" onClick={saveAll}>Save</button></div>
  </main>;
}

// When the owner's machine has the bot key, approvals carry the team messaging
// connection along inside the unlock code — one paste sets everything up.
function ownerMessagingPayload(): { botToken: string; channelId: string } | undefined {
  return messagingConnected() ? { botToken: getBotToken(), channelId: getRelayChannelId() } : undefined;
}

function cleanTitle(name: string): string {
  return name.replace(/\.(txt|docx)$/i, "").replace(/\s+v\d+(?:\.\d+)*$/i, "");
}

// "C07-R Chapter 07 …" or "Chapter 7 …" → 7. Null when a file has no chapter.
function chapterNumberFromName(name: string): number | null {
  const match = /^C(\d{1,2})\b/i.exec(name) ?? /Chapter\s+(\d{1,2})\b/i.exec(name);
  return match ? Number(match[1]) : null;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "The project connection failed.";
}
