# MaggotClaw Games

Windows-first project hub, Reader Mode, and no-API-key Voice Companion for
MaggotClaw Games. The Long Rot is the first project used inside the app; it is
not permanently built into the finished product.

Current installed development version: `0.6.3`.

For the complete current state, decisions, live-test results, and ordered next
steps, read [`docs/project-status-2026-07-15.md`](docs/project-status-2026-07-15.md).
For a clean continuation in another Codex chat, use
[`docs/new-chat-prompt-2026-07-15.md`](docs/new-chat-prompt-2026-07-15.md).

## Current application modes

1. **Main MaggotClaw Games hub** — profile, settings, project selection, and
   entry into the other modes. The multi-project dashboard is planned but not
   implemented yet.
2. **Reader Mode** — Reader Copy selection, local caching, sentence playback,
   durable reading position, comments, recovery, and comment review.
3. **Voice Companion** — free offline speech recognition into the ordinary
   installed Codex Windows app, automatic Send, response detection, and local
   neural reply reading. Codex is first; Claude and regular ChatGPT adapters
   remain unfinished.

Normal Voice Companion use requires no AI API key. It uses the user's existing
signed-in Codex session. Vosk handles local speech recognition and Piper handles
local neural reading. The older API experiment remains legacy code and must not
become the default path.

## Build and verification

```powershell
npm install
npm run check
npm test
cargo test --manifest-path src-tauri/Cargo.toml -j 1
npm run desktop:build
```

The NSIS installer is created under
`src-tauri/target/release/bundle/nsis/`. The current installer is
`MaggotClaw Games_0.6.3_x64-setup.exe`. Development installers are unsigned.

## Local project workspace

The Projects screen can prepare a local workspace under
`Documents\MaggotClaw Games Projects\The Long Rot`, recursively download
supported text files, preserve exact local originals, create Markdown copies
for AI work, and back up an old local original before replacing it with a new
Dropbox revision. Dropbox uploads are deliberately disabled.

Word, PDF, image, and other binary files are listed in the local inventory but
cannot be downloaded until the MCP gains a safe binary-download operation.

The project selector currently contains The Long Rot and Project Zero Author.
The Long Rot workspace is prepared locally; Project Zero Author is selectable
but its workspace and remote source are not configured yet.

## Safety boundaries

- Never commit or display MCP bearer tokens, Dropbox credentials, PINs, or API
  keys.
- Voice Companion must never send when the target app or composer cannot be
  identified confidently.
- Reader Mode remains read-only toward official project files until a separate
  approval/upload workflow is built.
- Live MCP/Dropbox access must be reverified before relying on it; the last
  recorded local connection used an expired temporary Dropbox token.
- Do not treat brainstorming or AI conversation as approved project canon.
