import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function read(path) {
    return readFile(new URL(path, import.meta.url), 'utf8');
}

test('manifest loads the extension entry point and stylesheet', async () => {
    const manifest = JSON.parse(await read('../manifest.json'));

    assert.equal(manifest.display_name, 'ST Auto Prompt Reminder');
    assert.equal(manifest.js, 'index.js');
    assert.equal(manifest.css, 'style.css');
    assert.equal(manifest.version, '0.1.0');
    assert.equal(manifest.hooks?.disable, 'onDisable');
});

test('entry point uses stable SillyTavern context API and generation hook', async () => {
    const source = await read('../index.js');

    assert.match(source, /SillyTavern.*getContext/);
    assert.match(source, /registerGenerationHook/);
    assert.match(source, /saveSettingsDebounced/);
    assert.match(source, /extensions_settings2/);
    assert.match(source, /st-auto-prompt-text/);
});

test('entry point refreshes injection immediately when UI settings change', async () => {
    const source = await read('../index.js');

    assert.match(source, /applyReminderInjection/);
    assert.match(source, /addEventListener\('input'/);
    assert.match(source, /addEventListener\('change'/);
});
