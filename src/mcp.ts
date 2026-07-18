import type { ConnectionSettings } from "./types";
import { activeProject } from "./projects";

interface McpResponse {
  result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean };
  error?: { message?: string };
}

export interface ProjectEntry {
  name: string;
  path: string;
  type: "file" | "folder";
}

// Direct Dropbox access: with the project file keys on this machine, the app
// talks to Dropbox itself and the local bridge no longer needs to be running.
export interface DropboxCreds {
  appKey: string;
  appSecret: string;
  refreshToken: string;
}

const DROPBOX_CREDS_KEY = "mcg-dropbox-creds";

export function getDropboxCreds(): DropboxCreds | null {
  try {
    const raw = JSON.parse(localStorage.getItem(DROPBOX_CREDS_KEY) || "null") as DropboxCreds | null;
    return raw && raw.appKey && raw.appSecret && raw.refreshToken ? raw : null;
  } catch {
    return null;
  }
}

export function setDropboxCreds(creds: DropboxCreds | null): void {
  try {
    if (creds && creds.appKey.trim() && creds.appSecret.trim() && creds.refreshToken.trim()) {
      localStorage.setItem(DROPBOX_CREDS_KEY, JSON.stringify({
        appKey: creds.appKey.trim(), appSecret: creds.appSecret.trim(), refreshToken: creds.refreshToken.trim()
      }));
    } else {
      localStorage.removeItem(DROPBOX_CREDS_KEY);
    }
  } catch { /* ignore */ }
}

export function filesDirectConfigured(): boolean {
  return Boolean(getDropboxCreds());
}

export class LongRotMcpClient {
  constructor(private readonly settings: ConnectionSettings) {}

  private direct(): DropboxCreds | null {
    return "__TAURI_INTERNALS__" in window ? getDropboxCreds() : null;
  }

  async listFolder(path = activeProject().dropboxRoot): Promise<ProjectEntry[]> {
    const creds = this.direct();
    if (creds) {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<ProjectEntry[]>("dropbox_list_folder", { creds, path });
    }
    const content = await this.callTool("list_dropbox_folder", { path });
    return JSON.parse(content) as ProjectEntry[];
  }

  // Owner-approved upload: writes a UTF-8 text file in place on Dropbox.
  async writeText(path: string, content: string): Promise<void> {
    const creds = this.direct();
    if (creds) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("dropbox_write_text", { creds, path, content });
      return;
    }
    await this.callTool("write_dropbox_text_file", { path, content, overwrite: true });
  }

  async readText(path: string): Promise<string> {
    const creds = this.direct();
    if (creds) {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<string>("dropbox_read_text", { creds, path });
    }
    return this.callTool("read_dropbox_text_file", { path });
  }

  async currentRevision(path: string): Promise<string | null> {
    const creds = this.direct();
    if (creds) {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<string | null>("dropbox_current_revision", { creds, path });
    }
    const content = await this.callTool("list_dropbox_revisions", { path });
    const revisions = JSON.parse(content) as Array<{ revision_id: string }>;
    return revisions[0]?.revision_id ?? null;
  }

  private async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const body = {
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "tools/call",
      params: { name, arguments: args }
    };
    let payload: McpResponse;
    let status = 200;
    if ("__TAURI_INTERNALS__" in window) {
      const { invoke } = await import("@tauri-apps/api/core");
      payload = await invoke<McpResponse>("mcp_call", {
        endpoint: this.settings.endpoint,
        bearerToken: this.settings.bearerToken,
        body
      });
    } else {
      const response = await fetch(this.settings.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // The MCP Streamable HTTP transport requires both types in Accept.
          accept: "application/json, text/event-stream",
          ...(this.settings.bearerToken
            ? { authorization: `Bearer ${this.settings.bearerToken}` }
            : {})
        },
        body: JSON.stringify(body)
      });
      status = response.status;
      payload = await response.json() as McpResponse;
    }
    if (status >= 400 || payload.error) {
      throw new Error(payload.error?.message || `Project connection failed (${status}).`);
    }
    const result = payload.result;
    const text = result?.content?.find((item) => item.type === "text")?.text;
    if (result?.isError || typeof text !== "string") {
      throw new Error(projectSafeError(text));
    }
    return text;
  }
}

export function projectSafeError(text?: string): string {
  if (!text) return "The project returned an unreadable response. Nothing was changed.";
  if (/expired_access_token|HTTP\s*401/i.test(text)) {
    return "The application reached the project service, but its Dropbox connection has expired. No work was deleted or changed. Reconnect the project’s Dropbox account.";
  }
  if (/unauthorized|forbidden|HTTP\s*403/i.test(text)) {
    return "The application is not authorized to open the project files. Nothing was changed. Ask the administrator to reconnect the project account.";
  }
  return "The project service could not complete that request. Nothing was changed. Please try again or ask the administrator to check the connection.";
}
