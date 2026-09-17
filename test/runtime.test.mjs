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

test('applyReminderInjection sends exact text as depth-0 system in-chat extension prompt', async () => {
    const context = createContext();
    const authored = 'Stay in character.\nUpdate the table.';
    const seen = [];

    const result = await applyReminderInjection(
        context,
        { enabled: true, promptText: authored },
        (info) => seen.push(info),
        () => 123456789,
    );

    assert.deepEqual(context.calls, [[
        PROMPT_KEY,
        authored,
        INJECTION_POSITION,
        INJECTION_DEPTH,
        false,
        INJECTION_ROLE,
    ]]);
    assert.deepEqual(result, { active: true, textLength: authored.length });
    assert.deepEqual(seen, [{ at: 123456789, textLength: authored.length }]);
});

test('applyReminderInjection actively clears a previous prompt when disabled', async () => {
    const context = createContext();
    const seen = [];

    const result = await applyReminderInjection(
        context,
        { enabled: false, promptText: 'old reminder' },
        (info) => seen.push(info),
    );

    assert.equal(context.calls.length, 1);
    assert.deepEqual(context.calls[0], [PROMPT_KEY, '', INJECTION_POSITION, INJECTION_DEPTH, false, INJECTION_ROLE]);
    assert.deepEqual(result, { active: false, textLength: 0 });
    assert.deepEqual(seen, []);
});

test('registerGenerationHook injects on every generation event', async () => {
    const context = createContext();
    let settings = { enabled: true, promptText: 'always inject this' };
    const seen = [];

    const cleanup = registerGenerationHook(
        context,
        () => settings,
        (info) => seen.push(info),
        () => 99,
    );

    const handler = context.handlers.get('generation_after_commands');
    assert.equal(typeof handler, 'function');

    await handler();
    settings = { enabled: true, promptText: 'new text next turn' };
    await handler();

    assert.equal(context.calls.length, 2);
    assert.equal(context.calls[0][1], 'always inject this');
    assert.equal(context.calls[1][1], 'new text next turn');
    assert.equal(seen.length, 2);

    cleanup();
    assert.equal(context.handlers.has('generation_after_commands'), false);
});

test('registerGenerationHook falls back to GENERATION_STARTED when needed', () => {
    const context = createContext();
    delete context.event_types.GENERATION_AFTER_COMMANDS;

    registerGenerationHook(context, () => ({ enabled: true, promptText: 'x' }), () => {});

    assert.equal(context.handlers.has('generation_started'), true);
});

test('finalizeReminderInChat moves the existing reminder to the final system message without duplication', () => {
    assert.equal(typeof runtime.finalizeReminderInChat, 'function');

    const reminder = 'FINAL REMINDER';
    const eventData = {
        chat: [
            { role: 'system', content: 'base system' },
            { role: 'system', content: reminder },
            { role: 'assistant', content: 'another late prompt' },
            { role: 'user', content: 'latest user turn' },
        ],
    };

    const result = runtime.finalizeReminderInChat(eventData, { enabled: true, promptText: reminder });

    assert.deepEqual(eventData.chat, [
        { role: 'system', content: 'base system' },
        { role: 'assistant', content: 'another late prompt' },
        { role: 'user', content: 'latest user turn' },
        { role: 'system', content: reminder },
    ]);
    assert.deepEqual(result, { active: true, textLength: reminder.length, movedExisting: true });
    assert.equal(eventData.chat.filter((message) => message.content === reminder).length, 1);
});

test('registerFinalPromptHook finalizes the reminder on CHAT_COMPLETION_PROMPT_READY and reports the final injection', async () => {
    assert.equal(typeof runtime.registerFinalPromptHook, 'function');

    const context = createContext();
    const reminder = 'FINAL STAGE REMINDER';
    const seen = [];

    const cleanup = runtime.registerFinalPromptHook(
        context,
        () => ({ enabled: true, promptText: reminder }),
        (info) => seen.push(info),
        () => 777,
    );

    const handler = context.handlers.get('chat_completion_prompt_ready');
    assert.equal(typeof handler, 'function');

    const eventData = {
        chat: [
            { role: 'system', content: reminder },
            { role: 'assistant', content: 'late prompt layer' },
        ],
    };

    await handler(eventData);

    assert.deepEqual(eventData.chat.at(-1), { role: 'system', content: reminder });
    assert.deepEqual(seen, [{ at: 777, textLength: reminder.length, finalStage: true, movedExisting: true }]);

    cleanup();
    assert.equal(context.handlers.has('chat_completion_prompt_ready'), false);
});

test('finalizeReminderInChat appends the reminder when the staged copy is missing', () => {
    const reminder = 'APPEND ME LAST';
    const eventData = {
        chat: [
            { role: 'system', content: 'base system' },
            { role: 'user', content: 'hello' },
        ],
    };

    const result = runtime.finalizeReminderInChat(eventData, { enabled: true, promptText: reminder });

    assert.deepEqual(eventData.chat.at(-1), { role: 'system', content: reminder });
    assert.deepEqual(result, { active: true, textLength: reminder.length, movedExisting: false });
});

test('finalizeReminderInChat leaves the final prompt untouched when reminder is disabled', () => {
    const eventData = {
        chat: [
            { role: 'system', content: 'base system' },
            { role: 'user', content: 'hello' },
        ],
    };
    const before = structuredClone(eventData.chat);

    const result = runtime.finalizeReminderInChat(eventData, { enabled: false, promptText: 'disabled' });

    assert.deepEqual(eventData.chat, before);
    assert.deepEqual(result, { active: false, textLength: 0, movedExisting: false });
});
