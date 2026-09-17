export const MODULE_NAME = 'st_auto_prompt_reminder';

export const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    promptText: '',
});

export function ensureSettings(extensionSettings) {
    if (!extensionSettings[MODULE_NAME] || typeof extensionSettings[MODULE_NAME] !== 'object') {
        extensionSettings[MODULE_NAME] = { ...DEFAULT_SETTINGS };
    }

    const settings = extensionSettings[MODULE_NAME];

    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (!Object.hasOwn(settings, key)) {
            settings[key] = value;
        }
    }

    return settings;
}

export function getReminderText(settings) {
    if (!settings?.enabled || typeof settings.promptText !== 'string') {
        return '';
    }

    return settings.promptText.trim().length > 0 ? settings.promptText : '';
}
