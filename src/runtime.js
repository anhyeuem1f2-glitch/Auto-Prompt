import { getReminderText } from './reminder-core.js';

export const PROMPT_KEY = 'st_auto_prompt_reminder.main';
export const INJECTION_POSITION = 1;
export const INJECTION_DEPTH = 0;
export const INJECTION_ROLE = 0;

export async function applyReminderInjection(context, settings, onInjected = () => {}, now = Date.now) {
    const text = getReminderText(settings);

    await context.setExtensionPrompt(
        PROMPT_KEY,
        text,
        INJECTION_POSITION,
        INJECTION_DEPTH,
        false,
        INJECTION_ROLE,
    );

    if (text) {
        onInjected({
            at: now(),
            textLength: text.length,
        });
    }

    return {
        active: Boolean(text),
        textLength: text.length,
    };
}

export function registerGenerationHook(context, settingsProvider, onInjected = () => {}, now = Date.now) {
    const eventType = context.event_types.GENERATION_AFTER_COMMANDS ?? context.event_types.GENERATION_STARTED;

    if (!eventType) {
        throw new Error('SillyTavern generation event is unavailable.');
    }

    const handler = async () => {
        await applyReminderInjection(context, settingsProvider(), onInjected, now);
    };

    context.eventSource.on(eventType, handler);

    return () => {
        context.eventSource.removeListener(eventType, handler);
    };
}
