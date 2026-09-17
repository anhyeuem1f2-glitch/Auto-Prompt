# Multi-Prompt + Character Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Upgrade ST Auto Prompt Reminder to manage multiple ordered prompts, add Global/Character scopes, migrate v0.1.2 data losslessly, and still inject exactly one final system message.

**Architecture:** Keep the proven final-stage injection pipeline. Extend `reminder-core.js` into the source of truth for schema v2, migration, active-card identity, prompt selection, ordering, and merge. Keep `runtime.js` responsible only for legacy-slot clearing plus final aggregate injection. Replace the single-textarea UI in `index.js` with a small prompt list/editor that auto-saves.

**Tech Stack:** Vanilla JavaScript ES modules, SillyTavern extension API, Node.js built-in `node:test`, CSS.

**Spec:** `docs/superpowers/specs/2026-09-17-multi-prompt-character-binding-design.md`

## Global Constraints

- Target version is `0.2.0`.
- Global enabled prompts always participate.
- Character prompts participate only when the current active card matches the persisted binding.
- If no active character can be resolved, only Global prompts inject.
- Enabled prompts are ordered by `order` and merged into exactly one final `system` message.
- Legacy `setExtensionPrompt` slot stays empty.
- No scheduling, regex triggers, generation-type filters, multiple injection positions, HTML-comment injection, priority levels, or one-message-per-prompt behavior.
- Existing v0.1.2 `promptText` must migrate without losing authored text.

---

### Task 1: Schema v2, Migration, Selection, and Merge Core

**Files:**
- Modify: `src/reminder-core.js`
- Modify: `test/reminder-core.test.mjs`

**Interfaces:**
- Produces: `SCHEMA_VERSION`, `createPromptEntry()`, `ensureSettings()`, `resolveCharacterIdentity()`, `characterBindingsMatch()`, `getActivePrompts()`, `mergeActivePrompts()`, `getReminderText()`.
- `mergeActivePrompts(settings, activeCharacter)` returns `{ text, prompts, promptCount, textLength }`.

- [x] **Step 1: Write failing tests for v0.1.2 migration, ordered globals, disabled omission, matching/non-matching character prompts, additive global+character behavior, and no-card global-only behavior.**
- [x] **Step 2: Run `node --test test/reminder-core.test.mjs` and verify the new assertions fail against v0.1.2 core.**
- [x] **Step 3: Implement schema v2 and migration without deleting legacy authored text until it has been copied into a prompt entry.**
- [x] **Step 4: Implement stable card identity extraction preferring avatar/card filename and using name as display fallback.**
- [x] **Step 5: Implement active prompt filtering, deterministic ordering, and aggregate merge.**
- [x] **Step 6: Run `node --test test/reminder-core.test.mjs` and verify all core tests pass.**

### Task 2: Final Injection Uses Aggregate Prompt + Character Context

**Files:**
- Modify: `src/runtime.js`
- Modify: `test/runtime.test.mjs`

**Interfaces:**
- Consumes: `mergeActivePrompts(settings, activeCharacter)` from Task 1.
- Produces: `finalizeReminderInChat(eventData, settings, activeCharacter)` and `registerFinalPromptHook(context, settingsProvider, characterProvider, onInjected, now)`.
- Injection report includes `promptCount`, `textLength`, `finalStage`, and `movedExisting`.

- [x] **Step 1: Write failing runtime tests proving multiple prompts become one final system message, character scope is respected, no active card injects globals only, and disabled extension does nothing.**
- [x] **Step 2: Run `node --test test/runtime.test.mjs` and verify failures occur because runtime still reads legacy `promptText`.**
- [x] **Step 3: Change finalization to consume the aggregate merge result and de-duplicate only the aggregate system message.**
- [x] **Step 4: Change final hook registration to resolve character identity for each generation.**
- [x] **Step 5: Run `node --test test/runtime.test.mjs` and verify runtime tests pass.**

### Task 3: Multi-Prompt Manager UI

**Files:**
- Modify: `index.js`
- Modify: `style.css`
- Modify: `test/extension-contract.test.mjs`

**Interfaces:**
- Consumes: schema-v2 settings and `resolveCharacterIdentity()`.
- UI supports global extension ON/OFF, prompt rows, add, edit, delete, move up/down, per-prompt ON/OFF, scope Global/Character, and `Gắn với card hiện tại`.
- Auto-save uses `context.saveSettingsDebounced()`.

- [x] **Step 1: Extend contract tests to require v0.2.0 UI controls and no legacy single-textarea-only contract.**
- [x] **Step 2: Run `node --test test/extension-contract.test.mjs` and verify failure.**
- [x] **Step 3: Replace the single textarea panel with prompt list + editor markup and event handlers.**
- [x] **Step 4: Add card-binding action using current SillyTavern context identity.**
- [x] **Step 5: Add reorder, delete, per-row enable toggles, and editor auto-save.**
- [x] **Step 6: Update status to `✓ Đã chèn N prompt ở cuối prompt gửi AI · X ký tự` using final injection report.**
- [x] **Step 7: Add compact CSS for rows, badges, editor, and controls.**
- [x] **Step 8: Run `node --test test/extension-contract.test.mjs` and verify pass.**

### Task 4: Versioning, Documentation, and Release Verification

**Files:**
- Modify: `manifest.json`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `BAN_GIAO_DU_AN.md`
- Modify: `test/extension-contract.test.mjs`
- Create: `docs/superpowers/plans/2026-09-17-multi-prompt-character-binding-implementation.md`

**Interfaces:**
- Version contract: `0.2.0` in manifest/package/docs.
- Handoff records migration, final-injection behavior, tests, known limitations, and exact GitHub overwrite list.

- [x] **Step 1: Update version contract tests to expect `0.2.0`.**
- [x] **Step 2: Bump manifest/package version and update README usage/migration/character-binding instructions.**
- [x] **Step 3: Update `BAN_GIAO_DU_AN.md` with v0.2.0 changes, test results placeholder only until verification is run, known limitations, and exact GitHub overwrite list.**
- [x] **Step 4: Run `npm test` and `npm run check`.**
- [x] **Step 5: Scan for stale `0.1.2`, legacy UI wording, duplicate-injection wording, and author metadata.**
- [x] **Step 6: Package `/mnt/data/Auto-prompt.zip` with root folder `Auto-prompt/`.**
- [x] **Step 7: Extract the ZIP to a clean temp directory and rerun `npm test` + `npm run check` there.**
