import test from 'node:test';
import assert from 'node:assert/strict';

import {
    MEMORY_SCHEMA_VERSION,
    ensureMemorySettings,
    getOrCreateCardMemory,
    getCardMemory,
    getMemoryInjectionText,
    extractCanonicalNarrative,
    buildMemoryMessages,
    parseMemoryModelResponse,
    appendEventText,
    createMessageSignature,
} from '../src/memory-core.js';

const alice = { key: 'avatar:Alice.png', avatar: 'Alice.png', name: 'Alice' };

test('ensureMemorySettings creates optional memory defaults with recording off', () => {
    const root = {};
    const memory = ensureMemorySettings(root);

    assert.equal(MEMORY_SCHEMA_VERSION, 1);
    assert.strictEqual(memory, root.memory);
    assert.deepEqual(memory, {
        schemaVersion: 1,
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
        injectEnabled: false,
        eventLog: '',
        processedSignatures: {},
        updatedAt: 0,
    });
    assert.strictEqual(getCardMemory(root, alice), card);
});

test('getMemoryInjectionText injects the full event log when injection is enabled, even if auto-recording is off', () => {
    const root = {};
    ensureMemorySettings(root);
    const card = getOrCreateCardMemory(root, alice);
    card.eventLog = 'EVENT A\n\nEVENT B';

    assert.equal(getMemoryInjectionText(root, alice), '');

    card.injectEnabled = true;
    const text = getMemoryInjectionText(root, alice);
    assert.match(text, /CARD EVENT LOG/);
    assert.match(text, /Alice/);
    assert.match(text, /EVENT A\n\nEVENT B/);
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
    assert.deepEqual(parseMemoryModelResponse('{"has_event":true,"event_text":"Detailed event"}'), {
        hasEvent: true,
        eventText: 'Detailed event',
    });

    assert.deepEqual(parseMemoryModelResponse('```json\n{"has_event":false,"event_text":""}\n```'), {
        hasEvent: false,
        eventText: '',
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
