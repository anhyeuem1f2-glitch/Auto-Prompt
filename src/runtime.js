import { mergeActivePrompts } from './reminder-core.js';
import { getCardMemory } from './memory-core.js';

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
 * Merge active Auto Prompt reminders with already-selected memory context and
 * keep exactly one aggregate reminder as the final system message.
 */
export function finalizeReminderInChat(eventData, settings, activeCharacter = null, memoryText = '') {
    const merged = mergeActivePrompts(settings, activeCharacter);
    const selectedMemory = typeof memoryText === 'string' ? memoryText.trim() : '';
    const aggregateText = [merged.text, selectedMemory].filter(Boolean).join('\n\n');
    const chat = eventData?.chat;

    if (!aggregateText || !Array.isArray(chat)) {
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
        if (message?.role === 'system' && message?.content === aggregateText) {
            existingMessage ??= message;
            chat.splice(index, 1);
        }
    }

    chat.push(existingMessage ?? { role: 'system', content: aggregateText });

    const result = {
        active: true,
        promptCount: merged.promptCount,
        textLength: aggregateText.length,
        movedExisting: Boolean(existingMessage),
    };
    if (selectedMemory) result.memoryTextLength = selectedMemory.length;
    return result;
}

function latestRoleContent(chat, role) {
    if (!Array.isArray(chat)) return '';
    for (let index = chat.length - 1; index >= 0; index -= 1) {
        const message = chat[index];
        if (message?.role === role && typeof message.content === 'string') {
            return message.content;
        }
    }
    return '';
}

export function registerFinalPromptHook(
    context,
    settingsProvider,
    characterProvider = () => null,
    memorySelector = async () => ({ mode: 'none', text: '', relevantIds: [], totalEvents: 0, consumeFullNext: false }),
    onInjected = () => {},
    now = Date.now,
) {
    const eventType = context.event_types.CHAT_COMPLETION_PROMPT_READY;

    if (!eventType) {
        throw new Error('SillyTavern CHAT_COMPLETION_PROMPT_READY event is unavailable.');
    }

    const handler = async (eventData) => {
        const settings = settingsProvider();
        const character = characterProvider(eventData);
        const userPrompt = latestRoleContent(eventData?.chat, 'user');
        const recentAssistant = latestRoleContent(eventData?.chat, 'assistant');

        let memorySelection = {
            mode: 'none',
            text: '',
            relevantIds: [],
            totalEvents: 0,
            consumeFullNext: false,
        };

        try {
            memorySelection = await memorySelector({
                settings,
                character,
                userPrompt,
                recentAssistant,
                eventData,
            }) ?? memorySelection;
        } catch (error) {
            console.error('[ST Auto Prompt Reminder] Memory relevance selection failed.', error);
        }

        const result = finalizeReminderInChat(
            eventData,
            settings,
            character,
            memorySelection.text,
        );

        if (result.active && memorySelection.consumeFullNext) {
            const card = getCardMemory(settings, character);
            if (card) {
                card.fullInjectNext = false;
                context.saveSettingsDebounced?.();
            }
        }

        if (result.active) {
            onInjected({
                at: now(),
                promptCount: result.promptCount,
                textLength: result.textLength,
                ...(memorySelection.text ? {
                    memoryTextLength: result.memoryTextLength ?? memorySelection.text.length,
                    memoryMode: memorySelection.mode ?? 'none',
                    memoryRelevantIds: Array.isArray(memorySelection.relevantIds) ? memorySelection.relevantIds : [],
                    memoryTotalEvents: Number(memorySelection.totalEvents) || 0,
                } : {}),
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
