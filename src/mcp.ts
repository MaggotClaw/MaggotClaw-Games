import type { ConnectionSettings, ReaderCopy } from "./types";

interface McpResponse {
  result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean };
  error?: { message?: string };
}

export interface ProjectEntry {
  name: string;
  path: string;
  type: "file" | "folder";
}

export class LongRotMcpClient {
  constructor(private readonly settings: ConnectionSettings) {}

  async listReaderCopies(): Promise<ReaderCopy[]> {
    const content = await this.callTool("search_dropbox_filenames", { query: "Reader Copy" });
    const items = JSON.parse(content) as Array<{ name: string; path: string; type: string }>;
    return items
      .filter((item): item is ReaderCopy => item.type === "file" && /reader copy/i.test(item.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }

  async listFolder(path = "/The Long Rot"): Promise<ProjectEntry[]> {
    const content = await this.callTool("list_dropbox_folder", { path });
    return JSON.parse(content) as ProjectEntry[];
  }

  async readText(path: string): Promise<string> {
    return this.callTool("read_dropbox_text_file", { path });
  }

  async currentRevision(path: string): Promise<string | null> {
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
    return "The application reached the project service, but its Dropbox connection has expired. No work was deleted or changed. Reconnect the Long Rot Dropbox account.";
  }
  if (/unauthorized|forbidden|HTTP\s*403/i.test(text)) {
    return "The application is not authorized to open the project files. Nothing was changed. Ask the administrator to reconnect the Long Rot account.";
  }
  return "The project service could not complete that request. Nothing was changed. Please try again or ask the administrator to check the connection.";
}
