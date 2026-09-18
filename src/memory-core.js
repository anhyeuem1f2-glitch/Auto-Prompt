export const MEMORY_SCHEMA_VERSION = 1;

const DEFAULT_PROVIDER = Object.freeze({
    baseUrl: '',
    apiKey: '',
    model: '',
    models: [],
});

const NON_CANON_TAGS = [
    'think',
    'thinking',
    'story_driver',
    'acg_think',
    'combat_driver',
    'analysis',
    'reasoning',
];

function cleanString(value) {
    return typeof value === 'string' ? value : '';
}

function normalizeCharacter(character) {
    if (!character || typeof character !== 'object') return null;

    const key = cleanString(character.key).trim();
    const avatar = cleanString(character.avatar);
    const name = cleanString(character.name);

    if (!key) return null;
    return { key, avatar, name };
}

function normalizeProvider(provider) {
    const source = provider && typeof provider === 'object' ? provider : {};
    const rawModels = Array.isArray(source.models) ? source.models : [];
    const models = [...new Set(rawModels
        .map((value) => cleanString(typeof value === 'string' ? value : value?.id).trim())
        .filter(Boolean))];

    return {
        baseUrl: cleanString(source.baseUrl),
        apiKey: cleanString(source.apiKey),
        model: cleanString(source.model),
        models,
    };
}

function normalizeCardMemory(card, character = null) {
    const source = card && typeof card === 'object' ? card : {};
    const normalizedCharacter = normalizeCharacter(character)
        || normalizeCharacter(source.character)
        || null;
    const processed = source.processedSignatures && typeof source.processedSignatures === 'object'
        ? { ...source.processedSignatures }
        : {};

    return {
        character: normalizedCharacter,
        enabled: source.enabled === true,
        injectEnabled: source.injectEnabled === true,
        eventLog: cleanString(source.eventLog),
        processedSignatures: processed,
        updatedAt: Number.isFinite(Number(source.updatedAt)) ? Number(source.updatedAt) : 0,
    };
}

export function ensureMemorySettings(settings) {
    if (!settings || typeof settings !== 'object') {
        throw new TypeError('Settings container is required.');
    }

    if (!settings.memory || typeof settings.memory !== 'object') {
        settings.memory = {
            schemaVersion: MEMORY_SCHEMA_VERSION,
            provider: { ...DEFAULT_PROVIDER },
            cards: {},
        };
        return settings.memory;
    }

    const memory = settings.memory;
    memory.schemaVersion = MEMORY_SCHEMA_VERSION;
    memory.provider = normalizeProvider(memory.provider ?? DEFAULT_PROVIDER);

    if (!memory.cards || typeof memory.cards !== 'object' || Array.isArray(memory.cards)) {
        memory.cards = {};
    }

    for (const [key, rawCard] of Object.entries(memory.cards)) {
        const card = rawCard && typeof rawCard === 'object' ? rawCard : {};
        const normalized = normalizeCardMemory(card, card.character?.key ? card.character : {
            key,
            avatar: cleanString(card.character?.avatar),
            name: cleanString(card.character?.name),
        });

        card.character = normalized.character;
        card.enabled = normalized.enabled;
        card.injectEnabled = normalized.injectEnabled;
        card.eventLog = normalized.eventLog;
        card.processedSignatures = normalized.processedSignatures;
        card.updatedAt = normalized.updatedAt;
        memory.cards[key] = card;
    }

    return memory;
}

export function getCardMemory(settings, character) {
    const normalizedCharacter = normalizeCharacter(character);
    if (!normalizedCharacter) return null;
    const memory = ensureMemorySettings(settings);
    return memory.cards[normalizedCharacter.key] ?? null;
}

export function getOrCreateCardMemory(settings, character) {
    const normalizedCharacter = normalizeCharacter(character);
    if (!normalizedCharacter) return null;

    const memory = ensureMemorySettings(settings);
    const existing = memory.cards[normalizedCharacter.key];

    if (existing) {
        existing.character = normalizedCharacter;
        return existing;
    }

    const created = normalizeCardMemory({}, normalizedCharacter);
    memory.cards[normalizedCharacter.key] = created;
    return created;
}

export function getMemoryInjectionText(settings, character) {
    const card = getCardMemory(settings, character);
    if (!card?.injectEnabled) return '';

    const log = card.eventLog;
    if (!log.trim()) return '';

    const cardName = card.character?.name || 'Current card';
    return [
        `[CARD EVENT LOG — ${cardName}]`,
        'Use the complete event log below as factual historical context for this card. Do not discard earlier events merely because they are old.',
        log,
        '[/CARD EVENT LOG]',
    ].join('\n');
}

function collectTagContents(text, tagName) {
    const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'gi');
    const parts = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
        const value = cleanString(match[1]).trim();
        if (value) parts.push(value);
    }
    return parts;
}

function stripNonCanonTags(text) {
    let output = text;
    for (const tagName of NON_CANON_TAGS) {
        const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`<${escaped}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${escaped}>`, 'gi');
        output = output.replace(regex, '');
    }
    return output.trim();
}

export function extractCanonicalNarrative(fullResponse) {
    const text = cleanString(fullResponse);
    if (!text.trim()) return '';

    const story = collectTagContents(text, 'story_scene');
    const parallels = collectTagContents(text, 'parallel_line');
    const canonical = [...story, ...parallels].filter(Boolean);

    if (canonical.length > 0) {
        return canonical.join('\n\n').trim();
    }

    return stripNonCanonTags(text);
}

export function buildMemoryMessages({
    character,
    messageId,
    fullResponse,
    canonicalNarrative,
    eventLog,
}) {
    const name = cleanString(character?.name) || cleanString(character?.key) || 'Current card';
    const existingLog = cleanString(eventLog);
    const canonical = cleanString(canonicalNarrative) || extractCanonicalNarrative(fullResponse);

    const system = `You are an append-only event recorder for a long-running SillyTavern roleplay.
Your only job is to decide whether the newest assistant response contains one or more events worth preserving, then write the new log entry in concrete detail.

STRICT SOURCE RULES:
- Actual narrative that happened on-page is the source of truth.
- Planning, hidden reasoning, <story_driver>, <think>, analysis, predictions, proposed future actions, and choices are NOT events unless the same action actually occurs in the narrative.
- Existing Event Log is historical context. Never rewrite, summarize, delete, or correct old entries in your output.
- Do not invent facts, locations, motives, emotions, chronology, participants, injuries, dialogue, or outcomes that are not supported.
- If a detail is uncertain, say it is uncertain instead of guessing.

DETAIL REQUIREMENT:
Never write vague shorthand such as only "A kept the promise", "A defeated B", "they argued", or "the relationship improved". A preserved event must include every detail supported by the text that matters for future continuity: the most precise confirmed location, who was present, what led into the event, the sequence of important actions, how actions were carried out, key dialogue/decisions when relevant, how the event ended, immediate outcome, situational or emotional context that is explicitly supported, consequences that remain active, and links to earlier Event Log entries when this event continues or resolves an earlier situation.

OUTPUT:
Return ONLY valid JSON with this exact shape:
{"has_event": true|false, "event_text": "..."}
If nothing new is worth preserving, use false and an empty event_text.
When writing event_text, include the source Message ID so future entries can reference it. Use the same language as the existing Event Log; if it is empty, use the language of the new narrative.`;

    const user = `Card: ${name}\nMessage ID: ${messageId}\n\n=== COMPLETE EXISTING EVENT LOG ===\n${existingLog || '(empty)'}\n=== END EVENT LOG ===\n\n=== CANONICAL NARRATIVE THAT ACTUALLY OCCURRED ===\n${canonical || '(no canonical narrative extracted)'}\n=== END CANONICAL NARRATIVE ===\n\n=== FULL ASSISTANT RESPONSE FOR AUXILIARY CONTEXT ===\n${cleanString(fullResponse)}\n=== END FULL RESPONSE ===`;

    return [
        { role: 'system', content: system },
        { role: 'user', content: user },
    ];
}

export function parseMemoryModelResponse(content) {
    let text = cleanString(content).trim();
    const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fence) text = fence[1].trim();

    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        throw new Error(`Memory AI did not return valid JSON: ${error.message}`);
    }

    if (!parsed || typeof parsed !== 'object' || typeof parsed.has_event !== 'boolean') {
        throw new Error('Memory AI JSON must contain boolean has_event.');
    }

    const eventText = cleanString(parsed.event_text).trim();
    if (parsed.has_event && !eventText) {
        throw new Error('Memory AI reported an event but event_text was empty.');
    }

    return {
        hasEvent: parsed.has_event,
        eventText: parsed.has_event ? eventText : '',
    };
}

export function appendEventText(existingLog, eventText) {
    const existing = cleanString(existingLog);
    const addition = cleanString(eventText).trim();
    if (!addition) return existing;
    if (!existing) return addition;
    return `${existing}\n\n${addition}`;
}

export function createMessageSignature(messageId, content) {
    const input = `${String(messageId)}\u0000${cleanString(content)}`;
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `${String(messageId)}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
