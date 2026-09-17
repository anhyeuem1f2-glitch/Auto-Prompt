import test from 'node:test';
import assert from 'node:assert/strict';

import { ensureSettings, getReminderText, MODULE_NAME } from '../src/reminder-core.js';

test('ensureSettings creates defaults without replacing the settings container', () => {
    const extensionSettings = {};
    const settings = ensureSettings(extensionSettings);

    assert.equal(MODULE_NAME, 'st_auto_prompt_reminder');
    assert.strictEqual(settings, extensionSettings[MODULE_NAME]);
    assert.deepEqual(settings, {
        enabled: true,
        promptText: '',
    });
});

test('ensureSettings preserves existing values and fills missing defaults', () => {
    const extensionSettings = {
        [MODULE_NAME]: {
            enabled: false,
        },
    };

    const settings = ensureSettings(extensionSettings);

    assert.deepEqual(settings, {
        enabled: false,
        promptText: '',
    });
});

test('getReminderText returns exact authored text when enabled', () => {
    const authored = 'Line one.\n\n  Keep these spaces.  \nLine four.';

    assert.equal(getReminderText({ enabled: true, promptText: authored }), authored);
});

test('getReminderText clears injection when disabled or blank', () => {
    assert.equal(getReminderText({ enabled: false, promptText: 'remember me' }), '');
    assert.equal(getReminderText({ enabled: true, promptText: '   \n\t  ' }), '');
});
