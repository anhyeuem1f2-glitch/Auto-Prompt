import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function read(path) {
    return readFile(new URL(path, import.meta.url), 'utf8');
}

test('manifest loads the extension entry point and stylesheet at v0.3.5', async () => {
    const manifest = JSON.parse(await read('../manifest.json'));

    assert.equal(manifest.display_name, 'ST Auto Prompt Reminder');
    assert.equal(manifest.js, 'index.js');
    assert.equal(manifest.css, 'style.css');
    assert.equal(manifest.version, '0.3.5');
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

test('entry point exposes optional per-card Event Memory controls and provider model loader', async () => {
    const source = await read('../index.js');

    assert.match(source, /st-auto-memory-enabled/);
    assert.match(source, /st-auto-memory-auto-relevant/);
    assert.match(source, /st-auto-memory-full-next/);
    assert.match(source, /st-auto-memory-event-log/);
    assert.match(source, /st-auto-memory-base-url/);
    assert.match(source, /st-auto-memory-api-key/);
    assert.match(source, /st-auto-memory-load-models/);
    assert.match(source, /st-auto-memory-model/);
    assert.match(source, /st-auto-memory-test-connection/);
    assert.match(source, /st-auto-memory-status/);
    assert.match(source, /st-auto-memory-recall-failed/);
    assert.match(source, /st-auto-memory-retry-selector/);
    assert.match(source, /Tải danh sách model/);
    assert.match(source, /Nhật ký sự kiện/);
    assert.match(source, /Tự chọn ký ức liên quan/);
    assert.match(source, /Bơm toàn bộ ký ức vào lượt kế tiếp/);
    assert.match(source, /Hủy bơm toàn bộ ký ức ở lượt kế tiếp/);
    assert.match(source, /Recall ký ức lỗi/);
    assert.match(source, /Retry Memory selector/);
    assert.match(source, /toggleFullInjectNext\(card\)/);
});

test('entry point wires post-response memory capture and provider actions', async () => {
    const source = await read('../index.js');

    assert.match(source, /registerMemoryCaptureHook/);
    assert.match(source, /loadProviderModels/);
    assert.match(source, /testProviderConnection/);
    assert.match(source, /getOrCreateCardMemory/);
    assert.match(source, /processReceivedAssistantMessage/);
    assert.match(source, /selectRelevantMemoryForPrompt/);
    assert.match(source, /recallFailedMemoryMessages/);
    assert.match(source, /retryFailedMemorySelector/);
});

test('entry point reports final aggregate prompt count and text length', async () => {
    const source = await read('../index.js');

    assert.match(source, /promptCount/);
    assert.match(source, /Đã chèn.*prompt.*cuối prompt gửi AI/);
    assert.match(source, /textLength/);
});

test('legacy single textarea id remains removed', async () => {
    const source = await read('../index.js');
    assert.doesNotMatch(source, /st-auto-prompt-text(?:"|'|`)/);
});


test('v0.3.4 exposes chat-scoped memory identity and reconciliation hooks', async () => {
    const source = await read('../index.js');
    const memoryRuntime = await read('../src/memory-runtime.js');
    assert.match(source, /getCurrentChatId/);
    assert.match(source, /Chat ID hiện tại/);
    assert.match(source, /registerMemoryReconcileHooks/);
    assert.match(memoryRuntime, /MESSAGE_DELETED/);
    assert.match(memoryRuntime, /MESSAGE_SWIPED/);
});

test('memory event log uses inspectable MEMORY_EVENT blocks with chat and message ids', async () => {
    const source = await read('../src/memory-core.js');
    assert.match(source, /<MEMORY_EVENT/);
    assert.match(source, /chat_id=/);
    assert.match(source, /message_id=/);
    assert.match(source, /source_signature=/);
});
