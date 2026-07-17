# MaggotClaw Games — New Chat Handoff (2026-07-17)

Continue the MaggotClaw Games Windows app. Do not restart the design.

## Where everything lives
- App repo: `C:\Users\QinOt\Desktop\MaggotClaw Games\Program\the-long-rot-voice`
- Installers: `C:\Users\QinOt\Desktop\MaggotClaw Games\Updates`
- Dropbox bridge (separate service): `C:\Users\QinOt\the-long-rot-mcp`
  (start with `npm run start:remote` → http://127.0.0.1:3000/mcp; durable
  refresh-token Dropbox auth in its gitignored `.env`)
- Local story files: `Documents\MaggotClaw Games Projects\The Long Rot`
- GitHub: `MaggotClaw/MaggotClaw-Games` (latest published release: v1.0.0)

## Working rules (the user's own)
- **OK GO**: plan first, execute on OK GO. STOP must finish the current atomic
  action, never leave anything half-written.
- **Do not build after every change** — stack changes; build when the user
  wants to look.
- **NEVER push to GitHub / create a release / copy to Updates unless the user
  says "push update".** Local commits are fine.
- Minimal explanations; short direct questions only when genuinely needed.
- Big labels in the UI are Title Case (Each Word Capitalized).

## Current state (v1.0.2, built + installed locally, NOT released)
Everything works: reader (narrated + read-myself, Word chapters take over
their slot), chapters/files open in separate windows, unified green pill
toolbars with "← Back", who-chip (Name · Role) on every page, Start Here
onboarding with radio roles, view-as-any-role for the owner, Discord two-way
(requests auto-post via webhook; Owner Dashboard auto-pulls on open and posts
approvals back via bot), local room messages + Message MaggotClaw button,
owner Dropbox uploads from `05 Approved Uploads`, in-app update download,
Word-file search, read-highlighted-aloud, Directions screen.

## Next up (user's spec, in order)
1. **Startup sync check**: when the app opens, verify local file versions
   against the Dropbox backups automatically; also refresh Discord requests/
   messages everywhere on open (dashboard already does).
2. **Editing flow**: editing a file works on a copy; submitting sends the
   copy; the owner sees a diff against the backup, approves, and only then
   does the change apply/upload. Owner's uploads panel should list who
   submitted what, click to open a window showing what goes where.
3. **Paragraph streaming** in the Voice Companion (read stable paragraphs
   while the AI is still generating) + full live voice-loop retest — both
   need the user at the keyboard.
4. Cross-machine chat/roles beyond Discord; binary Dropbox download/upload.

## Gotchas
- After moving the repo, stale cargo caches needed `cargo clean` once.
- The bridge must be running for downloads/uploads.
- Discord bot token lives ONLY in the app's Settings → Owner (never in git —
  GitHub scanning would revoke it). Webhook + channel id are baked defaults.
- The memory files in the Claude project carry full details (`long-rot-*`).
