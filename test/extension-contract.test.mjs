import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function read(path) {
    return readFile(new URL(path, import.meta.url), 'utf8');
}

test('manifest loads the extension entry point and stylesheet at v0.2.0', async () => {
    const manifest = JSON.parse(await read('../manifest.json'));

    assert.equal(manifest.display_name, 'ST Auto Prompt Reminder');
    assert.equal(manifest.js, 'index.js');
    assert.equal(manifest.css, 'style.css');
    assert.equal(manifest.version, '0.2.0');
    assert.equal(Object.hasOwn(manifest, 'author'), false);
    assert.equal(manifest.hooks?.disable, 'onDisable');
});

test('entry point uses stable SillyTavern context API and final-stage prompt hook', async () => {
    const source = await read('../index.js');

    assert.match(source, /SillyTavern.*getContext/);
    assert.match(source, /registerGenerationHook/);
    assert.match(source, /registerFinalPromptHook/);
    assert.match(source, /resolveCharacterIdentity/);
    assert.match(source, /saveSettingsDebounced/);
    assert.match(source, /extensions_settings2/);
});

test('entry point exposes multi-prompt manager controls', async () => {
    const source = await read('../index.js');

    assert.match(source, /st-auto-prompt-list/);
    assert.match(source, /st-auto-prompt-add/);
    assert.match(source, /st-auto-prompt-editor/);
    assert.match(source, /st-auto-prompt-name/);
    assert.match(source, /st-auto-prompt-scope/);
    assert.match(source, /st-auto-prompt-content/);
    assert.match(source, /st-auto-prompt-bind-current/);
    assert.match(source, /Gắn với card hiện tại/);
});

test('entry point supports per-prompt enable, edit, delete, and reorder actions', async () => {
    const source = await read('../index.js');

    assert.match(source, /st-auto-prompt-entry-enabled/);
    assert.match(source, /st-auto-prompt-edit/);
    assert.match(source, /st-auto-prompt-delete/);
    assert.match(source, /st-auto-prompt-up/);
    assert.match(source, /st-auto-prompt-down/);
});

test('entry point reports final aggregate prompt count and text length', async () => {
    const source = await read('../index.js');

    assert.match(source, /promptCount/);
    assert.match(source, /Đã chèn.*prompt.*cuối prompt gửi AI/);
    assert.match(source, /textLength/);
});

test('legacy single textarea id is removed from v0.2.0 UI', async () => {
    const source = await read('../index.js');

    assert.doesNotMatch(source, /st-auto-prompt-text(?:"|'|`)/);
});
