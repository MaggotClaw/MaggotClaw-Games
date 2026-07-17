// Extra profile details collected by onboarding: a nickname for friendly
// display, and a four-digit PIN kept as a hash for the future profile-recovery
// flow ("name plus PIN identifies a returning user"). The plain PIN is never
// stored anywhere.

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
