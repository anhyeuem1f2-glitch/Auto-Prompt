import {
    getCardMemory,
    ensureMemorySettings,
    extractCanonicalNarrative,
    buildMemoryMessages,
    parseMemoryModelResponse,
    appendEventText,
    createMessageSignature,
    upsertEventIndexEntry,
    buildSelectorMessages,
    parseMemorySelectionResponse,
    selectEventTextByIds,
    buildMemoryContextText,
} from './memory-core.js';
import { requestMemoryUpdate as requestMemoryUpdateDefault } from './memory-api.js';

function resolveMessage(context, messageId) {
    if (!Array.isArray(context?.chat)) return null;
    const numericId = Number(messageId);
    if (Number.isInteger(numericId) && numericId >= 0) {
        return context.chat[numericId] ?? null;
    }
    return null;
}

function isAssistantMessage(message) {
    return Boolean(
        message
        && message.is_user !== true
        && message.is_system !== true
        && typeof message.mes === 'string',
    );
}

function providerConfigured(provider) {
    return Boolean(provider?.baseUrl?.trim?.() && provider?.model?.trim?.());
}

function emptySelection(reason = 'disabled', totalEvents = 0) {
    return {
        mode: 'none',
        text: '',
        relevantIds: [],
        totalEvents,
        reason,
        consumeFullNext: false,
    };
}

export async function processReceivedAssistantMessage({
    context,
    settings,
    character,
    messageId,
    requestMemoryUpdate = requestMemoryUpdateDefault,
    now = Date.now,
}) {
    const message = resolveMessage(context, messageId);
    if (!isAssistantMessage(message)) {
        return { processed: false, reason: 'not-assistant' };
    }

    const card = getCardMemory(settings, character);
    if (!card?.enabled) {
        return { processed: false, reason: 'memory-disabled' };
    }

    const memory = ensureMemorySettings(settings);
    if (!providerConfigured(memory.provider)) {
        return { processed: false, reason: 'provider-not-configured' };
    }

    const messageKey = String(messageId);
    if (card.processedMessageIds?.[messageKey] === true) {
        return { processed: false, reason: 'duplicate' };
    }

    const signature = createMessageSignature(messageId, message.mes);
    const canonicalNarrative = extractCanonicalNarrative(message.mes);
    const messages = buildMemoryMessages({
        character,
        messageId,
        fullResponse: message.mes,
        canonicalNarrative,
        eventLog: card.eventLog,
    });

    try {
        const content = await requestMemoryUpdate(memory.provider, messages);
        const parsed = parseMemoryModelResponse(content);

        if (parsed.hasEvent) {
            card.eventLog = appendEventText(card.eventLog, parsed.eventText);
            card.eventIndex = upsertEventIndexEntry(card.eventIndex, messageKey, parsed.index);
        }

        card.processedMessageIds[messageKey] = true;
        card.processedSignatures[messageKey] = signature;
        card.updatedAt = now();
        context?.saveSettingsDebounced?.();

        return {
            processed: true,
            appended: parsed.hasEvent,
            eventText: parsed.eventText,
            index: parsed.index,
            signature,
        };
    } catch (error) {
        return {
            processed: false,
            reason: 'error',
            error: error instanceof Error ? error : new Error(String(error)),
        };
    }
}

export async function selectRelevantMemoryForPrompt({
    settings,
    character,
    userPrompt,
    recentAssistant = '',
    requestMemorySelection = requestMemoryUpdateDefault,
}) {
    const card = getCardMemory(settings, character);
    if (!card?.eventLog?.trim()) return emptySelection('empty-log', 0);

    const totalEvents = Array.isArray(card.eventIndex) ? card.eventIndex.length : 0;
    const cardName = card.character?.name || character?.name || 'Current card';

    if (card.fullInjectNext) {
        return {
            mode: 'full',
            text: buildMemoryContextText(card.eventLog, cardName, 'full'),
            relevantIds: Array.isArray(card.eventIndex)
                ? card.eventIndex.map((entry) => String(entry.messageId))
                : [],
            totalEvents,
            reason: 'manual-full',
            consumeFullNext: true,
        };
    }

    if (!card.autoRelevantEnabled) return emptySelection('auto-relevant-disabled', totalEvents);
    if (!cleanPrompt(userPrompt)) return emptySelection('empty-user-prompt', totalEvents);

    const memory = ensureMemorySettings(settings);
    if (!providerConfigured(memory.provider)) {
        return emptySelection('provider-not-configured', totalEvents);
    }

    const messages = buildSelectorMessages({
        character,
        userPrompt,
        recentAssistant,
        eventIndex: card.eventIndex,
    });

    try {
        const content = await requestMemorySelection(memory.provider, messages);
        const parsed = parseMemorySelectionResponse(content);
        const validIds = new Set((card.eventIndex ?? []).map((entry) => String(entry.messageId)));
        const relevantIds = parsed.relevantIds.filter((id) => validIds.has(String(id)));
        const selectedText = selectEventTextByIds(card.eventLog, relevantIds);

        if (!selectedText) {
            return {
                ...emptySelection(parsed.reason || 'unrelated', totalEvents),
                relevantIds: [],
            };
        }

        return {
            mode: 'relevant',
            text: buildMemoryContextText(selectedText, cardName, 'relevant'),
            relevantIds,
            totalEvents,
            reason: parsed.reason,
            consumeFullNext: false,
        };
    } catch (error) {
        return {
            ...emptySelection('error', totalEvents),
            error: error instanceof Error ? error : new Error(String(error)),
        };
    }
}

function cleanPrompt(value) {
    return typeof value === 'string' ? value.trim() : '';
}

export function registerMemoryCaptureHook(
    context,
    settingsProvider,
    characterProvider,
    processor = processReceivedAssistantMessage,
    onResult = () => {},
) {
    const eventType = context?.event_types?.MESSAGE_RECEIVED ?? context?.eventTypes?.MESSAGE_RECEIVED;
    if (!eventType) {
        throw new Error('SillyTavern MESSAGE_RECEIVED event is unavailable.');
    }

    let queue = Promise.resolve();
    const handler = async (messageId) => {
        const payload = {
            context,
            settings: settingsProvider(),
            character: characterProvider(messageId),
            messageId,
        };

        const job = queue.then(() => processor(payload));
        queue = job.catch(() => {});
        const result = await job;
        onResult(result, payload);
        return result;
    };

    context.eventSource.on(eventType, handler);

    return () => {
        context.eventSource.removeListener(eventType, handler);
    };
}
