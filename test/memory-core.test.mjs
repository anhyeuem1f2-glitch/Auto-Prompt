import test from 'node:test';
import assert from 'node:assert/strict';

import {
    MEMORY_SCHEMA_VERSION,
    ensureMemorySettings,
    getOrCreateCardMemory,
    getCardMemory,
    getMemoryInjectionText,
    buildSelectorMessages,
    parseMemorySelectionResponse,
    selectEventTextByIds,
    buildMemoryContextText,
    upsertEventIndexEntry,
    extractCanonicalNarrative,
    buildMemoryMessages,
    parseMemoryModelResponse,
    appendEventText,
    createMessageSignature,
    toggleFullInjectNext,
    formatMemoryEventBlock,
    parseMemoryEventBlocks,
    reconcileMemoryWithChat,
} from '../src/memory-core.js';

const alice = { key: 'avatar:Alice.png', avatar: 'Alice.png', name: 'Alice' };

test('ensureMemorySettings creates optional memory defaults with recording off', () => {
    const root = {};
    const memory = ensureMemorySettings(root);

    assert.equal(MEMORY_SCHEMA_VERSION, 4);
    assert.strictEqual(memory, root.memory);
    assert.deepEqual(memory, {
        schemaVersion: 4,
        provider: {
            baseUrl: '',
            apiKey: '',
            model: '',
            models: [],
        },
        cards: {},
    });
});

test('getOrCreateCardMemory creates card-scoped memory disabled by default', () => {
    const root = {};
    ensureMemorySettings(root);

    const card = getOrCreateCardMemory(root, alice);

    assert.deepEqual(card, {
        character: alice,
        enabled: false,
        autoRelevantEnabled: false,
        fullInjectNext: false,
        eventLog: '',
        eventIndex: [],
        processedMessageIds: {},
        processedSignatures: {},
        failedMessages: {},
        updatedAt: 0,
    });
    assert.strictEqual(getCardMemory(root, alice), card);
});

test('getMemoryInjectionText only returns full log for one-shot full injection', () => {
    const root = {};
    ensureMemorySettings(root);
    const card = getOrCreateCardMemory(root, alice);
    card.eventLog = 'Message ID 1: EVENT A\n\nMessage ID 2: EVENT B';

    assert.equal(getMemoryInjectionText(root, alice), '');

    card.autoRelevantEnabled = true;
    assert.equal(getMemoryInjectionText(root, alice), '');

    card.fullInjectNext = true;
    const text = getMemoryInjectionText(root, alice);
    assert.match(text, /MEMORY_CONTEXT/);
    assert.match(text, /Alice/);
    assert.match(text, /EVENT A/);
    assert.match(text, /EVENT B/);
    assert.match(text, /only when relevant/i);
});



test('toggleFullInjectNext schedules and cancels the one-shot full-memory injection', () => {
    const root = {};
    ensureMemorySettings(root);
    const card = getOrCreateCardMemory(root, alice);
    card.eventLog = 'Message ID 1: EVENT A';

    assert.equal(toggleFullInjectNext(card), true);
    assert.equal(card.fullInjectNext, true);

    assert.equal(toggleFullInjectNext(card), false);
    assert.equal(card.fullInjectNext, false);
});

test('extractCanonicalNarrative prefers actual story_scene and parallel_line while excluding planning', () => {
    const response = `
<story_driver>PLAN ONLY: A will leave tomorrow.</story_driver>
<story_scene>A opened the eastern gate and left the city.</story_scene>
<parallel_line>B watched from the tower.</parallel_line>
<status>location: outside city</status>`;

    assert.equal(
        extractCanonicalNarrative(response),
        'A opened the eastern gate and left the city.\n\nB watched from the tower.',
    );
});

test('extractCanonicalNarrative falls back to response text with planning tags removed', () => {
    const response = '<think>private reasoning</think>\n<story_driver>plan</story_driver>\nA actually sits down at the table.';
    assert.equal(extractCanonicalNarrative(response), 'A actually sits down at the table.');
});

test('buildMemoryMessages includes the entire existing log and detailed event requirements', () => {
    const messages = buildMemoryMessages({
        character: alice,
        messageId: 31,
        fullResponse: '<story_scene>A returned the ring.</story_scene>',
        canonicalNarrative: 'A returned the ring.',
        eventLog: 'Turn 4: A distrusted User because of X.\nTurn 19: User kept the earlier promise by doing Y.',
    });

    assert.equal(messages[0].role, 'system');
    assert.match(messages[0].content, /append-only/i);
    assert.match(messages[0].content, /location/i);
    assert.match(messages[0].content, /sequence/i);
    assert.match(messages[0].content, /do not invent/i);
    assert.equal(messages[1].role, 'user');
    assert.match(messages[1].content, /Turn 4: A distrusted User/);
    assert.match(messages[1].content, /Message ID: 31/);
    assert.match(messages[1].content, /A returned the ring/);
});

test('parseMemoryModelResponse accepts plain or fenced JSON and rejects malformed payloads', () => {
    assert.deepEqual(parseMemoryModelResponse('{"has_event":true,"event_text":"Detailed event","index":{"actors":["A"],"locations":["Gate"],"topics":["promise"],"entities":[],"related_ids":[4],"summary":"A fulfilled the promise at the gate."}}'), {
        hasEvent: true,
        eventText: 'Detailed event',
        index: {
            actors: ['A'],
            locations: ['Gate'],
            topics: ['promise'],
            entities: [],
            relatedIds: ['4'],
            summary: 'A fulfilled the promise at the gate.',
        },
    });

    assert.deepEqual(parseMemoryModelResponse('```json\n{"has_event":false,"event_text":""}\n```'), {
        hasEvent: false,
        eventText: '',
        index: null,
    });

    assert.throws(() => parseMemoryModelResponse('not json'), /valid JSON/i);
});

test('appendEventText only appends and preserves existing log bytes', () => {
    assert.equal(appendEventText('OLD\n  KEEP  ', 'NEW EVENT'), 'OLD\n  KEEP  \n\nNEW EVENT');
    assert.equal(appendEventText('', 'FIRST'), 'FIRST');
    assert.equal(appendEventText('OLD', '   '), 'OLD');
});

test('createMessageSignature is stable for equal inputs and changes with content', () => {
    assert.equal(createMessageSignature(5, 'hello'), createMessageSignature(5, 'hello'));
    assert.notEqual(createMessageSignature(5, 'hello'), createMessageSignature(5, 'hello!'));
    assert.notEqual(createMessageSignature(5, 'hello'), createMessageSignature(6, 'hello'));
});


test('ensureMemorySettings migrates legacy full-injection toggle into auto relevant mode', () => {
    const root = {
        memory: {
            schemaVersion: 1,
            provider: { baseUrl: '', apiKey: '', model: '', models: [] },
            cards: {
                [alice.key]: {
                    character: alice,
                    enabled: true,
                    injectEnabled: true,
                    eventLog: 'Message ID 4: A met B at the gate.',
                    processedSignatures: {},
                    updatedAt: 10,
                },
            },
        },
    };

    const memory = ensureMemorySettings(root);
    const card = memory.cards[alice.key];

    assert.equal(memory.schemaVersion, 4);
    assert.equal(card.autoRelevantEnabled, true);
    assert.equal(card.fullInjectNext, false);
    assert.equal(card.injectEnabled, undefined);
    assert.deepEqual(card.processedMessageIds, {});
    assert.ok(Array.isArray(card.eventIndex));
    assert.equal(card.eventIndex[0].messageId, '4');
});

test('upsertEventIndexEntry keeps one hidden index row per Message ID', () => {
    const first = upsertEventIndexEntry([], '24', {
        summary: 'First version', actors: ['A'], locations: ['City'], topics: ['travel'], entities: [], relatedIds: [],
    });
    const second = upsertEventIndexEntry(first, '24', {
        summary: 'Updated version', actors: ['A', 'B'], locations: ['City'], topics: ['travel'], entities: ['Bus'], relatedIds: ['22'],
    });

    assert.equal(second.length, 1);
    assert.equal(second[0].messageId, '24');
    assert.equal(second[0].summary, 'Updated version');
    assert.deepEqual(second[0].relatedIds, ['22']);
});

test('selector prompt uses compact hidden index and never includes full Event Log text', () => {
    const messages = buildSelectorMessages({
        character: alice,
        userPrompt: 'Tôi hỏi A về lời hứa ở cổng thành.',
        recentAssistant: 'A đang đứng ở quảng trường.',
        eventIndex: [
            { messageId: '4', summary: 'A distrusted User.', actors: ['A'], locations: ['Gate'], topics: ['trust'], entities: [], relatedIds: [] },
            { messageId: '19', summary: 'User fulfilled the promise to A.', actors: ['A', 'User'], locations: ['Gate'], topics: ['promise', 'trust'], entities: [], relatedIds: ['4'] },
        ],
    });

    assert.match(messages[0].content, /only the event IDs/i);
    assert.match(messages[0].content, /causal chain/i);
    assert.match(messages[1].content, /Tôi hỏi A về lời hứa/);
    assert.match(messages[1].content, /Message ID 19/);
    assert.doesNotMatch(messages[1].content, /COMPLETE EXISTING EVENT LOG/);
});

test('parseMemorySelectionResponse accepts selected IDs and normalizes duplicates', () => {
    assert.deepEqual(parseMemorySelectionResponse('{"relevant_ids":[4,"19",19],"reason":"relationship chain"}'), {
        relevantIds: ['4', '19'],
        reason: 'relationship chain',
    });
    assert.deepEqual(parseMemorySelectionResponse('{"relevant_ids":[],"reason":"unrelated"}'), {
        relevantIds: [],
        reason: 'unrelated',
    });
});

test('selectEventTextByIds returns only selected full event blocks and deduplicates duplicate Message IDs', () => {
    const log = `Message ID 4: A first distrusted User at the eastern gate.\n\nMessage ID 19: User later fulfilled the promise in detail.\n\nMessage ID 19: duplicate version that must not be injected twice.\n\nMessage ID 30: unrelated event.`;
    const selected = selectEventTextByIds(log, ['4', '19']);

    assert.match(selected, /Message ID 4/);
    assert.match(selected, /fulfilled the promise/);
    assert.doesNotMatch(selected, /duplicate version/);
    assert.doesNotMatch(selected, /Message ID 30/);
});

test('buildMemoryContextText explains how selected memories should be used instead of dumping raw triggers', () => {
    const text = buildMemoryContextText('Message ID 19: User fulfilled the promise.', 'Alice');
    assert.match(text, /MEMORY_CONTEXT/);
    assert.match(text, /historical memory/i);
    assert.match(text, /only when relevant/i);
    assert.match(text, /do not force/i);
    assert.match(text, /Message ID 19/);
});


test('ensureMemorySettings preserves a persistent per-card failed Memory queue', () => {
    const root = {
        memory: {
            schemaVersion: 2,
            provider: { baseUrl: 'https://example.com/v1', apiKey: '', model: 'memory-model', models: [] },
            cards: {
                [alice.key]: {
                    character: alice,
                    enabled: true,
                    eventLog: '',
                    eventIndex: [],
                    processedMessageIds: {},
                    processedSignatures: {},
                    failedMessages: {
                        '24': { messageId: '24', attempts: 6, lastError: 'network down', failedAt: 1234, messageText: '<story_scene>Saved response.</story_scene>' },
                    },
                },
            },
        },
    };

    const memory = ensureMemorySettings(root);
    assert.equal(memory.schemaVersion, 4);
    assert.deepEqual(memory.cards[alice.key].failedMessages, {
        '24': { messageId: '24', attempts: 6, lastError: 'network down', failedAt: 1234, messageText: '<story_scene>Saved response.</story_scene>', sourceSignature: '' },
    });
});


test('event log stores each event as an inspectable block with chat and message IDs', () => {
    const block = formatMemoryEventBlock({
        chatId: 'Chat 2026-09-20 16-30-00',
        messageId: '24',
        sourceSignature: '24:deadbeef',
        eventText: 'A reached Saffron City after taking the bus.',
    });

    assert.match(block, /^<MEMORY_EVENT chat_id="Chat 2026-09-20 16-30-00" message_id="24" source_signature="24:deadbeef">/);
    assert.match(block, /A reached Saffron City/);
    assert.match(block, /<\/MEMORY_EVENT>$/);

    const parsed = parseMemoryEventBlocks(block);
    assert.deepEqual(parsed, [{
        chatId: 'Chat 2026-09-20 16-30-00',
        messageId: '24',
        sourceSignature: '24:deadbeef',
        eventText: 'A reached Saffron City after taking the bus.',
        text: block,
    }]);
});

test('memory is isolated by card plus chat id so a New Chat starts with an empty Event Log', () => {
    const root = {};
    ensureMemorySettings(root);
    const chatA = { ...alice, chatId: 'chat-A' };
    const chatB = { ...alice, chatId: 'chat-B' };

    const first = getOrCreateCardMemory(root, chatA);
    first.enabled = true;
    first.autoRelevantEnabled = true;
    first.eventLog = formatMemoryEventBlock({
        chatId: 'chat-A',
        messageId: '2',
        sourceSignature: '2:aaaa1111',
        eventText: 'Old chat event.',
    });

    const second = getOrCreateCardMemory(root, chatB);
    assert.notStrictEqual(second, first);
    assert.equal(second.eventLog, '');
    assert.deepEqual(second.eventIndex, []);
    assert.deepEqual(second.processedMessageIds, {});
    assert.deepEqual(second.failedMessages, {});
    assert.equal(second.enabled, true);
    assert.equal(second.autoRelevantEnabled, true);
    assert.strictEqual(getCardMemory(root, chatA), first);
    assert.strictEqual(getCardMemory(root, chatB), second);
});

test('v0.3.3 card memory migrates once into the currently opened chat and legacy log becomes blocks', () => {
    const root = {
        memory: {
            schemaVersion: 3,
            provider: { baseUrl: '', apiKey: '', model: '', models: [] },
            cards: {
                [alice.key]: {
                    character: alice,
                    enabled: true,
                    autoRelevantEnabled: true,
                    fullInjectNext: false,
                    eventLog: 'Message ID 4: A met B at the eastern gate.',
                    eventIndex: [],
                    processedMessageIds: { '4': true },
                    processedSignatures: { '4': '4:12345678' },
                    failedMessages: {},
                    updatedAt: 50,
                },
            },
        },
    };

    const current = getOrCreateCardMemory(root, { ...alice, chatId: 'current-chat' });
    assert.match(current.eventLog, /<MEMORY_EVENT chat_id="current-chat" message_id="4" source_signature="4:12345678">/);
    assert.match(current.eventLog, /A met B at the eastern gate/);
    assert.equal(root.memory.cards[alice.key], undefined);
});

test('reconcile removes memory whose source message disappeared after rewind or deletion', () => {
    const root = {};
    ensureMemorySettings(root);
    const identity = { ...alice, chatId: 'chat-A' };
    const card = getOrCreateCardMemory(root, identity);
    const message0 = '<story_scene>First event.</story_scene>';
    const message2 = '<story_scene>Later event.</story_scene>';
    const sig0 = createMessageSignature(0, message0);
    const sig2 = createMessageSignature(2, message2);
    card.eventLog = [
        formatMemoryEventBlock({ chatId: 'chat-A', messageId: '0', sourceSignature: sig0, eventText: 'First event.' }),
        formatMemoryEventBlock({ chatId: 'chat-A', messageId: '2', sourceSignature: sig2, eventText: 'Later event.' }),
    ].join('\n\n');
    card.eventIndex = [
        { messageId: '0', summary: 'first', actors: [], locations: [], topics: [], entities: [], relatedIds: [] },
        { messageId: '2', summary: 'later', actors: [], locations: [], topics: [], entities: [], relatedIds: [] },
    ];
    card.processedMessageIds = { '0': true, '2': true };
    card.processedSignatures = { '0': sig0, '2': sig2 };
    card.failedMessages = {
        '2': { messageId: '2', attempts: 6, lastError: 'x', failedAt: 1, messageText: message2 },
    };

    const result = reconcileMemoryWithChat(card, 'chat-A', [
        { is_user: false, is_system: false, mes: message0 },
        { is_user: true, mes: 'rewound from here' },
    ]);

    assert.equal(result.changed, true);
    assert.deepEqual(result.removedEventIds, ['2']);
    assert.match(card.eventLog, /message_id="0"/);
    assert.doesNotMatch(card.eventLog, /message_id="2"/);
    assert.deepEqual(card.eventIndex.map((entry) => entry.messageId), ['0']);
    assert.equal(card.processedMessageIds['2'], undefined);
    assert.equal(card.processedSignatures['2'], undefined);
    assert.equal(card.failedMessages['2'], undefined);
});

test('reconcile removes stale memory when the same Message ID is replaced by a swipe', () => {
    const root = {};
    ensureMemorySettings(root);
    const identity = { ...alice, chatId: 'chat-A' };
    const card = getOrCreateCardMemory(root, identity);
    const oldText = '<story_scene>A chose the red door.</story_scene>';
    const newText = '<story_scene>A chose the blue door.</story_scene>';
    const oldSignature = createMessageSignature(3, oldText);
    card.eventLog = formatMemoryEventBlock({
        chatId: 'chat-A', messageId: '3', sourceSignature: oldSignature, eventText: 'A chose the red door.',
    });
    card.eventIndex = [{ messageId: '3', summary: 'red door', actors: ['A'], locations: [], topics: [], entities: [], relatedIds: [] }];
    card.processedMessageIds = { '3': true };
    card.processedSignatures = { '3': oldSignature };

    const chat = [
        { is_user: true, mes: '0' },
        { is_user: true, mes: '1' },
        { is_user: true, mes: '2' },
        { is_user: false, is_system: false, mes: newText },
    ];
    reconcileMemoryWithChat(card, 'chat-A', chat);

    assert.equal(card.eventLog, '');
    assert.deepEqual(card.eventIndex, []);
    assert.equal(card.processedMessageIds['3'], undefined);
});
