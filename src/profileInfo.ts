// Extra profile details collected by onboarding: a nickname for friendly
// display, and a four-digit PIN kept as a hash for the future profile-recovery
// flow ("name plus PIN identifies a returning user"). The plain PIN is never
// stored anywhere.

// Everything onboarding asks a new person, kept on their own machine and sent
// to the author once so he knows who is reading his book.
export interface ReaderProfile {
  email: string;
  phone: string;
  where: string;            // state or region
  reads: string;            // what they usually read
  authors: string;          // favourite authors
  betaBefore: string;       // yes / no / a little
  pace: string;             // how much they read in a week
  prefers: string;          // listening vs reading themselves
  avoid: string;            // anything they would rather not read
  invitedBy: string;        // who sent them
  notes: string;            // anything else
}

export const EMPTY_READER_PROFILE: ReaderProfile = {
  email: "", phone: "", where: "", reads: "", authors: "", betaBefore: "",
  pace: "", prefers: "", avoid: "", invitedBy: "", notes: ""
};

export function loadReaderProfile(profile: string): ReaderProfile {
  try {
    return { ...EMPTY_READER_PROFILE, ...(JSON.parse(localStorage.getItem(`mcg-reader-profile:${profile}`) || "{}") as Partial<ReaderProfile>) };
  } catch {
    return { ...EMPTY_READER_PROFILE };
  }
}

export function saveReaderProfile(profile: string, details: ReaderProfile): void {
  try { localStorage.setItem(`mcg-reader-profile:${profile}`, JSON.stringify(details)); } catch { /* ignore */ }
}

// A tidy one-message summary for the author.
export function readerProfileSummary(name: string, role: string, details: ReaderProfile): string {
  const rows: Array<[string, string]> = [
    ["Role asked for", role], ["Email", details.email], ["Phone", details.phone],
    ["Where", details.where], ["Usually reads", details.reads], ["Favourite authors", details.authors],
    ["Beta read before", details.betaBefore], ["Reading pace", details.pace],
    ["Prefers", details.prefers], ["Rather not read", details.avoid],
    ["Invited by", details.invitedBy], ["Notes", details.notes]
  ];
  const lines = rows.filter(([, value]) => value && value.trim()).map(([label, value]) => `${label}: ${value.trim()}`);
  return `**New reader** ${name}\n${lines.join("\n")}`.slice(0, 1800);
}

export function isValidPin(pin: string): boolean {
  return /^\d{4}$/.test(pin.trim());
}

export function getNickname(profile: string): string {
  try { return localStorage.getItem(`mcg-nickname:${profile}`) || ""; } catch { return ""; }
}

export function setNickname(profile: string, nickname: string): void {
  try { localStorage.setItem(`mcg-nickname:${profile}`, nickname.trim()); } catch { /* ignore */ }
}

async function pinHash(profile: string, pin: string): Promise<string> {
  // Salted with the profile name so two people with the same PIN store
  // different values.
  const bytes = new TextEncoder().encode(`mcg:${profile.trim().toLowerCase()}:${pin.trim()}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function setProfilePin(profile: string, pin: string): Promise<void> {
  if (!isValidPin(pin)) return;
  try { localStorage.setItem(`mcg-profile-pin:${profile}`, await pinHash(profile, pin)); } catch { /* ignore */ }
}

export function hasProfilePin(profile: string): boolean {
  try { return Boolean(localStorage.getItem(`mcg-profile-pin:${profile}`)); } catch { return false; }
}

export async function verifyProfilePin(profile: string, pin: string): Promise<boolean> {
  try {
    const stored = localStorage.getItem(`mcg-profile-pin:${profile}`);
    return Boolean(stored) && stored === await pinHash(profile, pin);
  } catch { return false; }
}
