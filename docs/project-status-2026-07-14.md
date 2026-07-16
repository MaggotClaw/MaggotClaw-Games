# Project Status — 2026-07-14

## Repositories and installed application

- Voice application repository: `C:\Users\QinOt\the-long-rot-voice`
- MCP repository: `C:\Users\QinOt\the-long-rot-mcp`
- Installed application name: `MaggotClaw Games Reader`
- Installed development version: `0.4.0`
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

## Windows Codex companion update — version 0.3.0

The first Codex-only Windows companion slice is implemented.

- Normal use no longer requires an OpenAI API key.
- The companion verifies that the open ChatGPT-titled window is specifically the Codex interface.
- Spoken text remains editable before transfer.
- Put Draft Into Codex replaces the current composer draft but does not press Send.
- The latest completed Codex response can be copied through Windows accessibility and loaded for playback.
- Playback uses free Windows voices and paragraph-sized segments.
- Controls include Read Aloud, Pause, Continue, Stop, Repeat Paragraph, Previous Paragraph, Next Paragraph, Slower, Faster, and Talk Again.
- A clipboard fallback remains available if Codex changes its accessibility structure.
- Reader Mode remains intact.

Verification completed for this slice:

- TypeScript checks passed.
- Eight frontend tests passed.
- Two Rust tests passed.
- Production frontend and Windows release builds passed.
- Dependency audit reported zero vulnerabilities.
- Windows accessibility inspection confirmed the Codex document, ProseMirror composer, Dictate control, and response Copy controls.

Automatic Send remains intentionally disabled until the user has checked the inserted draft in Codex.

## Automatic Codex voice loop — version 0.4.0

The Codex-only companion now supports the approved continuous conversation loop:

1. Start Talking begins microphone capture.
2. Speech activity resets the visible silence countdown.
3. Add 5 Seconds increases the silence allowance without a small fixed limit.
4. Countdown completion finishes transcription, inserts the message into the verified Codex composer, and presses Enter.
5. The companion detects Codex's busy state and waits for a new completed response.
6. The newest response is loaded and read with free Windows voices in paragraph-sized segments.
7. When playback finishes, listening begins again automatically.

The user can cancel recording, finish and send immediately, pause or continue reading, repeat or move between paragraphs, adjust speed, stop the loop, or start talking again. Companion mode resizes to a compact always-on-top Windows panel. Reader Mode remains available and restores the full window size.

Automatic sending is enabled only from the verified Codex target. Regular ChatGPT and Claude adapters remain future work. Individually movable controls are an approved follow-up after the basic loop is proven with live microphone use.

## Future onboarding and profile recovery requirement

Add a guided onboarding program for every new user, including Readers, Writers, and Editors. This belongs in the future work queue and is not part of the current Codex voice-loop slice.

- Onboarding collects the approved user identity, role, nickname, preferences, and a user-chosen four-digit PIN.
- Name plus PIN identifies a returning user when activating a newly installed or repaired computer.
- Normal use remains locally available after activation.
- Approved profile information and settings should synchronize to that user's personal Long Rot profile file for recovery.
- On a new computer, the program asks for name and PIN, offers to restore existing settings, and may collect any newly required onboarding information.
- Requiring the PIN at every program start is optional and disabled by default.
- Store verification data safely; do not record the plain PIN in project documentation, logs, or ordinary settings files.

## Confirmed product structure — 2026-07-14

The installable Windows program is named **MaggotClaw Games Reader**. It uses one profile and settings system with clearly separated modes:

- Reader Mode preserves Reader Copy reading, playback, position, comments, recovery, and local feedback review.
- Voice Companion opens a target selector. Codex is implemented first; ChatGPT and Claude remain disabled placeholders until their adapters are built.
- Test Profile — Local Only provides both modes without onboarding or synchronization and is visibly marked as test mode.

Confirmed Codex defaults and behavior:

- Microphone starts only after Start Talking is pressed.
- Recognized words appear directly in the Codex composer rather than a second transcript box.
- Default silence before automatic Send is two seconds.
- Add Time adds five seconds by default; both values are profile settings.
- The visible countdown always shows the actual remaining time.
- Cancel stops listening and reading, clears any unsent Codex draft, and ends the loop.
- Codex generation disables Start Talking. Start Talking is available while a completed reply is being read and interrupts playback.
- Completed replies read automatically, then listening restarts automatically.
- Skip Reply immediately returns to listening.
- Fenced code or output boxes are announced as “Content box skipped.” Read Skipped Box reads the most recently skipped box on request.
- Reading speed lives in Settings rather than the main control panel.
- All main controls remain in stable positions; unavailable controls are dimmed. The implementation must permit separately movable controls later.
- The panel stays above Codex but drops out of always-on-top behavior when another unrelated program is active.
- Conversation text is not duplicated in local history. Only profile settings and future button positions are stored.

Future profile and support requirements:

- One main shortcut opens profile selection; direct mode shortcuts are deferred.
- Every user eventually completes onboarding with name and a four-digit PIN. First activation on a computer restores the profile; requiring PIN at every launch is optional and off by default.
- Profile settings are local-first and may synchronize to the user's personal Long Rot profile file for recovery.
- Project authorization must be one-button and hide technical credentials from normal users.
- Temporary support access is request-based, read-only by default, expires after 30 minutes, and excludes manuscript text, conversations, PINs, and credentials from diagnostics.

## Local neural reading voice — version 0.5.0

Reader Mode and Voice Companion reply playback now use the bundled Piper neural
text-to-speech engine by default. The selected `en_GB-cori-high` voice is a
single-speaker UK English model trained from scratch using public-domain
LibriVox recordings. It runs entirely on the computer and requires no API key,
subscription, or network connection.

- Reading speed continues to use the existing profile setting.
- Pause, continue, stop, paragraph navigation, and automatic listen-after-read
  behavior are preserved.
- If Piper or its model cannot start, playback automatically falls back to the
  installed Windows speech system instead of breaking the conversation loop.
- The commonly recommended Lessac model was deliberately not bundled because
  its source-data license is restricted to research use.
- Piper, the Cori voice, their required runtime libraries, license text, and
  voice notice are included in the Windows installer.

Verification for this slice includes a native test that invokes the bundled
Piper executable and confirms that it creates valid RIFF/WAVE audio.

## Live-test corrections — version 0.5.1

The first live test of version 0.5.0 exposed three problems that automated
build checks did not reproduce. Version 0.5.1 corrects them:

- Add Time is now protected. Continued speech never replaces an added ten
  seconds with the normal two-second allowance. Once the bonus counts down to
  the normal allowance, active speech continues refreshing those two seconds.
- The floating panel disables text selection and prevents the pointer-down
  event from highlighting the timer while the user drags the panel.
- Codex now exposes its composer class as `ProseMirror ProseMirror-focused`.
  The adapter matches the `ProseMirror` class token instead of requiring the
  obsolete exact class value.
- All Windows accessibility tree work runs on background threads so checking
  Codex does not freeze dragging or button feedback.
- Start Talking immediately displays a preparation state and rejects duplicate
  clicks while Codex and the microphone are being prepared.

Automated verification: 15 frontend tests, three Rust tests, TypeScript checks,
and Rust compilation pass. A second live microphone/Codex test is still needed
before calling the complete conversation loop proven.
