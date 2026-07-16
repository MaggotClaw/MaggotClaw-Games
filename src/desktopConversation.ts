import { invoke } from "@tauri-apps/api/core";

export interface DesktopConversationTarget {
  id: "codex" | "claude" | "auto";
  name: string;
}

export interface ConversationTargetStatus {
  found: boolean;
  ready: boolean;
  name: string;
  label: string;
  detail: string;
}

export interface ConversationResponseState {
  busy: boolean;
  hasCompletedResponse: boolean;
  completedResponseCount: number;
}

export interface DesktopConversationAdapter {
  readonly target: DesktopConversationTarget;
  insertDraft(text: string): Promise<void>;
  readCopiedResponse(): Promise<string>;
  sendMessage?(text: string): Promise<void>;
  responseState?(): Promise<ConversationResponseState>;
  clearDraft?(): Promise<void>;
  targetForeground?(): Promise<boolean>;
}

export class ClipboardConversationAdapter implements DesktopConversationAdapter {
  readonly target = { id: "auto" as const, name: "the AI program" };

  async insertDraft(text: string): Promise<void> {
    const draft = text.trim();
    if (!draft) throw new Error("Say or type something first.");
    await navigator.clipboard.writeText(draft);
  }

  async readCopiedResponse(): Promise<string> {
    const response = (await navigator.clipboard.readText()).trim();
    if (!response) throw new Error("Copy the AI response first.");
    return response;
  }
}

export class WindowsConversationAdapter implements DesktopConversationAdapter {
  readonly target = { id: "auto" as const, name: "Claude or Codex" };
  // "auto" is sent to the backend as no preference so it falls back to detection.
  private readonly choice: string | null;

  constructor(choice: "auto" | "claude" | "codex" = "auto") {
    this.choice = choice === "auto" ? null : choice;
  }

  status(): Promise<ConversationTargetStatus> {
    return invoke<ConversationTargetStatus>("conversation_target_status", { target: this.choice });
  }

  async insertDraft(text: string): Promise<void> {
    await invoke("insert_conversation_draft", { draft: text, target: this.choice });
  }

  readCopiedResponse(): Promise<string> {
    return invoke<string>("copy_latest_conversation_response", { target: this.choice });
  }

  async sendMessage(text: string): Promise<void> {
    await invoke("send_conversation_message", { draft: text, target: this.choice });
  }

  responseState(): Promise<ConversationResponseState> {
    return invoke<ConversationResponseState>("conversation_response_state", { target: this.choice });
  }

  async clearDraft(): Promise<void> {
    await invoke("clear_conversation_draft", { target: this.choice });
  }

  targetForeground(): Promise<boolean> {
    return invoke<boolean>("conversation_is_foreground", { target: this.choice });
  }
}

export function createConversationAdapter(choice: "auto" | "claude" | "codex" = "auto"): DesktopConversationAdapter & { status?: () => Promise<ConversationTargetStatus> } {
  return "__TAURI_INTERNALS__" in window ? new WindowsConversationAdapter(choice) : new ClipboardConversationAdapter();
}
