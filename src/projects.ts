// The projects this app works on.
//
// MaggotClaw Games is the program. A project — The Long Rot, Project Zero
// Author, or anything added later — is just one thing being worked on inside
// it. Nothing outside a project's own files should ever name a project.

export interface Project {
  id: string;
  name: string;
  dropboxRoot: string;   // "" when the project has no remote source yet
  icon: string;
  builtIn: boolean;
}

export const BUILT_IN_PROJECTS: Project[] = [
  { id: "long-rot", name: "The Long Rot", dropboxRoot: "/The Long Rot", icon: "/long-rot-icon.png", builtIn: true },
  { id: "project-zero", name: "Project Zero Author", dropboxRoot: "", icon: "/project-zero-icon.svg", builtIn: true }
];

const ADDED_KEY = "mcg-projects";
const ACTIVE_KEY = "mcg-active-project";

export function addedProjects(): Project[] {
  try {
    const raw = JSON.parse(localStorage.getItem(ADDED_KEY) || "[]") as Project[];
    return raw.filter((p) => p && typeof p.id === "string" && typeof p.name === "string" && p.name.trim());
  } catch {
    return [];
  }
}

export function allProjects(): Project[] {
  return [...BUILT_IN_PROJECTS, ...addedProjects()];
}

// A project's folder name must be a plain name — never a path.
export function isSafeProjectName(name: string): boolean {
  return Boolean(name.trim()) && !/[\\/:*?"<>|]/.test(name);
}

export function isSafeDropboxRoot(root: string): boolean {
  return root.startsWith("/") && !root.includes("..") && root.length > 1;
}

export function addProject(name: string, dropboxRoot: string): Project[] {
  const clean = name.trim();
  if (!isSafeProjectName(clean)) return addedProjects();
  const id = clean.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `project-${allProjects().length}`;
  if (allProjects().some((p) => p.id === id)) return addedProjects();
  const next = [...addedProjects(), { id, name: clean, dropboxRoot: dropboxRoot.trim(), icon: "/mcg-social-circle.png", builtIn: false }];
  try { localStorage.setItem(ADDED_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}

export function removeProject(id: string): Project[] {
  const next = addedProjects().filter((p) => p.id !== id);
  try { localStorage.setItem(ADDED_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}

export function activeProject(): Project {
  try {
    const id = localStorage.getItem(ACTIVE_KEY);
    const found = allProjects().find((p) => p.id === id);
    if (found) return found;
  } catch { /* ignore */ }
  return BUILT_IN_PROJECTS[0];
}

export function setActiveProjectId(id: string): Project {
  try { localStorage.setItem(ACTIVE_KEY, id); } catch { /* ignore */ }
  return activeProject();
}

// Where the app keeps its own shared settings for a project.
export function projectFile(name: string, project: Project = activeProject()): string {
  return `${project.dropboxRoot}/.mcg/${name}`;
}

// Tell the Rust side which project it is working in, so local folders and
// path checks follow the same project the screens are showing.
export async function applyActiveProject(project: Project = activeProject()): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_active_project", { name: project.name, dropboxRoot: project.dropboxRoot || "/" }).catch(() => undefined);
}
