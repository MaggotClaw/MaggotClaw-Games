// Walkthroughs: the little window that stays on top and shows you what to do.
//
// It opens the right screen for you, says in plain words what to do there, and
// waits. Press Next and it takes you to the next place. No hunting, no jargon,
// no knowing where anything lives. Built for whoever finds this hardest.

export interface Step {
  say: string;              // what to do, in plain words
  screen?: string;          // the screen to open for them
  heads?: string;           // a warning or aside worth reading first
}

export interface Walkthrough {
  id: string;
  name: string;
  forOwner: boolean;        // owner-only guides are hidden from readers
  why: string;              // one line: what you end up with
  steps: Step[];
}

export const WALKTHROUGHS: Walkthrough[] = [
  {
    id: "reader-start",
    name: "Getting Started",
    forOwner: false,
    why: "You end up reading the book, with your place saved.",
    steps: [
      { say: "Welcome. This takes about a minute. Press Next whenever you are ready.", screen: "home" },
      { say: "If MaggotClaw sent you a Messaging Key, this is where it goes. Press Connect Messaging in the left column, paste the key, and press Connect. If you have not got one, just press Next.", screen: "chat" },
      { say: "This is Reader Mode — your shelf. Press Get The Latest Chapters at the top to bring the book onto this computer.", screen: "library" },
      { say: "Now click any chapter that is not locked. Choose Narrated to be read to, or Read Myself for a normal page.", screen: "library" },
      { say: "While you read: the four buttons — Loved It, Confused, Scared, Bored — mark the exact sentence for MaggotClaw without stopping the story. Comment records your voice.", screen: "library" },
      { say: "That is everything. Your place saves itself, so you can close the app any time and come back where you left off.", screen: "home" }
    ]
  },
  {
    id: "owner-setup",
    name: "First-Time Setup",
    forOwner: true,
    why: "Your computer talks to Dropbox directly and your friends can download the book.",
    steps: [
      { say: "This sets up everything on your side. Press Next to begin.", screen: "home" },
      { say: "Scroll down to Owner — Project Files and press Import From The Bridge. It reads your Dropbox keys for you. Then press Save at the bottom.", screen: "settings", heads: "The bridge does not need to be running for this — it only reads the settings file it left behind." },
      { say: "Open your project here. Press Open on The Long Rot.", screen: "projects" },
      { say: "Press Download or Update to bring the files onto this computer. Unchanged files are skipped, so this is quick after the first time.", screen: "project-workspace" },
      { say: "Now press View The File List. Rate each file with the lowest role that needs it — most chapters are Reader And Up. Anything nobody needs, mark Not Needed In App.", screen: "workspace-files" },
      { say: "Press Publish File Access, then Publish Reader Links. That makes the read-only links your friends download through — no keys ever leave your computer.", screen: "workspace-files" },
      { say: "Last step: press Copy Messaging Key and send it privately to each friend. One key gives them the chat and the book.", screen: "chat" },
      { say: "Done. You are set up. Friends now need only the installer and that one key.", screen: "home" }
    ]
  },
  {
    id: "release-chapter",
    name: "Releasing A Chapter",
    forOwner: true,
    why: "A new chapter reaches every reader.",
    steps: [
      { say: "Put the finished chapter in your Dropbox project folder first, the way you always do. Press Next when it is there.", screen: "home" },
      { say: "Press Download or Update so this computer has the new file.", screen: "project-workspace" },
      { say: "Open the file list and rate the new chapter — usually Reader And Up. Then press Publish Reader Links so readers can fetch it.", screen: "workspace-files" },
      { say: "Now tick the chapter under Released Chapters and press Publish Releases. Every reader's app picks it up the next time they open it.", screen: "dashboard" },
      { say: "Optional: post in Announcements so everyone knows it is out.", screen: "chat" }
    ]
  },
  {
    id: "claude-setup",
    name: "Letting Claude Work In The App",
    forOwner: true,
    why: "Claude can open screens, change settings and propose rewrites — with your OK GO on anything that touches the book.",
    steps: [
      { say: "This lets Claude act inside the app. You stay in charge of anything that changes your writing.", screen: "home" },
      { say: "Turn on Let Claude Act Inside This App.", screen: "claude-access" },
      { say: "Press Copy The Instructions For Claude, then paste them into Claude. That is all Claude needs.", screen: "claude-access" },
      { say: "From now on, anything Claude asks that would change the book waits right here for your OK GO. Everything it has done is listed underneath.", screen: "claude-access" }
    ]
  },
  {
    id: "voice-companion",
    name: "Talking To The AI",
    forOwner: false,
    why: "You can talk instead of type, and have the replies read back to you.",
    steps: [
      { say: "Open Claude or Codex on your computer first, the way you normally would. Press Next when it is open.", screen: "home" },
      { say: "Choose which program you are talking to, then press it to open the floating bar.", screen: "voice-targets" },
      { say: "The little bar floats above everything. Press the microphone and talk — your words appear in the AI. It sends by itself after a couple of seconds of quiet.", heads: "If the bar ever goes quiet after sending, press the ▶ button and it reads the latest reply." },
      { say: "The OK GO button on the main page works the same way: press it, it counts three, two, one, and sends OK GO. Press again during the countdown to call it off.", screen: "home" }
    ]
  }
];

export function walkthroughsFor(isOwner: boolean): Walkthrough[] {
  return WALKTHROUGHS.filter((w) => isOwner || !w.forOwner);
}

export function findWalkthrough(id: string): Walkthrough | undefined {
  return WALKTHROUGHS.find((w) => w.id === id);
}

// Pure: where a step number lands, kept inside the guide's real bounds.
export function clampStep(walkthrough: Walkthrough, index: number): number {
  return Math.max(0, Math.min(index, walkthrough.steps.length - 1));
}

export function progressLine(walkthrough: Walkthrough, index: number): string {
  return `Step ${clampStep(walkthrough, index) + 1} of ${walkthrough.steps.length}`;
}

const DONE_KEY = "mcg-walkthroughs-done";

export function completed(): string[] {
  try { return JSON.parse(localStorage.getItem(DONE_KEY) || "[]") as string[]; } catch { return []; }
}

export function markCompleted(id: string): void {
  try { localStorage.setItem(DONE_KEY, JSON.stringify([...new Set([...completed(), id])])); } catch { /* ignore */ }
}
