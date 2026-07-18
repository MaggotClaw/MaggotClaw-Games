# MaggotClaw Games — New Chat Handoff (2026-07-18)

Continue the MaggotClaw Games Windows app. Do not restart the design.

## Where everything lives
- App repo: `C:\Users\QinOt\Desktop\MaggotClaw Games\Program\maggotclaw-games`
  (renamed from the-long-rot-voice; npm + Cargo package are `maggotclaw-games`)
- Installers: `C:\Users\QinOt\Desktop\MaggotClaw Games\Updates`
- Dropbox: **everything under `/MaggotClaw Games/`** — `The Long Rot`,
  `Project Zero Author`, `App Releases`
- Local workspace: `Documents\MaggotClaw Games\<Project Name>`
- Bridge (now optional): `C:\Users\QinOt\the-long-rot-mcp` — the app talks to
  Dropbox directly once the project keys are saved
- GitHub: `MaggotClaw/MaggotClaw-Games` (still PUBLIC — see Decisions)
- Settings backup: `Documents\MaggotClaw Games Settings Backup.json`

## Working rules (the user's own)
- **OK GO**: plan first, execute on OK GO. STOP finishes the current atomic
  action; never leave anything half-written.
- **Do not build after every change** — stack changes; build when he wants to
  look. **Never push/release without "push update".**
- **Answers, not explanations.** He does not want a post-mortem on why
  something was broken — just fix it and say what to check.
- **No hesitating over his own credentials.** Standing permission to read,
  copy, move and rotate any key of his. Never commit secrets; never print them
  into chat (write to a file and say where).
- Big labels are Title Case.

## Current state — v1.4.0-beta, built, installed, pushed
Everything below is committed and on GitHub. **Nothing has been released.**

Built this session: Human Maker (prose audit against his own 91 Codex);
OK GO button (floating, draggable, 3-2-1 countdown, cancel mid-count);
Claude's hands (Claude writes actions to Dropbox, app carries them out, book
changes wait for OK GO); project registry (MaggotClaw Games is the program,
projects live inside it); direct Dropbox access + Reader Links (read-only
catalog so friends need no keys); people roster; feedback + quiet
diagnostics; walkthroughs ("Show Me How", can open web pages); Things To Do
warnings; automatic approvals (owner picks role from a dropdown, the person's
app unlocks itself — no codes); settings export/import; expanded 3-step
onboarding; Editor vs Editor/Manager split; pronunciation dictionary; sleep
timer; listening stats; Note To Self; reactions; chapter questions; reader
progress; scheduled releases; story-context packs.

164 tests, tsc and cargo clean.

## What still needs doing (the app itself lists these)
1. **Import settings** on the installed build — the identifier changed, so it
   looks empty. The Discord token is already in the backup file.
2. **Turn on Dropbox sharing** — the Dropbox app lacks `sharing.read` /
   `sharing.write`, so share links fail. This blocks BOTH Reader Links and the
   Dropbox update channel. Needs the App Console (walkthrough exists), then a
   fresh refresh token via
   `C:\Users\QinOt\the-long-rot-mcp\scripts\get-dropbox-refresh-token.js`.
3. **Publish Reader Links** — until then no friend can download the book.
4. Finish publishing v1.4.0-beta to Dropbox: the installer is already at
   `/MaggotClaw Games/App Releases/`; only the share links failed.
   `node scripts/publish-to-dropbox.mjs --notes "..."` does the whole job once
   sharing works.

## Decisions still open
- **Repo visibility.** He wants only himself able to change the program. The
  repo is public, so anyone can read and fork it. Plan agreed: go private and
  distribute through Dropbox. Not done — deliberately waiting until Dropbox
  distribution actually works end to end.
- Updates already check Dropbox first, then GitHub, so either can be retired
  without stranding anyone.

## Never live-tested
No second machine has ever run this. The whole reader path — key, catalog
download, automatic approval, progress reporting — is theory until one friend
tries it. Treat the first onboarding as the real test.

## Gotchas
- Moving the repo needs one `cargo clean` afterwards.
- **New windows must be added to `src-tauri/capabilities/default.json`** or
  Tauri silently refuses dragging, closing and always-on-top.
- Discord bot token lives only in app settings (and the backup file) — never
  in git.
- The memory files (`long-rot-*`, `credentials-permission`) carry the detail.
