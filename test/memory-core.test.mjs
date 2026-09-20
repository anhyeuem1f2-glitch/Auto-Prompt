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
} from '../src/memory-core.js';

const alice = { key: 'avatar:Alice.png', avatar: 'Alice.png', name: 'Alice' };

test('ensureMemorySettings creates optional memory defaults with recording off', () => {
    const root = {};
    const memory = ensureMemorySettings(root);

    assert.equal(MEMORY_SCHEMA_VERSION, 2);
    assert.strictEqual(memory, root.memory);
    assert.deepEqual(memory, {
        schemaVersion: 2,
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

    assert.equal(memory.schemaVersion, 2);
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
