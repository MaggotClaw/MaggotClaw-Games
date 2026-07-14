# Project Status — 2026-07-14

## Repositories and installed application

- Voice application repository: `C:\Users\QinOt\the-long-rot-voice`
- MCP repository: `C:\Users\QinOt\the-long-rot-mcp`
- Installed application: `C:\Users\QinOt\AppData\Local\The Long Rot Reader\the-long-rot-voice.exe`
- Installed development version: `0.2.0`
- Latest local source commit before this documentation update: `f649524`
- No remote was created for the voice application and nothing was pushed.
- The MCP repository was inspected read-only and remained unchanged.
- Nothing was deployed or written to Dropbox.

## Accepted product direction

The product is not merely a talking Reader Copy application. It is intended to become a general Long Rot voice workspace for authors, editors, contributors, collaborators, and readers.

The primary Windows requirement is a desktop accessibility companion that works with the user's normal installed ChatGPT, Codex, or Claude application:

```text
User speaks
  -> companion transcribes locally or with a user-selected speech service
  -> companion inserts text into the target application's existing message box
  -> companion waits for the configured silence allowance
  -> companion sends the message
  -> target application produces its normal response under the user's existing account
  -> companion detects the displayed response
  -> companion reads it aloud by paragraph
  -> companion becomes ready for the next spoken message
```

This path must work with Free or paid consumer accounts and must not require an OpenAI or Anthropic API key.

## Required desktop companion controls

### Dictation

- Start Talking
- Finish and Send
- Add 5 Seconds
- Visible current silence allowance and countdown
- Editable live transcription
- Start Over
- Cancel

Each Add 5 Seconds press adds exactly five seconds. There should be no small fixed press limit. The displayed allowance is the source of truth.

### Response playback

- Pause
- Continue
- Stop
- Repeat Paragraph
- Previous Paragraph
- Next Paragraph
- Slower
- Faster
- Talk Again

Responses should be divided into stable paragraphs so playback controls do not depend on one long audio stream.

## Windows implementation recommendation

Extend the existing Tauri application with a small always-on-top Desktop Voice Companion window. Add separate Windows UI Automation adapters for:

- ChatGPT Windows
- Codex desktop task/chat windows
- Claude Desktop

The adapter should identify the target window, message composer, send control, and newest assistant response through the Windows accessibility tree. It should include fallbacks for focusing the active text field, inserting through the clipboard, sending with a keyboard action, and reading user-selected/copied response text.

The companion must always show which application it will control before sending. It must never send to an unidentified or unexpected foreground application.

## Apple device direction

The user also wants the experience on iPad and iPhone with the installed ChatGPT or Claude application.

iOS and iPadOS do not expose Windows-style cross-application UI Automation to ordinary third-party apps. Apple also documents that custom keyboard extensions do not have microphone access. Therefore the Apple version cannot promise the same invisible app control.

The native Apple companion should investigate:

- Recording and transcription in the containing Long Rot app.
- User-mediated transfer to ChatGPT or Claude through clipboard, Share extensions, App Intents, Shortcuts, or provider-supported actions.
- Returning selected/shared/copied response text to the Long Rot app for paragraph playback.
- A Safari extension as an optional path for users who prefer a more automatic loop.

Do not claim full native-app automation on iPhone or iPad unless a supported provider or Apple integration is verified.

## Working Reader Mode

The installed application currently includes:

- Reader identity.
- Reader Copy discovery through MCP filename search when the MCP is connected.
- Offline demonstration Reader Copy.
- Sentence segmentation and highlighting.
- Play, pause, continue, back, forward, repeat, and speed controls.
- Durable reading position and cached document state.
- Large Comment button.
- Local microphone recording.
- Voice-activity silence detection.
- Repeatable Add 5 Seconds behavior.
- Browser transcription fallback and editable confirmation.
- Exact filename, content hash, paragraph, sentence, and character anchors.
- Original comment audio preservation.
- Recovery of unfinished comments.
- Saved-comment review, audio playback, categories, and JSON index export.

Comments remain local. They are not synchronized to Dropbox.

## API Talk prototype

Version `0.2.0` contains a push-to-talk OpenAI API prototype using:

- `gpt-4o-transcribe`
- Responses API with `gpt-5.4-mini`
- `tts-1`
- Windows Credential Manager for the API key

This prototype was useful for proving the microphone, transcript review, conversation UI, and spoken-response controls. It does not meet the clarified no-key requirement and must not remain the normal first-run path. Preserve it only as an optional advanced provider if that simplifies future maintenance.

## MCP status and blockers

The current MCP exposes these usable read operations:

- `search_dropbox_filenames`
- `read_dropbox_text_file`
- `list_dropbox_revisions`

Known gaps:

- Search/list results omit file ID and revision metadata.
- Text reads cannot request a particular immutable revision.
- No Reader Copy-specific Registry resolver is defined.
- No binary audio operation exists.
- The local MCP `.env` contains an expired temporary Dropbox access token. It does not currently contain `DROPBOX_APP_KEY`, `DROPBOX_REFRESH_TOKEN`, or `DROPBOX_APP_SECRET` refresh-token configuration.

A live read-only test reached the MCP but Dropbox returned an expired-access-token response. No content was changed.

## Verification already completed

- TypeScript checks passed.
- Six frontend tests passed.
- Two Rust tests passed after the Talk prototype update.
- Production frontend builds passed.
- Windows NSIS installers were built and installed successfully.
- Installed version `0.2.0` launched successfully.
- Dependency audit reported zero vulnerabilities at the time of the build.
- Secret scans found no credential values in the voice repository.

## Git state before this documentation update

- Initial MVP commit: `c20b433` — `Build Long Rot desktop reader MVP`
- Talk prototype commit: `f649524` — `Add push-to-talk AI conversation`
- Branch: `master`
- No configured remote and no push.

## Next implementation milestone

1. Inspect the current accessibility trees of the installed ChatGPT/Codex and Claude applications without sending messages.
2. Define a provider-neutral `DesktopConversationAdapter` interface.
3. Implement target-window identification and a visible target selector.
4. Implement safe text insertion without automatic send.
5. Add explicit Send and validate the correct target receives the text.
6. Detect the newest assistant response and segment it by paragraph.
7. Reuse the existing playback controls for response reading.
8. Integrate Start Talking, Add 5 Seconds, Finish and Send, and Talk Again in an always-on-top companion window.
9. Add fallbacks for copied or selected response text.
10. Test against application updates, multiple windows, focus changes, and accidental-target prevention.

The first automation tests must use harmless test text and must not alter Long Rot project files.
