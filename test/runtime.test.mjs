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

function settings(prompts, enabled = true) {
    return { enabled, schemaVersion: 2, prompts };
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

test('registerFinalPromptHook resolves character each generation and reports prompt count', async () => {
    const context = createContext();
    const alice = { key: 'avatar:Alice.png', avatar: 'Alice.png', name: 'Alice' };
    const seen = [];
    let activeCharacter = alice;

    const cleanup = runtime.registerFinalPromptHook(
        context,
        () => settings([
            p('global', 'GLOBAL', 0),
            p('alice', 'ALICE', 1, { scope: 'character', character: alice }),
        ]),
        () => activeCharacter,
        (info) => seen.push(info),
        () => 777,
    );

    const handler = context.handlers.get('chat_completion_prompt_ready');
    assert.equal(typeof handler, 'function');

    const first = { chat: [{ role: 'user', content: 'first' }] };
    await handler(first);
    assert.equal(first.chat.at(-1).content, 'GLOBAL\n\nALICE');

    activeCharacter = null;
    const second = { chat: [{ role: 'user', content: 'second' }] };
    await handler(second);
    assert.equal(second.chat.at(-1).content, 'GLOBAL');

    assert.deepEqual(seen, [
        { at: 777, promptCount: 2, textLength: 'GLOBAL\n\nALICE'.length, finalStage: true, movedExisting: false },
        { at: 777, promptCount: 1, textLength: 'GLOBAL'.length, finalStage: true, movedExisting: false },
    ]);

    cleanup();
    assert.equal(context.handlers.has('chat_completion_prompt_ready'), false);
});
