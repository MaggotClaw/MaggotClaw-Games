# Prompt for the next Codex chat

Continue the MaggotClaw Games Windows app from the existing repository. Do not
restart the design and do not discard, reset, or clean the current large
uncommitted working tree.

Repository:
`C:\Users\QinOt\the-long-rot-voice`

Read these files first:

1. `README.md`
2. `docs\project-status-2026-07-15.md`
3. `docs\desktop-companion-requirements.md`
4. `THIRD-PARTY-NOTICES.txt`

The user is learning as they go. Explain work in very small, plain-language
steps and ask only one question at a time when input is genuinely required.
Prefer free, local, no-subscription solutions. Perform real checks instead of
guessing. Preserve secrets. Do not modify Dropbox unless explicitly authorized.

## Current build

- Source and installer version: `0.6.3`.
- Installer:
  `src-tauri\target\release\bundle\nsis\MaggotClaw Games_0.6.3_x64-setup.exe`.
- TypeScript passes.
- Seventeen frontend tests pass across eight files.
- Four Rust tests pass.
- The 0.6.3 installer builds successfully.
- Version 0.6.3 is installed and its two-project selection screen was visually
  verified in the packaged Windows app.

## Work completed in the latest session

- Added a Projects card to the main hub using the approved circular MCG icon.
- Removed the unnecessary `Choose what you want to do` line.
- Projects opens a project-selection screen rather than The Long Rot directly.
- Added selectable tiles for The Long Rot and Project Zero Author.
- Added a local The Long Rot workspace under
  `Documents\MaggotClaw Games Projects\The Long Rot` with Originals, Working
  Files, AI Context, Proposed Changes, Approved Uploads, Exports, Backups, and a
  hidden manifest.
- Added recursive read-only text download, source revisions, SHA-256 checksums,
  Markdown AI copies, and backup-before-replacement behavior.
- Dropbox upload, replace, move, delete, and restore are not available.
- Added Download, Review Changes, Upload Approved, and Open Local Folder controls.
- Added reader, contributor, editor, and administrator capability rules.
- During development, existing profiles without a role receive administrator
  controls so every button can be tested. Onboarding must later assign real roles.
- Main shortcut now always opens the full app rather than restoring compact Talk.
- Added a 30-second project-connection timeout.

## Dropbox blocker

The app cannot download project files yet because authentication is not connected.
The configured local MCP did not answer. Starting the existing local remote server
failed because neither OAuth nor diagnostic static-key authentication was enabled.
The local MCP environment has a temporary Dropbox access-token field and a remote
API-key field but no refresh-token configuration. No credential values were read,
printed, copied, committed, or placed in documentation.

Recommended fix: implement or reconnect durable Dropbox OAuth/refresh-token auth,
then run one small read-only list operation before attempting a recursive download.
Do not enable static-key fallback as the normal product path. Avoid clustered
Dropbox calls because earlier project audits encountered rate limits.

## Project icons

- The user selected icon number 10 for The Long Rot: distressed silver `LR`
  letters with turquoise decay accents.
- The full selection sheet is preserved at
  `assets\branding\long-rot-icon-selection-sheet.png`.
- The standalone number-10 icon has not been extracted or generated yet.
- The UI intentionally still uses an `LR` placeholder.
- Project Zero Author currently uses a `PZA` placeholder; no final artwork has
  been supplied.

## Immediate next steps

1. Extract/recreate selection-sheet icon number 10 as a clean standalone square
   asset and use it on The Long Rot tile. Preserve the selection sheet.
2. Confirm whether Project Zero Author should use a supplied icon or retain PZA.
3. Improve the two-column project-tile text layout if needed; the packaged view
   works but narrow text columns make the cards taller than necessary.
4. Generalize the hard-coded local workspace from The Long Rot to a safe
   multi-project model; Project Zero Author is currently selectable but its local
   workspace and remote source are deliberately unconfigured.
5. Repair durable Dropbox authentication and prove a small read-only list.
6. Download text files incrementally, then add a safe binary-download MCP tool for
   Word, PDF, image, and other binary files.
7. Build proposed-change review, revision comparisons, explicit approval, and only
   then revision-checked uploads.
8. Retest the full Codex voice conversation loop; it remains unproven after 0.5.1.
9. Fix separate full-app/companion taskbar icons and implement stable paragraph
   streaming while Codex generates.

Do not claim Project Zero Author sync works. Do not claim Dropbox files have been
downloaded. Do not enable Upload Approved until authentication, comparison,
approval, conflict handling, backup, and returned-revision verification are real.
