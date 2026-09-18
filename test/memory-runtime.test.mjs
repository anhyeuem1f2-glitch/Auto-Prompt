import test from 'node:test';
import assert from 'node:assert/strict';

import {
    processReceivedAssistantMessage,
    registerMemoryCaptureHook,
} from '../src/memory-runtime.js';
import { ensureMemorySettings, getOrCreateCardMemory } from '../src/memory-core.js';

const alice = { key: 'avatar:Alice.png', avatar: 'Alice.png', name: 'Alice' };

function makeSettings() {
    const settings = {};
    const memory = ensureMemorySettings(settings);
    memory.provider.baseUrl = 'https://example.com/v1';
    memory.provider.model = 'memory-model';
    return settings;
}

test('processReceivedAssistantMessage ignores user/system messages and disabled card memory', async () => {
    const settings = makeSettings();
    const context = { chat: [
        { is_user: true, mes: 'user' },
        { is_user: false, is_system: true, mes: 'system' },
        { is_user: false, mes: 'assistant' },
    ] };
    const request = async () => { throw new Error('must not call'); };

    assert.deepEqual(await processReceivedAssistantMessage({ context, settings, character: alice, messageId: 0, requestMemoryUpdate: request }), { processed: false, reason: 'not-assistant' });
    assert.deepEqual(await processReceivedAssistantMessage({ context, settings, character: alice, messageId: 1, requestMemoryUpdate: request }), { processed: false, reason: 'not-assistant' });
    assert.deepEqual(await processReceivedAssistantMessage({ context, settings, character: alice, messageId: 2, requestMemoryUpdate: request }), { processed: false, reason: 'memory-disabled' });
});

test('processReceivedAssistantMessage sends full existing log plus canonical narrative and appends returned event', async () => {
    const settings = makeSettings();
    const card = getOrCreateCardMemory(settings, alice);
    card.enabled = true;
    card.eventLog = 'Message ID: 4\nA distrusted User after X.';

    const context = {
        chat: [{
            is_user: false,
            is_system: false,
            mes: '<story_driver>A will forgive User.</story_driver><story_scene>A returned to the eastern gate and accepted the apology.</story_scene>',
        }],
        saveSettingsDebouncedCalls: 0,
        saveSettingsDebounced() { this.saveSettingsDebouncedCalls += 1; },
    };

    const seen = [];
    const result = await processReceivedAssistantMessage({
        context,
        settings,
        character: alice,
        messageId: 0,
        requestMemoryUpdate: async (provider, messages) => {
            seen.push({ provider: structuredClone(provider), messages: structuredClone(messages) });
            return '{"has_event":true,"event_text":"Message ID: 0\\nAt the eastern gate, A accepted the apology after returning there; this directly follows the distrust recorded at Message ID 4."}';
        },
        now: () => 1234,
    });

    assert.equal(result.processed, true);
    assert.equal(result.appended, true);
    assert.match(card.eventLog, /Message ID: 4/);
    assert.match(card.eventLog, /Message ID: 0/);
    assert.match(seen[0].messages[1].content, /COMPLETE EXISTING EVENT LOG/);
    assert.match(seen[0].messages[1].content, /A distrusted User after X/);
    assert.match(seen[0].messages[1].content, /A returned to the eastern gate and accepted the apology/);
    assert.doesNotMatch(seen[0].messages[1].content.split('=== CANONICAL NARRATIVE THAT ACTUALLY OCCURRED ===')[1].split('=== END CANONICAL NARRATIVE ===')[0], /A will forgive User/);
    assert.equal(card.updatedAt, 1234);
    assert.equal(context.saveSettingsDebouncedCalls, 1);
});

test('duplicate committed response signature is skipped without a second API call', async () => {
    const settings = makeSettings();
    const card = getOrCreateCardMemory(settings, alice);
    card.enabled = true;
    const context = {
        chat: [{ is_user: false, mes: '<story_scene>A sat down.</story_scene>' }],
        saveSettingsDebounced() {},
    };
    let calls = 0;
    const request = async () => {
        calls += 1;
        return '{"has_event":false,"event_text":""}';
    };

    await processReceivedAssistantMessage({ context, settings, character: alice, messageId: 0, requestMemoryUpdate: request });
    const second = await processReceivedAssistantMessage({ context, settings, character: alice, messageId: 0, requestMemoryUpdate: request });

    assert.equal(calls, 1);
    assert.deepEqual(second, { processed: false, reason: 'duplicate' });
});

test('memory request error leaves Event Log unchanged and reports isolated failure', async () => {
    const settings = makeSettings();
    const card = getOrCreateCardMemory(settings, alice);
    card.enabled = true;
    card.eventLog = 'OLD';
    const context = {
        chat: [{ is_user: false, mes: 'A walks away.' }],
        saveSettingsDebounced() {},
    };

    const result = await processReceivedAssistantMessage({
        context,
        settings,
        character: alice,
        messageId: 0,
        requestMemoryUpdate: async () => { throw new Error('network down'); },
    });

    assert.equal(result.processed, false);
    assert.equal(result.reason, 'error');
    assert.match(result.error.message, /network down/);
    assert.equal(card.eventLog, 'OLD');
});

test('registerMemoryCaptureHook listens to MESSAGE_RECEIVED and can be cleaned up', async () => {
    const handlers = new Map();
    const context = {
        event_types: { MESSAGE_RECEIVED: 'message_received' },
        eventSource: {
            on(type, handler) { handlers.set(type, handler); },
            removeListener(type, handler) { if (handlers.get(type) === handler) handlers.delete(type); },
        },
    };
    const seen = [];

    const cleanup = registerMemoryCaptureHook(
        context,
        () => ({ marker: 'settings' }),
        () => alice,
        async (payload) => { seen.push(payload); return { processed: true }; },
    );

    await handlers.get('message_received')(7);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].messageId, 7);
    assert.equal(seen[0].character.name, 'Alice');

    cleanup();
    assert.equal(handlers.has('message_received'), false);
});
