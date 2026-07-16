export type ProjectRole = "reader" | "contributor" | "editor" | "administrator";
export type ProjectAction = "download" | "review" | "propose" | "upload" | "manage";

// Mapped to "82 Codex, Roles, Duties & Authority": readers/contributors (L1) may
// read and propose but never change files; editors/maintainers (L3) may edit
// within scope after OK GO; the author/owner (L4) approves everyone and holds
// final authority. A dedicated reviewer (L2) tier can be added when needed.
const roleActions: Record<ProjectRole, ReadonlySet<ProjectAction>> = {
  reader: new Set(["download", "propose"]),
  contributor: new Set(["download", "propose"]),
  editor: new Set(["download", "review", "propose", "upload"]),
  administrator: new Set(["download", "review", "propose", "upload", "manage"])
};

const ROLE_LABELS: Record<ProjectRole, string> = {
  reader: "Reader",
  contributor: "Contributor",
  editor: "Editor / Maintainer",
  administrator: "Author / Owner"
};

// Ascending authority — used to order requestable upgrades and compare levels.
export const ROLE_ORDER: ProjectRole[] = ["reader", "contributor", "editor", "administrator"];

export function roleLabel(role: ProjectRole): string {
  return ROLE_LABELS[role] ?? role;
}

export function profileRole(profileName: string): ProjectRole {
  // The local owner/author access for this machine.
  if (profileName === "Test Profile") return "administrator";
  const saved = localStorage.getItem(`mcg-profile-role:${profileName}`);
  return saved === "reader" || saved === "contributor" || saved === "editor" || saved === "administrator"
    ? saved
    // Everyone new starts as a Reader. Higher authority is granted by the owner,
    // never self-assigned (see the Roles & Authority and Approval Workflow codices).
    : "reader";
}

export function setProfileRole(profileName: string, role: ProjectRole): void {
  try {
    localStorage.setItem(`mcg-profile-role:${profileName}`, role);
  } catch {
    /* ignore private-mode storage errors */
  }
}

export function canPerform(role: ProjectRole, action: ProjectAction): boolean {
  return roleActions[role].has(action);
}

export function visibleActions(role: ProjectRole): ProjectAction[] {
  return [...roleActions[role]];
}
