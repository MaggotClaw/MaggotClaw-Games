# MaggotClaw Games — Agent Instructions

**Read [CLAUDE.md](./CLAUDE.md) first. It is the full standard and this file
does not repeat it.**

Codex reads `AGENTS.md`; Claude Code reads `CLAUDE.md`. Rather than keep two
copies of the same rules and let them drift apart, this file points at the
other one. If you are about to add a rule here, add it to `CLAUDE.md` instead.

The three things most often got wrong, as a safety net:

1. **OK GO.** Nothing is written or changed without the author's explicit
   "OK GO". Plan first. Building is not releasing — releasing needs the words
   "push update".
2. **Bump the version before every build**, in all three of `package.json`,
   `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`. Two builds must
   never share a version number.
3. **Big labels are Title Case, not capitals.** `.eyebrow` is styled
   `text-transform: capitalize`, which cannot lowercase text that is already
   uppercase — so write `Projects`, not `PROJECTS`.

The same rules are mirrored on Dropbox in `90 Codex, Technical Operations`,
sections 17 and 18, for assistants that reach the project over MCP rather than
through this repository. The book's own rules are separate and live in the
Master Codex — never mix the two.
