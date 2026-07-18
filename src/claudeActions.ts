// Claude's hands inside the app.
//
// Claude already reaches the project files through the bridge. This gives it
// the rest: it writes an action file to Dropbox, the app picks it up and
// carries the action out — opening screens, changing settings, moving and
// making files, releasing chapters, proposing rewrites.
//
// Two speeds, on purpose. Ordinary actions (open this, set that, make a note)
// happen straight away. Anything that changes the book itself waits for the
// author's OK GO, because that brake is the whole reason this project works.
// Every action is written to a log either way.

import { projectFile } from "./projects";

export const actionsPath = () => projectFile("claude-actions.json");

export type ActionKind =
  | "open_screen"
  | "set_setting"
  | "add_pronunciation"
  | "release_chapters"
  | "make_note"
  | "new_file"
  | "move_file"
  | "propose_edit"
  | "say";

export interface ClaudeAction {
  id: string;
  kind: ActionKind;
  why?: string;               // Claude's one-line reason, shown to the author
  // open_screen
  screen?: string;
  // set_setting
  setting?: string;
  value?: string | number | boolean;
  // add_pronunciation
  say?: string;
  as?: string;
  // release_chapters
  chapters?: number[];
  // make_note / new_file / propose_edit
  text?: string;
  path?: string;              // workspace-relative
  to?: string;                // move_file destination
  find?: string;              // propose_edit: the passage to replace
  replace?: string;           // propose_edit: what it becomes
}

export interface ActionRecord {
  action: ClaudeAction;
  at: string;
  state: "done" | "waiting" | "approved" | "declined" | "failed";
  note: string;
}

// Which actions may run on their own, and which must wait for OK GO. Anything
// that writes to the author's actual prose waits. Always.
export function needsOkGo(kind: ActionKind): boolean {
  return kind === "propose_edit" || kind === "move_file" || kind === "release_chapters";
}

export function describeAction(action: ClaudeAction): string {
  switch (action.kind) {
    case "open_screen": return `Open ${action.screen}`;
    case "set_setting": return `Set ${action.setting} to ${String(action.value)}`;
    case "add_pronunciation": return `Teach the narrator "${action.say}" → "${action.as}"`;
    case "release_chapters": return `Release chapter${(action.chapters ?? []).length === 1 ? "" : "s"} ${(action.chapters ?? []).join(", ")}`;
    case "make_note": return `Save a note: ${(action.text ?? "").slice(0, 60)}…`;
    case "new_file": return `Make the file ${action.path}`;
    case "move_file": return `Move ${action.path} to ${action.to}`;
    case "propose_edit": return `Rewrite a passage in ${action.path}`;
    case "say": return `Say aloud: ${(action.text ?? "").slice(0, 60)}`;
    default: return "Unknown request";
  }
}

const KINDS: ActionKind[] = [
  "open_screen", "set_setting", "add_pronunciation", "release_chapters",
  "make_note", "new_file", "move_file", "propose_edit", "say"
];

// Pure: read an action file, keeping only well-formed requests. A damaged or
// half-written file yields nothing rather than nonsense.
export function parseActions(json: string): ClaudeAction[] {
  try {
    const raw = JSON.parse(json) as unknown;
    const list = Array.isArray(raw) ? raw : (raw as { actions?: unknown })?.actions;
    if (!Array.isArray(list)) return [];
    return list.filter((item): item is ClaudeAction => {
      const a = item as Partial<ClaudeAction>;
      if (!a || typeof a.id !== "string" || !a.id.trim()) return false;
      if (!KINDS.includes(a.kind as ActionKind)) return false;
      // Each kind must carry what it needs, or it is not a real request.
      switch (a.kind) {
        case "open_screen": return typeof a.screen === "string" && !!a.screen;
        case "set_setting": return typeof a.setting === "string" && a.value !== undefined;
        case "add_pronunciation": return typeof a.say === "string" && typeof a.as === "string" && !!a.say && !!a.as;
        case "release_chapters": return Array.isArray(a.chapters) && a.chapters.every((n) => typeof n === "number");
        case "make_note":
        case "say": return typeof a.text === "string" && !!a.text.trim();
        case "new_file": return typeof a.path === "string" && !!a.path && typeof a.text === "string";
        case "move_file": return typeof a.path === "string" && !!a.path && typeof a.to === "string" && !!a.to;
        case "propose_edit": return typeof a.path === "string" && !!a.path
          && typeof a.find === "string" && !!a.find && typeof a.replace === "string";
        default: return false;
      }
    });
  } catch {
    return [];
  }
}

// ---- What has already been handled ----------------------------------------

const HANDLED_KEY = "mcg-claude-handled";
const LOG_KEY = "mcg-claude-log";
const ENABLED_KEY = "mcg-claude-access";

export function claudeAccessOn(): boolean {
  try { return localStorage.getItem(ENABLED_KEY) === "true"; } catch { return false; }
}
export function setClaudeAccess(on: boolean): void {
  try { localStorage.setItem(ENABLED_KEY, on ? "true" : "false"); } catch { /* ignore */ }
}

export function handledIds(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(HANDLED_KEY) || "[]") as string[]); } catch { return new Set(); }
}
export function markHandled(id: string): void {
  try {
    const ids = [...handledIds(), id];
    localStorage.setItem(HANDLED_KEY, JSON.stringify(ids.slice(-500)));
  } catch { /* ignore */ }
}

export function actionLog(): ActionRecord[] {
  try { return JSON.parse(localStorage.getItem(LOG_KEY) || "[]") as ActionRecord[]; } catch { return []; }
}
export function writeLog(list: ActionRecord[]): void {
  try { localStorage.setItem(LOG_KEY, JSON.stringify(list.slice(-200))); } catch { /* ignore */ }
}
export function logAction(action: ClaudeAction, state: ActionRecord["state"], note: string): ActionRecord[] {
  const next = [{ action, at: new Date().toISOString(), state, note }, ...actionLog()];
  writeLog(next);
  return next;
}
export function updateLogState(id: string, state: ActionRecord["state"], note: string): ActionRecord[] {
  const next = actionLog().map((record) => record.action.id === id ? { ...record, state, note } : record);
  writeLog(next);
  return next;
}

// The instruction sheet the author hands to Claude so it knows the protocol.
export function claudeInstructions(): string {
  return `You can act inside the MaggotClaw Games app.

Write a JSON file to Dropbox at ${actionsPath()} shaped like:

{"actions": [ { "id": "unique-id", "kind": "...", "why": "one line for the author", ... } ]}

Kinds and their fields:
- open_screen   { "screen": "home | library | reader | settings | projects | project-workspace | human-maker | chat | dashboard | idea" }
- set_setting   { "setting": "speechRate | silenceSeconds | addSeconds | readRepliesAutomatically | listenAfterReading | skipContentBoxes | includeStoryContext", "value": ... }
- add_pronunciation { "say": "Louvenia", "as": "loo-VEE-nee-ah" }
- release_chapters  { "chapters": [5, 6] }          (waits for OK GO)
- make_note     { "text": "the idea" }               (lands in 02 Working Files/Ideas)
- new_file      { "path": "04 Proposed Changes/name.txt", "text": "contents" }
- move_file     { "path": "from/here.txt", "to": "to/there.txt" }   (waits for OK GO)
- propose_edit  { "path": "01 Originals/C07-R ....txt", "find": "exact passage", "replace": "the rewrite" }   (waits for OK GO)
- say           { "text": "read this aloud to the author" }

Rules:
- Give every action a new unique id; the app runs each id once.
- propose_edit, move_file and release_chapters are shown to the author as
  before/after and only happen when he presses OK GO. Everything else runs
  immediately.
- "find" must match the file's text exactly, including punctuation.
- Never touch canon, locked lines, chapter events, or the reveal schedule
  without being asked. The Human Maker filter and the Ward directive govern
  all prose.`;
}
