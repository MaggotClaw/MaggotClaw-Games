# MaggotClaw Games — New Chat Handoff (2026-07-19)

Continue the MaggotClaw Games Windows app. Do not restart the design.

**Read `CLAUDE.md` in the repo root first.** It is the standing rulebook and it
is loaded automatically — OK GO, version bumping, Title Case, the identifier
warning, where everything lives. This file is only what changed and what is
still open.

## Where things are

- App repo: `C:\Users\QinOt\Desktop\MaggotClaw Games\Program\maggotclaw-games`
- Installers: `Desktop\MaggotClaw Games\Updates` — **keep exactly two**
- Current build: **v1.21.0-beta**, published, links verified
- 243 TS tests, 11 Rust tests, all clean

## His working rules — these matter more than any feature

- **OK GO covers the whole conversation**, not one item. Gather everything, ask
  real questions *before* he says it, then do the lot. He should never have to
  repeat himself item by item.
- **Do not build after every change.** Stack them. Build when he says "make it
  into a thing" or similar. (Broken repeatedly on 2026-07-18; he corrected it.)
- **Answers, not explanations.** A line or two. Detail on request.
- **Read a file end to end before recommending it be deleted.** Searching it for
  what you expect to find is not reading it. This nearly destroyed four unruled
  findings in Change File 001.
- Show him a **picture** before rebuilding UI he has described. He asked for
  mockups twice and both times it saved a wasted build.

## Live and working

- **Dropbox distribution.** Publishing works; share links verified each time.
  `node scripts/publish-to-dropbox.mjs --notes "..."`
- **Hosted MCP** at `https://maggotclaw-games-long-rot-mcp.onrender.com/mcp`,
  redeployed 2026-07-18, reports as "MaggotClaw Games MCP".
- **Local bridge** wired into Claude Desktop as `maggotclaw-games`.
- **The bridge root was broken** (`/The Long Rot`, a folder that stopped
  existing) and is now `/MaggotClaw Games`. 116 tests pass there.

## Built on 2026-07-19

Word chapters render from the file itself · per-chapter reader-copy picker ·
three-deep change logs · shared codex library · role-tiered profiles and a
profile chip on every page · AI Settings with a behaviour builder · four
downloadable voices · feedback from other people on Tell MaggotClaw · the main
screen as nine cards · one top row on every page · Suggestions (was Catch An
Idea) · Dashboard (was Owner Dashboard) with live connection checks · the
Human Maker reading manuscripts correctly.

## Open, and worth picking up

1. **Reading a reply while it streams.** The wait is down from 8s to 2s and
   polling is 4× faster, which he can feel. True streaming needs the diagnostic
   run against a live Claude window: AI Settings → Reading Out Loud → Check
   What Can Be Read, while a long answer is arriving. It copies its report to
   the clipboard. Build from that, not from a guess — the last guess here is
   what made the companion read his own words back to him.
2. **Two buttons in Project Files** he asked about — "the main button on top and
   the search button on the side". Never identified. Ask him to point at them.
3. **SYNC-0026** in `99 Codex, Project Sync Queue v2.33` — four findings
   awaiting his ruling, carried out of Change File 001 before it was deleted.
4. **Superseded codex versions** are piling up on Dropbox (90 Codex at v1.7,
   v1.8, v1.9; sync queue at v2.32, v2.33). He has not said to archive them.
5. **Word upload.** Word downloads; `05 Approved Uploads` still refuses
   binaries. Only matters once someone else edits Word files.

## Still never live-tested

No second machine has ever run this. Key, catalog download, approval, progress
reporting — all theory. Reader Links are still unpublished, so no friend can
download the book yet even though sharing works.

## Things he still has to do himself

- **Settings → Import From Bridge → Save.** The app holds the pre-rotation
  Dropbox token until he does.
- **Add the Claude connector** (walkthrough shipped: "Putting MaggotClaw In
  Claude's Menu").
- **Put the update-file link in the app's update setting** — it never changes:
  `https://www.dropbox.com/scl/fi/yu7oh90wpbksmzpiwcy1l/latest-version.json?rlkey=gfm3j5q50mxajq9ceyhx45v84&dl=1`

## Gotchas

- **Never change `identifier`** in `tauri.conf.json`. Every setting lives in
  `%LOCALAPPDATA%\<identifier>`; changing it wipes the lot silently.
- New windows must be added to `src-tauri/capabilities/default.json`.
- Patch `App.tsx` by matching exact text, never by line number. Doing the
  latter corrupted the file once and cost a `git checkout` and a redo.
- Rust tests share one global project — new ones must take `ONE_AT_A_TIME`.
- The memory files (`long-rot-*`, `maggotclaw-*`) carry the rest.
