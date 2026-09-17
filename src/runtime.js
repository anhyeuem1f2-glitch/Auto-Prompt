import { getReminderText } from './reminder-core.js';

export const PROMPT_KEY = 'st_auto_prompt_reminder.main';
export const INJECTION_POSITION = 1;
export const INJECTION_DEPTH = 0;
export const INJECTION_ROLE = 0;

export async function applyReminderInjection(context, settings) {
    const text = getReminderText(settings);

    // v0.1.1 staged the reminder through setExtensionPrompt and then appended a
    // final system reminder at CHAT_COMPLETION_PROMPT_READY. In real prompts,
    // the staged copy can already be merged into another prompt layer by the
    // time the final event fires, so exact-message de-duplication cannot remove
    // it. Keep this legacy slot empty and let the final-stage hook be the only
    // source of the reminder.
    await context.setExtensionPrompt(
        PROMPT_KEY,
        '',
        INJECTION_POSITION,
        INJECTION_DEPTH,
        false,
        INJECTION_ROLE,
    );

    return {
        active: Boolean(text),
        textLength: text.length,
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
 * Ensure the reminder is the final system message in a finished Chat Completion prompt.
 * Existing copies created by setExtensionPrompt are removed and one canonical copy is
 * appended at the end so the model sees the reminder after all other prompt layers.
 */
export function finalizeReminderInChat(eventData, settings) {
    const text = getReminderText(settings);
    const chat = eventData?.chat;

    if (!text || !Array.isArray(chat)) {
        return { active: false, textLength: 0, movedExisting: false };
    }

    let existingMessage = null;

    for (let index = chat.length - 1; index >= 0; index -= 1) {
        const message = chat[index];
        if (message?.role === 'system' && message?.content === text) {
            existingMessage ??= message;
            chat.splice(index, 1);
        }
    }

    chat.push(existingMessage ?? { role: 'system', content: text });

    return {
        active: true,
        textLength: text.length,
        movedExisting: Boolean(existingMessage),
    };
}

export function registerFinalPromptHook(context, settingsProvider, onInjected = () => {}, now = Date.now) {
    const eventType = context.event_types.CHAT_COMPLETION_PROMPT_READY;

    if (!eventType) {
        throw new Error('SillyTavern CHAT_COMPLETION_PROMPT_READY event is unavailable.');
    }

    const handler = async (eventData) => {
        const result = finalizeReminderInChat(eventData, settingsProvider());

        if (result.active) {
            onInjected({
                at: now(),
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
