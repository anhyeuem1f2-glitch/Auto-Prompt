import test from 'node:test';
import assert from 'node:assert/strict';

import {
    normalizeApiBaseUrl,
    loadProviderModels,
    testProviderConnection,
    requestMemoryUpdate,
} from '../src/memory-api.js';

function jsonResponse(body, ok = true, status = 200) {
    return {
        ok,
        status,
        async json() { return body; },
        async text() { return JSON.stringify(body); },
    };
}

test('normalizeApiBaseUrl accepts API roots and chat completion URLs', () => {
    assert.equal(normalizeApiBaseUrl(' https://example.com/v1/ '), 'https://example.com/v1');
    assert.equal(normalizeApiBaseUrl('https://example.com/v1/chat/completions'), 'https://example.com/v1');
    assert.equal(normalizeApiBaseUrl('https://example.com/chat/completions/'), 'https://example.com');
});

test('loadProviderModels calls /models with optional bearer auth and parses OpenAI data array', async () => {
    const calls = [];
    const fetchImpl = async (...args) => {
        calls.push(args);
        return jsonResponse({ data: [{ id: 'z-model' }, { id: 'a-model' }] });
    };

    const models = await loadProviderModels({
        baseUrl: 'https://example.com/v1',
        apiKey: 'secret',
    }, fetchImpl);

    assert.deepEqual(models, ['a-model', 'z-model']);
    assert.equal(calls[0][0], 'https://example.com/v1/models');
    assert.equal(calls[0][1].headers.Authorization, 'Bearer secret');
});

test('loadProviderModels allows local provider without API key', async () => {
    const fetchImpl = async (_url, options) => {
        assert.equal(Object.hasOwn(options.headers, 'Authorization'), false);
        return jsonResponse({ models: ['local-b', { id: 'local-a' }] });
    };

    assert.deepEqual(
        await loadProviderModels({ baseUrl: 'http://127.0.0.1:1234/v1', apiKey: '' }, fetchImpl),
        ['local-a', 'local-b'],
    );
});

test('requestMemoryUpdate posts OpenAI-compatible chat completion and returns assistant content', async () => {
    const calls = [];
    const fetchImpl = async (...args) => {
        calls.push(args);
        return jsonResponse({ choices: [{ message: { content: '{"has_event":false,"event_text":""}' } }] });
    };
    const messages = [{ role: 'user', content: 'hello' }];

    const content = await requestMemoryUpdate({
        baseUrl: 'https://example.com/v1',
        apiKey: 'k',
        model: 'memory-model',
    }, messages, fetchImpl);

    assert.equal(content, '{"has_event":false,"event_text":""}');
    assert.equal(calls[0][0], 'https://example.com/v1/chat/completions');
    const body = JSON.parse(calls[0][1].body);
    assert.equal(body.model, 'memory-model');
    assert.deepEqual(body.messages, messages);
    assert.equal(body.temperature, 0.1);
});

test('testProviderConnection verifies selected model through a minimal chat call', async () => {
    const fetchImpl = async (_url, options) => {
        const body = JSON.parse(options.body);
        assert.equal(body.model, 'm1');
        return jsonResponse({ choices: [{ message: { content: 'OK' } }] });
    };

    assert.equal(await testProviderConnection({ baseUrl: 'https://example.com/v1', model: 'm1', apiKey: '' }, fetchImpl), 'OK');
});

test('API helpers expose provider HTTP errors', async () => {
    const fetchImpl = async () => ({
        ok: false,
        status: 401,
        async text() { return 'unauthorized'; },
    });

    await assert.rejects(
        () => loadProviderModels({ baseUrl: 'https://example.com/v1', apiKey: 'bad' }, fetchImpl),
        /401.*unauthorized/i,
    );
});
