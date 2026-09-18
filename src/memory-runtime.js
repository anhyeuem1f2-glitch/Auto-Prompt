import {
    getCardMemory,
    ensureMemorySettings,
    extractCanonicalNarrative,
    buildMemoryMessages,
    parseMemoryModelResponse,
    appendEventText,
    createMessageSignature,
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

    const signature = createMessageSignature(messageId, message.mes);
    if (card.processedSignatures?.[String(messageId)] === signature) {
        return { processed: false, reason: 'duplicate' };
    }

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
        }

        card.processedSignatures[String(messageId)] = signature;
        card.updatedAt = now();
        context?.saveSettingsDebounced?.();

        return {
            processed: true,
            appended: parsed.hasEvent,
            eventText: parsed.eventText,
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
