# MaggotClaw Games — Handoff (2026-07-18, evening)

**Read `CLAUDE.md` in the repo root first.** It is now the standing rulebook —
OK GO, version bumping, Title Case, where everything lives. This file is only
what changed today and what is still open.

## Live now

- **Dropbox distribution works.** v1.5.0-beta published with working share
  links. Download link and `latest-version.json` both verified reachable.
  This was the blocker behind everything.
- **Hosted MCP redeployed and verified.** Reports as "MaggotClaw Games MCP",
  root fixed. `https://maggotclaw-games-long-rot-mcp.onrender.com/mcp`
- **The bridge was broken and is fixed.** Its guard held `/The Long Rot`, a
  folder that no longer exists, so every call was refused. Root is now
  `/MaggotClaw Games`. 116 tests pass. Pushed to `remote-mcp`, deployed.
- **Local bridge wired into Claude Desktop** as `maggotclaw-games`, verified
  with a live listing.
- **Rules written down**: `CLAUDE.md` + `AGENTS.md` in the repo,
  `90 Codex, Technical Operations v1.5` on Dropbox, and Claude/ChatGPT
  instruction files at v1.1 in `Operations/02`.

## Broken — fix this first

**The installer will not package.** `npm run desktop:build` compiles the
frontend and Rust fine, then `makensis` fails with "Can't open output file".
Not disk space (222 GB free), not antivirus (Defender off), no process holding
the file, and clearing `target/release/bundle` and `target/release/nsis` did
not help. It succeeded once at 17:22 and never again.

So **v1.6.0-beta exists only as source.** Everything after v1.5.0-beta —
Title Case menus, the Human Maker send button, the Claude connector
walkthrough — is committed and tested but has never been packaged.

Try a reboot, then `cargo clean` and rebuild. If it still fails, that is the
first job.

## Needs the author's own hands

- **Add the Claude connector.** Settings → Connectors → Add custom connector,
  URL above, Auth0 details from Bitwarden. There is now a walkthrough for it
  ("Putting MaggotClaw In Claude's Menu") — but only in the unbuilt v1.6.0.
- **Install v1.5.0-beta, then Settings → Import From Bridge → Save.** The
  app still holds the pre-rotation Dropbox token.
- **Put the update-file URL in the app's update setting** so other machines
  find updates:
  `https://www.dropbox.com/scl/fi/yu7oh90wpbksmzpiwcy1l/latest-version.json?rlkey=gfm3j5q50mxajq9ceyhx45v84&dl=1`

## Decisions still open

- **Codices sit outside the app's project root** (`/MaggotClaw Games/The Long
  Rot`), so the app never downloads them — including `91 Codex, Human Maker`,
  which the Human Maker audits against. Claude reaches them now; the app
  cannot. Fixing means moving files or widening the root, and both break the
  path-keyed ratings in `.mcg/`.
- **The local Claude Desktop connector contradicts `90 Codex` §9**, which
  bans it. Its stated reason (stale credentials) no longer applies, but the
  two disagree. Both configs backed up as `.bak-2026-07-18`.
- **GitHub as an update source.** The author said Dropbox is enough now.
  Updates still check Dropbox first, then GitHub, so GitHub can be retired
  whenever — nothing is stranded.
- **Repo visibility.** Still public. The agreed plan was private once Dropbox
  distribution worked. It now works.

## Never live-tested

No second machine has ever run this. Key, catalog download, approval,
progress reporting — all still theory. Treat the first real onboarding as the
test. Reader Links are still unpublished, so no friend can download the book
yet even though sharing now works.
