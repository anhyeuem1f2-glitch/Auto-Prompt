export const MEMORY_SCHEMA_VERSION = 4;

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

function uniqueStrings(values) {
    if (!Array.isArray(values)) return [];
    return [...new Set(values
        .map((value) => cleanString(String(value ?? '')).trim())
        .filter(Boolean))];
}

function normalizeCharacter(character) {
    if (!character || typeof character !== 'object') return null;

    const key = cleanString(character.key).trim();
    const avatar = cleanString(character.avatar);
    const name = cleanString(character.name);
    const chatId = cleanString(character.chatId ?? character.chat_id).trim();

    if (!key) return null;
    return chatId ? { key, avatar, name, chatId } : { key, avatar, name };
}

function memoryStorageKey(character) {
    const normalized = normalizeCharacter(character);
    if (!normalized) return '';
    return normalized.chatId
        ? `${normalized.key}::chat:${encodeURIComponent(normalized.chatId)}`
        : normalized.key;
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

function normalizeIndexPayload(index) {
    if (!index || typeof index !== 'object') return null;
    const summary = cleanString(index.summary).trim();
    return {
        actors: uniqueStrings(index.actors),
        locations: uniqueStrings(index.locations),
        topics: uniqueStrings(index.topics),
        entities: uniqueStrings(index.entities),
        relatedIds: uniqueStrings(index.relatedIds ?? index.related_ids),
        summary,
    };
}

function fallbackIndexPayload(eventText) {
    const summary = cleanString(eventText).replace(/\s+/g, ' ').trim().slice(0, 500);
    return {
        actors: [],
        locations: [],
        topics: [],
        entities: [],
        relatedIds: [],
        summary,
    };
}

function normalizeEventIndexEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const messageId = cleanString(String(entry.messageId ?? entry.message_id ?? '')).trim();
    if (!messageId) return null;
    const payload = normalizeIndexPayload(entry) ?? fallbackIndexPayload(entry.summary);
    return { messageId, ...payload };
}

function normalizeEventIndex(index) {
    if (!Array.isArray(index)) return [];
    const result = [];
    for (const raw of index) {
        const entry = normalizeEventIndexEntry(raw);
        if (!entry) continue;
        const existing = result.findIndex((candidate) => candidate.messageId === entry.messageId);
        if (existing >= 0) result[existing] = entry;
        else result.push(entry);
    }
    return result;
}

function escapeXmlAttribute(value) {
    return cleanString(String(value ?? ''))
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}

function decodeXmlAttribute(value) {
    return cleanString(value)
        .replaceAll('&quot;', '"')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&amp;', '&');
}

function readAttribute(attrs, name) {
    const match = attrs.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'));
    return match ? decodeXmlAttribute(match[1]) : '';
}

export function formatMemoryEventBlock({ chatId = '', messageId = '', sourceSignature = '', eventText = '' } = {}) {
    const normalizedMessageId = cleanString(String(messageId ?? '')).trim();
    const content = cleanString(eventText).trim();
    if (!normalizedMessageId || !content) return '';

    return [
        `<MEMORY_EVENT chat_id="${escapeXmlAttribute(chatId)}" message_id="${escapeXmlAttribute(normalizedMessageId)}" source_signature="${escapeXmlAttribute(sourceSignature)}">`,
        content,
        '</MEMORY_EVENT>',
    ].join('\n');
}

function parseLegacyEventBlocks(eventLog) {
    const text = cleanString(eventLog);
    if (!text.trim()) return [];

    const regex = /^Message ID\s*:?[ \t]*(\d+)[ \t]*:?/gim;
    const matches = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
        matches.push({ id: match[1], start: match.index });
    }

    if (!matches.length) return [];
    return matches.map((item, index) => {
        const end = matches[index + 1]?.start ?? text.length;
        const blockText = text.slice(item.start, end).trim();
        return {
            chatId: '',
            messageId: item.id,
            sourceSignature: '',
            eventText: blockText,
            text: blockText,
        };
    }).filter((entry) => entry.text);
}

export function parseMemoryEventBlocks(eventLog) {
    const text = cleanString(eventLog);
    if (!text.trim()) return [];

    const modern = [];
    const regex = /<MEMORY_EVENT\b([^>]*)>([\s\S]*?)<\/MEMORY_EVENT>/gi;
    let match;
    while ((match = regex.exec(text)) !== null) {
        const attrs = match[1] ?? '';
        const eventText = cleanString(match[2]).trim();
        const messageId = readAttribute(attrs, 'message_id').trim();
        if (!messageId || !eventText) continue;
        modern.push({
            chatId: readAttribute(attrs, 'chat_id').trim(),
            messageId,
            sourceSignature: readAttribute(attrs, 'source_signature').trim(),
            eventText,
            text: match[0].trim(),
        });
    }

    return modern.length ? modern : parseLegacyEventBlocks(text);
}

function migrateLegacyEventLogToBlocks(eventLog, chatId, processedSignatures = {}) {
    const text = cleanString(eventLog);
    if (!text.trim()) return '';
    if (/<MEMORY_EVENT\b/i.test(text)) return text;

    const seen = new Set();
    const blocks = [];
    for (const event of parseLegacyEventBlocks(text)) {
        if (seen.has(event.messageId)) continue;
        seen.add(event.messageId);
        const block = formatMemoryEventBlock({
            chatId,
            messageId: event.messageId,
            sourceSignature: cleanString(processedSignatures?.[event.messageId]),
            eventText: event.eventText,
        });
        if (block) blocks.push(block);
    }
    return blocks.length ? blocks.join('\n\n') : text;
}

export function buildEventIndexFromLog(eventLog) {
    const seen = new Set();
    const result = [];
    for (const block of parseMemoryEventBlocks(eventLog)) {
        if (seen.has(block.messageId)) continue;
        seen.add(block.messageId);
        result.push({
            messageId: block.messageId,
            ...fallbackIndexPayload(block.eventText || block.text),
        });
    }
    return result;
}

export function upsertEventIndexEntry(index, messageId, payload) {
    const normalizedId = cleanString(String(messageId ?? '')).trim();
    if (!normalizedId) return normalizeEventIndex(index);
    const normalizedPayload = normalizeIndexPayload(payload) ?? fallbackIndexPayload(payload?.summary);
    const entry = { messageId: normalizedId, ...normalizedPayload };
    const result = normalizeEventIndex(index);
    const existing = result.findIndex((candidate) => candidate.messageId === normalizedId);
    if (existing >= 0) result[existing] = entry;
    else result.push(entry);
    return result;
}

function normalizeFailedMessages(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const result = {};
    for (const [key, raw] of Object.entries(value)) {
        if (!raw || typeof raw !== 'object') continue;
        const messageId = cleanString(String(raw.messageId ?? key ?? '')).trim();
        if (!messageId) continue;
        result[messageId] = {
            messageId,
            attempts: Number.isFinite(Number(raw.attempts)) ? Number(raw.attempts) : 0,
            lastError: cleanString(raw.lastError),
            failedAt: Number.isFinite(Number(raw.failedAt)) ? Number(raw.failedAt) : 0,
            messageText: cleanString(raw.messageText),
            sourceSignature: cleanString(raw.sourceSignature),
        };
    }
    return result;
}

function normalizeFailedSelector(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const userPrompt = cleanString(value.userPrompt);
    if (!userPrompt.trim()) return null;
    return {
        userPrompt,
        recentAssistant: cleanString(value.recentAssistant),
        attempts: Number.isFinite(Number(value.attempts)) ? Number(value.attempts) : 0,
        lastError: cleanString(value.lastError),
        failedAt: Number.isFinite(Number(value.failedAt)) ? Number(value.failedAt) : 0,
    };
}

function normalizePendingSelector(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const userPrompt = cleanString(value.userPrompt);
    if (!userPrompt.trim()) return null;
    return {
        userPrompt,
        recentAssistant: cleanString(value.recentAssistant),
        relevantIds: uniqueStrings(value.relevantIds ?? value.relevant_ids),
        reason: cleanString(value.reason),
        selectedAt: Number.isFinite(Number(value.selectedAt)) ? Number(value.selectedAt) : 0,
    };
}

function normalizeCardMemory(card, character = null) {
    const source = card && typeof card === 'object' ? card : {};
    const normalizedCharacter = normalizeCharacter(character)
        || normalizeCharacter(source.character)
        || null;
    const processedSignatures = source.processedSignatures && typeof source.processedSignatures === 'object'
        ? { ...source.processedSignatures }
        : {};
    const processedMessageIds = source.processedMessageIds && typeof source.processedMessageIds === 'object'
        ? { ...source.processedMessageIds }
        : Object.fromEntries(Object.keys(processedSignatures).map((key) => [key, true]));
    const chatId = normalizedCharacter?.chatId ?? '';
    const eventLog = chatId
        ? migrateLegacyEventLogToBlocks(source.eventLog, chatId, processedSignatures)
        : cleanString(source.eventLog);
    const storedIndex = normalizeEventIndex(source.eventIndex);
    const fallbackIndex = buildEventIndexFromLog(eventLog);
    const indexedIds = new Set(storedIndex.map((entry) => entry.messageId));
    const eventIndex = [
        ...storedIndex,
        ...fallbackIndex.filter((entry) => !indexedIds.has(entry.messageId)),
    ];
    const autoRelevantEnabled = source.autoRelevantEnabled === true
        || (source.autoRelevantEnabled === undefined && source.injectEnabled === true);
    const failedMessages = normalizeFailedMessages(source.failedMessages);
    const failedSelector = normalizeFailedSelector(source.failedSelector);
    const pendingSelector = normalizePendingSelector(source.pendingSelector);

    return {
        character: normalizedCharacter,
        enabled: source.enabled === true,
        autoRelevantEnabled,
        fullInjectNext: source.fullInjectNext === true,
        eventLog,
        eventIndex,
        processedMessageIds,
        processedSignatures,
        failedMessages,
        ...(failedSelector ? { failedSelector } : {}),
        ...(pendingSelector ? { pendingSelector } : {}),
        updatedAt: Number.isFinite(Number(source.updatedAt)) ? Number(source.updatedAt) : 0,
    };
}

function assignNormalizedCard(card, normalized) {
    card.character = normalized.character;
    card.enabled = normalized.enabled;
    card.autoRelevantEnabled = normalized.autoRelevantEnabled;
    card.fullInjectNext = normalized.fullInjectNext;
    card.eventLog = normalized.eventLog;
    card.eventIndex = normalized.eventIndex;
    card.processedMessageIds = normalized.processedMessageIds;
    card.processedSignatures = normalized.processedSignatures;
    card.failedMessages = normalized.failedMessages;
    if (normalized.failedSelector) card.failedSelector = normalized.failedSelector;
    else delete card.failedSelector;
    if (normalized.pendingSelector) card.pendingSelector = normalized.pendingSelector;
    else delete card.pendingSelector;
    card.updatedAt = normalized.updatedAt;
    delete card.injectEnabled;
    return card;
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
        const fallbackKey = key.includes('::chat:') ? key.split('::chat:')[0] : key;
        const normalized = normalizeCardMemory(card, card.character?.key ? card.character : {
            key: fallbackKey,
            avatar: cleanString(card.character?.avatar),
            name: cleanString(card.character?.name),
        });
        memory.cards[key] = assignNormalizedCard(card, normalized);
    }

    return memory;
}

function mostRecentCardDefaults(memory, characterKey) {
    let candidate = null;
    for (const card of Object.values(memory.cards)) {
        if (card?.character?.key !== characterKey) continue;
        if (!candidate || Number(card.updatedAt) > Number(candidate.updatedAt)) candidate = card;
    }
    return candidate ? {
        enabled: candidate.enabled === true,
        autoRelevantEnabled: candidate.autoRelevantEnabled === true,
    } : null;
}

export function getCardMemory(settings, character) {
    const normalizedCharacter = normalizeCharacter(character);
    if (!normalizedCharacter) return null;
    const memory = ensureMemorySettings(settings);
    const key = memoryStorageKey(normalizedCharacter);
    return memory.cards[key] ?? null;
}

export function getOrCreateCardMemory(settings, character) {
    const normalizedCharacter = normalizeCharacter(character);
    if (!normalizedCharacter) return null;

    const memory = ensureMemorySettings(settings);
    const storageKey = memoryStorageKey(normalizedCharacter);
    const existing = memory.cards[storageKey];

    if (existing) {
        existing.character = normalizedCharacter;
        if (normalizedCharacter.chatId && !/<MEMORY_EVENT\b/i.test(existing.eventLog) && existing.eventLog.trim()) {
            existing.eventLog = migrateLegacyEventLogToBlocks(existing.eventLog, normalizedCharacter.chatId, existing.processedSignatures);
        }
        return existing;
    }

    if (normalizedCharacter.chatId && memory.cards[normalizedCharacter.key]) {
        const legacy = memory.cards[normalizedCharacter.key];
        delete memory.cards[normalizedCharacter.key];
        const normalized = normalizeCardMemory(legacy, normalizedCharacter);
        memory.cards[storageKey] = assignNormalizedCard(legacy, normalized);
        return memory.cards[storageKey];
    }

    const defaults = mostRecentCardDefaults(memory, normalizedCharacter.key);
    const created = normalizeCardMemory({
        enabled: defaults?.enabled === true,
        autoRelevantEnabled: defaults?.autoRelevantEnabled === true,
    }, normalizedCharacter);
    memory.cards[storageKey] = created;
    return created;
}

export function buildMemoryContextText(eventText, cardName = 'Current card', mode = 'relevant') {
    const content = cleanString(eventText).trim();
    if (!content) return '';
    const scopeLine = mode === 'full'
        ? 'The complete event history is included because the user explicitly requested a full-memory refresh for this generation.'
        : 'This historical memory context was selected because it may be relevant to the current request or situation.';

    return [
        `<MEMORY_CONTEXT card="${cleanString(cardName) || 'Current card'}">`,
        scopeLine,
        'Usage rules:',
        '- Use a remembered event only when relevant to the current scene, request, character, relationship, location, consequence, or causal chain.',
        '- If a memory is not relevant, ignore it completely. Do not force old events into the prose merely because they appear here.',
        '- Preserve continuity and factual consequences when relevant, but do not treat an old event as if it just happened.',
        '- Do not mention this memory system, retrieval process, hidden triggers, or Message IDs in the story unless the user explicitly asks about them.',
        '- Do not copy the memory text mechanically; use it only as factual historical context.',
        '',
        content,
        '</MEMORY_CONTEXT>',
    ].join('\n');
}

export function toggleFullInjectNext(card) {
    if (!card || typeof card !== 'object') return false;
    card.fullInjectNext = !Boolean(card.fullInjectNext);
    return card.fullInjectNext;
}

export function getMemoryInjectionText(settings, character) {
    const card = getCardMemory(settings, character);
    if (!card?.fullInjectNext) return '';
    if (!card.eventLog.trim()) return '';
    return buildMemoryContextText(card.eventLog, card.character?.name || 'Current card', 'full');
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
Your only job is to decide whether the newest assistant response contains one or more events worth preserving, then write the new log entry in concrete detail and create a compact hidden retrieval index for that event.

STRICT SOURCE RULES:
- Actual narrative that happened on-page is the source of truth.
- Planning, hidden reasoning, <story_driver>, <think>, analysis, predictions, proposed future actions, and choices are NOT events unless the same action actually occurs in the narrative.
- Existing Event Log is historical context. Never rewrite, summarize, delete, or correct old entries in your output.
- Do not invent facts, locations, motives, emotions, chronology, participants, injuries, dialogue, or outcomes that are not supported.
- If a detail is uncertain, say it is uncertain instead of guessing.

DETAIL REQUIREMENT:
Never write vague shorthand such as only "A kept the promise", "A defeated B", "they argued", or "the relationship improved". A preserved event must include every detail supported by the text that matters for future continuity: the most precise confirmed location, who was present, what led into the event, the sequence of important actions, how actions were carried out, key dialogue/decisions when relevant, how the event ended, immediate outcome, situational or emotional context that is explicitly supported, consequences that remain active, and links to earlier Event Log entries when this event continues or resolves an earlier situation.

HIDDEN INDEX REQUIREMENT:
The index is not prose for the roleplay model. It is only for retrieval. Keep summary concise but specific. List concrete actors, locations, topics, named entities/items, and prior Message IDs that this event causally continues, changes, fulfills, resolves, or depends on.

OUTPUT:
Return ONLY valid JSON with this exact shape:
{"has_event": true|false, "event_text": "...", "index": {"summary":"...","actors":["..."],"locations":["..."],"topics":["..."],"entities":["..."],"related_ids":["..."]}}
If nothing new is worth preserving, use false, an empty event_text, and omit index or set it to null.
Do NOT add XML/block wrappers to event_text; the extension adds the source chat/message metadata block itself. Use the same language as the existing Event Log; if it is empty, use the language of the new narrative.`;

    const user = `Card: ${name}\nChat ID: ${cleanString(character?.chatId) || '(unknown)'}\nMessage ID: ${messageId}\n\n=== COMPLETE EXISTING EVENT LOG ===\n${existingLog || '(empty)'}\n=== END EVENT LOG ===\n\n=== CANONICAL NARRATIVE THAT ACTUALLY OCCURRED ===\n${canonical || '(no canonical narrative extracted)'}\n=== END CANONICAL NARRATIVE ===\n\n=== FULL ASSISTANT RESPONSE FOR AUXILIARY CONTEXT ===\n${cleanString(fullResponse)}\n=== END FULL RESPONSE ===`;

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
        index: parsed.has_event
            ? (normalizeIndexPayload(parsed.index) ?? fallbackIndexPayload(eventText))
            : null,
    };
}

export function appendEventText(existingLog, eventText) {
    const existing = cleanString(existingLog);
    const addition = cleanString(eventText).trim();
    if (!addition) return existing;
    if (!existing) return addition;
    return `${existing}\n\n${addition}`;
}

function formatIndexEntry(entry) {
    const parts = [
        `Message ID ${entry.messageId}`,
        `summary=${entry.summary || '(no summary)'}`,
    ];
    if (entry.actors.length) parts.push(`actors=${entry.actors.join(', ')}`);
    if (entry.locations.length) parts.push(`locations=${entry.locations.join(', ')}`);
    if (entry.topics.length) parts.push(`topics=${entry.topics.join(', ')}`);
    if (entry.entities.length) parts.push(`entities=${entry.entities.join(', ')}`);
    if (entry.relatedIds.length) parts.push(`related_ids=${entry.relatedIds.join(', ')}`);
    return parts.join(' | ');
}

export function buildSelectorMessages({
    character,
    userPrompt,
    recentAssistant = '',
    eventIndex = [],
}) {
    const name = cleanString(character?.name) || cleanString(character?.key) || 'Current card';
    const index = normalizeEventIndex(eventIndex);

    const system = `You are a relevance selector for a long-running roleplay memory log.
Choose only the event IDs whose full historical details are genuinely useful for answering the CURRENT user prompt in the CURRENT situation.

RULES:
- Be selective. Shared words or the same character name alone are not enough.
- Return an empty list when no old event is needed.
- If the prompt concerns a relationship, opinion, promise, conflict, mystery, ongoing consequence, emotional change, or long-running development, include the causal chain of earlier event IDs needed to understand how the current state developed, not just the newest event.
- If the prompt clearly references a place, past action, item, person, promise, battle, decision, consequence, or "what happened before", select the event IDs that establish that history.
- Recent assistant context is only for resolving references such as "she", "there", "that promise", or "what just happened".
- Never invent IDs. Use only IDs present in the hidden index.

Return ONLY valid JSON:
{"relevant_ids":["22","24"],"reason":"brief internal reason"}
The reason is diagnostic only. The roleplay model will never see this selector prompt or hidden index.`;

    const compactIndex = index.length
        ? index.map(formatIndexEntry).join('\n')
        : '(empty)';
    const user = `Card: ${name}\nChat ID: ${cleanString(character?.chatId) || '(unknown)'}\n\n=== CURRENT USER PROMPT ===\n${cleanString(userPrompt)}\n=== END CURRENT USER PROMPT ===\n\n=== RECENT ASSISTANT CONTEXT ===\n${cleanString(recentAssistant) || '(none)'}\n=== END RECENT CONTEXT ===\n\n=== HIDDEN EVENT INDEX ===\n${compactIndex}\n=== END HIDDEN INDEX ===`;

    return [
        { role: 'system', content: system },
        { role: 'user', content: user },
    ];
}

export function parseMemorySelectionResponse(content) {
    let text = cleanString(content).trim();
    const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fence) text = fence[1].trim();

    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        throw new Error(`Memory selector did not return valid JSON: ${error.message}`);
    }

    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.relevant_ids)) {
        throw new Error('Memory selector JSON must contain relevant_ids array.');
    }

    return {
        relevantIds: uniqueStrings(parsed.relevant_ids),
        reason: cleanString(parsed.reason).trim(),
    };
}

export function selectEventTextByIds(eventLog, relevantIds) {
    const wanted = new Set(uniqueStrings(relevantIds));
    if (!wanted.size) return '';
    const seen = new Set();
    const selected = [];
    for (const block of parseMemoryEventBlocks(eventLog)) {
        if (!wanted.has(block.messageId) || seen.has(block.messageId)) continue;
        seen.add(block.messageId);
        selected.push(block.text);
    }
    return selected.join('\n\n');
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

function isAssistantChatMessage(message) {
    return Boolean(
        message
        && message.is_user !== true
        && message.is_system !== true
        && typeof message.mes === 'string',
    );
}

function objectFilterByIds(source, allowedIds) {
    const result = {};
    if (!source || typeof source !== 'object') return result;
    for (const [key, value] of Object.entries(source)) {
        if (allowedIds.has(String(key))) result[key] = value;
    }
    return result;
}

export function reconcileMemoryWithChat(card, chatId, chat) {
    if (!card || typeof card !== 'object') {
        return { changed: false, removedEventIds: [] };
    }

    const normalizedChatId = cleanString(chatId).trim();
    const currentChat = Array.isArray(chat) ? chat : [];
    const originalEventLog = cleanString(card.eventLog);
    const migratedLog = migrateLegacyEventLogToBlocks(originalEventLog, normalizedChatId, card.processedSignatures);
    const events = parseMemoryEventBlocks(migratedLog);
    const keptEvents = [];
    const keptEventIds = new Set();
    const removedEventIds = [];

    for (const event of events) {
        const id = String(event.messageId);
        const numericId = Number(id);
        const message = Number.isInteger(numericId) && numericId >= 0 ? currentChat[numericId] : null;
        if (event.chatId && normalizedChatId && event.chatId !== normalizedChatId) {
            removedEventIds.push(id);
            continue;
        }
        if (!isAssistantChatMessage(message)) {
            removedEventIds.push(id);
            continue;
        }
        const currentSignature = createMessageSignature(id, message.mes);
        const expectedSignature = event.sourceSignature || cleanString(card.processedSignatures?.[id]);
        if (expectedSignature && currentSignature !== expectedSignature) {
            removedEventIds.push(id);
            continue;
        }
        if (keptEventIds.has(id)) continue;
        keptEventIds.add(id);
        keptEvents.push(formatMemoryEventBlock({
            chatId: normalizedChatId || event.chatId,
            messageId: id,
            sourceSignature: expectedSignature || currentSignature,
            eventText: event.eventText,
        }));
    }

    const nextEventLog = keptEvents.join('\n\n');
    const nextEventIndex = normalizeEventIndex(card.eventIndex).filter((entry) => keptEventIds.has(String(entry.messageId)));

    const validProcessedIds = new Set();
    const nextProcessedSignatures = {};
    for (const key of Object.keys(card.processedMessageIds ?? {})) {
        const numericId = Number(key);
        const message = Number.isInteger(numericId) && numericId >= 0 ? currentChat[numericId] : null;
        if (!isAssistantChatMessage(message)) continue;
        const signature = createMessageSignature(key, message.mes);
        const expected = cleanString(card.processedSignatures?.[key]);
        if (expected && signature !== expected) continue;
        validProcessedIds.add(String(key));
        nextProcessedSignatures[key] = expected || signature;
    }
    const nextProcessedIds = objectFilterByIds(card.processedMessageIds, validProcessedIds);

    const nextFailed = {};
    for (const [key, failed] of Object.entries(card.failedMessages ?? {})) {
        const numericId = Number(key);
        const message = Number.isInteger(numericId) && numericId >= 0 ? currentChat[numericId] : null;
        if (!isAssistantChatMessage(message)) continue;
        if (failed?.messageText && failed.messageText !== message.mes) continue;
        const signature = createMessageSignature(key, message.mes);
        if (failed?.sourceSignature && failed.sourceSignature !== signature) continue;
        nextFailed[key] = { ...failed, sourceSignature: failed?.sourceSignature || signature };
    }

    const changed = nextEventLog !== originalEventLog
        || JSON.stringify(nextEventIndex) !== JSON.stringify(card.eventIndex ?? [])
        || JSON.stringify(nextProcessedIds) !== JSON.stringify(card.processedMessageIds ?? {})
        || JSON.stringify(nextProcessedSignatures) !== JSON.stringify(card.processedSignatures ?? {})
        || JSON.stringify(nextFailed) !== JSON.stringify(card.failedMessages ?? {});

    card.eventLog = nextEventLog;
    card.eventIndex = nextEventIndex;
    card.processedMessageIds = nextProcessedIds;
    card.processedSignatures = nextProcessedSignatures;
    card.failedMessages = nextFailed;
    if (!card.eventLog.trim()) card.fullInjectNext = false;

    return {
        changed,
        removedEventIds: [...new Set(removedEventIds)],
        keptEventIds: [...keptEventIds],
    };
}
