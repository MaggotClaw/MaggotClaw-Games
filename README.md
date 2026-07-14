# The Long Rot Voice

Windows-first reader application for The Long Rot. This initial slice lists Reader Copies through the existing MCP, reads one sentence at a time using system speech, and restores the reader's position from durable browser storage.

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
- Push-to-talk AI conversation with transcription review.
- Spoken AI responses with stop, repeat, and follow-up controls.
- OpenAI API key stored in Windows Credential Manager rather than application files.
- Local conversation history limited to the most recent turns.
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

Talk mode uses `gpt-4o-transcribe` for transcription, `gpt-5.4-mini` through the Responses API for conversation, and `tts-1` for spoken output. The interface discloses that the spoken voice is AI-generated. API usage is billed independently from ChatGPT subscriptions.

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
- Tauri packaging awaits installation of the Rust toolchain. The portable React core is implemented first and is ready to be wrapped after that prerequisite is installed.
