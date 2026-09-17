import {
    createPromptEntry,
    ensureSettings,
    mergeActivePrompts,
    resolveCharacterIdentity,
} from './src/reminder-core.js';
import { applyReminderInjection, registerFinalPromptHook, registerGenerationHook } from './src/runtime.js';

const ROOT_ID = 'st-auto-prompt-reminder-settings';
const TOGGLE_ID = 'st-auto-prompt-enabled';
const STATUS_ID = 'st-auto-prompt-status';
const LIST_ID = 'st-auto-prompt-list';
const ADD_ID = 'st-auto-prompt-add';
const EDITOR_ID = 'st-auto-prompt-editor';
const NAME_ID = 'st-auto-prompt-name';
const SCOPE_ID = 'st-auto-prompt-scope';
const CONTENT_ID = 'st-auto-prompt-content';
const BIND_ID = 'st-auto-prompt-bind-current';
const BINDING_ID = 'st-auto-prompt-character-binding';

let initialized = false;
let cleanupGenerationHook = null;
let cleanupFinalPromptHook = null;
let lastInjectionInfo = null;
let selectedPromptId = null;

function currentContext(fallback = null) {
    return globalThis.SillyTavern?.getContext?.() ?? fallback;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function sortedPrompts(settings) {
    return [...settings.prompts].sort((a, b) => {
        const orderA = Number.isFinite(Number(a.order)) ? Number(a.order) : 0;
        const orderB = Number.isFinite(Number(b.order)) ? Number(b.order) : 0;
        return orderA - orderB;
    });
}

function activeCharacter(context) {
    return resolveCharacterIdentity(currentContext(context));
}

function getSelectedPrompt(settings) {
    return settings.prompts.find((prompt) => prompt.id === selectedPromptId) ?? null;
}

function resetLastInjection() {
    lastInjectionInfo = null;
}

async function persist(context, settings) {
    context.saveSettingsDebounced();
    resetLastInjection();

    try {
        await applyReminderInjection(context, settings);
    } catch (error) {
        console.error('[ST Auto Prompt Reminder] Failed to keep the legacy injection slot clear.', error);
    }

    renderStatus(context, settings);
}

function getStatusText(context, settings) {
    if (!settings.enabled) {
        return 'Tạm dừng — Auto Prompt hiện không được chèn.';
    }

    if (lastInjectionInfo?.finalStage) {
        const time = new Date(lastInjectionInfo.at).toLocaleTimeString();
        return `✓ Đã chèn ${lastInjectionInfo.promptCount} prompt ở cuối prompt gửi AI · ${lastInjectionInfo.textLength.toLocaleString()} ký tự · ${time}`;
    }

    const merged = mergeActivePrompts(settings, activeCharacter(context));
    if (!merged.text) {
        return 'Đang chờ — chưa có prompt đang bật phù hợp với card hiện tại.';
    }

    return `Sẵn sàng — ${merged.promptCount} prompt phù hợp · ${merged.textLength.toLocaleString()} ký tự`;
}

function renderStatus(context, settings) {
    const status = document.getElementById(STATUS_ID);
    if (status) status.textContent = getStatusText(context, settings);
}

function scopeLabel(prompt) {
    if (prompt.scope !== 'character') return 'Global';
    return prompt.character?.name ? `Card: ${prompt.character.name}` : 'Card: Chưa gắn';
}

function normalizeOrder(settings) {
    const ordered = sortedPrompts(settings);
    ordered.forEach((prompt, index) => {
        prompt.order = index;
    });
    settings.prompts = ordered;
}

function renderPromptList(context, settings) {
    const list = document.getElementById(LIST_ID);
    if (!list) return;

    const prompts = sortedPrompts(settings);
    if (prompts.length === 0) {
        list.innerHTML = '<div class="st-auto-prompt-empty">Chưa có prompt. Bấm “+ Thêm prompt” để tạo.</div>';
        return;
    }

    list.innerHTML = prompts.map((prompt, index) => `
        <div class="st-auto-prompt-row${prompt.id === selectedPromptId ? ' is-selected' : ''}" data-prompt-id="${escapeHtml(prompt.id)}">
            <label class="st-auto-prompt-row-toggle" title="Bật/tắt prompt này">
                <input class="st-auto-prompt-entry-enabled" type="checkbox" ${prompt.enabled ? 'checked' : ''}>
            </label>
            <button type="button" class="st-auto-prompt-row-main st-auto-prompt-edit" title="Chỉnh sửa prompt">
                <span class="st-auto-prompt-row-name">${escapeHtml(prompt.name || 'Prompt chưa đặt tên')}</span>
                <span class="st-auto-prompt-badge">${escapeHtml(scopeLabel(prompt))}</span>
            </button>
            <div class="st-auto-prompt-row-actions">
                <button type="button" class="menu_button st-auto-prompt-up" title="Đưa lên" ${index === 0 ? 'disabled' : ''}>↑</button>
                <button type="button" class="menu_button st-auto-prompt-down" title="Đưa xuống" ${index === prompts.length - 1 ? 'disabled' : ''}>↓</button>
                <button type="button" class="menu_button st-auto-prompt-delete" title="Xóa prompt">×</button>
            </div>
        </div>
    `).join('');

    list.querySelectorAll('.st-auto-prompt-entry-enabled').forEach((checkbox) => {
        checkbox.addEventListener('change', async (event) => {
            const row = event.target.closest('[data-prompt-id]');
            const prompt = settings.prompts.find((item) => item.id === row?.dataset.promptId);
            if (!prompt) return;
            prompt.enabled = event.target.checked;
            await persist(context, settings);
        });
    });

    list.querySelectorAll('.st-auto-prompt-edit').forEach((button) => {
        button.addEventListener('click', (event) => {
            const row = event.target.closest('[data-prompt-id]');
            selectedPromptId = row?.dataset.promptId ?? null;
            renderPromptList(context, settings);
            renderEditor(context, settings);
        });
    });

    list.querySelectorAll('.st-auto-prompt-delete').forEach((button) => {
        button.addEventListener('click', async (event) => {
            const row = event.target.closest('[data-prompt-id]');
            const promptId = row?.dataset.promptId;
            const prompt = settings.prompts.find((item) => item.id === promptId);
            if (!prompt) return;

            if (!globalThis.confirm?.(`Xóa prompt “${prompt.name}”?`)) return;

            settings.prompts = settings.prompts.filter((item) => item.id !== promptId);
            normalizeOrder(settings);
            if (selectedPromptId === promptId) selectedPromptId = null;
            await persist(context, settings);
            renderPromptList(context, settings);
            renderEditor(context, settings);
        });
    });

    const movePrompt = async (promptId, direction) => {
        const ordered = sortedPrompts(settings);
        const index = ordered.findIndex((item) => item.id === promptId);
        const targetIndex = index + direction;
        if (index < 0 || targetIndex < 0 || targetIndex >= ordered.length) return;

        [ordered[index], ordered[targetIndex]] = [ordered[targetIndex], ordered[index]];
        ordered.forEach((prompt, order) => {
            prompt.order = order;
        });
        settings.prompts = ordered;
        await persist(context, settings);
        renderPromptList(context, settings);
    };

    list.querySelectorAll('.st-auto-prompt-up').forEach((button) => {
        button.addEventListener('click', async (event) => {
            const row = event.target.closest('[data-prompt-id]');
            await movePrompt(row?.dataset.promptId, -1);
        });
    });

    list.querySelectorAll('.st-auto-prompt-down').forEach((button) => {
        button.addEventListener('click', async (event) => {
            const row = event.target.closest('[data-prompt-id]');
            await movePrompt(row?.dataset.promptId, 1);
        });
    });
}

function renderBinding(context, prompt) {
    const binding = document.getElementById(BINDING_ID);
    const bindButton = document.getElementById(BIND_ID);
    const show = prompt?.scope === 'character';

    if (binding) {
        binding.hidden = !show;
        binding.textContent = show
            ? (prompt.character?.name ? `Đang gắn với: ${prompt.character.name}` : 'Chưa gắn với card nào.')
            : '';
    }

    if (bindButton) bindButton.hidden = !show;
}

function renderEditor(context, settings) {
    const editor = document.getElementById(EDITOR_ID);
    if (!editor) return;

    const prompt = getSelectedPrompt(settings);
    if (!prompt) {
        editor.hidden = true;
        editor.innerHTML = '';
        return;
    }

    editor.hidden = false;
    editor.innerHTML = `
        <div class="st-auto-prompt-editor-head">
            <b>Chỉnh sửa prompt</b>
            <button type="button" class="menu_button st-auto-prompt-editor-close" title="Đóng">×</button>
        </div>

        <label class="st-auto-prompt-field" for="${NAME_ID}">
            <span>Tên prompt</span>
            <input id="${NAME_ID}" class="text_pole" type="text" value="${escapeHtml(prompt.name)}" placeholder="Ví dụ: Quy tắc viết">
        </label>

        <label class="st-auto-prompt-field" for="${SCOPE_ID}">
            <span>Phạm vi</span>
            <select id="${SCOPE_ID}" class="text_pole">
                <option value="global" ${prompt.scope === 'global' ? 'selected' : ''}>Global — dùng cho mọi card</option>
                <option value="character" ${prompt.scope === 'character' ? 'selected' : ''}>Character — chỉ dùng cho card đã gắn</option>
            </select>
        </label>

        <div class="st-auto-prompt-binding-wrap">
            <div id="${BINDING_ID}" class="st-auto-prompt-binding"></div>
            <button id="${BIND_ID}" type="button" class="menu_button st-auto-prompt-bind-current">Gắn với card hiện tại</button>
        </div>

        <label class="st-auto-prompt-field" for="${CONTENT_ID}">
            <span>Nội dung prompt</span>
            <textarea id="${CONTENT_ID}" class="text_pole st-auto-prompt-editor-content" rows="12" spellcheck="false" placeholder="Nhập prompt sẽ được ghép vào lời nhắc cuối cùng...">${escapeHtml(prompt.content)}</textarea>
        </label>
    `;

    renderBinding(context, prompt);

    const nameInput = document.getElementById(NAME_ID);
    const scopeSelect = document.getElementById(SCOPE_ID);
    const contentInput = document.getElementById(CONTENT_ID);
    const bindButton = document.getElementById(BIND_ID);
    const closeButton = editor.querySelector('.st-auto-prompt-editor-close');

    nameInput.addEventListener('input', async () => {
        prompt.name = nameInput.value;
        await persist(context, settings);
        renderPromptList(context, settings);
    });

    scopeSelect.addEventListener('change', async () => {
        prompt.scope = scopeSelect.value === 'character' ? 'character' : 'global';
        if (prompt.scope === 'global') prompt.character = null;
        await persist(context, settings);
        renderPromptList(context, settings);
        renderBinding(context, prompt);
    });

    contentInput.addEventListener('input', async () => {
        prompt.content = contentInput.value;
        await persist(context, settings);
    });

    bindButton.addEventListener('click', async () => {
        const character = activeCharacter(context);
        if (!character) {
            globalThis.toastr?.warning?.('Không tìm thấy card hiện tại để liên kết.');
            return;
        }

        prompt.scope = 'character';
        prompt.character = character;
        scopeSelect.value = 'character';
        await persist(context, settings);
        renderPromptList(context, settings);
        renderBinding(context, prompt);
    });

    closeButton.addEventListener('click', () => {
        selectedPromptId = null;
        renderPromptList(context, settings);
        renderEditor(context, settings);
    });
}

function createSettingsPanel(context, settings) {
    if (document.getElementById(ROOT_ID)) {
        renderPromptList(context, settings);
        renderEditor(context, settings);
        renderStatus(context, settings);
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

                <div class="st-auto-prompt-toolbar">
                    <b>Danh sách prompt</b>
                    <button id="${ADD_ID}" type="button" class="menu_button st-auto-prompt-add">+ Thêm prompt</button>
                </div>

                <div id="${LIST_ID}" class="st-auto-prompt-list"></div>
                <div id="${EDITOR_ID}" class="st-auto-prompt-editor" hidden></div>

                <div id="${STATUS_ID}" class="st-auto-prompt-status" aria-live="polite"></div>
                <small class="st-auto-prompt-hint">
                    Prompt Global luôn được cộng vào. Prompt Character chỉ được cộng khi đúng card đã gắn. Tất cả prompt phù hợp được ghép thành một system message duy nhất ở cuối prompt gửi AI.
                </small>
            </div>
        </div>
    `;

    host.appendChild(root);

    const toggle = document.getElementById(TOGGLE_ID);
    const addButton = document.getElementById(ADD_ID);
    toggle.checked = Boolean(settings.enabled);

    toggle.addEventListener('change', async () => {
        settings.enabled = toggle.checked;
        await persist(context, settings);
    });

    addButton.addEventListener('click', async () => {
        const maxOrder = settings.prompts.reduce((max, prompt) => Math.max(max, Number(prompt.order) || 0), -1);
        const prompt = createPromptEntry({
            name: `Prompt ${settings.prompts.length + 1}`,
            enabled: true,
            scope: 'global',
            content: '',
            order: maxOrder + 1,
        });

        settings.prompts.push(prompt);
        selectedPromptId = prompt.id;
        normalizeOrder(settings);
        await persist(context, settings);
        renderPromptList(context, settings);
        renderEditor(context, settings);
    });

    renderPromptList(context, settings);
    renderEditor(context, settings);
    renderStatus(context, settings);
    return true;
}

async function init() {
    if (initialized) return;
    initialized = true;

    const context = currentContext();
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
    normalizeOrder(settings);
    context.saveSettingsDebounced();

    try {
        await applyReminderInjection(context, settings);
    } catch (error) {
        console.error('[ST Auto Prompt Reminder] Initial legacy-slot cleanup failed.', error);
    }

    cleanupGenerationHook = registerGenerationHook(context, () => settings);

    try {
        cleanupFinalPromptHook = registerFinalPromptHook(
            context,
            () => settings,
            () => activeCharacter(context),
            (info) => {
                lastInjectionInfo = info;
                renderStatus(context, settings);
                console.debug('[ST Auto Prompt Reminder] Finalized aggregate reminder as the last system message.', info);
            },
        );
    } catch (error) {
        console.error('[ST Auto Prompt Reminder] Final-stage prompt hook is unavailable; reminders cannot be injected safely.', error);
    }

    createSettingsPanel(context, settings);
    console.log('[ST Auto Prompt Reminder] Loaded v0.2.0.');
}

export function onDisable() {
    cleanupGenerationHook?.();
    cleanupGenerationHook = null;
    cleanupFinalPromptHook?.();
    cleanupFinalPromptHook = null;

    const context = currentContext();
    if (context) {
        const settings = ensureSettings(context.extensionSettings);
        applyReminderInjection(context, { ...settings, enabled: false }).catch((error) => {
            console.error('[ST Auto Prompt Reminder] Failed to clear prompt on disable.', error);
        });
    }
}

const bootstrapContext = currentContext();
if (bootstrapContext?.eventSource && bootstrapContext?.event_types?.APP_READY) {
    bootstrapContext.eventSource.on(bootstrapContext.event_types.APP_READY, init);
} else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
    queueMicrotask(init);
}
