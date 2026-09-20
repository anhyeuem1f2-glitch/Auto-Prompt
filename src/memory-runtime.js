import {
    getCardMemory,
    getOrCreateCardMemory,
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
    formatMemoryEventBlock,
    reconcileMemoryWithChat,
} from './memory-core.js';
import { requestMemoryUpdate as requestMemoryUpdateDefault } from './memory-api.js';

const DEFAULT_RETRY_COUNT = 5;
const DEFAULT_RETRY_DELAY_MS = 20_000;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    messageOverride = null,
    requestMemoryUpdate = requestMemoryUpdateDefault,
    now = Date.now,
    wait = sleep,
    maxRetries = DEFAULT_RETRY_COUNT,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    onRetry = () => {},
}) {
    const message = typeof messageOverride === 'string'
        ? { is_user: false, is_system: false, mes: messageOverride }
        : resolveMessage(context, messageId);
    if (!isAssistantMessage(message)) {
        return { processed: false, reason: 'not-assistant' };
    }

    const card = getOrCreateCardMemory(settings, character);
    if (character?.chatId) {
        const reconcile = reconcileMemoryWithChat(card, character.chatId, context?.chat);
        if (reconcile.changed) context?.saveSettingsDebounced?.();
    }
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

    let attempts = 0;
    let lastError = null;
    while (attempts <= maxRetries) {
        attempts += 1;
        try {
            const content = await requestMemoryUpdate(memory.provider, messages);
            const parsed = parseMemoryModelResponse(content);

            if (parsed.hasEvent) {
                const eventBlock = formatMemoryEventBlock({
                    chatId: character?.chatId ?? '',
                    messageId: messageKey,
                    sourceSignature: signature,
                    eventText: parsed.eventText,
                });
                card.eventLog = appendEventText(card.eventLog, eventBlock);
                card.eventIndex = upsertEventIndexEntry(card.eventIndex, messageKey, parsed.index);
            }

            card.processedMessageIds[messageKey] = true;
            card.processedSignatures[messageKey] = signature;
            if (card.failedMessages) delete card.failedMessages[messageKey];
            card.updatedAt = now();
            context?.saveSettingsDebounced?.();

            return {
                processed: true,
                appended: parsed.hasEvent,
                eventText: parsed.eventText,
                index: parsed.index,
                signature,
                attempts,
            };
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            if (attempts > maxRetries) break;
            const retryNumber = attempts;
            onRetry({
                messageId: messageKey,
                retryNumber,
                maxRetries,
                retryDelayMs,
                error: lastError,
            });
            await wait(retryDelayMs);
        }
    }

    card.failedMessages ??= {};
    card.failedMessages[messageKey] = {
        messageId: messageKey,
        attempts,
        lastError: lastError?.message ?? 'Unknown Memory AI error',
        failedAt: now(),
        messageText: message.mes,
        sourceSignature: signature,
    };
    card.updatedAt = now();
    context?.saveSettingsDebounced?.();

    return {
        processed: false,
        reason: 'retry-exhausted',
        error: lastError ?? new Error('Memory AI retry exhausted.'),
        attempts,
    };
}

export async function recallFailedMemoryMessages({
    context,
    settings,
    character,
    processor = processReceivedAssistantMessage,
    onProgress = () => {},
}) {
    const card = getOrCreateCardMemory(settings, character);
    if (character?.chatId) {
        const reconcile = reconcileMemoryWithChat(card, character.chatId, context?.chat);
        if (reconcile.changed) context?.saveSettingsDebounced?.();
    }
    const queuedIds = Object.keys(card?.failedMessages ?? {});
    let recovered = 0;

    for (const messageId of queuedIds) {
        onProgress({ type: 'recall-start', messageId, total: queuedIds.length, recovered });
        const failedEntry = card.failedMessages?.[messageId];
        const result = await processor({
            context,
            settings,
            character,
            messageId,
            messageOverride: failedEntry?.messageText || null,
            onRetry: (retry) => onProgress({ type: 'retry', ...retry }),
        });
        if (result?.processed) recovered += 1;
        onProgress({ type: 'recall-result', messageId, result, total: queuedIds.length, recovered });
    }

    return {
        total: queuedIds.length,
        recovered,
        remainingIds: Object.keys(card?.failedMessages ?? {}),
    };
}

export async function selectRelevantMemoryForPrompt({
    settings,
    character,
    userPrompt,
    recentAssistant = '',
    requestMemorySelection = requestMemoryUpdateDefault,
    context = null,
}) {
    const card = getOrCreateCardMemory(settings, character);
    if (character?.chatId && context) {
        const reconcile = reconcileMemoryWithChat(card, character.chatId, context?.chat);
        if (reconcile.changed) context?.saveSettingsDebounced?.();
    }
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


export function reconcileCurrentMemory({ context, settings, character }) {
    const card = getOrCreateCardMemory(settings, character);
    if (!card || !character?.chatId) return { changed: false, removedEventIds: [] };
    const result = reconcileMemoryWithChat(card, character.chatId, context?.chat);
    if (result.changed) {
        card.updatedAt = Date.now();
        context?.saveSettingsDebounced?.();
    }
    return result;
}

export function registerMemoryReconcileHooks(
    context,
    settingsProvider,
    characterProvider,
    reconciler = ({ context: currentContext, settings, character }) => reconcileCurrentMemory({ context: currentContext, settings, character }),
    onResult = () => {},
) {
    const bindings = [
        [context?.event_types?.CHAT_CHANGED ?? context?.eventTypes?.CHAT_CHANGED, 'chat-changed'],
        [context?.event_types?.MESSAGE_DELETED ?? context?.eventTypes?.MESSAGE_DELETED, 'message-deleted'],
        [context?.event_types?.MESSAGE_SWIPED ?? context?.eventTypes?.MESSAGE_SWIPED, 'message-swiped'],
    ].filter(([eventType]) => Boolean(eventType));

    const handlers = [];
    for (const [eventType, reason] of bindings) {
        const handler = async () => {
            const payload = {
                context,
                settings: settingsProvider(),
                character: characterProvider(),
                reason,
            };
            const result = await reconciler(payload);
            onResult(result, payload);
            return result;
        };
        context.eventSource.on(eventType, handler);
        handlers.push([eventType, handler]);
    }

    return () => {
        for (const [eventType, handler] of handlers) {
            context.eventSource.removeListener(eventType, handler);
        }
    };
}

export function registerMemoryCaptureHook(
    context,
    settingsProvider,
    characterProvider,
    processor = processReceivedAssistantMessage,
    onResult = () => {},
    onProgress = () => {},
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

        const job = queue.then(() => processor({
            ...payload,
            onRetry: (retry) => onProgress(retry, payload),
        }));
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
