import { ensureSettings, getReminderText } from './src/reminder-core.js';
import { applyReminderInjection, registerFinalPromptHook, registerGenerationHook } from './src/runtime.js';

const ROOT_ID = 'st-auto-prompt-reminder-settings';
const TEXTAREA_ID = 'st-auto-prompt-text';
const TOGGLE_ID = 'st-auto-prompt-enabled';
const STATUS_ID = 'st-auto-prompt-status';

let initialized = false;
let cleanupGenerationHook = null;
let cleanupFinalPromptHook = null;
let lastInjectionInfo = null;

function getStatusText(settings) {
    const text = getReminderText(settings);

    if (!settings.enabled) {
        return 'Tạm dừng — prompt nhắc nhở hiện không được chèn.';
    }

    if (!text) {
        return 'Đang chờ — hãy nhập prompt nhắc nhở.';
    }

    if (!lastInjectionInfo) {
        return `Sẵn sàng — sẽ chèn ${text.length} ký tự vào lượt tạo tiếp theo.`;
    }

    const time = new Date(lastInjectionInfo.at).toLocaleTimeString();
    if (lastInjectionInfo.finalStage) {
        return `✓ Đã chèn ở cuối prompt gửi AI · ${lastInjectionInfo.textLength} ký tự · ${time}`;
    }

    return `✓ Đã chèn vào lượt tạo gần nhất · ${lastInjectionInfo.textLength} ký tự · ${time}`;
}

function renderStatus(settings) {
    const status = document.getElementById(STATUS_ID);
    if (status) {
        status.textContent = getStatusText(settings);
    }
}

function createSettingsPanel(context, settings) {
    if (document.getElementById(ROOT_ID)) {
        renderStatus(settings);
        return true;
    }

    const host = document.getElementById('extensions_settings2');
    if (!host) {
        console.warn('[ST Auto Prompt Reminder] #extensions_settings2 was not found.');
        return false;
    }

    const root = document.createElement('div');
    root.id = ROOT_ID;
    root.className = 'st-auto-prompt-reminder';
    root.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Tự động chèn Prompt</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content st-auto-prompt-content">
                <label class="st-auto-prompt-toggle" for="${TOGGLE_ID}">
                    <input id="${TOGGLE_ID}" type="checkbox">
                    <span>Bật tự động chèn vào mọi lượt</span>
                </label>

                <label for="${TEXTAREA_ID}" class="st-auto-prompt-label">Prompt nhắc nhở</label>
                <textarea
                    id="${TEXTAREA_ID}"
                    class="text_pole st-auto-prompt-textarea"
                    rows="14"
                    spellcheck="false"
                    placeholder="Nhập toàn bộ prompt bạn muốn AI luôn nhận ở mọi lượt..."
                ></textarea>

                <div id="${STATUS_ID}" class="st-auto-prompt-status" aria-live="polite"></div>
                <small class="st-auto-prompt-hint">
                    Nội dung được tự lưu. Extension chèn ở depth 0 để Prompt Reviewer nhìn thấy, sau đó đưa cùng system reminder xuống cuối prompt ngay trước khi gửi AI.
                </small>
            </div>
        </div>
    `;

    host.appendChild(root);

    const toggle = document.getElementById(TOGGLE_ID);
    const textarea = document.getElementById(TEXTAREA_ID);

    toggle.checked = Boolean(settings.enabled);
    textarea.value = typeof settings.promptText === 'string' ? settings.promptText : '';

    const saveAndRefreshInjection = async () => {
        context.saveSettingsDebounced();
        try {
            await applyReminderInjection(context, settings);
        } catch (error) {
            console.error('[ST Auto Prompt Reminder] Failed to refresh prompt injection.', error);
        }
        renderStatus(settings);
    };

    toggle.addEventListener('change', async () => {
        settings.enabled = toggle.checked;
        lastInjectionInfo = null;
        await saveAndRefreshInjection();
    });

    textarea.addEventListener('input', async () => {
        settings.promptText = textarea.value;
        lastInjectionInfo = null;
        await saveAndRefreshInjection();
    });

    renderStatus(settings);
    return true;
}

async function init() {
    if (initialized) return;
    initialized = true;

    const context = globalThis.SillyTavern?.getContext?.();
    if (!context) {
        initialized = false;
        console.error('[ST Auto Prompt Reminder] SillyTavern context is unavailable.');
        return;
    }

    if (typeof context.setExtensionPrompt !== 'function') {
        initialized = false;
        console.error('[ST Auto Prompt Reminder] setExtensionPrompt is unavailable in this SillyTavern version.');
        return;
    }

    const settings = ensureSettings(context.extensionSettings);

    try {
        await applyReminderInjection(context, settings);
    } catch (error) {
        console.error('[ST Auto Prompt Reminder] Initial injection setup failed.', error);
    }

    cleanupGenerationHook = registerGenerationHook(
        context,
        () => settings,
        (info) => {
            console.debug('[ST Auto Prompt Reminder] Staged reminder for generation.', info);
        },
    );

    try {
        cleanupFinalPromptHook = registerFinalPromptHook(
            context,
            () => settings,
            (info) => {
                lastInjectionInfo = info;
                renderStatus(settings);
                console.debug('[ST Auto Prompt Reminder] Finalized reminder as the last system message.', info);
            },
        );
    } catch (error) {
        console.warn('[ST Auto Prompt Reminder] Final-stage prompt hook is unavailable; using depth-0 injection only.', error);
    }

    createSettingsPanel(context, settings);
    console.log('[ST Auto Prompt Reminder] Loaded.');
}

export function onDisable() {
    cleanupGenerationHook?.();
    cleanupGenerationHook = null;
    cleanupFinalPromptHook?.();
    cleanupFinalPromptHook = null;

    const context = globalThis.SillyTavern?.getContext?.();
    if (context) {
        const settings = ensureSettings(context.extensionSettings);
        applyReminderInjection(context, { ...settings, enabled: false }).catch((error) => {
            console.error('[ST Auto Prompt Reminder] Failed to clear prompt on disable.', error);
        });
    }
}

const bootstrapContext = globalThis.SillyTavern?.getContext?.();
if (bootstrapContext?.eventSource && bootstrapContext?.event_types?.APP_READY) {
    bootstrapContext.eventSource.on(bootstrapContext.event_types.APP_READY, init);
} else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
    queueMicrotask(init);
}
