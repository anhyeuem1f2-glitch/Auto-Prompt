# ST Auto Prompt Reminder — V1 Design

## Goal
Build a minimal SillyTavern UI extension that stores one user-authored reminder prompt and injects that exact text into every generation without altering the visible user message.

## V1 Scope
- One global ON/OFF toggle.
- One large textarea containing the complete reminder prompt.
- Autosave to SillyTavern extension settings.
- Inject the textarea content into every generation.
- Use an in-chat system injection at depth 0 so it is near the newest context and visible to SillyTavern prompt inspection/itemization.
- Show a small status line confirming the latest generation-time injection.
- No reminder categories, schedules, per-chat profiles, macros, editors, or advanced routing in V1.

## Architecture
The extension is dependency-free and loads directly as a SillyTavern third-party extension. Runtime integration uses `SillyTavern.getContext()` rather than deep imports from SillyTavern internals. Pure settings/injection logic is separated into small ES modules so it can be tested with Node's built-in test runner.

## Runtime Flow
1. SillyTavern loads `index.js`.
2. On `APP_READY`, the extension initializes settings and mounts one settings card into `#extensions_settings2`.
3. The extension applies the current injection immediately.
4. It registers a listener for `GENERATION_AFTER_COMMANDS` (falling back to `GENERATION_STARTED` if unavailable).
5. Before every generation prompt is built, the listener calls `setExtensionPrompt` with the exact textarea text as a system-role in-chat injection at depth 0.
6. The status line is updated after a successful non-empty generation-time injection.

## Persistence
Settings live at `extensionSettings.st_auto_prompt_reminder`:

```json
{
  "enabled": true,
  "promptText": ""
}
```

`saveSettingsDebounced()` is called after UI edits.

## Injection Contract
- Prompt key: `st_auto_prompt_reminder.main`
- Position: `1` (in-chat)
- Depth: `0`
- Scan: `false`
- Role: `0` (system)
- If disabled or textarea is blank/whitespace-only, the extension writes an empty extension prompt to clear any previous injection.
- The stored text is not decorated or rewritten; the model receives the user's exact non-empty textarea content.

## Verification
Automated tests must prove:
- Existing settings are preserved and missing defaults are added.
- Disabled/blank content produces an empty injection.
- Enabled content is passed exactly to `setExtensionPrompt` at position 1, depth 0, system role.
- The registered generation event causes injection each time the event handler runs.

Manual SillyTavern verification:
1. Install/enable extension.
2. Enter a unique marker such as `AUTO_REMINDER_TEST_9F31` in the textarea.
3. Send a normal chat message.
4. Open Prompt Inspector or Prompt Itemization.
5. Confirm the marker is present in the built prompt while it is absent from the visible user message.
6. Disable the extension, generate again, and confirm the marker is absent.
