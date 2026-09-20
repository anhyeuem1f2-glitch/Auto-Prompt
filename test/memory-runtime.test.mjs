import test from 'node:test';
import assert from 'node:assert/strict';

import {
    processReceivedAssistantMessage,
    registerMemoryCaptureHook,
    selectRelevantMemoryForPrompt,
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
            return '{"has_event":true,"event_text":"Message ID: 0\\nAt the eastern gate, A accepted the apology after returning there; this directly follows the distrust recorded at Message ID 4.","index":{"summary":"A accepted the apology at the eastern gate.","actors":["A"],"locations":["eastern gate"],"topics":["apology","trust"],"entities":[],"related_ids":["4"]}}';
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
    assert.equal(card.eventIndex.at(-1).messageId, '0');
    assert.deepEqual(card.eventIndex.at(-1).relatedIds, ['4']);
    assert.equal(context.saveSettingsDebouncedCalls, 1);
});

test('same Message ID is skipped even if MESSAGE_RECEIVED fires again with changed content', async () => {
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
    context.chat[0].mes = '<story_scene>A sat down and then stood up.</story_scene>';
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


test('selectRelevantMemoryForPrompt calls selector with hidden index and injects only selected full events', async () => {
    const settings = makeSettings();
    const card = getOrCreateCardMemory(settings, alice);
    card.autoRelevantEnabled = true;
    card.eventLog = [
        'Message ID 4: A began distrusting User at the eastern gate after X.',
        'Message ID 19: User fulfilled the promise to A at the same gate, partially restoring trust.',
        'Message ID 30: B bought lunch in another city.',
    ].join('\n\n');
    card.eventIndex = [
        { messageId: '4', summary: 'A began distrusting User.', actors: ['A', 'User'], locations: ['eastern gate'], topics: ['trust'], entities: [], relatedIds: [] },
        { messageId: '19', summary: 'User fulfilled the promise to A.', actors: ['A', 'User'], locations: ['eastern gate'], topics: ['promise', 'trust'], entities: [], relatedIds: ['4'] },
        { messageId: '30', summary: 'B bought lunch.', actors: ['B'], locations: ['other city'], topics: ['food'], entities: [], relatedIds: [] },
    ];

    const seen = [];
    const result = await selectRelevantMemoryForPrompt({
        settings,
        character: alice,
        userPrompt: 'Tôi hỏi A bây giờ cô ấy nghĩ gì về tôi.',
        recentAssistant: 'A đang đứng trước cổng thành.',
        requestMemorySelection: async (provider, messages) => {
            seen.push(messages);
            return '{"relevant_ids":["4","19"],"reason":"relationship chain"}';
        },
    });

    assert.equal(result.mode, 'relevant');
    assert.deepEqual(result.relevantIds, ['4', '19']);
    assert.equal(result.totalEvents, 3);
    assert.match(result.text, /Message ID 4/);
    assert.match(result.text, /Message ID 19/);
    assert.doesNotMatch(result.text, /Message ID 30/);
    assert.match(result.text, /MEMORY_CONTEXT/);
    assert.doesNotMatch(seen[0][1].content, /B bought lunch in another city/);
    assert.match(seen[0][1].content, /summary=B bought lunch/);
});

test('selectRelevantMemoryForPrompt returns no injection when selector finds no relevant events', async () => {
    const settings = makeSettings();
    const card = getOrCreateCardMemory(settings, alice);
    card.autoRelevantEnabled = true;
    card.eventLog = 'Message ID 4: A met B at the gate.';
    card.eventIndex = [{ messageId: '4', summary: 'A met B.', actors: ['A', 'B'], locations: ['gate'], topics: ['meeting'], entities: [], relatedIds: [] }];

    const result = await selectRelevantMemoryForPrompt({
        settings,
        character: alice,
        userPrompt: 'Tôi nhìn thời tiết hôm nay.',
        requestMemorySelection: async () => '{"relevant_ids":[],"reason":"unrelated"}',
    });

    assert.equal(result.mode, 'none');
    assert.equal(result.text, '');
    assert.deepEqual(result.relevantIds, []);
});

test('one-shot full-memory override bypasses selector and returns complete Event Log', async () => {
    const settings = makeSettings();
    const card = getOrCreateCardMemory(settings, alice);
    card.fullInjectNext = true;
    card.eventLog = 'Message ID 4: EVENT A\n\nMessage ID 19: EVENT B';
    card.eventIndex = [
        { messageId: '4', summary: 'A', actors: [], locations: [], topics: [], entities: [], relatedIds: [] },
        { messageId: '19', summary: 'B', actors: [], locations: [], topics: [], entities: [], relatedIds: [] },
    ];

    let calls = 0;
    const result = await selectRelevantMemoryForPrompt({
        settings,
        character: alice,
        userPrompt: 'anything',
        requestMemorySelection: async () => { calls += 1; return '{}'; },
    });

    assert.equal(calls, 0);
    assert.equal(result.mode, 'full');
    assert.equal(result.consumeFullNext, true);
    assert.match(result.text, /EVENT A/);
    assert.match(result.text, /EVENT B/);
});
