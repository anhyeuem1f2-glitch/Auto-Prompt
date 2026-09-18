import { ensureMemorySettings } from './memory-core.js';

export const MODULE_NAME = 'st_auto_prompt_reminder';
export const SCHEMA_VERSION = 3;

export const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    schemaVersion: SCHEMA_VERSION,
    prompts: [],
});

function defaultIdFactory() {
    if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
    }

    return `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function cleanString(value) {
    return typeof value === 'string' ? value : '';
}

function normalizeCharacterBinding(binding) {
    if (!binding || typeof binding !== 'object') return null;

    const avatar = cleanString(binding.avatar);
    const name = cleanString(binding.name);
    const key = cleanString(binding.key)
        || (avatar ? `avatar:${avatar}` : (name ? `name:${name}` : ''));

    if (!key && !avatar && !name) return null;

    return { key, avatar, name };
}

export function createPromptEntry(overrides = {}, idFactory = defaultIdFactory) {
    const scope = overrides.scope === 'character' ? 'character' : 'global';
    const character = scope === 'character'
        ? normalizeCharacterBinding(overrides.character)
        : null;

    return {
        id: cleanString(overrides.id) || idFactory(),
        name: cleanString(overrides.name) || 'Prompt mới',
        enabled: overrides.enabled !== false,
        scope,
        character,
        content: cleanString(overrides.content),
        order: Number.isFinite(Number(overrides.order)) ? Number(overrides.order) : 0,
    };
}

function normalizePrompts(prompts, idFactory) {
    if (!Array.isArray(prompts)) return [];

    return prompts.map((entry, index) => createPromptEntry({
        ...entry,
        order: Number.isFinite(Number(entry?.order)) ? Number(entry.order) : index,
    }, idFactory));
}

export function ensureSettings(extensionSettings, idFactory = defaultIdFactory) {
    if (!extensionSettings[MODULE_NAME] || typeof extensionSettings[MODULE_NAME] !== 'object') {
        extensionSettings[MODULE_NAME] = {
            enabled: DEFAULT_SETTINGS.enabled,
            schemaVersion: SCHEMA_VERSION,
            prompts: [],
        };
    }

    const settings = extensionSettings[MODULE_NAME];
    settings.enabled = settings.enabled !== false;

    const legacyPromptText = typeof settings.promptText === 'string' ? settings.promptText : '';
    const hasSchemaV2Prompts = settings.schemaVersion === SCHEMA_VERSION && Array.isArray(settings.prompts);

    if (!hasSchemaV2Prompts) {
        const migratedPrompts = normalizePrompts(settings.prompts, idFactory);

        if (legacyPromptText.trim().length > 0) {
            const alreadyMigrated = migratedPrompts.some((entry) => entry.content === legacyPromptText);
            if (!alreadyMigrated) {
                migratedPrompts.push(createPromptEntry({
                    name: 'Prompt cũ',
                    enabled: true,
                    scope: 'global',
                    character: null,
                    content: legacyPromptText,
                    order: migratedPrompts.length,
                }, idFactory));
            }
        }

        settings.prompts = migratedPrompts;
        settings.schemaVersion = SCHEMA_VERSION;
    } else {
        settings.prompts = normalizePrompts(settings.prompts, idFactory);
    }

    delete settings.promptText;
    ensureMemorySettings(settings);

    return settings;
}

function readCharacterName(character) {
    return cleanString(character?.name)
        || cleanString(character?.data?.name)
        || cleanString(character?.name2);
}

function readCharacterAvatar(character) {
    return cleanString(character?.avatar)
        || cleanString(character?.data?.avatar)
        || cleanString(character?.filename)
        || cleanString(character?.card_filename)
        || cleanString(character?.cardFilename);
}

export function resolveCharacterIdentity(context) {
    if (!context || typeof context !== 'object') return null;

    let character = null;

    if (context.character && typeof context.character === 'object') {
        character = context.character;
    }

    if (!character && Number.isInteger(context.characterId) && Array.isArray(context.characters)) {
        character = context.characters[context.characterId] ?? null;
    }

    if (!character && typeof context.name2 === 'string' && context.name2.trim() && Array.isArray(context.characters)) {
        character = context.characters.find((candidate) => readCharacterName(candidate) === context.name2) ?? null;
    }

    const fallbackName = cleanString(context.name2).trim();
    if (!character && !fallbackName) return null;

    const avatar = readCharacterAvatar(character);
    const name = readCharacterName(character) || fallbackName;

    if (!avatar && !name) return null;

    return {
        key: avatar ? `avatar:${avatar}` : `name:${name}`,
        avatar,
        name,
    };
}

export function characterBindingsMatch(binding, activeCharacter) {
    const stored = normalizeCharacterBinding(binding);
    const active = normalizeCharacterBinding(activeCharacter);

    if (!stored || !active) return false;

    if (stored.avatar && active.avatar) {
        return stored.avatar === active.avatar;
    }

    if (stored.key && active.key) {
        return stored.key === active.key;
    }

    return Boolean(stored.name && active.name && stored.name === active.name);
}

export function getActivePrompts(settings, activeCharacter = null) {
    if (!settings?.enabled || !Array.isArray(settings.prompts)) return [];

    return settings.prompts
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => {
            if (!entry?.enabled) return false;
            if (typeof entry.content !== 'string' || entry.content.trim().length === 0) return false;

            if (entry.scope === 'character') {
                return characterBindingsMatch(entry.character, activeCharacter);
            }

            return true;
        })
        .sort((a, b) => {
            const orderA = Number.isFinite(Number(a.entry.order)) ? Number(a.entry.order) : a.index;
            const orderB = Number.isFinite(Number(b.entry.order)) ? Number(b.entry.order) : b.index;
            if (orderA !== orderB) return orderA - orderB;
            return a.index - b.index;
        })
        .map(({ entry }) => entry);
}

export function mergeActivePrompts(settings, activeCharacter = null) {
    const prompts = getActivePrompts(settings, activeCharacter);
    const text = prompts.map((entry) => entry.content).join('\n\n');

    return {
        text,
        prompts,
        promptCount: prompts.length,
        textLength: text.length,
    };
}

export function getReminderText(settings, activeCharacter = null) {
    return mergeActivePrompts(settings, activeCharacter).text;
}
