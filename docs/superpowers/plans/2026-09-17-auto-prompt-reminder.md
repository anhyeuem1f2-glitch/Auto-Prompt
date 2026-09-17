# ST Auto Prompt Reminder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build a minimal SillyTavern extension that autosaves one reminder textarea and injects its exact content into every generation.

**Architecture:** Use `SillyTavern.getContext()` as the host API boundary. Keep pure settings and injection logic in testable ES modules, while `index.js` only initializes settings, UI, autosave, lifecycle hooks, and status display.

**Tech Stack:** Browser ES modules, SillyTavern extension API, HTML/CSS, Node.js built-in test runner.

**Spec:** `docs/superpowers/specs/2026-09-17-auto-prompt-reminder-design.md`

## Global Constraints
- V1 has exactly one reminder textarea and one enabled toggle.
- Every real generation receives the reminder when enabled and non-empty.
- Reminder text is injected exactly as written; no wrapper is added.
- Injection is in-chat depth 0 with system role.
- Runtime has no npm dependencies and no build step.

---

### Task 1: Pure settings and injection behavior

**Files:**
- Create: `src/reminder-core.js`
- Create: `src/runtime.js`
- Test: `test/reminder-core.test.mjs`
- Test: `test/runtime.test.mjs`

**Interfaces:**
- Produces: `ensureSettings(extensionSettings)`, `getReminderText(settings)`, `applyReminderInjection(context, settings, onInjected)`, `registerGenerationHook(context, settingsProvider, onInjected)`.

- [x] Write failing tests for settings defaults, exact text preservation, empty clearing, injection arguments, and repeated generation hooks.
- [x] Run `node --test` and confirm failures are caused by missing modules/functions.
- [x] Implement the smallest pure modules that satisfy the tests.
- [x] Run `node --test` and confirm all tests pass.

### Task 2: SillyTavern entry point and settings UI

**Files:**
- Create: `index.js`
- Create: `style.css`
- Create: `manifest.json`
- Create: `package.json`

**Interfaces:**
- Consumes: Task 1 modules and `SillyTavern.getContext()`.
- Produces: extension initialization on `APP_READY`, one textarea, one toggle, autosave, live injection refresh, and latest-injection status.

- [x] Add a source-contract test that checks the manifest and entry point wiring before implementation.
- [x] Run `node --test` and confirm it fails before runtime files exist.
- [x] Implement manifest, entry point, and CSS without external dependencies.
- [x] Run `node --test` and syntax checks.

### Task 3: Release documentation and packaging

**Files:**
- Create: `README.md`
- Create: `BAN_GIAO_DU_AN.md`
- Create: `LICENSE`
- Create: `.gitignore`

**Interfaces:**
- Produces: install/test instructions, manual Prompt Inspector verification steps, release handoff, and GitHub-ready repository contents.

- [x] Document Git URL/manual installation and the unique-marker verification procedure.
- [x] Record v0.1.0 scope, tests, known limitations, and exact GitHub upload list in `BAN_GIAO_DU_AN.md`.
- [x] Run the full automated verification suite.
- [x] Package the repository as `st-auto-prompt-reminder-v0.1.0.zip` excluding `.git`.
