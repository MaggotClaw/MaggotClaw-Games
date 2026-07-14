# Desktop Voice Companion Requirements

## Purpose

Provide voice input and spoken response playback while the user works in the ordinary installed ChatGPT, Codex, or Claude Windows application. The companion is an accessibility layer over the existing application, not a replacement AI backend.

## Non-negotiable requirements

1. No API key required for the normal path.
2. Use the user's existing Free or paid account in the target application.
3. Never capture password or secure-entry fields.
4. Display the selected target application before inserting or sending text.
5. Do not send automatically when the target cannot be identified with confidence.
6. Preserve an editable transcript before sending.
7. Add exactly five seconds per Add 5 Seconds press.
8. Display the current silence allowance and countdown.
9. Read responses in paragraph-sized segments.
10. Support pause, continue, repeat, previous paragraph, next paragraph, speed, stop, and talk again.
11. Do not modify Long Rot project files through this companion unless a separate, explicit project action is approved.
12. Keep Reader Mode separate and intact.

## Adapter contract

Each target application adapter should implement conceptual operations equivalent to:

```text
detectWindows()
identifyTarget(window)
findComposer(window)
insertDraft(window, text)
readDraft(window)
sendDraft(window)
observeResponseStarted(window)
observeResponseCompleted(window)
readLatestResponse(window)
```

Adapters must return confidence and plain-language failure information. Application-specific selectors must not leak into the shared speech, silence, or playback layers.

## Safety fallbacks

- Insert without Send when confidence is below the automatic-send threshold.
- Allow Send only after the user confirms the visible target.
- Offer Paste Into Focused Box when a stable composer cannot be found.
- Offer Read Selected or Copied Text when a stable response element cannot be found.
- Stop playback immediately when the target changes or the user presses Stop.

## Out of scope for the first companion slice

- Automatically approving file changes.
- Scraping account credentials or session tokens.
- Bypassing target-application usage limits.
- Automating secure text fields.
- Claiming identical native-app control on iPhone or iPad.
