# The Long Rot Voice

Windows-first voice companion and project application for The Long Rot. The application contains a working Reader Mode and is being expanded into a no-API-key desktop accessibility companion for the installed ChatGPT, Codex, and Claude applications.

Current installed development version: `0.2.0`.

## Product boundary

The project has two distinct experiences:

1. **Project Workspace and Desktop Voice Companion** for authors, editors, contributors, and collaborators. It should dictate into the ordinary ChatGPT, Codex, or Claude desktop application, send the message, detect the displayed response, and read it aloud. It must work with the user's existing Free or paid account and must not require an API key.
2. **Reader Mode** for selecting Reader Copies, listening, preserving position, and recording version-linked feedback.

Reader Mode is not the primary boundary of the finished product. It is one mode within the larger Long Rot voice workspace.

## Current scope

- Reader Copy discovery through `search_dropbox_filenames`.
- Text retrieval through `read_dropbox_text_file`.
- Current revision capture through `list_dropbox_revisions`.
- Sentence segmentation and highlighting.
- Play, pause, continue, back, forward, repeat, and speed.
- Durable cached document and reading position.
- Local microphone recording with durable comment drafts.
- Five-second incremental silence allowance with voice-activity reset.
- Browser transcription when supported, with a manual confirmation fallback.
- Exact sentence/paragraph/character anchors and post-comment resume.
- Recovery of unfinished comments after restart.
- Required reader identity stored locally.
- Saved-comment review with original audio playback.
- Local JSON comment-index export without embedding audio.
- An API-backed Talk mode prototype with transcription review and spoken responses.
- Secure Windows Credential Manager storage for the optional API prototype.
- Offline demo Reader Copy.
- Read-only application boundary; no MCP write tools are called.

Comments remain local in this slice. Project synchronization is intentionally disabled until the feedback location and MCP audio contract are approved.

## Run locally

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:4173`.

The demo works without credentials. For MCP access, start the MCP HTTP server separately and configure its local authentication. The development server proxies `/mcp` to `LONG_ROT_MCP_URL`, defaulting to `http://127.0.0.1:3000`.

Never commit an MCP bearer token or Dropbox credentials. The prototype connection screen is not the final OAuth flow.

## Windows desktop

After the Rust and Visual C++ build prerequisites are installed:

```powershell
npm run desktop:dev
npm run desktop:build
```

The desktop shell allows only HTTPS MCP endpoints or the local `http://127.0.0.1/.../mcp` development endpoint. Network requests pass through a narrowly scoped Rust command; Dropbox credentials are never accepted by the application.

The current `0.2.0` Talk mode is an implementation prototype, not the accepted production interaction model. It uses an OpenAI API key and therefore does not meet the clarified requirement. API support may remain as an optional advanced provider, but it must not be the default or required path.

The Windows installer is created under `src-tauri/target/release/bundle/nsis/`. It is an unsigned development build and Windows may display a publisher warning until a code-signing certificate is configured.

## Checks

```powershell
npm run check
npm test
npm run build
```

## Known integration gaps

- The current MCP read tool returns text without file metadata; the app separately requests the newest revision ID. An MCP read-by-revision operation is required for a strict immutable-version guarantee.
- The current MCP has no binary audio operation.
- The repository does not define the project ID Registry format or a dedicated Reader Copy listing tool; discovery temporarily uses the filename search tool.
- Live MCP verification is blocked because the local MCP currently has an expired temporary Dropbox access token and does not have refresh-token credentials configured.
- The no-API-key Windows desktop companion is not implemented yet. It requires Windows UI Automation adapters for the installed ChatGPT, Codex, and Claude applications.
- The current API Talk screen must be moved under an optional Advanced provider area or disabled by default.
- iPhone and iPad cannot offer the same unrestricted cross-application automation as Windows. A native Apple companion will require user-mediated handoff through app extensions, clipboard/share flows, or provider-supported app actions; a Safari extension may provide a more automatic optional route.
