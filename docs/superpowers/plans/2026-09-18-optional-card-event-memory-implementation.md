# Optional Card Event Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in, per-card append-only event memory maintained by a separate OpenAI-compatible model and optionally injected in full into the final system prompt.

**Architecture:** Keep the existing prompt manager and final-stage injection intact. Add focused `memory-core`, `memory-api`, and `memory-runtime` modules; the entry point only owns UI/wiring. The final runtime combines normal reminders and an optional current-card Event Log into exactly one final system message.

**Tech Stack:** Browser JavaScript ES modules, SillyTavern extension APIs/events, Fetch API, Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-09-18-optional-card-event-memory-design.md`

## Global Constraints

- Card memory is OFF by default.
- Automatic memory writes are append-only; only the user may edit/delete existing Event Log text.
- Memory AI runs after every committed assistant response when enabled for that card.
- The full Event Log is injected when injection is enabled; no RAG or selective retrieval.
- Existing Auto Prompt final-stage injection must remain one final system message with no duplicates.
- Memory failures must not alter chat history or block the main response.

---

### Task 1: Memory data model and narrative extraction

**Files:**
- Create: `src/memory-core.js`
- Modify: `src/reminder-core.js`
- Test: `test/memory-core.test.mjs`
- Test: `test/reminder-core.test.mjs`

**Interfaces:**
- Produces: `ensureMemorySettings`, `getOrCreateCardMemory`, `getCardMemory`, `getMemoryInjectionText`, `extractCanonicalNarrative`, `buildMemoryMessages`, `parseMemoryModelResponse`, `appendEventText`, `createMessageSignature`.

- [ ] Write tests proving v2→v3 migration preserves prompts and memory defaults to OFF.
- [ ] Run the tests and confirm they fail before implementation.
- [ ] Implement memory schema, per-card storage, canonical narrative extraction, JSON response parsing, signatures, and append-only text handling.
- [ ] Run core tests and confirm they pass.

### Task 2: OpenAI-compatible Memory API client

**Files:**
- Create: `src/memory-api.js`
- Test: `test/memory-api.test.mjs`

**Interfaces:**
- Produces: `normalizeApiBaseUrl`, `loadProviderModels`, `testProviderConnection`, `requestMemoryUpdate`.

- [ ] Write mocked-fetch tests for URL normalization, model listing, auth/no-auth, chat completion requests, and API error propagation.
- [ ] Run the tests and confirm they fail before implementation.
- [ ] Implement the minimal fetch client.
- [ ] Run API tests and confirm they pass.

### Task 3: Automatic post-response memory recording

**Files:**
- Create: `src/memory-runtime.js`
- Test: `test/memory-runtime.test.mjs`

**Interfaces:**
- Consumes: memory-core and memory-api functions.
- Produces: `processReceivedAssistantMessage`, `registerMemoryCaptureHook`.

- [ ] Write tests for assistant-only processing, per-card opt-in, duplicate-signature suppression, detailed model request wiring, successful append, and error isolation.
- [ ] Run the tests and confirm they fail before implementation.
- [ ] Implement the `MESSAGE_RECEIVED` hook and processor.
- [ ] Run runtime tests and confirm they pass.

### Task 4: One final aggregate system message

**Files:**
- Modify: `src/runtime.js`
- Test: `test/runtime.test.mjs`

**Interfaces:**
- Consumes: normal reminder merge plus `getMemoryInjectionText`.
- Produces: unchanged public final-hook API with aggregate counts plus memory metadata.

- [ ] Add failing tests for reminder+memory, memory-only, disabled memory, and duplicate aggregate relocation.
- [ ] Run the tests and confirm they fail before implementation.
- [ ] Extend final-stage aggregation without adding a second system message.
- [ ] Run runtime tests and confirm they pass.

### Task 5: Memory UI and wiring

**Files:**
- Modify: `index.js`
- Modify: `style.css`
- Modify: `test/extension-contract.test.mjs`

**Interfaces:**
- UI controls: card memory enabled, inject full log, Event Log editor, Base URL, API key, Load Models, model select, Test Connection, Memory status.

- [ ] Add contract tests for all controls, model loading, MESSAGE_RECEIVED registration, and v0.3.0 version markers.
- [ ] Run the contract tests and confirm they fail before implementation.
- [ ] Implement UI, provider actions, manual Event Log editing, and hook registration/cleanup.
- [ ] Run contract tests and syntax checks.

### Task 6: Release docs and clean-package verification

**Files:**
- Modify: `manifest.json`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `BAN_GIAO_DU_AN.md`

**Interfaces:**
- Produces: release v0.3.0 package with top-level `Auto-prompt/`.

- [ ] Document optional memory behavior, provider setup, full-log injection, limitations, and troubleshooting.
- [ ] Bump versions to 0.3.0.
- [ ] Run `npm test` and `npm run check` on source.
- [ ] Package `Auto-prompt.zip`, extract into a clean directory, then rerun `npm test` and `npm run check` on the extracted package.
