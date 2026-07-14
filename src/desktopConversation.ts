import { invoke } from "@tauri-apps/api/core";

export interface DesktopConversationTarget {
  id: "codex";
  name: string;
}

export interface CodexTargetStatus {
  found: boolean;
  ready: boolean;
  label: string;
  detail: string;
}

export interface DesktopConversationAdapter {
  readonly target: DesktopConversationTarget;
  insertDraft(text: string): Promise<void>;
  readCopiedResponse(): Promise<string>;
}

export class CodexClipboardAdapter implements DesktopConversationAdapter {
  readonly target = { id: "codex" as const, name: "Codex — current Windows task" };

  async insertDraft(text: string): Promise<void> {
    const draft = text.trim();
    if (!draft) throw new Error("Say or type something first.");
    await navigator.clipboard.writeText(draft);
  }

  async readCopiedResponse(): Promise<string> {
    const response = (await navigator.clipboard.readText()).trim();
    if (!response) throw new Error("Copy the Codex response first.");
    return response;
  }
}

export class CodexWindowsAdapter implements DesktopConversationAdapter {
  readonly target = { id: "codex" as const, name: "Codex — current Windows task" };

  status(): Promise<CodexTargetStatus> {
    return invoke<CodexTargetStatus>("codex_target_status");
  }

  async insertDraft(text: string): Promise<void> {
    await invoke("insert_codex_draft", { draft: text });
  }

  readCopiedResponse(): Promise<string> {
    return invoke<string>("copy_latest_codex_response");
  }
}

export function createCodexAdapter(): DesktopConversationAdapter & { status?: () => Promise<CodexTargetStatus> } {
  return "__TAURI_INTERNALS__" in window ? new CodexWindowsAdapter() : new CodexClipboardAdapter();
}
