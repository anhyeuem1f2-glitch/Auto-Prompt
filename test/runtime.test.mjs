import test from 'node:test';
import assert from 'node:assert/strict';

import * as runtime from '../src/runtime.js';
import {
    applyReminderInjection,
    registerGenerationHook,
    PROMPT_KEY,
    INJECTION_POSITION,
    INJECTION_DEPTH,
    INJECTION_ROLE,
} from '../src/runtime.js';

function createContext() {
    const handlers = new Map();
    const calls = [];

    return {
        calls,
        handlers,
        setExtensionPrompt: async (...args) => {
            calls.push(args);
        },
        event_types: {
            GENERATION_AFTER_COMMANDS: 'generation_after_commands',
            GENERATION_STARTED: 'generation_started',
            CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready',
        },
        eventSource: {
            on(type, handler) {
                handlers.set(type, handler);
            },
            removeListener(type, handler) {
                if (handlers.get(type) === handler) handlers.delete(type);
            },
        },
    };
}

function p(id, content, order = 0, extra = {}) {
    return {
        id,
        name: id,
        enabled: true,
        scope: 'global',
        character: null,
        content,
        order,
        ...extra,
    };
}

function settings(prompts, enabled = true, memory = null) {
    return {
        enabled,
        schemaVersion: 3,
        prompts,
        memory: memory ?? {
            schemaVersion: 2,
            provider: { baseUrl: '', apiKey: '', model: '', models: [] },
            cards: {},
        },
    };
}

function memoryFor(character, eventLog, enabled = true, autoRelevantEnabled = true, fullInjectNext = false) {
    return {
        schemaVersion: 2,
        provider: { baseUrl: 'https://example.com/v1', apiKey: '', model: 'memory-model', models: [] },
        cards: {
            [character.key]: {
                character,
                enabled,
                autoRelevantEnabled,
                fullInjectNext,
                eventLog,
                eventIndex: [],
                processedMessageIds: {},
                processedSignatures: {},
                updatedAt: 0,
            },
        },
    };
}


test('applyReminderInjection always clears the legacy staged prompt', async () => {
    const context = createContext();

    const result = await applyReminderInjection(context, settings([p('a', 'A')]));

    assert.deepEqual(context.calls, [[
        PROMPT_KEY,
        '',
        INJECTION_POSITION,
        INJECTION_DEPTH,
        false,
        INJECTION_ROLE,
    ]]);
    assert.equal(result.staged, false);
});

test('registerGenerationHook clears the legacy staged slot on every generation event', async () => {
    const context = createContext();
    const cleanup = registerGenerationHook(context, () => settings([p('a', 'A')]));

    const handler = context.handlers.get('generation_after_commands');
    assert.equal(typeof handler, 'function');

    await handler();
    await handler();

    assert.equal(context.calls.length, 2);
    assert.equal(context.calls[0][1], '');
    assert.equal(context.calls[1][1], '');

    cleanup();
    assert.equal(context.handlers.has('generation_after_commands'), false);
});

test('registerGenerationHook falls back to GENERATION_STARTED when needed', () => {
    const context = createContext();
    delete context.event_types.GENERATION_AFTER_COMMANDS;

    registerGenerationHook(context, () => settings([]));

    assert.equal(context.handlers.has('generation_started'), true);
});

test('finalizeReminderInChat merges multiple active prompts into exactly one final system message', () => {
    const eventData = {
        chat: [
            { role: 'system', content: 'base system' },
            { role: 'user', content: 'latest user turn' },
        ],
    };
    const promptSettings = settings([
        p('second', 'SECOND', 20),
        p('first', 'FIRST', 10),
    ]);

    const result = runtime.finalizeReminderInChat(eventData, promptSettings, null);

    assert.deepEqual(eventData.chat, [
        { role: 'system', content: 'base system' },
        { role: 'user', content: 'latest user turn' },
        { role: 'system', content: 'FIRST\n\nSECOND' },
    ]);
    assert.deepEqual(result, {
        active: true,
        promptCount: 2,
        textLength: 'FIRST\n\nSECOND'.length,
        movedExisting: false,
    });
    assert.equal(eventData.chat.filter((message) => message.content === 'FIRST\n\nSECOND').length, 1);
});

test('finalizeReminderInChat moves an existing aggregate reminder to the end without duplication', () => {
    const merged = 'FIRST\n\nSECOND';
    const eventData = {
        chat: [
            { role: 'system', content: merged },
            { role: 'assistant', content: 'late layer' },
        ],
    };

    const result = runtime.finalizeReminderInChat(
        eventData,
        settings([p('first', 'FIRST', 0), p('second', 'SECOND', 1)]),
        null,
    );

    assert.deepEqual(eventData.chat, [
        { role: 'assistant', content: 'late layer' },
        { role: 'system', content: merged },
    ]);
    assert.equal(result.movedExisting, true);
    assert.equal(eventData.chat.filter((message) => message.content === merged).length, 1);
});

test('finalizeReminderInChat adds matching character prompt to globals', () => {
    const alice = { key: 'avatar:Alice.png', avatar: 'Alice.png', name: 'Alice' };
    const eventData = { chat: [{ role: 'user', content: 'hello' }] };

    const result = runtime.finalizeReminderInChat(
        eventData,
        settings([
            p('global', 'GLOBAL', 0),
            p('alice', 'ALICE', 1, { scope: 'character', character: alice }),
        ]),
        alice,
    );

    assert.deepEqual(eventData.chat.at(-1), { role: 'system', content: 'GLOBAL\n\nALICE' });
    assert.equal(result.promptCount, 2);
});

test('finalizeReminderInChat omits non-matching character prompt', () => {
    const alice = { key: 'avatar:Alice.png', avatar: 'Alice.png', name: 'Alice' };
    const bob = { key: 'avatar:Bob.png', avatar: 'Bob.png', name: 'Bob' };
    const eventData = { chat: [{ role: 'user', content: 'hello' }] };

    const result = runtime.finalizeReminderInChat(
        eventData,
        settings([
            p('global', 'GLOBAL', 0),
            p('alice', 'ALICE', 1, { scope: 'character', character: alice }),
        ]),
        bob,
    );

    assert.deepEqual(eventData.chat.at(-1), { role: 'system', content: 'GLOBAL' });
    assert.equal(result.promptCount, 1);
});

test('finalizeReminderInChat with no active card injects globals only', () => {
    const alice = { key: 'avatar:Alice.png', avatar: 'Alice.png', name: 'Alice' };
    const eventData = { chat: [{ role: 'user', content: 'hello' }] };

    const result = runtime.finalizeReminderInChat(
        eventData,
        settings([
            p('global', 'GLOBAL', 0),
            p('alice', 'ALICE', 1, { scope: 'character', character: alice }),
        ]),
        null,
    );

    assert.deepEqual(eventData.chat.at(-1), { role: 'system', content: 'GLOBAL' });
    assert.equal(result.promptCount, 1);
});



test('finalizeReminderInChat combines Auto Prompt reminders with selector-provided memory context', () => {
    const alice = { key: 'avatar:Alice.png', avatar: 'Alice.png', name: 'Alice' };
    const eventData = { chat: [{ role: 'user', content: 'hello' }] };
    const promptSettings = settings([p('global', 'REMINDER', 0)], true, memoryFor(alice, 'stored but not auto-dumped'));
    const memoryText = '<MEMORY_CONTEXT>Message ID 4: A met B at the eastern gate.</MEMORY_CONTEXT>';

    const result = runtime.finalizeReminderInChat(eventData, promptSettings, alice, memoryText);

    assert.equal(eventData.chat.filter((message) => message.role === 'system').length, 1);
    assert.match(eventData.chat.at(-1).content, /^REMINDER\n\n<MEMORY_CONTEXT>/);
    assert.match(eventData.chat.at(-1).content, /A met B at the eastern gate/);
    assert.doesNotMatch(eventData.chat.at(-1).content, /stored but not auto-dumped/);
    assert.equal(result.active, true);
    assert.equal(result.promptCount, 1);
    assert.equal(result.memoryTextLength, memoryText.length);
});

test('finalizeReminderInChat can inject selected memory alone when normal Auto Prompt is disabled', () => {
    const alice = { key: 'avatar:Alice.png', avatar: 'Alice.png', name: 'Alice' };
    const eventData = { chat: [{ role: 'user', content: 'hello' }] };
    const promptSettings = settings([p('global', 'DO NOT INJECT', 0)], false, memoryFor(alice, 'stored history'));
    const memoryText = '<MEMORY_CONTEXT>SELECTED HISTORY</MEMORY_CONTEXT>';

    const result = runtime.finalizeReminderInChat(eventData, promptSettings, alice, memoryText);

    assert.equal(result.active, true);
    assert.equal(result.promptCount, 0);
    assert.match(eventData.chat.at(-1).content, /SELECTED HISTORY/);
    assert.doesNotMatch(eventData.chat.at(-1).content, /DO NOT INJECT/);
});

test('finalizeReminderInChat never dumps stored card memory unless selector provides memory text', () => {
    const alice = { key: 'avatar:Alice.png', avatar: 'Alice.png', name: 'Alice' };
    const eventData = { chat: [{ role: 'user', content: 'hello' }] };
    const promptSettings = settings([p('global', 'REMINDER', 0)], true, memoryFor(alice, 'HIDDEN HISTORY'));

    runtime.finalizeReminderInChat(eventData, promptSettings, alice, '');
    assert.equal(eventData.chat.at(-1).content, 'REMINDER');
});

test('finalizeReminderInChat leaves final prompt untouched when extension is disabled', () => {
    const eventData = {
        chat: [
            { role: 'system', content: 'base system' },
            { role: 'user', content: 'hello' },
        ],
    };
    const before = structuredClone(eventData.chat);

    const result = runtime.finalizeReminderInChat(eventData, settings([p('a', 'A')], false), null);

    assert.deepEqual(eventData.chat, before);
    assert.deepEqual(result, { active: false, promptCount: 0, textLength: 0, movedExisting: false });
});

test('registerFinalPromptHook asks memory selector from current prompt and reports selected memory', async () => {
    const context = createContext();
    const alice = { key: 'avatar:Alice.png', avatar: 'Alice.png', name: 'Alice' };
    const seen = [];
    const selectorCalls = [];
    const promptSettings = settings([
        p('global', 'GLOBAL', 0),
        p('alice', 'ALICE', 1, { scope: 'character', character: alice }),
    ], true, memoryFor(alice, 'stored history'));

    const cleanup = runtime.registerFinalPromptHook(
        context,
        () => promptSettings,
        () => alice,
        async (payload) => {
            selectorCalls.push(payload);
            return {
                mode: 'relevant',
                text: '<MEMORY_CONTEXT>Message ID 19: relevant history</MEMORY_CONTEXT>',
                relevantIds: ['19'],
                totalEvents: 3,
                reason: 'promise chain',
                consumeFullNext: false,
            };
        },
        (info) => seen.push(info),
        () => 777,
    );

    const handler = context.handlers.get('chat_completion_prompt_ready');
    const eventData = {
        chat: [
            { role: 'assistant', content: 'A is waiting at the gate.' },
            { role: 'user', content: 'Tôi hỏi A về lời hứa cũ.' },
        ],
    };
    await handler(eventData);

    assert.equal(selectorCalls.length, 1);
    assert.equal(selectorCalls[0].userPrompt, 'Tôi hỏi A về lời hứa cũ.');
    assert.equal(selectorCalls[0].recentAssistant, 'A is waiting at the gate.');
    assert.match(eventData.chat.at(-1).content, /GLOBAL\n\nALICE\n\n<MEMORY_CONTEXT>/);
    assert.deepEqual(seen, [{
        at: 777,
        promptCount: 2,
        textLength: eventData.chat.at(-1).content.length,
        memoryTextLength: '<MEMORY_CONTEXT>Message ID 19: relevant history</MEMORY_CONTEXT>'.length,
        memoryMode: 'relevant',
        memoryRelevantIds: ['19'],
        memoryTotalEvents: 3,
        finalStage: true,
        movedExisting: false,
    }]);

    cleanup();
    assert.equal(context.handlers.has('chat_completion_prompt_ready'), false);
});

test('registerFinalPromptHook consumes one-shot full-memory flag only after it is injected', async () => {
    const context = createContext();
    const alice = { key: 'avatar:Alice.png', avatar: 'Alice.png', name: 'Alice' };
    const promptSettings = settings([], false, memoryFor(alice, 'Message ID 4: FULL', true, false, true));

    runtime.registerFinalPromptHook(
        context,
        () => promptSettings,
        () => alice,
        async () => ({
            mode: 'full', text: '<MEMORY_CONTEXT>FULL</MEMORY_CONTEXT>', relevantIds: ['4'], totalEvents: 1, consumeFullNext: true,
        }),
    );

    await context.handlers.get('chat_completion_prompt_ready')({ chat: [{ role: 'user', content: 'refresh memory' }] });

    assert.equal(promptSettings.memory.cards[alice.key].fullInjectNext, false);
});

