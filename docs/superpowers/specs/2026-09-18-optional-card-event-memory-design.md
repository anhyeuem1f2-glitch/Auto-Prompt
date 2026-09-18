# Optional Card Event Memory Design

## Goal

Extend Auto Prompt with an opt-in, card-scoped event log that is maintained by a separate OpenAI-compatible model and can optionally be injected in full into the same final system reminder used by Auto Prompt.

## Scope

This is deliberately not a general memory engine. It stores only a detailed append-only event log per card. It does not maintain relationship scores, knowledge graphs, vector retrieval, summaries, or automatic pruning.

## User model

Each card owns an independent Event Log. A card's memory is OFF by default. The user can enable automatic event recording for the current card and separately enable full Event Log injection for that card. Switching cards switches the visible log and the active memory state.

The Event Log textarea is directly editable by the user. The memory model may only append; it never rewrites or deletes previous log text. User edits remain authoritative.

## Memory AI provider

Provider configuration is global to the extension and OpenAI-compatible:

- Base URL
- API key
- Load Models button
- Model dropdown populated from the provider model endpoint
- Test Connection button

A local/no-key endpoint is allowed. The extension normalizes a Base URL ending in `/chat/completions` back to the API root, then uses `/models` and `/chat/completions`.

## Automatic recording flow

When SillyTavern emits `MESSAGE_RECEIVED`, the extension inspects the committed chat message. It processes only assistant/character messages and only when memory is enabled for the active card.

The Memory AI receives:

1. Card identity.
2. The entire current Event Log for that card.
3. The new assistant response.
4. A canonical narrative extract. `<story_scene>` and `<parallel_line>` content are preferred when present; planning/reasoning sections such as `<story_driver>` and `<think>` are not authoritative events.
5. Source message id.

The Memory AI must return JSON with `has_event` and `event_text`. `event_text` must describe events with concrete location, participants, lead-in, sequence of actions, method, outcome, situational/emotional context, aftermath, and relevant links to earlier logged events. It must not use vague shorthand such as only “kept a promise” or “defeated B”. It must not invent missing details.

If the response contains no new event worth preserving, `has_event` is false and the log is unchanged.

## Append-only behavior

Automatic writes only append a separated block to the current card Event Log. Existing Event Log text is never regenerated. The model cannot issue edits or deletes.

A processed-message signature prevents duplicate writes when the same committed response event is emitted repeatedly. If the same message id later has different content, it is eligible for a new append rather than silently overwriting history; the user can manually reconcile rejected swipes if desired.

## Prompt injection

When Event Log injection is enabled for the current card and the log is non-empty, the entire log is included in the final system message. Auto Prompt reminders and Event Log are combined into one aggregate system message so the existing no-duplicate final-stage behavior is preserved.

Memory recording and Event Log injection are independent toggles. Recording may remain on while injection is off.

## Failure behavior

Memory failures must never block the main SillyTavern response or modify chat history. API/configuration/parse errors are shown in the Memory status area and logged to the console. The Event Log remains unchanged on failure.

## Data model

The extension root schema moves to v3 while preserving v2 prompts.

`settings.memory` contains:

- `schemaVersion: 1`
- `provider: { baseUrl, apiKey, model, models }`
- `cards: Record<characterKey, CardMemory>`

Each `CardMemory` contains:

- `character`
- `enabled` (default false)
- `injectEnabled` (default false)
- `eventLog`
- `processedSignatures`
- `updatedAt`

## Non-goals

- No vector database or RAG.
- No selective retrieval; injection is the entire Event Log.
- No automatic compression/pruning.
- No relationship/affinity engine.
- No knowledge graph.
- No default event rules or bundled prompts.
