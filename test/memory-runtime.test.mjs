import test from 'node:test';
import assert from 'node:assert/strict';

import {
    processReceivedAssistantMessage,
    registerMemoryCaptureHook,
    reconcileCurrentMemory,
    registerMemoryReconcileHooks,
    recallFailedMemoryMessages,
    retryFailedMemorySelector,
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

test('memory request error leaves Event Log unchanged after retry exhaustion', async () => {
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
        wait: async () => {},
    });

    assert.equal(result.processed, false);
    assert.equal(result.reason, 'retry-exhausted');
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


test('Memory recorder retries five times with 20 second gaps before succeeding', async () => {
    const settings = makeSettings();
    const card = getOrCreateCardMemory(settings, alice);
    card.enabled = true;
    const context = {
        chat: [{ is_user: false, mes: '<story_scene>A reached the station.</story_scene>' }],
        saveSettingsDebounced() {},
    };
    const waits = [];
    const retryEvents = [];
    let calls = 0;

    const result = await processReceivedAssistantMessage({
        context,
        settings,
        character: alice,
        messageId: 0,
        requestMemoryUpdate: async () => {
            calls += 1;
            if (calls < 6) throw new Error(`temporary failure ${calls}`);
            return '{"has_event":false,"event_text":""}';
        },
        wait: async (ms) => { waits.push(ms); },
        onRetry: (info) => retryEvents.push(info),
    });

    assert.equal(result.processed, true);
    assert.equal(calls, 6);
    assert.deepEqual(waits, [20000, 20000, 20000, 20000, 20000]);
    assert.equal(retryEvents.length, 5);
    assert.deepEqual(retryEvents.map((item) => item.retryNumber), [1, 2, 3, 4, 5]);
    assert.equal(retryEvents.every((item) => item.retryDelayMs === 20000), true);
    assert.deepEqual(card.failedMessages, {});
});

test('Memory recorder persists failed message after initial call plus five retries', async () => {
    const settings = makeSettings();
    const card = getOrCreateCardMemory(settings, alice);
    card.enabled = true;
    const context = {
        chat: [{ is_user: false, mes: '<story_scene>A reached the station.</story_scene>' }],
        saveSettingsDebouncedCalls: 0,
        saveSettingsDebounced() { this.saveSettingsDebouncedCalls += 1; },
    };
    let calls = 0;

    const result = await processReceivedAssistantMessage({
        context,
        settings,
        character: alice,
        messageId: 0,
        requestMemoryUpdate: async () => { calls += 1; throw new Error('network down'); },
        wait: async () => {},
        now: () => 9876,
    });

    assert.equal(calls, 6);
    assert.equal(result.processed, false);
    assert.equal(result.reason, 'retry-exhausted');
    assert.equal(result.attempts, 6);
    assert.deepEqual(card.failedMessages['0'], {
        messageId: '0',
        attempts: 6,
        lastError: 'network down',
        failedAt: 9876,
        messageText: '<story_scene>A reached the station.</story_scene>',
        sourceSignature: '0:8d8ac28a',
    });
    assert.equal(card.processedMessageIds['0'], undefined);
    assert.equal(context.saveSettingsDebouncedCalls, 1);
});

test('successful processing clears an existing failed queue entry for the same Message ID', async () => {
    const settings = makeSettings();
    const card = getOrCreateCardMemory(settings, alice);
    card.enabled = true;
    card.failedMessages['0'] = { messageId: '0', attempts: 6, lastError: 'old error', failedAt: 1 };
    const context = {
        chat: [{ is_user: false, mes: '<story_scene>A reached the station.</story_scene>' }],
        saveSettingsDebounced() {},
    };

    const result = await processReceivedAssistantMessage({
        context,
        settings,
        character: alice,
        messageId: 0,
        requestMemoryUpdate: async () => '{"has_event":false,"event_text":""}',
    });

    assert.equal(result.processed, true);
    assert.equal(card.failedMessages['0'], undefined);
});

test('recallFailedMemoryMessages recalls every queued Message ID and reports remaining failures', async () => {
    const settings = makeSettings();
    const card = getOrCreateCardMemory(settings, alice);
    card.enabled = true;
    card.failedMessages = {
        '4': { messageId: '4', attempts: 6, lastError: 'x', failedAt: 1, messageText: 'saved 4' },
        '9': { messageId: '9', attempts: 6, lastError: 'y', failedAt: 2, messageText: 'saved 9' },
    };
    const context = { chat: [] };
    const seen = [];

    const result = await recallFailedMemoryMessages({
        context,
        settings,
        character: alice,
        processor: async ({ messageId, messageOverride }) => {
            seen.push(`${messageId}:${messageOverride}`);
            if (String(messageId) === '4') {
                delete card.failedMessages['4'];
                return { processed: true };
            }
            return { processed: false, reason: 'retry-exhausted' };
        },
    });

    assert.deepEqual(seen, ['4:saved 4', '9:saved 9']);
    assert.equal(result.total, 2);
    assert.equal(result.recovered, 1);
    assert.deepEqual(result.remainingIds, ['9']);
});

test('registerMemoryCaptureHook forwards retry progress to the UI callback', async () => {
    const handlers = new Map();
    const context = {
        event_types: { MESSAGE_RECEIVED: 'message_received' },
        eventSource: {
            on(type, handler) { handlers.set(type, handler); },
            removeListener(type, handler) { if (handlers.get(type) === handler) handlers.delete(type); },
        },
    };
    const progress = [];

    registerMemoryCaptureHook(
        context,
        () => ({ marker: 'settings' }),
        () => alice,
        async (payload) => {
            payload.onRetry({ messageId: '7', retryNumber: 2, maxRetries: 5, retryDelayMs: 20000, error: new Error('x') });
            return { processed: false, reason: 'retry-exhausted' };
        },
        () => {},
        (info, payload) => progress.push({ info, payload }),
    );

    await handlers.get('message_received')(7);
    assert.equal(progress.length, 1);
    assert.equal(progress[0].info.retryNumber, 2);
    assert.equal(progress[0].payload.messageId, 7);
});


test('processReceivedAssistantMessage writes a block tagged with the active chat id', async () => {
    const settings = makeSettings();
    const identity = { ...alice, chatId: 'chat-A' };
    const card = getOrCreateCardMemory(settings, identity);
    card.enabled = true;
    const response = '<story_scene>A arrived at Saffron City.</story_scene>';
    const context = {
        chat: [{ is_user: false, is_system: false, mes: response }],
        saveSettingsDebounced() {},
    };

    const result = await processReceivedAssistantMessage({
        context,
        settings,
        character: identity,
        messageId: 0,
        requestMemoryUpdate: async () => JSON.stringify({
            has_event: true,
            event_text: 'A arrived at Saffron City.',
            index: { summary: 'arrival', actors: ['A'], locations: ['Saffron City'], topics: ['travel'], entities: [], related_ids: [] },
        }),
    });

    assert.equal(result.processed, true);
    assert.match(card.eventLog, /<MEMORY_EVENT chat_id="chat-A" message_id="0" source_signature="0:[0-9a-f]{8}">/);
    assert.match(card.eventLog, /A arrived at Saffron City/);
});

test('reconcileCurrentMemory uses the current chat and removes invalidated Event Log entries', () => {
    const settings = makeSettings();
    const identity = { ...alice, chatId: 'chat-A' };
    const card = getOrCreateCardMemory(settings, identity);
    card.eventLog = '<MEMORY_EVENT chat_id="chat-A" message_id="1" source_signature="1:00000000">\nOld event.\n</MEMORY_EVENT>';
    card.eventIndex = [{ messageId: '1', summary: 'old', actors: [], locations: [], topics: [], entities: [], relatedIds: [] }];
    card.processedMessageIds = { '1': true };
    card.processedSignatures = { '1': '1:00000000' };
    let saves = 0;
    const context = {
        chat: [{ is_user: true, mes: 'hello' }],
        saveSettingsDebounced() { saves += 1; },
    };

    const result = reconcileCurrentMemory({ context, settings, character: identity });
    assert.equal(result.changed, true);
    assert.equal(card.eventLog, '');
    assert.equal(saves, 1);
});

test('registerMemoryReconcileHooks reconciles on chat changes, deletes, and swipes', async () => {
    const handlers = new Map();
    const context = {
        event_types: {
            CHAT_CHANGED: 'chat_changed',
            MESSAGE_DELETED: 'message_deleted',
            MESSAGE_SWIPED: 'message_swiped',
        },
        eventSource: {
            on(type, handler) { handlers.set(type, handler); },
            removeListener(type, handler) { if (handlers.get(type) === handler) handlers.delete(type); },
        },
        chat: [],
        saveSettingsDebounced() {},
    };
    const seen = [];

    const cleanup = registerMemoryReconcileHooks(
        context,
        () => ({ marker: 'settings' }),
        () => ({ ...alice, chatId: 'chat-A' }),
        (payload) => { seen.push(payload.reason); return { changed: false }; },
    );

    await handlers.get('chat_changed')();
    await handlers.get('message_deleted')();
    await handlers.get('message_swiped')();
    assert.deepEqual(seen, ['chat-changed', 'message-deleted', 'message-swiped']);

    cleanup();
    assert.equal(handlers.size, 0);
});


test('Memory selector retries five times with 20 second gaps before succeeding', async () => {
    const settings = makeSettings();
    const card = getOrCreateCardMemory(settings, alice);
    card.autoRelevantEnabled = true;
    card.eventLog = 'Message ID 4: A met B.';
    card.eventIndex = [{ messageId: '4', summary: 'A met B.', actors: ['A'], locations: [], topics: ['meeting'], entities: [], relatedIds: [] }];
    const waits = [];
    const progress = [];
    let calls = 0;
    const result = await selectRelevantMemoryForPrompt({
        settings,
        character: alice,
        userPrompt: 'Nhắc lại lúc A gặp B.',
        requestMemorySelection: async () => {
            calls += 1;
            if (calls < 6) throw new Error('503 busy');
            return '{"relevant_ids":["4"],"reason":"meeting"}';
        },
        wait: async (ms) => waits.push(ms),
        onRetry: (info) => progress.push(info),
    });
    assert.equal(calls, 6);
    assert.deepEqual(waits, [20000, 20000, 20000, 20000, 20000]);
    assert.equal(progress.length, 5);
    assert.equal(result.mode, 'relevant');
    assert.equal(card.failedSelector, null);
});

test('Memory selector persists a failed selector payload after retry exhaustion', async () => {
    const settings = makeSettings();
    const card = getOrCreateCardMemory(settings, alice);
    card.autoRelevantEnabled = true;
    card.eventLog = 'Message ID 4: A met B.';
    card.eventIndex = [{ messageId: '4', summary: 'A met B.', actors: ['A'], locations: [], topics: ['meeting'], entities: [], relatedIds: [] }];
    let saves = 0;
    const result = await selectRelevantMemoryForPrompt({
        settings,
        character: alice,
        userPrompt: 'Nhắc lại lúc A gặp B.',
        recentAssistant: 'A đang đứng ngoài cổng.',
        requestMemorySelection: async () => { throw new Error('503 busy'); },
        wait: async () => {},
        now: () => 777,
        context: { chat: [], saveSettingsDebounced() { saves += 1; } },
    });
    assert.equal(result.reason, 'error');
    assert.equal(card.failedSelector.userPrompt, 'Nhắc lại lúc A gặp B.');
    assert.equal(card.failedSelector.recentAssistant, 'A đang đứng ngoài cổng.');
    assert.equal(card.failedSelector.attempts, 6);
    assert.equal(card.failedSelector.failedAt, 777);
    assert.match(card.failedSelector.lastError, /503 busy/);
    assert.ok(saves >= 1);
});

test('manual selector retry clears failure and caches selection for Regenerate with the same prompt', async () => {
    const settings = makeSettings();
    const card = getOrCreateCardMemory(settings, alice);
    card.autoRelevantEnabled = true;
    card.eventLog = 'Message ID 4: A met B.';
    card.eventIndex = [{ messageId: '4', summary: 'A met B.', actors: ['A'], locations: [], topics: ['meeting'], entities: [], relatedIds: [] }];
    card.failedSelector = { userPrompt: 'Nhắc lại lúc A gặp B.', recentAssistant: 'A waits.', attempts: 6, lastError: '503', failedAt: 1 };
    const context = { chat: [], saveSettingsDebounced() {} };
    const retry = await retryFailedMemorySelector({
        settings,
        character: alice,
        context,
        requestMemorySelection: async () => '{"relevant_ids":["4"],"reason":"meeting"}',
        now: () => 888,
    });
    assert.equal(retry.success, true);
    assert.deepEqual(retry.relevantIds, ['4']);
    assert.equal(card.failedSelector, null);
    assert.equal(card.pendingSelector.userPrompt, 'Nhắc lại lúc A gặp B.');

    let calls = 0;
    const selected = await selectRelevantMemoryForPrompt({
        settings,
        character: alice,
        userPrompt: 'Nhắc lại lúc A gặp B.',
        recentAssistant: 'A waits.',
        requestMemorySelection: async () => { calls += 1; throw new Error('must not call'); },
    });
    assert.equal(calls, 0);
    assert.equal(selected.mode, 'relevant');
    assert.deepEqual(selected.relevantIds, ['4']);
    assert.equal(card.pendingSelector, null);
});
