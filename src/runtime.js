import { mergeActivePrompts } from './reminder-core.js';

export const PROMPT_KEY = 'st_auto_prompt_reminder.main';
export const INJECTION_POSITION = 1;
export const INJECTION_DEPTH = 0;
export const INJECTION_ROLE = 0;

export async function applyReminderInjection(context, settings) {
    await context.setExtensionPrompt(
        PROMPT_KEY,
        '',
        INJECTION_POSITION,
        INJECTION_DEPTH,
        false,
        INJECTION_ROLE,
    );

    return {
        active: Boolean(settings?.enabled),
        staged: false,
    };
}

export function registerGenerationHook(context, settingsProvider) {
    const eventType = context.event_types.GENERATION_AFTER_COMMANDS ?? context.event_types.GENERATION_STARTED;

    if (!eventType) {
        throw new Error('SillyTavern generation event is unavailable.');
    }

    const handler = async () => {
        await applyReminderInjection(context, settingsProvider());
    };

    context.eventSource.on(eventType, handler);

    return () => {
        context.eventSource.removeListener(eventType, handler);
    };
}

/**
 * Merge all active prompt entries and keep exactly one aggregate reminder as
 * the final system message in the finished Chat Completion prompt.
 */
export function finalizeReminderInChat(eventData, settings, activeCharacter = null) {
    const merged = mergeActivePrompts(settings, activeCharacter);
    const chat = eventData?.chat;

    if (!merged.text || !Array.isArray(chat)) {
        return {
            active: false,
            promptCount: 0,
            textLength: 0,
            movedExisting: false,
        };
    }

    let existingMessage = null;

    for (let index = chat.length - 1; index >= 0; index -= 1) {
        const message = chat[index];
        if (message?.role === 'system' && message?.content === merged.text) {
            existingMessage ??= message;
            chat.splice(index, 1);
        }
    }

    chat.push(existingMessage ?? { role: 'system', content: merged.text });

    return {
        active: true,
        promptCount: merged.promptCount,
        textLength: merged.textLength,
        movedExisting: Boolean(existingMessage),
    };
}

export function registerFinalPromptHook(
    context,
    settingsProvider,
    characterProvider = () => null,
    onInjected = () => {},
    now = Date.now,
) {
    const eventType = context.event_types.CHAT_COMPLETION_PROMPT_READY;

    if (!eventType) {
        throw new Error('SillyTavern CHAT_COMPLETION_PROMPT_READY event is unavailable.');
    }

    const handler = async (eventData) => {
        const result = finalizeReminderInChat(
            eventData,
            settingsProvider(),
            characterProvider(eventData),
        );

        if (result.active) {
            onInjected({
                at: now(),
                promptCount: result.promptCount,
                textLength: result.textLength,
                finalStage: true,
                movedExisting: result.movedExisting,
            });
        }
    };

    context.eventSource.on(eventType, handler);

    return () => {
        context.eventSource.removeListener(eventType, handler);
    };
}
