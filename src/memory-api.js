function clean(value) {
    return typeof value === 'string' ? value.trim() : '';
}

export function normalizeApiBaseUrl(value) {
    let url = clean(value).replace(/\/+$/, '');
    url = url.replace(/\/chat\/completions$/i, '');
    return url;
}

function authHeaders(apiKey) {
    const headers = { 'Content-Type': 'application/json' };
    const key = clean(apiKey);
    if (key) headers.Authorization = `Bearer ${key}`;
    return headers;
}

async function readError(response) {
    try {
        const text = await response.text();
        return text || `HTTP ${response.status}`;
    } catch {
        return `HTTP ${response.status}`;
    }
}

function requireBaseUrl(provider) {
    const baseUrl = normalizeApiBaseUrl(provider?.baseUrl);
    if (!baseUrl) throw new Error('Memory AI Base URL is required.');
    return baseUrl;
}

function requireModel(provider) {
    const model = clean(provider?.model);
    if (!model) throw new Error('Memory AI model is required.');
    return model;
}

function parseModels(payload) {
    let raw = [];
    if (Array.isArray(payload?.data)) raw = payload.data;
    else if (Array.isArray(payload?.models)) raw = payload.models;
    else if (Array.isArray(payload)) raw = payload;

    return [...new Set(raw
        .map((item) => clean(typeof item === 'string' ? item : item?.id ?? item?.name))
        .filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
}

export async function loadProviderModels(provider, fetchImpl = globalThis.fetch) {
    const baseUrl = requireBaseUrl(provider);
    if (typeof fetchImpl !== 'function') throw new Error('Fetch API is unavailable.');

    const response = await fetchImpl(`${baseUrl}/models`, {
        method: 'GET',
        headers: authHeaders(provider?.apiKey),
    });

    if (!response.ok) {
        throw new Error(`Memory AI model list failed (${response.status}): ${await readError(response)}`);
    }

    const payload = await response.json();
    const models = parseModels(payload);
    if (!models.length) throw new Error('Memory AI provider returned no models.');
    return models;
}

export async function requestMemoryUpdate(provider, messages, fetchImpl = globalThis.fetch) {
    const baseUrl = requireBaseUrl(provider);
    const model = requireModel(provider);
    if (typeof fetchImpl !== 'function') throw new Error('Fetch API is unavailable.');

    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: authHeaders(provider?.apiKey),
        body: JSON.stringify({
            model,
            messages,
            temperature: 0.1,
        }),
    });

    if (!response.ok) {
        throw new Error(`Memory AI request failed (${response.status}): ${await readError(response)}`);
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
        throw new Error('Memory AI response did not contain choices[0].message.content.');
    }
    return content;
}

export async function testProviderConnection(provider, fetchImpl = globalThis.fetch) {
    const content = await requestMemoryUpdate(provider, [
        { role: 'user', content: 'Reply with exactly OK.' },
    ], fetchImpl);
    return content.trim();
}
