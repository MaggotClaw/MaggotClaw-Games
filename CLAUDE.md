# MaggotClaw Games — How This Program Works

Read this before changing anything. It exists because the same mistakes kept
happening across chats: versions not bumped, labels shouting in capitals,
a live server nobody remembered. If you learn something here that turns out to
be wrong, fix this file in the same breath.

This file is about **the program**. The book's own rules live in the codices on
Dropbox (`00 Master Codex`, `03 Codex, Core Rules`, `91 Codex, Human Maker`).
Never mix the two.

---

## The brake: OK GO

Nothing gets written or changed without the author's explicit **"OK GO"**. Plan
first, then execute when he says it. **STOP** finishes the current atomic action
and leaves nothing half-written.

Two things carry their own separate permission:
- **Building** is not releasing.
- **Releasing needs the words "push update".** Never push to Dropbox or GitHub
  without them.

## How he wants to be talked to

Answers, not explanations. Report in a line or two — say it is done, and say
what to check. He will ask for detail when he wants it. Do not narrate what you
just did step by step, and never write a post-mortem on why something broke.

Plans before work can be as long as they need to be. Reports after work stay
short.

## Before every build

Bump the version. **All three files must move together:**

- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`

Never ship two builds carrying the same version — installers are named by
version, so the second silently overwrites the first and neither he nor anyone
else can tell what they are running. Features get a minor bump, fixes a patch.

Build with `npm run desktop:build`. Copy the installer from
`src-tauri/target/release/bundle/nsis/` into
`C:\Users\QinOt\Desktop\MaggotClaw Games\Updates`, then **prune that folder to
the two newest** — the current build and one fallback. He installs it himself.

## Writing on screen

- **Big labels are Title Case.** Screen headers, buttons, section headings.
- Not ALL CAPS. `.eyebrow` is styled `text-transform: capitalize`, which cannot
  lowercase text that is already uppercase — so a hard-coded `PROJECTS` shouts
  no matter what the CSS says. Write `Projects` in the source.
- Plain words over jargon. "Left on Dropbox" beats "binary download deferred".
- Say what is safe: when something fails, tell the person what was *not*
  changed.

## Every new window

Add it to `src-tauri/capabilities/default.json` or Tauri silently refuses
dragging, closing and always-on-top. This has cost hours more than once.

## Where things live

| What | Where |
|---|---|
| App repo | `C:\Users\QinOt\Desktop\MaggotClaw Games\Program\maggotclaw-games` |
| Installers | `C:\Users\QinOt\Desktop\MaggotClaw Games\Updates` (keep two) |
| Local workspace | `Documents\MaggotClaw Games\<Project Name>` |
| Dropbox | everything under `/MaggotClaw Games/` |
| Local bridge | `C:\Users\QinOt\the-long-rot-mcp` |
| Settings backup | `Documents\MaggotClaw Games Settings Backup.json` |
| GitHub | `MaggotClaw/MaggotClaw-Games` (still public — see Open decisions) |

**The hosted bridge is live. Do not forget it exists.**
`https://maggotclaw-games-long-rot-mcp.onrender.com/mcp` — Render, OAuth via
Auth0, scope `mcp:tools`. This is what lets claude.ai add MaggotClaw as a
custom connector, with nothing running on his PC. Config in
`the-long-rot-mcp/render.yaml`. Deploys from branch `remote-mcp` with
auto-deploy **off**, so the running code may lag the local checkout. Free plan
sleeps when idle — first request after a quiet spell takes ~30s.

## Dropbox layout, and one trap

The app's project root is **`/MaggotClaw Games/The Long Rot`**, set in
`src/projects.ts`. Only files under that root are downloaded.

**The trap:** the codices (`00 Master Codex`, `91 Codex, Human Maker`, and ~28
others) sit at `/MaggotClaw Games/` — *outside* the root. The app therefore
never downloads them, including the very codex the Human Maker audits against.
Anything that needs to reach the codices must either use its own path or the
root must widen. Unresolved as of 2026-07-18.

Per-file behaviour is decided by three shared files under
`<project root>/.mcg/`, all published from the file list:

- `file-access.json` — the lowest role that downloads each file, or
  `excluded` for things nobody needs.
- `chapter-files.json` — which file readers actually open for a chapter,
  overriding the automatic newest-version rule.
- `change-log.json` — who changed what, last three per file.

**These are keyed by Dropbox path.** Moving or renaming a file on Dropbox
silently breaks its rating, its pick and its history. Never reorganise project
files without re-pointing these.

## File naming

Chapters follow `C<nn>-<type> Chapter <nn> <Label> - <Title> v<version>.<ext>`,
parsed in `src/projectDocs.ts`. Types: `A` blueprint, `B` development,
`P<nn>` draft part, `R` reader copy. Codices are `<nn> Codex, <Name> v<v>.txt`.
A filename that does not match still works, but loses its chapter and version.

## Credentials

Standing permission to read, copy, move and rotate any of his own keys without
asking. **Never commit a secret, and never print one into chat** — write it to
a file and say where. The Discord bot token lives only in app settings and the
settings backup.

## Roles

Ascending: reader → contributor → reviewer → editor → manager → support →
administrator. Authority is granted by the owner, never self-assigned. See
`src/permissions.ts` and, for the book's version of the same rule,
`82 Codex, Roles, Duties & Authority`.

## Housekeeping

- Do not build after every change — stack them and build when he wants to look.
- Moving the repo needs one `cargo clean` afterwards.
- `npx tsc -b`, `npx vitest run`, and `cargo check` should all be clean before
  you say a job is done.

## Open decisions

- **Repo visibility.** He wants only himself able to change the program; the
  repo is public. Agreed plan is to go private and distribute through Dropbox,
  deliberately waiting until Dropbox distribution works end to end.
- **Nothing has been live-tested on a second machine.** The whole reader path —
  key, catalog download, approval, progress — is theory until a friend tries
  it. Treat the first onboarding as the real test.
- **Word upload.** Word files download but cannot be uploaded; `05 Approved
  Uploads` refuses binaries. Only matters once someone else edits Word files.
