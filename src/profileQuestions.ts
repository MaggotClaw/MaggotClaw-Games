// A profile that grows as trust grows.
//
// Nobody should face twenty questions on the first day. Everyone answers a few
// plain ones; being made a Reviewer, an Editor or a Manager adds the questions
// that only matter once you actually do that job.
//
// The questions a person sees are cumulative — an Editor still answers the
// reader's questions, because they still read.

import { ROLE_ORDER, type ProjectRole } from "./permissions";
import { EMPTY_READER_PROFILE, loadReaderProfile, type ReaderProfile } from "./profileInfo";

export interface ProfileQuestion {
  id: string;
  askedAt: ProjectRole;       // the lowest role this question is put to
  label: string;
  hint?: string;
  kind: "text" | "long" | "choice";
  options?: string[];
  // Carried over from the older reader profile so nothing already answered is
  // asked twice.
  legacy?: keyof ReaderProfile;
}

export const PROFILE_QUESTIONS: ProfileQuestion[] = [
  // ---- Everyone ----------------------------------------------------------
  { id: "email", askedAt: "reader", label: "Email", kind: "text", legacy: "email" },
  { id: "phone", askedAt: "reader", label: "Phone", hint: "Only used if you ask for the book to be sent to you.", kind: "text", legacy: "phone" },
  { id: "where", askedAt: "reader", label: "Where are you?", hint: "State or region is plenty.", kind: "text", legacy: "where" },
  { id: "invitedBy", askedAt: "reader", label: "Who invited you?", kind: "text", legacy: "invitedBy" },
  { id: "prefers", askedAt: "reader", label: "How do you like to take it in?", kind: "choice", options: ["Read to me", "I read it myself", "Both, depending"], legacy: "prefers" },
  { id: "pace", askedAt: "reader", label: "How much do you read in a week?", kind: "choice", options: ["A chapter or two", "Several chapters", "Whatever you send me", "It varies"], legacy: "pace" },
  { id: "reads", askedAt: "reader", label: "What do you usually read?", kind: "text", legacy: "reads" },
  { id: "authors", askedAt: "reader", label: "Favourite authors", kind: "text", legacy: "authors" },
  { id: "avoid", askedAt: "reader", label: "Anything you would rather not read?", hint: "Said once here, and respected.", kind: "long", legacy: "avoid" },
  { id: "betaBefore", askedAt: "reader", label: "Read for a writer before?", kind: "choice", options: ["No", "A little", "Yes, often"], legacy: "betaBefore" },
  { id: "spoilers", askedAt: "reader", label: "Do you want to know what is coming?", hint: "Some readers like a hint of what a chapter holds; others want none.", kind: "choice", options: ["No hints at all", "A little warning is fine", "Tell me anything"] },
  { id: "quoting", askedAt: "reader", label: "May your comments be quoted?", kind: "choice", options: ["Yes, with my name", "Yes, but no name", "No"] },
  { id: "notes", askedAt: "reader", label: "Anything else worth knowing?", kind: "long", legacy: "notes" },

  // ---- Reviewer ----------------------------------------------------------
  { id: "catches", askedAt: "reviewer", label: "What do you tend to notice?", hint: "Plot holes, repeated words, pacing, dialogue — whatever your eye goes to.", kind: "long" },
  { id: "bluntness", askedAt: "reviewer", label: "How blunt should feedback to you be?", kind: "choice", options: ["Gently", "Straight but kind", "Do not spare me"] },
  { id: "skipChapters", askedAt: "reviewer", label: "Anything you would rather not review?", kind: "text" },

  // ---- Editor ------------------------------------------------------------
  { id: "scope", askedAt: "editor", label: "Which parts may you work on?", hint: "Set by the author. Say what you understand it to be.", kind: "long" },
  { id: "format", askedAt: "editor", label: "Do you work in Word or plain text?", kind: "choice", options: ["Word", "Plain text", "Either"] },
  { id: "humanMaker", askedAt: "editor", label: "Do you want the Human Maker?", hint: "The author decides; this only says whether you want it.", kind: "choice", options: ["Yes please", "Not needed"] },

  // ---- Manager -----------------------------------------------------------
  { id: "mayApprove", askedAt: "manager", label: "May you approve other people?", kind: "choice", options: ["Yes", "No", "Only readers"] },
  { id: "approveUpTo", askedAt: "manager", label: "Up to which role?", kind: "choice", options: ["Reader", "Contributor", "Reviewer", "Editor"] }
];

const KEY = (profile: string) => `mcg-profile-answers:${profile}`;

export type ProfileAnswers = Record<string, string>;

// Pure: every question put to this role, in order. Cumulative — an Editor is
// still a reader, so the reader's questions remain.
export function questionsFor(role: ProjectRole): ProfileQuestion[] {
  const rank = ROLE_ORDER.indexOf(role);
  return PROFILE_QUESTIONS.filter((question) => ROLE_ORDER.indexOf(question.askedAt) <= rank);
}

// Pure: what this role has been asked but not yet answered. Promotion adds
// questions, so a freshly promoted person genuinely has gaps — worth saying
// rather than pretending the answers exist.
export function unanswered(role: ProjectRole, answers: ProfileAnswers): ProfileQuestion[] {
  return questionsFor(role).filter((question) => !(answers[question.id] ?? "").trim());
}

export function completeness(role: ProjectRole, answers: ProfileAnswers): { answered: number; total: number } {
  const total = questionsFor(role).length;
  return { answered: total - unanswered(role, answers).length, total };
}

// The questions that appeared because of a promotion, so someone can be shown
// exactly what is newly being asked of them rather than the whole form again.
export function newlyAsked(from: ProjectRole, to: ProjectRole): ProfileQuestion[] {
  const older = new Set(questionsFor(from).map((question) => question.id));
  return questionsFor(to).filter((question) => !older.has(question.id));
}

export function loadAnswers(profile: string): ProfileAnswers {
  let stored: ProfileAnswers = {};
  try {
    const raw = JSON.parse(localStorage.getItem(KEY(profile)) || "{}") as Record<string, unknown>;
    for (const [id, value] of Object.entries(raw)) if (typeof value === "string") stored[id] = value;
  } catch { stored = {}; }
  // Anything already given to the older reader profile counts as answered.
  const legacy = loadReaderProfile(profile);
  const merged: ProfileAnswers = {};
  for (const question of PROFILE_QUESTIONS) {
    const carried = question.legacy ? (legacy[question.legacy] ?? "").trim() : "";
    const value = (stored[question.id] ?? "").trim() || carried;
    if (value) merged[question.id] = value;
  }
  return merged;
}

export function saveAnswers(profile: string, answers: ProfileAnswers): void {
  try { localStorage.setItem(KEY(profile), JSON.stringify(answers)); } catch { /* ignore */ }
}

// Written into the person's file so the author reads answers, not a form.
export function answersSummary(role: ProjectRole, answers: ProfileAnswers): string {
  const lines = questionsFor(role)
    .map((question) => [question.label, (answers[question.id] ?? "").trim()] as const)
    .filter(([, value]) => value)
    .map(([label, value]) => `- ${label}: ${value}`);
  return lines.length ? lines.join("\n") : "Nothing filled in yet.";
}

export { EMPTY_READER_PROFILE };
