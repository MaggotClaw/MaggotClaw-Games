// Walkthroughs: the little window that stays on top and shows you what to do.
//
// It opens the right screen for you, says in plain words what to do there, and
// waits. Press Next and it takes you to the next place. No hunting, no jargon,
// no knowing where anything lives. Built for whoever finds this hardest.

export interface Step {
  say: string;              // what to do, in plain words
  screen?: string;          // the screen to open for them
  open?: string;            // a web page to open for them
  copy?: string;            // text put on their clipboard, ready to paste
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
    id: "dropbox-sharing",
    name: "Turning On Dropbox Sharing",
    forOwner: true,
    why: "Reader Links and app updates can make the read-only links your friends use.",
    steps: [
      { say: "Your Dropbox app can read and write your files, but it is not yet allowed to make sharing links. Reader Links and app updates both need that. This fixes it — about three minutes.", screen: "home" },
      { say: "I have opened the Dropbox App Console. Sign in if it asks, then click your app in the list.", open: "https://www.dropbox.com/developers/apps", heads: "If you see more than one app, pick the one you made for this program." },
      { say: "Click the Permissions tab along the top." },
      { say: "Tick sharing.read and sharing.write. Leave everything already ticked exactly as it is. Then press Submit at the bottom.", heads: "Do not untick anything — the app still needs its file permissions." },
      { say: "Permissions only apply to a new sign-in, so the app needs a fresh key. Tell your assistant \"the Dropbox permissions are done\" and it will run the key script and update everything for you.", heads: "The script prints a link, you approve it in your browser, and paste one code back. Your assistant handles the rest." },
      { say: "Once the new key is in, Publish Reader Links and app updates will both work. Run First-Time Setup next.", screen: "home" }
    ]
  },
  {
    id: "settings-again",
    name: "Setting Up After An Update",
    forOwner: true,
    why: "Everything you had before is back — your name, your role, your keys.",
    steps: [
      { say: "This version changed the app's identity, so Windows treats it as new and your settings look empty. Nothing is lost — they are in a file, and this takes about a minute.", screen: "home" },
      { say: "Press Import My Settings near the bottom of this page. It reads the backup file from your Documents folder and puts everything back.", screen: "settings", heads: "If it says no file was found, carry on — the next steps set things up by hand." },
      { say: "Check the top of the page: your name should be back, and the who-chip on the main page should say Author / Owner.", screen: "settings" },
      { say: "If the Discord key did not come back, open the Discord Developer Portal — I will open it for you. Sign in, choose the MaggotClaw Games application, open Bot on the left, and press Reset Token. Copy the new token.", open: "https://discord.com/developers/applications", heads: "Resetting the token stops the old one working. That is fine — only this app uses it." },
      { say: "Paste that token into Discord bot key under Owner, then press Save.", screen: "settings" },
      { say: "Now press Import From The Bridge under Owner — Project Files, then Save. That restores the Dropbox connection without typing anything.", screen: "settings" },
      { say: "Last: press Export My Settings. That writes a fresh backup so the next update is a single button.", screen: "settings" },
      { say: "You are back. Everything else — people, pronunciations, releases — came back with the import.", screen: "home" }
    ]
  },
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
    id: "okgo-button",
    name: "The OK GO Button",
    forOwner: false,
    why: "You can approve something with one press, from anywhere on the screen, and call it off if you change your mind.",
    steps: [
      { say: "OK GO is how you say yes. Nothing that changes the book happens until you press it — that brake is the whole reason this is safe.", screen: "home" },
      { say: "Press OK GO Button and a small bar appears. It floats above everything, so it is there whatever else you are looking at.", screen: "home" },
      { say: "Drag it wherever suits you by the grip along its bottom. It stays where you put it.", heads: "The X sits off to the side on purpose, so reaching for OK GO can never close it by accident." },
      { say: "Press it and it counts three, two, one before sending. Press again during the countdown and nothing goes.", heads: "That pause is deliberate. It is the moment to change your mind." }
    ]
  },
  {
    id: "projects-tour",
    name: "Working On The Project",
    forOwner: false,
    why: "You know where the chapters live on your own computer, and what you may do with them.",
    steps: [
      { say: "Projects is the working side of the app. Reader Mode is for reading; this is for the files themselves.", screen: "projects" },
      { say: "Open a project. What you can do here depends on your role — a reader can look, an editor can propose changes.", screen: "projects" },
      { say: "Download or Update pulls the newest files onto this computer. It only takes what your role needs, so nothing is cluttered with files meant for someone else.", screen: "project-workspace" },
      { say: "Everything lands in numbered folders. 01 Originals is the real thing, 04 Proposed Changes is where suggestions wait, 07 Backups keeps the old copy of anything replaced.", heads: "Nothing you do locally touches Dropbox until an upload is approved." },
      { say: "View The File List shows every file with who it is for. That is where the owner decides what each role downloads.", screen: "workspace-files" }
    ]
  },
  {
    id: "messages-tour",
    name: "Talking To Everyone",
    forOwner: false,
    why: "You can post in the right room and know who else is there.",
    steps: [
      { say: "Messages has a room for each group — readers, editors, and the author. Post in the one that fits.", screen: "chat" },
      { say: "Who's Here shows who else has the app open. It is not a promise they are watching, only that they are connected.", screen: "chat" },
      { say: "Access requests also arrive here for the owner, so nothing gets lost in a private message.", heads: "If the rooms are empty, the messaging key has not been set up yet — ask MaggotClaw for it." }
    ]
  },
  {
    id: "ask-for-access",
    name: "Asking For More Access",
    forOwner: false,
    why: "You have asked for the role you need, and you know what happens next.",
    steps: [
      { say: "Everyone starts as a Reader. Anything more is given by MaggotClaw — it is never taken.", screen: "home" },
      { say: "Say which role you want and why. One line is plenty; he only needs to know what you are hoping to do.", screen: "request-access" },
      { say: "Send it. The request goes straight to him — there is no code to copy and nothing to paste.", screen: "request-access" },
      { say: "Carry on reading while you wait. When he approves you, your app unlocks itself the next time you open it.", heads: "New questions may appear in your profile afterwards — those are the ones only your new role is asked." }
    ]
  },
  {
    id: "human-maker-tour",
    name: "Using The Human Maker",
    forOwner: true,
    why: "You can audit a passage against your own codex and hand the findings to the AI.",
    steps: [
      { say: "The Human Maker reads a passage the way your codex says to read it, and finds the tells that make prose look machine-written. It runs entirely on this computer.", screen: "human-maker" },
      { say: "Pick a chapter, or paste a passage in. Then press Run The Audit.", screen: "human-maker" },
      { say: "The mechanical tells are found for you. Underneath are the ones no machine can judge — voice, flair, subtext — listed to read aloud for.", heads: "It is a detector, not a rewriter. The writing stays yours." },
      { say: "Send Audit To Claude hands the findings straight over, with the Ward directive and the canon protections attached. Then say Ok Go there.", screen: "human-maker" }
    ]
  },
  {
    id: "claude-connector",
    name: "Putting MaggotClaw In Claude's Menu",
    forOwner: true,
    why: "Claude reads and writes your project files itself, from anywhere, with nothing running on this computer.",
    steps: [
      { say: "Your project already has its own server online. This puts it in Claude's own menu, so Claude can open your chapters and codices without you pasting anything. About five minutes.", screen: "home" },
      { say: "I have opened Claude's settings. Go to Connectors, then press Add Custom Connector.", open: "https://claude.ai/settings/connectors" },
      { say: "Paste this as the server address. It is already on your clipboard.", copy: "https://maggotclaw-games-long-rot-mcp.onrender.com/mcp", heads: "Name it MaggotClaw Games so you recognise it later." },
      { say: "It will ask you to sign in. Use the Auth0 details saved in Bitwarden under Auth0 – The Long Rot MCP – Claude.", heads: "Never type your Dropbox password or keys into Claude. It does not need them — the server holds them." },
      { say: "When it says Connected, start a fresh chat and ask Claude to list your chapters. If it answers with real filenames, it is working.", heads: "The first request after a quiet spell takes about thirty seconds — the server wakes up. That is normal." },
      { say: "From now on Claude can read the codices and your chapters directly. Anything that changes the book still waits for your OK GO.", screen: "home" }
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
