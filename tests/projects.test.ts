import { beforeEach, describe, expect, it } from "vitest";

// The suite runs in plain Node; give the module the browser storage it expects.
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, String(value)); },
  removeItem: (key: string) => { store.delete(key); },
  clear: () => store.clear()
};

import {
  activeProject, addProject, allProjects, BUILT_IN_PROJECTS, isSafeDropboxRoot,
  isSafeProjectName, isSharedFile, projectFile, removeProject, setActiveProjectId
} from "../src/projects";

beforeEach(() => localStorage.clear());

describe("projects — the program works on many things", () => {
  it("ships with the built-in projects and defaults to the first", () => {
    expect(allProjects().length).toBeGreaterThanOrEqual(2);
    expect(activeProject().id).toBe(BUILT_IN_PROJECTS[0].id);
  });

  it("adds and removes a project of any name", () => {
    addProject("Second Book", "/Second Book");
    expect(allProjects().some((p) => p.name === "Second Book")).toBe(true);
    const added = allProjects().find((p) => p.name === "Second Book")!;
    removeProject(added.id);
    expect(allProjects().some((p) => p.name === "Second Book")).toBe(false);
  });

  it("refuses names that are not usable as a folder", () => {
    expect(isSafeProjectName("A Good Name")).toBe(true);
    expect(isSafeProjectName("bad/name")).toBe(false);
    expect(isSafeProjectName("bad:name")).toBe(false);
    expect(isSafeProjectName("   ")).toBe(false);
  });

  it("refuses remote folders that are not a real path", () => {
    expect(isSafeDropboxRoot("/Some Project")).toBe(true);
    expect(isSafeDropboxRoot("Some Project")).toBe(false);
    expect(isSafeDropboxRoot("/../escape")).toBe(false);
    expect(isSafeDropboxRoot("/")).toBe(false);
  });

  it("never lets a duplicate project shadow another", () => {
    addProject("Twice", "/Twice");
    addProject("Twice", "/Twice Again");
    expect(allProjects().filter((p) => p.name === "Twice")).toHaveLength(1);
  });

  it("puts the app's own settings files inside whichever project is active", () => {
    addProject("Second Book", "/Second Book");
    const added = allProjects().find((p) => p.name === "Second Book")!;
    setActiveProjectId(added.id);
    expect(activeProject().name).toBe("Second Book");
    expect(projectFile("file-access.json")).toBe("/Second Book/.mcg/file-access.json");
    expect(projectFile("claude-actions.json")).toBe("/Second Book/.mcg/claude-actions.json");
  });

  it("falls back to the first project when the remembered one is gone", () => {
    addProject("Temporary", "/Temporary");
    const added = allProjects().find((p) => p.name === "Temporary")!;
    setActiveProjectId(added.id);
    removeProject(added.id);
    expect(activeProject().id).toBe(BUILT_IN_PROJECTS[0].id);
  });
});

describe("the shared codex library", () => {
  const SHARED = "/MaggotClaw Games";

  it("counts a codex sitting directly in the library", () => {
    expect(isSharedFile(SHARED, "/MaggotClaw Games/01 Codex, ID Registry v1.31.txt")).toBe(true);
    expect(isSharedFile(SHARED, "/MaggotClaw Games/00 Master Codex v2.7.txt")).toBe(true);
  });

  it("never counts another project's files as shared", () => {
    // The whole point of the rule: The Long Rot must not start downloading
    // Project Zero Author's book just because they sit side by side.
    expect(isSharedFile(SHARED, "/MaggotClaw Games/Project Zero Author/Chapter 01.txt")).toBe(false);
    expect(isSharedFile(SHARED, "/MaggotClaw Games/The Long Rot/C01-R Chapter 01 Reader Copy v9.5.txt")).toBe(false);
  });

  it("never counts anything nested, however deep", () => {
    expect(isSharedFile(SHARED, "/MaggotClaw Games/Operations/06 Templates/Template - Verification Report v1.0.txt")).toBe(false);
    expect(isSharedFile(SHARED, "/MaggotClaw Games/(Images)/MaggotClaw.jpg")).toBe(false);
  });

  it("ignores a project with no shared library", () => {
    expect(isSharedFile(undefined, "/MaggotClaw Games/00 Master Codex v2.7.txt")).toBe(false);
    expect(isSharedFile("", "/MaggotClaw Games/00 Master Codex v2.7.txt")).toBe(false);
  });

  it("does not mistake a look-alike folder for the library", () => {
    expect(isSharedFile(SHARED, "/MaggotClaw Games Archive/00 Master Codex v2.7.txt")).toBe(false);
    expect(isSharedFile(SHARED, "/Somewhere Else/00 Master Codex v2.7.txt")).toBe(false);
  });

  it("does not treat the library folder itself as a file in it", () => {
    expect(isSharedFile(SHARED, "/MaggotClaw Games")).toBe(false);
    expect(isSharedFile(SHARED, "/MaggotClaw Games/")).toBe(false);
  });

  it("tolerates a trailing slash on the configured library", () => {
    expect(isSharedFile("/MaggotClaw Games/", "/MaggotClaw Games/00 Master Codex v2.7.txt")).toBe(true);
  });

  it("gives both built-in projects the same shared library", () => {
    for (const project of BUILT_IN_PROJECTS) {
      expect(project.sharedRoot).toBe(SHARED);
      expect(isSharedFile(project.sharedRoot, "/MaggotClaw Games/91 Codex, Human Maker v1.5.txt")).toBe(true);
    }
  });
});
