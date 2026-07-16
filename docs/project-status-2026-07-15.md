# MaggotClaw Games App — Current Technical Handoff

Updated: 2026-07-15

## Source of truth

- Repository: `C:\Users\QinOt\the-long-rot-voice`
- Branch: `master`
- Current application version: `0.6.3`
- Installed executable:
  `C:\Users\QinOt\AppData\Local\MaggotClaw Games\the-long-rot-voice.exe`
- Current installer:
  `src-tauri\target\release\bundle\nsis\MaggotClaw Games_0.6.3_x64-setup.exe`
- This repository has a large uncommitted working tree containing the current
  Voice Companion, branding, Vosk, Piper, icons, tests, and documentation.
  Preserve it. Do not reset or discard it.

This document supersedes outdated current-state statements in the 2026-07-14
status file. That older file remains useful as implementation history.

## Confirmed product direction

The installable program is **MaggotClaw Games**, not a permanent Long Rot-only
reader. It is intended to become the main MaggotClaw Games application.

- The Long Rot is the first project inside the app, not a permanent hard-coded
  product identity.
- Future users can have one or several projects and remove completed projects
  without removing the application.
- Reader Mode and Voice Companion are separate experiences inside one program.
- Normal Voice Companion use controls the installed Codex, Claude, or ChatGPT
  application through Windows accessibility. It does not require an AI API key.
- The normal path must remain as free and local as practical.
- Project discussion, suggestions, and approved canon must remain distinct.

## Branding and visual work completed

- Main interface uses the approved MCG black, worn-silver, white, and electric
  turquoise-green identity.
- Approved horizontal logo is stored at `public\maggotclaw-modern.png`.
- Approved primary app icon and generated platform sizes are under
  `src-tauri\icons`.
- Approved branding sources are under `assets\branding`.
- Approved circular social/companion icon:
  `assets\branding\mcg-social-circle.png`.
- The Voice Companion card and floating microphone use the matching industrial
  black, silver, and green treatment.
- The compact toolbar dimensions and stable button locations are preserved.

Visual work still open:

- The multi-project dashboard is not designed or implemented in the real app.
- The selected Long Rot project-icon concept still needs a final standalone
  production asset and project-tile integration.
- Separately movable toolbar controls and optional skins are later work.

## Reader Mode implemented

- Reader Copy search and retrieval through the existing MCP contract.
- Local document cache, sentence segmentation, highlighting, and exact resume.
- Continue, pause, repeat, back, forward, and reading speed.
- Local recorded comments with exact text anchors and recovery after restart.
- Saved-comment review and JSON comment-index export.
- Offline demo content.
- Reader operations do not write official Dropbox project files.

Reader integration gap:

- The last recorded local MCP configuration used an expired temporary Dropbox
  token. Reverify the current connection before relying on live Dropbox data.

## Voice Companion implemented

- Windows-first, no-API-key Codex adapter using Microsoft UI Automation.
- Visible Codex target verification before insertion or Send.
- Free offline Vosk recognition bundled with the installer.
- Live recognized words are inserted into the Codex composer.
- Configurable silence timeout and Add Time button.
- Send Now, pause/continue reply, skip reply, stop, and settings controls.
- Automatic Send, response-busy detection, completed-response copy, segmented
  reading, and listen-again loop are coded.
- Code/output boxes can be skipped during normal reading.
- Piper neural text-to-speech is bundled with the commercial-safe
  `en_GB-cori-high` voice; Windows speech is the automatic fallback.
- No second terminal window is needed by the installed program.

## Version 0.5.0 live-test result

The first full user test found that the complete loop was not yet reliable:

- Startup and target checks felt slow and the bar appeared to freeze.
- Continued speech erased time added with the `+` button by resetting to two
  seconds.
- Dragging could select/highlight the timer text.
- Codex was open and accepting typed text, but the companion reported that the
  message box was not ready.

## Version 0.5.1 corrections

- Add Time is protected by keeping the later of the existing deadline and the
  normal speech deadline. New tests cover this exact behavior.
- Timer and toolbar text selection are disabled while dragging.
- Live accessibility inspection found that current Codex reports the composer
  class as `ProseMirror ProseMirror-focused`. The adapter now matches the
  `ProseMirror` class token instead of requiring an exact old class value.
- All Windows accessibility operations now run on background threads so deep
  Codex-tree inspection cannot block the visual window.
- Start Talking immediately enters a preparation state and duplicate startup
  clicks are ignored.

Version 0.5.1 is installed and running, but the user stopped before completing
the second manual loop test. Do not claim the complete loop is proven yet.

## Version 0.6.0 local project workspace

- Added a Projects entry to the main MaggotClaw Games hub.
- The main shortcut now ignores the old companion-active marker and always
  opens the full application hub.
- Added the standard local workspace under
  `Documents\MaggotClaw Games Projects\The Long Rot`.
- Added exact local Originals, AI Context, Proposed Changes, Approved Uploads,
  Exports, Backups, and hidden inventory folders.
- Added recursive, download-only Dropbox folder traversal for supported UTF-8
  text files.
- Added revision checks before and after each text download.
- Added SHA-256 content tracking and automatic backup of an old local original
  before a changed download replaces it.
- Added Markdown AI copies carrying their source path, revision, and checksum.
- Dropbox upload, replacement, move, delete, and restore operations remain
  absent from the app.
- Binary files such as Word, PDF, and images are recorded as pending because
  the current MCP has no binary-download tool. They are not falsely treated as
  downloaded.
- No Dropbox content was downloaded or changed while implementing this build.
- A live read-only attempt showed that the configured local MCP did not answer;
  the app now stops that wait after 30 seconds and reports a safe connection
  error instead of remaining on `Checking` forever.
- The existing local MCP could not be started because neither OAuth nor its
  explicitly enabled diagnostic static-key mode is configured. Its local
  environment still contains only a temporary Dropbox access-token field and a
  remote API-key field. Credential values were not read or displayed.

## Version 0.6.1 project selection and permissions

- Projects now opens a project-selection screen instead of opening The Long Rot
  directly.
- The Long Rot is a selectable project tile. Its final standalone project icon
  is still needed, so the tile deliberately uses an `LR` placeholder.
- The main Projects card now uses the approved circular MCG icon.
- Removed the unnecessary `Choose what you want to do` line from the main hub.
- Added Download, Review Changes, Upload Approved, and Open Local Folder actions
  according to a centralized role-permission table.
- Test Profile is treated as an administrator and displays the complete planned
  control set.
- Existing profiles without an assigned role also temporarily receive the
  administrator control set during development so every button can be tested.
  Onboarding will replace that temporary default with an explicit role.
- Reader, contributor, editor, and administrator permissions are defined
  separately. Lower roles do not merely receive visually hidden administrator
  actions; unavailable actions are excluded by the same permission rules.
- Upload remains disabled because Dropbox authentication and revision-safe
  approval uploads are not complete.
- Added Project Zero Author as the second selectable project. Its local
  workspace and remote source remain deliberately unconfigured until those
  project-specific details are supplied.
- The standalone Long Rot and Project Zero Author artwork files are not present;
  the project list uses explicit `LR` and `PZA` placeholders instead of
  inventing or reusing unrelated artwork.
- The user subsequently selected icon number 10 from the preserved contact sheet
  at `assets\branding\long-rot-icon-selection-sheet.png`: distressed silver `LR`
  letters with turquoise decay accents. The standalone production icon was not
  extracted before handoff and remains next work.

## Newly confirmed startup and icon requirement

The user clicked the main MCG shortcut and it opened directly into the compact
Voice Companion. That happened because `App.tsx` restores Talk mode when the
`long-rot-companion-active` local-storage flag remains set.

Required behavior:

1. Clicking the main MaggotClaw Games shortcut always opens the full program.
2. The user chooses Voice Companion from inside the program.
3. Entering Voice Companion opens the compact bar and the selected AI target.
4. The full program keeps the approved primary MCG application icon.
5. The compact Voice Companion should use the approved circular MCG icon in the
   Windows taskbar. If one Tauri window cannot provide clean independent icons,
   create a separate companion window rather than confusing the two modes.

The main-shortcut portion is implemented: startup now ignores the old
`long-rot-companion-active` marker and opens the full application. Separate
full-app and companion taskbar icons remain unfinished.

## Next Voice Companion improvement already approved in discussion

The current adapter waits for Codex to finish and then invokes the response Copy
button. The desired improvement is progressive reading:

1. Observe the response while Codex is still generating.
2. Wait for a complete sentence or paragraph to remain stable briefly.
3. Queue that stable text to Piper.
4. Continue reading newly completed paragraphs without repeating text Codex
   revised while generating.
5. Finish the remaining text and return to listening.

Paragraph streaming is preferred over word-by-word speech because it sounds
smoother and avoids repeated or changed partial words. This is planned, not
implemented.

## Verification completed

- TypeScript check passes.
- Seventeen frontend tests pass across eight test files.
- Four Rust tests pass, including a real bundled-Piper RIFF/WAVE generation
  test.
- Rust compilation passes.
- Windows NSIS build passes.
- Version 0.6.3 installer completed and installed successfully. The packaged
  two-project selection screen was visually verified.
- Live Windows accessibility inspection confirmed the current Codex document,
  current composer class, Dictate control, Stop control, and Copy controls.

## Immediate next steps in order

1. Extract the approved number-10 Long Rot icon from the preserved selection
   sheet and replace the `LR` tile placeholder.
2. Confirm Project Zero Author artwork and refine the two-column tile layout.
3. Generalize the local workspace safely for multiple projects; Project Zero
   Author is selectable but not configured.
4. Repair durable Dropbox OAuth/refresh-token authentication and prove one small
   read-only list operation.
5. Download text incrementally, then add safe binary downloading for Word, PDF,
   image, and other files.
6. Build review, comparison, approval, conflict, backup, and revision-checked
   upload workflows before enabling Upload Approved.
7. Manually retest the Codex conversation loop.
8. Finish separate full-app/companion taskbar icons.
9. Implement stable paragraph streaming while Codex is generating.
10. Continue onboarding, profiles, messaging, and collaboration work.

## Longer-term product queue

- Project download/cache/upload-for-approval workflow.
- Change comparison generated on demand; contributors do not write a reason for
  every individual edit.
- Team messaging between readers, writers, editors, and administrators.
- Drag/highlight a story passage into a message for group review.
- Guided onboarding with name, role, nickname, preferences, and four-digit PIN.
- Local-first profile recovery on another computer.
- Request-based, time-limited support access with private content excluded.
- Movable individual voice controls and user-selectable visual skins.
- Apple support through constrained share/clipboard/app-intent flows rather
  than promising unrestricted Windows-style automation.

## Licensing and cost decisions

- Vosk recognition: local and free.
- Piper engine: archived MIT release, local and free.
- Bundled Cori voice: high-quality UK English model using public-domain
  LibriVox recordings.
- Lessac was deliberately rejected because its source-data license is limited
  to research use.
- Development installer is unsigned; code signing remains future paid work.
