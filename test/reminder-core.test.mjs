import test from 'node:test';
import assert from 'node:assert/strict';

import {
    SCHEMA_VERSION,
    MODULE_NAME,
    ensureSettings,
    createPromptEntry,
    resolveCharacterIdentity,
    characterBindingsMatch,
    getActivePrompts,
    mergeActivePrompts,
    getReminderText,
} from '../src/reminder-core.js';

function idFactorySequence(...ids) {
    let index = 0;
    return () => ids[index++] ?? `id-${index}`;
}

function prompt(overrides = {}) {
    return {
        id: overrides.id ?? 'p1',
        name: overrides.name ?? 'Prompt',
        enabled: overrides.enabled ?? true,
        scope: overrides.scope ?? 'global',
        character: overrides.character ?? null,
        content: overrides.content ?? 'content',
        order: overrides.order ?? 0,
    };
}

test('ensureSettings creates schema v2 defaults without replacing the settings container', () => {
    const extensionSettings = {};
    const settings = ensureSettings(extensionSettings, idFactorySequence('unused'));

    assert.equal(MODULE_NAME, 'st_auto_prompt_reminder');
    assert.equal(SCHEMA_VERSION, 2);
    assert.strictEqual(settings, extensionSettings[MODULE_NAME]);
    assert.deepEqual(settings, {
        enabled: true,
        schemaVersion: 2,
        prompts: [],
    });
});

test('ensureSettings migrates v0.1.2 promptText losslessly into one global prompt', () => {
    const authored = 'Line one.\n\n  Keep these spaces.  \nLine four.';
    const extensionSettings = {
        [MODULE_NAME]: {
            enabled: false,
            promptText: authored,
        },
    };

    const settings = ensureSettings(extensionSettings, idFactorySequence('legacy-id'));

    assert.equal(settings.enabled, false);
    assert.equal(settings.schemaVersion, 2);
    assert.equal(Object.hasOwn(settings, 'promptText'), false);
    assert.deepEqual(settings.prompts, [{
        id: 'legacy-id',
        name: 'Prompt cũ',
        enabled: true,
        scope: 'global',
        character: null,
        content: authored,
        order: 0,
    }]);
});

test('ensureSettings migrates blank legacy promptText without creating an empty prompt', () => {
    const extensionSettings = {
        [MODULE_NAME]: {
            enabled: true,
            promptText: '   \n  ',
        },
    };

    const settings = ensureSettings(extensionSettings, idFactorySequence('unused'));

    assert.deepEqual(settings, {
        enabled: true,
        schemaVersion: 2,
        prompts: [],
    });
});

test('createPromptEntry normalizes defaults and preserves supplied character binding', () => {
    const binding = { key: 'avatar:Alice.png', avatar: 'Alice.png', name: 'Alice' };
    const entry = createPromptEntry({
        name: 'Card rules',
        scope: 'character',
        character: binding,
        content: 'Stay Alice.',
        order: 3,
    }, () => 'generated-id');

    assert.deepEqual(entry, {
        id: 'generated-id',
        name: 'Card rules',
        enabled: true,
        scope: 'character',
        character: binding,
        content: 'Stay Alice.',
        order: 3,
    });
});

test('resolveCharacterIdentity prefers active character avatar and uses name for display', () => {
    const context = {
        characterId: 1,
        characters: [
            { name: 'Other', avatar: 'Other.png' },
            { name: 'Alice', avatar: 'Alice.png' },
        ],
        name2: 'Alice',
    };

    assert.deepEqual(resolveCharacterIdentity(context), {
        key: 'avatar:Alice.png',
        avatar: 'Alice.png',
        name: 'Alice',
    });
});

test('resolveCharacterIdentity falls back to name2 in group-style context', () => {
    const context = {
        characterId: undefined,
        characters: [
            { name: 'Alice', avatar: 'Alice.png' },
            { name: 'Bob', avatar: 'Bob.png' },
        ],
        name2: 'Bob',
        groupId: 'group-1',
    };

    assert.deepEqual(resolveCharacterIdentity(context), {
        key: 'avatar:Bob.png',
        avatar: 'Bob.png',
        name: 'Bob',
    });
});

test('resolveCharacterIdentity returns null when no active card can be resolved', () => {
    assert.equal(resolveCharacterIdentity({ characterId: undefined, characters: [], name2: '' }), null);
});

test('characterBindingsMatch prefers avatar identity and can fall back to stable key/name', () => {
    assert.equal(characterBindingsMatch(
        { key: 'avatar:Alice.png', avatar: 'Alice.png', name: 'Old Alice' },
        { key: 'avatar:Alice.png', avatar: 'Alice.png', name: 'Alice Renamed' },
    ), true);

    assert.equal(characterBindingsMatch(
        { key: 'name:Alice', avatar: '', name: 'Alice' },
        { key: 'name:Alice', avatar: '', name: 'Alice' },
    ), true);

    assert.equal(characterBindingsMatch(
        { key: 'avatar:Alice.png', avatar: 'Alice.png', name: 'Alice' },
        { key: 'avatar:Bob.png', avatar: 'Bob.png', name: 'Bob' },
    ), false);
});

test('multiple global prompts merge in order and preserve authored text', () => {
    const settings = {
        enabled: true,
        schemaVersion: 2,
        prompts: [
            prompt({ id: 'late', name: 'Late', content: 'SECOND\n  keep', order: 20 }),
            prompt({ id: 'early', name: 'Early', content: 'FIRST', order: 10 }),
        ],
    };

    const result = mergeActivePrompts(settings, null);

    assert.deepEqual(result.prompts.map((item) => item.id), ['early', 'late']);
    assert.equal(result.text, 'FIRST\n\nSECOND\n  keep');
    assert.equal(result.promptCount, 2);
    assert.equal(result.textLength, result.text.length);
    assert.equal(getReminderText(settings, null), result.text);
});

test('disabled prompts and blank prompts are omitted', () => {
    const settings = {
        enabled: true,
        schemaVersion: 2,
        prompts: [
            prompt({ id: 'on', content: 'ON', order: 0 }),
            prompt({ id: 'off', content: 'OFF', enabled: false, order: 1 }),
            prompt({ id: 'blank', content: '   \n', order: 2 }),
        ],
    };

    assert.deepEqual(getActivePrompts(settings, null).map((item) => item.id), ['on']);
    assert.equal(getReminderText(settings, null), 'ON');
});

test('matching character prompt is additive with global prompts', () => {
    const alice = { key: 'avatar:Alice.png', avatar: 'Alice.png', name: 'Alice' };
    const settings = {
        enabled: true,
        schemaVersion: 2,
        prompts: [
            prompt({ id: 'global', content: 'GLOBAL', order: 0 }),
            prompt({ id: 'alice', scope: 'character', character: alice, content: 'ALICE', order: 1 }),
        ],
    };

    const result = mergeActivePrompts(settings, alice);

    assert.deepEqual(result.prompts.map((item) => item.id), ['global', 'alice']);
    assert.equal(result.text, 'GLOBAL\n\nALICE');
});

test('non-matching character prompt is omitted', () => {
    const alice = { key: 'avatar:Alice.png', avatar: 'Alice.png', name: 'Alice' };
    const bob = { key: 'avatar:Bob.png', avatar: 'Bob.png', name: 'Bob' };
    const settings = {
        enabled: true,
        schemaVersion: 2,
        prompts: [
            prompt({ id: 'global', content: 'GLOBAL', order: 0 }),
            prompt({ id: 'alice', scope: 'character', character: alice, content: 'ALICE', order: 1 }),
        ],
    };

    assert.equal(getReminderText(settings, bob), 'GLOBAL');
});

test('no active card injects only global prompts', () => {
    const alice = { key: 'avatar:Alice.png', avatar: 'Alice.png', name: 'Alice' };
    const settings = {
        enabled: true,
        schemaVersion: 2,
        prompts: [
            prompt({ id: 'global', content: 'GLOBAL', order: 0 }),
            prompt({ id: 'alice', scope: 'character', character: alice, content: 'ALICE', order: 1 }),
        ],
    };

    assert.equal(getReminderText(settings, null), 'GLOBAL');
});

test('extension global disable clears aggregate reminder', () => {
    const settings = {
        enabled: false,
        schemaVersion: 2,
        prompts: [prompt({ content: 'DO NOT INJECT' })],
    };

    assert.deepEqual(mergeActivePrompts(settings, null), {
        text: '',
        prompts: [],
        promptCount: 0,
        textLength: 0,
    });
});
