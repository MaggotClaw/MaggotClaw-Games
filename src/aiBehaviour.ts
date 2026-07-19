// How the author wants an AI to talk to him.
//
// The buttons exist to solve the blank page, not to be pressed all at once. A
// long instruction list works worse than a short one — every rule added
// dilutes the rest — so each button produces one concrete behaviour rather
// than an adjective. "Be clear" changes nothing; "say what was not changed"
// changes everything.
//
// The assembled paragraph is a draft. The author edits it, and his edit wins.

import { activeProject } from "./projects";

export interface BehaviourChoice {
  id: string;
  group: "Length" | "Care" | "Working";
  label: string;              // what the button says
  line: string;               // the instruction it contributes
  fights?: string[];          // ids that pull the opposite way
}

export const BEHAVIOUR_CHOICES: BehaviourChoice[] = [
  {
    id: "short", group: "Length", label: "Answers, Not Explanations",
    line: "Answer in a line or two. Give detail only when I ask for it.",
    fights: ["reasoning"]
  },
  {
    id: "no-preamble", group: "Length", label: "No Preamble",
    line: "Start with the answer. Do not restate my question back to me first."
  },
  {
    id: "plain", group: "Length", label: "Plain Words",
    line: "Use plain words. No jargon unless I use it first."
  },
  {
    id: "reasoning", group: "Length", label: "Show Your Reasoning",
    line: "Explain how you reached the answer, not just the answer.",
    fights: ["short"]
  },
  {
    id: "okgo", group: "Care", label: "Nothing Without OK GO",
    line: "Change nothing until I say OK GO. Plan first, then wait."
  },
  {
    id: "unchanged", group: "Care", label: "Say What You Did Not Change",
    line: "When something fails, tell me plainly what was not changed."
  },
  {
    id: "guessing", group: "Care", label: "Admit When You Are Guessing",
    line: "Say when you are unsure instead of sounding certain. Never present a guess as a fact."
  },
  {
    id: "verified", group: "Care", label: "Check Before Claiming It Works",
    line: "Do not tell me something works until you have actually run it and seen it work."
  },
  {
    id: "stack", group: "Working", label: "Stack Changes, Do Not Rebuild",
    line: "Collect changes up. Do not build or publish anything until I ask for it."
  },
  {
    id: "decide", group: "Working", label: "Decide The Routine Things",
    line: "Make ordinary decisions yourself. Ask me only when the choice is genuinely mine to make.",
    fights: ["ask-first"]
  },
  {
    id: "ask-first", group: "Working", label: "Ask Before Deciding",
    line: "Check with me before making a choice on my behalf, even a small one.",
    fights: ["decide"]
  },
  {
    id: "push-back", group: "Working", label: "Tell Me When I Am Wrong",
    line: "If you think I am mistaken, say so and say why. Do not go along with something you believe is wrong."
  }
];

export const behaviourPath = () =>
  `${activeProject().sharedRoot ?? "/MaggotClaw Games"}/Operations/02 AI Behavior Profile Specification/How MaggotClaw Wants To Be Talked To.txt`;

const STORAGE_KEY = "mcg-ai-behaviour";

export interface BehaviourDraft {
  picked: string[];
  text: string;               // what will actually be saved, edits included
}

// Pure: the paragraph the chosen buttons make. Grouped in a fixed order so the
// same picks always read the same way.
export function composeBehaviour(picked: string[]): string {
  const chosen = BEHAVIOUR_CHOICES.filter((choice) => picked.includes(choice.id));
  if (!chosen.length) return "";
  const groups: BehaviourChoice["group"][] = ["Length", "Care", "Working"];
  const lines = groups.flatMap((group) => chosen.filter((choice) => choice.group === group).map((choice) => `- ${choice.line}`));
  return `How to talk to me:\n\n${lines.join("\n")}`;
}

// Pure: pairs that pull against each other. Worth saying out loud — two rules
// that contradict do not average out, they cancel, and the author ends up with
// neither behaviour.
export function conflicts(picked: string[]): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  for (const choice of BEHAVIOUR_CHOICES) {
    if (!picked.includes(choice.id)) continue;
    for (const other of choice.fights ?? []) {
      if (picked.includes(other) && !found.some(([a, b]) => a === other && b === choice.id)) {
        found.push([choice.id, other]);
      }
    }
  }
  return found;
}

export function labelOf(id: string): string {
  return BEHAVIOUR_CHOICES.find((choice) => choice.id === id)?.label ?? id;
}

// Too many rules is its own problem, separate from any two contradicting.
export const TOO_MANY = 7;

export function loadBehaviour(): BehaviourDraft {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Partial<BehaviourDraft>;
    const picked = Array.isArray(raw.picked) ? raw.picked.filter((id): id is string => typeof id === "string") : [];
    return { picked, text: typeof raw.text === "string" ? raw.text : composeBehaviour(picked) };
  } catch {
    return { picked: [], text: "" };
  }
}

export function saveBehaviour(draft: BehaviourDraft): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(draft)); } catch { /* ignore */ }
}

// The file every assistant's instruction file points at. Written whole, so
// what is on Dropbox is always exactly what the author last approved.
export function behaviourFile(text: string, when: string): string {
  return `═════════════════════════════════════════════
How MaggotClaw Wants To Be Talked To
═════════════════════════════════════════════

Written from the app, ${when}. Edit it here or in the app; the app reads this
file back, so neither copy goes stale.

The per-assistant instruction files in this folder point at this one. Change it
once and every assistant reading them follows it.

_____________________________________________

${text.trim()}
`;
}

// Pull the author's own words back out of the file, so the app shows what is
// actually in force rather than a blank box.
export function parseBehaviourFile(contents: string): string {
  const marker = contents.lastIndexOf("_____________________________________________");
  const body = marker === -1 ? contents : contents.slice(marker + 45);
  return body.trim();
}
