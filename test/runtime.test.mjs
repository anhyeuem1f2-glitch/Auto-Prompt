import test from 'node:test';
import assert from 'node:assert/strict';

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
