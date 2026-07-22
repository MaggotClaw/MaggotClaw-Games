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

## Never change the identifier

`identifier` in `src-tauri/tauri.conf.json` is `com.maggotclaw.games`. Every
setting the app has — keys, profiles, ratings, chapter picks, reading position
— lives in `%LOCALAPPDATA%\<identifier>`, because that is where WebView2 keeps
the storage. The installer never touches that folder, which is why upgrading
keeps everything.

Change the identifier and all of it vanishes in the same instant, with the app
reporting nothing wrong — it simply looks brand new. That is exactly what
happened when the project was renamed from the-long-rot-voice, and it cost a
re-import from the settings backup.

If it ever genuinely must change, copy the old folder to the new name first.

Installers are `currentUser` NSIS, so an upgrade installs over the top with no
admin prompt and no separate uninstall.

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

**The shared library.** The codices (`00 Master Codex`, `91 Codex, Human
Maker`, and ~28 others) sit at `/MaggotClaw Games/` — *outside* any project
root, because they belong to every project rather than to one. Each project
therefore carries a `sharedRoot` alongside its own root, and the download takes
the files sitting **directly** in it.

Directly, and never recursively — the folders beside those codices are the
other projects, and The Long Rot downloading Project Zero Author's book would
be a real bug. `isSharedFile()` in `src/projects.ts` and `shared_relative_path`
in `project_workspace.rs` both enforce that, and both are tested.

Shared files are filed locally under `01 Originals/(Shared Codex)/` so a codex
never looks like it came out of the project's own folder, and the file list
marks them with a "Shared Codex" chip.

This was not cosmetic. Before it existed, `TalkScreen`'s story context looked
for a downloaded file matching "ID Registry", never found one because the
registry lives in the library, and silently sent every message to the AI with
no canon attached. Story Brain failed the same way. Neither reported an error.

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

## Page-exact chapters

A chapter styled in Word carries filled header blocks, text boxes, WordArt and
3D lettering. `docx-preview` draws **none** of it — checked in the source, not
guessed — so no amount of CSS makes a styled chapter look like the file. The
only thing that renders Word exactly like Word is Word.

So Word makes the picture: `convert_document_to_pdf` drives it over COM and the
PDF goes up beside the chapter with the same name. Readers download it as a
normal document (`pdf` is already an allowed type) and `PageExactDocument`
draws the pages, fitted to whatever width it is given — narrowing the window
shrinks the page instead of reflowing it. Narrated mode finds the sentence
being read with `pageHighlight.ts` and lights that line; when it cannot match
the sentence it shows the page clean, because a wrong highlight is worse than
none. A chapter with no PDF published falls back to the older view.

**Word must never be told to quit while the author has documents open** — a
bare `Quit()` closes his whole session, unsaved chapters with it. The script
only quits when `Documents.Count` is zero.

## File naming

Chapters follow `C<nn>-<type> <Label> - <Title> v<version>.<ext>`, parsed in
`src/projectDocs.ts`:

| Type | Label | Example |
|---|---|---|
| `B` | Blueprint | `C01-B Blueprint - The Bounty v2.1.txt` |
| `D` | Chapter Draft | `C01-D Chapter Draft - The Bounty v2.1.txt` |
| `P<nn>` | Draft Segment | `C01-P03 Draft Segment - The Bounty v3.1.txt` |
| `R` | Reader Copy | `C01-R Reader Copy - The Bounty v9.5.docx` |

`C<nn>` already says which chapter it is, so the name never says it twice, and
the letters match the words. Codices are `<nn> Codex, <Name> v<v>.txt`. A
filename that matches no rule still works, but loses its chapter and version.

**The older names are still read** — `C01-A Chapter 01 Blueprint`, `C01-B
Chapter 01 Development`, `C01-P01 Chapter 01 Draft`. Keep it that way: one file
missed in a rename would otherwise drop off the shelf in silence.

**The label decides the type, never the letter.** `B` meant Development under
the old scheme and means Blueprint under the new one, so the letter alone is
ambiguous and reading it would turn every old Development file into a
blueprint. `parseDoc` switches on the label and only reads the letter for a
draft segment's number. There is no `A` type code any more.

Renaming a chapter file **breaks its rating, its reader pick and its history**,
because `file-access.json`, `chapter-files.json` and `change-log.json` are all
keyed by Dropbox path. Re-point all three in the same pass, or the file comes
back unrated with no history and no chapter pick. The page-exact PDF is named
after the chapter, so it has to move with it.

## Two programs are called "Claude"

The chat app and Claude Code both put a top-level window on screen titled
**Claude**. Asking Windows for a window by that name returns whichever it
likes, and not the same one twice — measured, not guessed: two inspections
minutes apart returned different windows with different structures.

That was the real cause of the companion reading his own words back. In Claude
Code every message is left-aligned, so the left-is-the-assistant rule finds his
own text and believes it. **Never resolve the window by title.**
`window_executable()` reads the owning process; the chat app is the one under
`WindowsApps\…\claude.exe`. If only Claude Code is open, the companion says so
rather than driving the wrong program.

Also measured, and worth knowing before changing the reader:

- The composer is a **Group named "Prompt"**, not a text field — the window has
  **zero** Edit controls. Searching for an Edit finds nothing.
- Copy buttons are "Copy message" (the reply) and "Copy code" (code blocks).
  Excluding "code" is what keeps her from reading code aloud.
- A reply arrives as **more elements, not a longer one**: the text-element count
  climbed 46 → 102 during one answer, then collapsed to 64 when it finished,
  while the longest single element never changed. `streaming_reply` therefore
  gathers every assistant-side element top-to-bottom rather than watching one
  box grow.
- Stop appears while busy and goes on completion; Copy count rises by one. Both
  are reliable finish signals.

## The bridge reads local files first

`search_file_contents` downloads **every** text file in the project from
Dropbox on every query — about a hundred files per search, thrown away
afterwards. The bridge runs on his PC, where the app has already downloaded
those same files, so `the-long-rot-mcp/src/local-tools.js` reads them off disk
instead: 6–14ms against the whole book.

Three tools, and Claude should reach for them in this order:

1. `read_story_index` — the newest local `ID Registry`, his own catalog of
   every character and place. Answers most "who/what is X" in one call.
2. `search_local_files` — grep the downloaded copies; returns file, line,
   context, and each file's Dropbox path.
3. `search_file_contents` — the Dropbox search, as the fallback.

**Local is a subset, never the truth.** It holds only what the app downloaded
for that person's role, so an excluded or higher-rated file is not there. Every
reply says which files were searched and names the Dropbox fallback — keep it
that way, or a missing file will read as a missing fact.

The workspace path in `local-tools.js` mirrors `workspace_root()` in
`project_workspace.rs`. Change one and you must change the other.

## quickOpen.ts is kept on purpose

Nothing calls it any more. The "say what to open" bar it drove was removed
because it read typed phrases and he wanted to *speak* to the AI — but the
module is the part that turns "ch 2 reader" into an actual file, which is
exactly what an AI-driven version would stand on. It is tested and costs
nothing unused. **Do not delete it as dead code.**

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
  repo is still public. Nothing blocks going private any more: the update check
  no longer falls back to GitHub. `DEFAULT_UPDATE_REPO` is `""` and the
  author's Dropbox `latest-version.json` is the built-in default, so a private
  repo cannot strand anybody. Verified: no secret was ever committed, and the
  manuscript is not in the repo. Flipping the switch is his to do.
- **Nothing has been live-tested on a second machine.** The whole reader path —
  key, catalog download, approval, progress — is theory until a friend tries
  it. Treat the first onboarding as the real test.
- **Word upload.** `05 Approved Uploads` still refuses binaries — but that is a
  *bridge* limit, not a Dropbox one. The direct connection uploads bytes fine
  (`dropbox_write_binary`), which is how page-exact copies get published. Only
  the bridge path is still text-only.
