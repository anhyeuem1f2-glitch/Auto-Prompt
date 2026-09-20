import {
    createPromptEntry,
    ensureSettings,
    mergeActivePrompts,
    resolveCharacterIdentity,
} from './src/reminder-core.js';
import { applyReminderInjection, registerFinalPromptHook, registerGenerationHook } from './src/runtime.js';
import { ensureMemorySettings, getOrCreateCardMemory, toggleFullInjectNext } from './src/memory-core.js';
import { loadProviderModels, testProviderConnection } from './src/memory-api.js';
import { processReceivedAssistantMessage, recallFailedMemoryMessages, registerMemoryCaptureHook, registerMemoryReconcileHooks, selectRelevantMemoryForPrompt } from './src/memory-runtime.js';

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
const MEMORY_ENABLED_ID = 'st-auto-memory-enabled';
const MEMORY_AUTO_RELEVANT_ID = 'st-auto-memory-auto-relevant';
const MEMORY_FULL_NEXT_ID = 'st-auto-memory-full-next';
const MEMORY_RECALL_FAILED_ID = 'st-auto-memory-recall-failed';
const MEMORY_EVENT_LOG_ID = 'st-auto-memory-event-log';
const MEMORY_BASE_URL_ID = 'st-auto-memory-base-url';
const MEMORY_API_KEY_ID = 'st-auto-memory-api-key';
const MEMORY_LOAD_MODELS_ID = 'st-auto-memory-load-models';
const MEMORY_MODEL_ID = 'st-auto-memory-model';
const MEMORY_TEST_ID = 'st-auto-memory-test-connection';
const MEMORY_STATUS_ID = 'st-auto-memory-status';
const MEMORY_CARD_ID = 'st-auto-memory-card';
const MEMORY_CHAT_ID = 'st-auto-memory-chat-id';

let initialized = false;
let cleanupGenerationHook = null;
let cleanupFinalPromptHook = null;
let cleanupMemoryHook = null;
let cleanupCardRefreshHook = null;
let cleanupMemoryReconcileHook = null;
let fallbackChatEpoch = 0;
let lastInjectionInfo = null;
let selectedPromptId = null;
let lastMemoryStatus = null;

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

function getCurrentChatId(context) {
    const ctx = currentContext(context);
    const direct = ctx?.getCurrentChatId?.();
    const metadata = ctx?.chatMetadata ?? ctx?.chat_metadata ?? {};
    const candidate = direct
        ?? ctx?.chatId
        ?? ctx?.chat_id
        ?? metadata?.chat_id
        ?? metadata?.chatId
        ?? metadata?.file_name
        ?? metadata?.fileName;
    const value = String(candidate ?? '').trim();
    return value || `unsaved:${fallbackChatEpoch}`;
}

function activeMemoryCharacter(context) {
    const character = activeCharacter(context);
    if (!character) return null;
    return { ...character, chatId: getCurrentChatId(context) };
}

function memoryStatusKey(character) {
    if (!character) return '';
    return `${character.key}::${character.chatId ?? ''}`;
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
    const character = activeCharacter(context);
    const merged = mergeActivePrompts(settings, character);
    const memoryCharacter = activeMemoryCharacter(context);
    const card = memoryCharacter ? getOrCreateCardMemory(settings, memoryCharacter) : null;

    if (lastInjectionInfo?.finalStage) {
        const time = new Date(lastInjectionInfo.at).toLocaleTimeString();
        if (lastInjectionInfo.memoryMode === 'relevant') {
            return `✓ Đã chèn ${lastInjectionInfo.promptCount} prompt + Memory liên quan ${lastInjectionInfo.memoryRelevantIds.length}/${lastInjectionInfo.memoryTotalEvents} event · ${lastInjectionInfo.memoryTextLength.toLocaleString()} ký tự Memory · ${time}`;
        }
        if (lastInjectionInfo.memoryMode === 'full') {
            return `✓ Đã chèn ${lastInjectionInfo.promptCount} prompt + TOÀN BỘ Memory lượt này · ${lastInjectionInfo.memoryTextLength.toLocaleString()} ký tự Memory · ${time}`;
        }
        return `✓ Đã chèn ${lastInjectionInfo.promptCount} prompt ở cuối prompt gửi AI · ${lastInjectionInfo.textLength.toLocaleString()} ký tự · ${time}`;
    }

    if (card?.fullInjectNext && card.eventLog.trim()) {
        return `Sẵn sàng — lượt kế tiếp sẽ bơm TOÀN BỘ Memory (${card.eventLog.length.toLocaleString()} ký tự).`;
    }
    if (card?.autoRelevantEnabled && card.eventLog.trim()) {
        return `Sẵn sàng — Auto Relevant Memory sẽ tự chọn event liên quan từ ${card.eventIndex.length} event; không nạp toàn bộ.`;
    }
    if (!settings.enabled && !merged.text) {
        return 'Tạm dừng — không có Auto Prompt hoặc Memory nào sẽ được chèn.';
    }
    if (!merged.text) {
        return 'Đang chờ — chưa có prompt đang bật phù hợp với card hiện tại.';
    }
    return `Sẵn sàng — ${merged.promptCount} prompt phù hợp · ${merged.textLength.toLocaleString()} ký tự`;
}

function renderStatus(context, settings) {
    const status = document.getElementById(STATUS_ID);
    if (status) status.textContent = getStatusText(context, settings);
}


function setMemoryStatus(kind, message, cardKey = '') {
    lastMemoryStatus = { kind, message, cardKey, at: Date.now() };
}

function getMemoryStatusText(context, settings) {
    const character = activeMemoryCharacter(context);
    if (!character) return 'Chưa xác định card hiện tại.';

    const memory = ensureMemorySettings(settings);
    const card = getOrCreateCardMemory(settings, character);

    if (lastMemoryStatus && (!lastMemoryStatus.cardKey || lastMemoryStatus.cardKey === memoryStatusKey(character))) {
        return lastMemoryStatus.message;
    }

    const recording = card.enabled ? 'Ghi sự kiện: BẬT' : 'Ghi sự kiện: TẮT';
    const failedCount = Object.keys(card.failedMessages ?? {}).length;
    if (failedCount > 0) {
        return `${recording} · ⚠ ${failedCount} message chưa được ghi vào Memory. Có thể Recall bằng tay.`;
    }
    if (card.fullInjectNext && card.eventLog.trim()) {
        return `${recording} · Đã xếp TOÀN BỘ Memory cho lượt kế tiếp.`;
    }
    if (card.autoRelevantEnabled) {
        if (!memory.provider.baseUrl.trim() || !memory.provider.model.trim()) {
            return `${recording} · Auto Relevant: BẬT nhưng chưa cấu hình Base URL và model.`;
        }
        return `${recording} · Auto Relevant: BẬT · ${card.eventIndex.length} event trong hidden index.`;
    }
    return `${recording} · Auto Relevant: TẮT.`;
}

function renderMemoryModelOptions(settings) {
    const select = document.getElementById(MEMORY_MODEL_ID);
    if (!select) return;

    const memory = ensureMemorySettings(settings);
    const provider = memory.provider;
    const values = [...new Set([provider.model, ...provider.models].filter(Boolean))];
    select.innerHTML = [
        '<option value="">-- Chọn model --</option>',
        ...values.map((model) => `<option value="${escapeHtml(model)}" ${model === provider.model ? 'selected' : ''}>${escapeHtml(model)}</option>`),
    ].join('');
}

function renderMemoryPanel(context, settings) {
    const character = activeMemoryCharacter(context);
    const memory = ensureMemorySettings(settings);
    const card = character ? getOrCreateCardMemory(settings, character) : null;

    const cardLabel = document.getElementById(MEMORY_CARD_ID);
    const chatLabel = document.getElementById(MEMORY_CHAT_ID);
    const enabled = document.getElementById(MEMORY_ENABLED_ID);
    const autoRelevant = document.getElementById(MEMORY_AUTO_RELEVANT_ID);
    const fullNext = document.getElementById(MEMORY_FULL_NEXT_ID);
    const recallFailed = document.getElementById(MEMORY_RECALL_FAILED_ID);
    const eventLog = document.getElementById(MEMORY_EVENT_LOG_ID);
    const baseUrl = document.getElementById(MEMORY_BASE_URL_ID);
    const apiKey = document.getElementById(MEMORY_API_KEY_ID);
    const status = document.getElementById(MEMORY_STATUS_ID);

    if (cardLabel) {
        cardLabel.textContent = character
            ? `Card hiện tại: ${character.name || character.key}`
            : 'Card hiện tại: không xác định';
    }
    if (chatLabel) {
        chatLabel.textContent = character
            ? `Chat ID hiện tại: ${character.chatId}`
            : 'Chat ID hiện tại: không xác định';
    }

    if (enabled) {
        enabled.checked = Boolean(card?.enabled);
        enabled.disabled = !card;
    }

    if (autoRelevant) {
        autoRelevant.checked = Boolean(card?.autoRelevantEnabled);
        autoRelevant.disabled = !card;
    }

    if (fullNext) {
        fullNext.disabled = !card || (!card.fullInjectNext && !card.eventLog.trim());
        fullNext.textContent = card?.fullInjectNext
            ? 'Hủy bơm toàn bộ ký ức ở lượt kế tiếp'
            : 'Bơm toàn bộ ký ức vào lượt kế tiếp';
        fullNext.classList.toggle('st-auto-memory-full-next-active', Boolean(card?.fullInjectNext));
    }

    if (recallFailed) {
        const failedCount = Object.keys(card?.failedMessages ?? {}).length;
        recallFailed.disabled = !card || failedCount === 0;
        recallFailed.textContent = failedCount > 0
            ? `Recall ký ức lỗi (${failedCount})`
            : 'Recall ký ức lỗi';
    }

    if (eventLog) {
        if (document.activeElement !== eventLog) eventLog.value = card?.eventLog ?? '';
        eventLog.disabled = !card;
    }

    if (baseUrl && document.activeElement !== baseUrl) baseUrl.value = memory.provider.baseUrl;
    if (apiKey && document.activeElement !== apiKey) apiKey.value = memory.provider.apiKey;
    renderMemoryModelOptions(settings);
    if (status) status.textContent = getMemoryStatusText(context, settings);
}

function saveMemoryProviderFields(context, settings) {
    const memory = ensureMemorySettings(settings);
    const baseUrl = document.getElementById(MEMORY_BASE_URL_ID);
    const apiKey = document.getElementById(MEMORY_API_KEY_ID);
    const model = document.getElementById(MEMORY_MODEL_ID);

    if (baseUrl) memory.provider.baseUrl = baseUrl.value;
    if (apiKey) memory.provider.apiKey = apiKey.value;
    if (model) memory.provider.model = model.value;
    context.saveSettingsDebounced();
}

function bindMemoryControls(context, settings) {
    const enabled = document.getElementById(MEMORY_ENABLED_ID);
    const autoRelevant = document.getElementById(MEMORY_AUTO_RELEVANT_ID);
    const fullNext = document.getElementById(MEMORY_FULL_NEXT_ID);
    const recallFailed = document.getElementById(MEMORY_RECALL_FAILED_ID);
    const eventLog = document.getElementById(MEMORY_EVENT_LOG_ID);
    const baseUrl = document.getElementById(MEMORY_BASE_URL_ID);
    const apiKey = document.getElementById(MEMORY_API_KEY_ID);
    const model = document.getElementById(MEMORY_MODEL_ID);
    const loadModels = document.getElementById(MEMORY_LOAD_MODELS_ID);
    const testConnection = document.getElementById(MEMORY_TEST_ID);

    enabled?.addEventListener('change', () => {
        const character = activeMemoryCharacter(context);
        if (!character) return;
        const card = getOrCreateCardMemory(settings, character);
        card.enabled = enabled.checked;
        card.updatedAt = Date.now();
        lastMemoryStatus = null;
        context.saveSettingsDebounced();
        renderMemoryPanel(context, settings);
    });

    autoRelevant?.addEventListener('change', () => {
        const character = activeMemoryCharacter(context);
        if (!character) return;
        const card = getOrCreateCardMemory(settings, character);
        card.autoRelevantEnabled = autoRelevant.checked;
        card.updatedAt = Date.now();
        lastMemoryStatus = null;
        context.saveSettingsDebounced();
        renderMemoryPanel(context, settings);
        renderStatus(context, settings);
    });

    fullNext?.addEventListener('click', () => {
        const character = activeMemoryCharacter(context);
        if (!character) return;
        const card = getOrCreateCardMemory(settings, character);
        if (!card.fullInjectNext && !card.eventLog.trim()) {
            setMemoryStatus('warning', 'Nhật ký sự kiện đang trống, không có gì để bơm.', memoryStatusKey(character));
            renderMemoryPanel(context, settings);
            return;
        }
        const scheduled = toggleFullInjectNext(card);
        card.updatedAt = Date.now();
        setMemoryStatus(
            scheduled ? 'success' : 'info',
            scheduled
                ? '✓ Đã xếp toàn bộ Memory cho lượt generation kế tiếp. Bấm lại nút để hủy.'
                : 'Đã hủy bơm toàn bộ Memory ở lượt kế tiếp.',
            memoryStatusKey(character),
        );
        context.saveSettingsDebounced();
        renderMemoryPanel(context, settings);
        renderStatus(context, settings);
    });

    recallFailed?.addEventListener('click', async () => {
        const character = activeMemoryCharacter(context);
        if (!character) return;
        const card = getOrCreateCardMemory(settings, character);
        const failedCount = Object.keys(card.failedMessages ?? {}).length;
        if (failedCount === 0) {
            setMemoryStatus('info', 'Không có message Memory lỗi nào cần Recall.', character.key);
            renderMemoryPanel(context, settings);
            return;
        }

        recallFailed.disabled = true;
        setMemoryStatus('working', `Đang Recall ${failedCount} message Memory lỗi...`, character.key);
        renderMemoryPanel(context, settings);

        const result = await recallFailedMemoryMessages({
            context,
            settings,
            character,
            onProgress: (info) => {
                if (info.type === 'retry') {
                    setMemoryStatus(
                        'working',
                        `Message #${info.messageId} vẫn lỗi · tự thử lại ${info.retryNumber}/${info.maxRetries} sau ${Math.round(info.retryDelayMs / 1000)} giây.`,
                        memoryStatusKey(character),
                    );
                } else if (info.type === 'recall-start') {
                    setMemoryStatus('working', `Đang Recall message #${info.messageId}...`, character.key);
                }
                renderMemoryPanel(context, settings);
            },
        });

        if (result.remainingIds.length === 0) {
            setMemoryStatus('success', `✓ Recall thành công ${result.recovered}/${result.total} message. Không còn ký ức lỗi.`, character.key);
        } else {
            setMemoryStatus(
                'error',
                `⚠ Recall được ${result.recovered}/${result.total}; còn lỗi: #${result.remainingIds.join(', #')}. Có thể bấm Recall lại sau.`,
                memoryStatusKey(character),
            );
        }
        renderMemoryPanel(context, settings);
        renderStatus(context, settings);
    });

    eventLog?.addEventListener('input', () => {
        const character = activeMemoryCharacter(context);
        if (!character) return;
        const card = getOrCreateCardMemory(settings, character);
        card.eventLog = eventLog.value;
        card.updatedAt = Date.now();
        context.saveSettingsDebounced();
        renderStatus(context, settings);
    });

    for (const input of [baseUrl, apiKey]) {
        input?.addEventListener('input', () => {
            saveMemoryProviderFields(context, settings);
            lastMemoryStatus = null;
        });
    }

    model?.addEventListener('change', () => {
        saveMemoryProviderFields(context, settings);
        lastMemoryStatus = null;
        renderMemoryPanel(context, settings);
    });

    loadModels?.addEventListener('click', async () => {
        saveMemoryProviderFields(context, settings);
        const memory = ensureMemorySettings(settings);
        setMemoryStatus('working', 'Đang tải danh sách model...');
        renderMemoryPanel(context, settings);
        try {
            const models = await loadProviderModels(memory.provider);
            memory.provider.models = models;
            if (!memory.provider.model || !models.includes(memory.provider.model)) {
                memory.provider.model = models[0] ?? '';
            }
            context.saveSettingsDebounced();
            setMemoryStatus('success', `✓ Đã tải ${models.length} model.`);
        } catch (error) {
            setMemoryStatus('error', `Lỗi tải model: ${error.message}`);
            console.error('[ST Auto Prompt Reminder] Memory model loading failed.', error);
        }
        renderMemoryPanel(context, settings);
    });

    testConnection?.addEventListener('click', async () => {
        saveMemoryProviderFields(context, settings);
        const memory = ensureMemorySettings(settings);
        setMemoryStatus('working', 'Đang kiểm tra kết nối Memory AI...');
        renderMemoryPanel(context, settings);
        try {
            await testProviderConnection(memory.provider);
            setMemoryStatus('success', `✓ Kết nối thành công với model ${memory.provider.model}.`);
        } catch (error) {
            setMemoryStatus('error', `Lỗi kết nối: ${error.message}`);
            console.error('[ST Auto Prompt Reminder] Memory AI connection test failed.', error);
        }
        renderMemoryPanel(context, settings);
    });
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
        renderMemoryPanel(context, settings);
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
                    <span>Bật tự động chèn các prompt nhắc nhở</span>
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

        <div class="inline-drawer st-auto-memory-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Bộ nhớ sự kiện theo Card</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content st-auto-memory-content">
                <div id="${MEMORY_CARD_ID}" class="st-auto-memory-card"></div>
                <div id="${MEMORY_CHAT_ID}" class="st-auto-memory-chat-id"></div>

                <label class="st-auto-prompt-toggle" for="${MEMORY_ENABLED_ID}">
                    <input id="${MEMORY_ENABLED_ID}" type="checkbox">
                    <span>Bật AI tự ghi sự kiện cho card này</span>
                </label>

                <label class="st-auto-prompt-toggle" for="${MEMORY_AUTO_RELEVANT_ID}">
                    <input id="${MEMORY_AUTO_RELEVANT_ID}" type="checkbox">
                    <span>Tự chọn ký ức liên quan và chèn khi cần</span>
                </label>

                <button id="${MEMORY_FULL_NEXT_ID}" type="button" class="menu_button st-auto-memory-full-next">Bơm toàn bộ ký ức vào lượt kế tiếp</button>
                <button id="${MEMORY_RECALL_FAILED_ID}" type="button" class="menu_button st-auto-memory-recall-failed">Recall ký ức lỗi</button>

                <div class="st-auto-memory-provider">
                    <b>Memory AI Provider</b>
                    <label class="st-auto-prompt-field" for="${MEMORY_BASE_URL_ID}">
                        <span>Base URL (OpenAI-compatible)</span>
                        <input id="${MEMORY_BASE_URL_ID}" class="text_pole" type="text" placeholder="https://example.com/v1">
                    </label>
                    <label class="st-auto-prompt-field" for="${MEMORY_API_KEY_ID}">
                        <span>API Key</span>
                        <input id="${MEMORY_API_KEY_ID}" class="text_pole" type="password" autocomplete="off" placeholder="Có thể để trống với local API">
                    </label>
                    <div class="st-auto-memory-provider-row">
                        <button id="${MEMORY_LOAD_MODELS_ID}" type="button" class="menu_button">Tải danh sách model</button>
                        <button id="${MEMORY_TEST_ID}" type="button" class="menu_button">Kiểm tra kết nối</button>
                    </div>
                    <label class="st-auto-prompt-field" for="${MEMORY_MODEL_ID}">
                        <span>Model</span>
                        <select id="${MEMORY_MODEL_ID}" class="text_pole">
                            <option value="">-- Chọn model --</option>
                        </select>
                    </label>
                </div>

                <label class="st-auto-prompt-field" for="${MEMORY_EVENT_LOG_ID}">
                    <span>Nhật ký sự kiện</span>
                    <textarea id="${MEMORY_EVENT_LOG_ID}" class="text_pole st-auto-memory-event-log" rows="16" spellcheck="false" placeholder="AI phụ sẽ append các sự kiện chi tiết đã thực sự xảy ra ở đây. Bạn có thể sửa thủ công bất cứ lúc nào."></textarea>
                </label>

                <div id="${MEMORY_STATUS_ID}" class="st-auto-memory-status" aria-live="polite"></div>
                <small class="st-auto-prompt-hint">
                    Memory mặc định tắt theo từng card. AI phụ vẫn ghi Event Log chi tiết, nhưng Auto Relevant chỉ gửi hidden index cho selector rồi chèn full text của đúng event liên quan. Trigger/index ẩn không bao giờ được đưa cho model chính.
                </small>
            </div>
        </div>
    `;

    host.appendChild(root);
    bindMemoryControls(context, settings);

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
    renderMemoryPanel(context, settings);
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
            () => activeMemoryCharacter(context),
            async ({ settings: currentSettings, character, userPrompt, recentAssistant }) => {
                const result = await selectRelevantMemoryForPrompt({
                    settings: currentSettings,
                    character,
                    userPrompt,
                    recentAssistant,
                    context,
                });
                if (result.reason === 'error') {
                    const key = memoryStatusKey(character);
                    setMemoryStatus('error', `Lỗi Memory selector: ${result.error?.message ?? 'Không rõ lỗi'}`, key);
                }
                return result;
            },
            (info) => {
                lastInjectionInfo = info;
                renderStatus(context, settings);
                renderMemoryPanel(context, settings);
                console.debug('[ST Auto Prompt Reminder] Finalized aggregate reminder as the last system message.', info);
            },
        );
    } catch (error) {
        console.error('[ST Auto Prompt Reminder] Final-stage prompt hook is unavailable; reminders cannot be injected safely.', error);
    }

    try {
        cleanupMemoryHook = registerMemoryCaptureHook(
            context,
            () => settings,
            () => activeMemoryCharacter(context),
            (payload) => processReceivedAssistantMessage(payload),
            (result, payload) => {
                const key = memoryStatusKey(payload.character);
                if (result?.processed) {
                    const suffix = result.appended
                        ? `✓ Đã ghi sự kiện mới từ message #${payload.messageId}.`
                        : `✓ Đã đọc message #${payload.messageId}; không có sự kiện mới cần ghi.`;
                    setMemoryStatus('success', suffix, key);
                } else if (result?.reason === 'retry-exhausted') {
                    setMemoryStatus(
                        'error',
                        `⚠ Message #${payload.messageId} chưa được ghi sau 5 lần retry. Dùng “Recall ký ức lỗi” khi API ổn định lại.`,
                        key,
                    );
                    console.error('[ST Auto Prompt Reminder] Memory AI retry exhausted.', result.error);
                } else if (result?.reason === 'provider-not-configured') {
                    setMemoryStatus('warning', 'Memory đang bật nhưng chưa cấu hình Base URL và model.', key);
                }
                renderMemoryPanel(context, settings);
                renderStatus(context, settings);
            },
            (retry, payload) => {
                const key = memoryStatusKey(payload.character);
                setMemoryStatus(
                    'working',
                    `Message #${payload.messageId} call Memory thất bại · tự thử lại ${retry.retryNumber}/${retry.maxRetries} sau ${Math.round(retry.retryDelayMs / 1000)} giây.`,
                    key,
                );
                renderMemoryPanel(context, settings);
                renderStatus(context, settings);
            },
        );
    } catch (error) {
        console.error('[ST Auto Prompt Reminder] MESSAGE_RECEIVED memory hook is unavailable.', error);
    }

    try {
        cleanupMemoryReconcileHook = registerMemoryReconcileHooks(
            context,
            () => settings,
            () => activeMemoryCharacter(context),
            undefined,
            (result, payload) => {
                if (payload.reason === 'chat-changed') fallbackChatEpoch += 1;
                lastMemoryStatus = null;
                if (result?.removedEventIds?.length) {
                    setMemoryStatus(
                        'info',
                        `Đã đồng bộ Memory với chat hiện tại · xóa ${result.removedEventIds.length} event không còn tồn tại.`,
                        memoryStatusKey(activeMemoryCharacter(context)),
                    );
                }
                renderMemoryPanel(context, settings);
                renderStatus(context, settings);
            },
        );
    } catch (error) {
        console.error('[ST Auto Prompt Reminder] Memory reconciliation hooks are unavailable.', error);
    }

    createSettingsPanel(context, settings);
    console.log('[ST Auto Prompt Reminder] Loaded v0.3.4.');
}

export function onDisable() {
    cleanupGenerationHook?.();
    cleanupGenerationHook = null;
    cleanupFinalPromptHook?.();
    cleanupFinalPromptHook = null;
    cleanupMemoryHook?.();
    cleanupMemoryHook = null;
    cleanupCardRefreshHook?.();
    cleanupCardRefreshHook = null;
    cleanupMemoryReconcileHook?.();
    cleanupMemoryReconcileHook = null;

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
