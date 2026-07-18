export type ProjectRole = "reader" | "contributor" | "reviewer" | "editor" | "manager" | "support" | "administrator";
export type ProjectAction = "download" | "review" | "propose" | "upload" | "manage";

// Mapped to "82 Codex, Roles, Duties & Authority": readers/contributors (L1) may
// read and propose but never change files; editors/maintainers (L3) may edit
// within scope after OK GO; the author/owner (L4) approves everyone and holds
// final authority. A dedicated reviewer (L2) tier can be added when needed.
const roleActions: Record<ProjectRole, ReadonlySet<ProjectAction>> = {
  reader: new Set(["download", "propose"]),
  contributor: new Set(["download", "propose"]),
  reviewer: new Set(["download", "review", "propose"]),
  // An editor works on the book; a manager also approves people.
  editor: new Set(["download", "review", "propose", "upload"]),
  manager: new Set(["download", "review", "propose", "upload", "manage"]),
  support: new Set(["download", "review", "propose", "manage"]),
  administrator: new Set(["download", "review", "propose", "upload", "manage"])
};

const ROLE_LABELS: Record<ProjectRole, string> = {
  reader: "Reader",
  contributor: "Contributor",
  reviewer: "Reviewer",
  editor: "Editor",
  manager: "Editor / Manager",
  support: "Technical Support",
  administrator: "Author / Owner"
};

// Ascending authority — used to order requestable upgrades and compare levels.
export const ROLE_ORDER: ProjectRole[] = ["reader", "contributor", "reviewer", "editor", "manager", "support", "administrator"];

export function roleLabel(role: ProjectRole): string {
  return ROLE_LABELS[role] ?? role;
}

const ALL_ROLES: ProjectRole[] = [...ROLE_ORDER];

// The owner (or support) can temporarily see the app as a lower role to judge
// what each kind of person experiences. Never changes the real stored role.
export function getViewAs(): ProjectRole | null {
  try {
    const value = localStorage.getItem("mcg-view-as");
    return (ALL_ROLES as string[]).includes(value ?? "") ? (value as ProjectRole) : null;
  } catch { return null; }
}

export function setViewAs(role: ProjectRole | null): void {
  try {
    if (role) localStorage.setItem("mcg-view-as", role);
    else localStorage.removeItem("mcg-view-as");
  } catch { /* ignore */ }
}

export function realProfileRole(profileName: string): ProjectRole {
  // The local owner/author access for this machine.
  if (profileName === "Test Profile") return "administrator";
  const saved = localStorage.getItem(`mcg-profile-role:${profileName}`);
  return (ALL_ROLES as string[]).includes(saved ?? "")
    ? (saved as ProjectRole)
    // Everyone new starts as a Reader. Higher authority is granted by the owner,
    // never self-assigned (see the Roles & Authority and Approval Workflow codices).
    : "reader";
}

export function profileRole(profileName: string): ProjectRole {
  const real = realProfileRole(profileName);
  if (!canPerform(real, "manage")) return real;
  return getViewAs() ?? real;
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
