// Things that still need doing.
//
// Half-finished setup is invisible until something fails at the worst moment —
// a friend cannot download, or a message never arrives. So the app works out
// what is still outstanding, says so on the front page, and hands each one to
// the guide that fixes it. Nobody should have to remember any of this.

export interface SetupTask {
  id: string;
  title: string;
  why: string;              // what breaks while this is undone
  urgent: boolean;          // true = something is actually broken right now
  guide?: string;           // the walkthrough that fixes it
  screen?: string;          // or the screen to open
}

// Everything the check needs to know, gathered by the app.
export interface SetupState {
  isOwner: boolean;
  hasProjectKeys: boolean;      // owner can reach Dropbox directly
  sharingWorks: boolean;        // Dropbox will make share links
  readerLinksPublished: boolean;
  hasMessaging: boolean;        // this machine can read team messages
  hasCatalog: boolean;          // a reader can fetch the book
  filesDownloaded: number;
  releasedChapters: number;
  settingsBackedUp: boolean;
  peopleCount: number;
}

// Pure, so the whole list can be reasoned about and tested.
export function outstandingTasks(state: SetupState): SetupTask[] {
  const tasks: SetupTask[] = [];

  if (state.isOwner) {
    if (!state.hasProjectKeys) {
      tasks.push({
        id: "project-keys", urgent: true,
        title: "Connect Your Project Files",
        why: "Without this the app cannot read or write your Dropbox, so nothing downloads or uploads.",
        guide: "owner-setup"
      });
    }
    if (state.hasProjectKeys && !state.sharingWorks) {
      tasks.push({
        id: "dropbox-sharing", urgent: true,
        title: "Turn On Dropbox Sharing",
        why: "Your Dropbox app cannot make sharing links yet, so Reader Links and app updates both fail.",
        guide: "dropbox-sharing"
      });
    }
    if (state.hasProjectKeys && state.sharingWorks && !state.readerLinksPublished) {
      tasks.push({
        id: "reader-links", urgent: true,
        title: "Publish Reader Links",
        why: "Until this is done your friends have no way to download the book.",
        guide: "owner-setup"
      });
    }
    if (state.filesDownloaded === 0) {
      tasks.push({
        id: "download", urgent: false,
        title: "Bring Your Files Onto This Computer",
        why: "The shelf, the search and the Human Maker all read from your local copies.",
        screen: "project-workspace"
      });
    }
    if (state.releasedChapters === 0) {
      tasks.push({
        id: "release", urgent: false,
        title: "Release A Chapter",
        why: "Readers see the shape of the book but cannot open anything yet.",
        guide: "release-chapter"
      });
    }
    if (!state.settingsBackedUp) {
      tasks.push({
        id: "backup", urgent: false,
        title: "Save A Settings Backup",
        why: "If you update or move computer, your keys and people come back in one press.",
        screen: "settings"
      });
    }
    if (state.readerLinksPublished && state.peopleCount === 0) {
      tasks.push({
        id: "invite", urgent: false,
        title: "Invite Your First Reader",
        why: "Everything is ready — send someone a Messaging Key and see it work end to end.",
        screen: "chat"
      });
    }
    return tasks;
  }

  // Readers and editors
  if (!state.hasCatalog && !state.hasProjectKeys) {
    tasks.push({
      id: "key", urgent: true,
      title: "Paste Your Messaging Key",
      why: "It connects your messages and lets you download the book. MaggotClaw sends it to you.",
      guide: "reader-start"
    });
  }
  if (state.filesDownloaded === 0 && (state.hasCatalog || state.hasProjectKeys)) {
    tasks.push({
      id: "get-book", urgent: true,
      title: "Get The Latest Chapters",
      why: "Your shelf is empty until the book is on this computer.",
      screen: "library"
    });
  }
  if (!state.hasMessaging && state.hasCatalog) {
    tasks.push({
      id: "messaging", urgent: false,
      title: "Connect Your Messages",
      why: "You can send messages, but replies will not reach you yet.",
      screen: "chat"
    });
  }
  return tasks;
}

export function tasksHeadline(tasks: SetupTask[]): string {
  if (!tasks.length) return "";
  const urgent = tasks.filter((t) => t.urgent).length;
  if (urgent) return `${urgent} Thing${urgent === 1 ? "" : "s"} Need${urgent === 1 ? "s" : ""} Doing Before This Works`;
  return `${tasks.length} Thing${tasks.length === 1 ? "" : "s"} Left To Set Up`;
}

// Remembering that sharing worked once, so the warning stops nagging.
const SHARING_KEY = "mcg-dropbox-sharing-works";
const LINKS_KEY = "mcg-reader-links-published";
const BACKUP_KEY = "mcg-settings-backed-up";

export const sharingWorks = () => flag(SHARING_KEY);
export const setSharingWorks = (on: boolean) => setFlag(SHARING_KEY, on);
export const readerLinksPublished = () => flag(LINKS_KEY);
export const setReaderLinksPublished = (on: boolean) => setFlag(LINKS_KEY, on);
export const settingsBackedUp = () => flag(BACKUP_KEY);
export const setSettingsBackedUp = (on: boolean) => setFlag(BACKUP_KEY, on);

function flag(key: string): boolean {
  try { return localStorage.getItem(key) === "true"; } catch { return false; }
}
function setFlag(key: string, on: boolean): void {
  try { localStorage.setItem(key, on ? "true" : "false"); } catch { /* ignore */ }
}
