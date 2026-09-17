# Auto-prompt Multi-Prompt + Character Binding Design

Date: 2026-09-17
Target version: 0.2.0

## Goal

Upgrade ST Auto Prompt Reminder from one global textarea into a small prompt manager while preserving the already-verified final-stage injection behavior.

## Core behavior

1. Users can create multiple prompt entries.
2. Each entry has:
   - id
   - name
   - enabled
   - scope: `global` or `character`
   - character binding metadata when scope is `character`
   - content
   - order
3. Global prompts always participate when enabled.
4. Character prompts participate only when the currently active SillyTavern character/card matches the stored binding.
5. Active prompts are sorted by `order`, concatenated into one text block, and injected as exactly one final `system` message during `CHAT_COMPLETION_PROMPT_READY`.
6. The extension must never inject one message per prompt.
7. The legacy staged extension-prompt slot remains empty so duplicate injection does not return.

## Character identity

Character binding should prefer a stable card identifier derived from the active character object, using avatar/card filename when available and name as a fallback display field. Numeric `characterId` is treated as a runtime lookup index, not as the persisted identity by itself.

A stored character binding should contain enough display metadata to make the UI understandable even when that card is not currently active.

## UI

Replace the single textarea with a compact prompt list.

Each prompt row shows:
- ON/OFF checkbox
- Prompt name
- Scope badge: `Global` or the linked character name
- Edit button
- Delete button

Controls:
- `+ Thêm prompt`
- Reorder controls (up/down initially; drag-and-drop can be added later if needed)

Editor fields:
- Name
- Scope: Global / Character
- Character selector / "Gắn với card hiện tại"
- Content textarea

Changes auto-save using SillyTavern `saveSettingsDebounced()`.

## Migration

Existing v0.1.2 settings:

```json
{
  "enabled": true,
  "promptText": "..."
}
```

must migrate automatically to:

```json
{
  "enabled": true,
  "schemaVersion": 2,
  "prompts": [
    {
      "id": "...",
      "name": "Prompt cũ",
      "enabled": true,
      "scope": "global",
      "character": null,
      "content": "...",
      "order": 0
    }
  ]
}
```

No authored text may be lost during migration.

## Injection pipeline

At final Chat Completion stage:

1. Read extension settings.
2. Resolve current active character/card.
3. Select enabled Global prompts.
4. Select enabled Character prompts matching current card.
5. Sort by order.
6. Join content with a clear separator/newline.
7. Remove any exact existing aggregate reminder copy if present.
8. Append one final `{ role: 'system', content: mergedText }` message.
9. Update UI status with prompt count and total character count.

Example status:

`✓ Đã chèn 3 prompt ở cuối prompt gửi AI · 1,248 ký tự`

## Group chats

For v0.2.0, character-scoped prompts follow the currently active/responding character resolved by SillyTavern context. Global prompts still apply normally. If no active character can be resolved, only Global prompts are injected.

## Non-goals for v0.2.0

- Scheduling/frequency rules
- Regex/conditional triggers
- Per-generation-type filters
- Multiple injection positions
- HTML-comment injection
- Separate priority levels
- One system message per prompt

## Tests

Required automated coverage:

- migration from v0.1.2 preserves old text
- multiple global prompts merge in order
- disabled prompts are omitted
- matching character prompt is included
- non-matching character prompt is omitted
- global + matching character prompts are additive
- final prompt contains exactly one aggregate reminder message
- no active card => only global prompts
- enable/disable extension behavior remains correct
- manifest/version contract updated to 0.2.0

## Files expected to change

- manifest.json
- package.json
- index.js
- style.css
- src/reminder-core.js
- src/runtime.js
- tests
- README.md
- BAN_GIAO_DU_AN.md
