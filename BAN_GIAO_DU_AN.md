# BÀN GIAO DỰ ÁN — ST Auto Prompt Reminder

## Phiên bản

`v0.2.0` — 2026-09-17

## Mục tiêu

Nâng extension từ một textarea Global thành prompt manager nhiều lệnh, có thể dùng prompt toàn cục và prompt riêng theo card, nhưng vẫn giữ cơ chế đã kiểm chứng: **chỉ một system message tổng hợp ở cuối final Chat Completion prompt**.

## Thay đổi v0.2.0

- Schema settings mới `schemaVersion: 2`.
- Hỗ trợ nhiều prompt với các trường:
  - `id`
  - `name`
  - `enabled`
  - `scope: global | character`
  - `character`
  - `content`
  - `order`
- Prompt Global luôn cộng vào nếu bật.
- Prompt Character chỉ cộng vào khi binding khớp card đang hoạt động.
- Global + matching Character prompt cộng dồn.
- Prompt được sort theo `order`, merge bằng hai newline, rồi inject thành đúng một final system message.
- UI mới có add/edit/delete, ON/OFF từng prompt, badge scope, lên/xuống, và nút **Gắn với card hiện tại**.
- Status final hiển thị số prompt + tổng số ký tự.
- Tự migrate v0.1.2 `promptText` thành prompt Global tên `Prompt cũ`, giữ nguyên authored text.
- Legacy staged key tiếp tục luôn rỗng để không tái xuất hiện bug duplicate.
- Version bump `0.2.0`.

## Character identity

- Ưu tiên avatar/card filename làm key persisted.
- Tên card được lưu để hiển thị trong UI.
- Single chat: ưu tiên `characterId` + `characters`.
- Group-style context: fallback qua `name2` để tìm character tương ứng trong `characters`.
- Nếu không resolve được card đang phản hồi: chỉ prompt Global được chèn.

## Injection pipeline

```text
Settings schema v2
    ↓
Resolve active card
    ↓
Enabled Global prompts
+ enabled matching Character prompts
    ↓
Sort by order
    ↓
Merge into one text block
    ↓
CHAT_COMPLETION_PROMPT_READY
    ↓
Append exactly one final system message
```

## Migration

Input cũ:

```json
{
  "enabled": true,
  "promptText": "..."
}
```

Sau migration:

```json
{
  "enabled": true,
  "schemaVersion": 2,
  "prompts": [
    {
      "id": "...",
      "name": "Prompt cũ",
      "enabled": true,
      "scope": "global",
      "character": null,
      "content": "...",
      "order": 0
    }
  ]
}
```

`promptText` cũ chỉ bị xóa sau khi nội dung đã được copy vào entry mới.

## Kiểm thử tự động

Lệnh:

```bash
npm test
npm run check
```

Kết quả verification source v0.2.0: **30/30 test pass**, syntax check pass.

Coverage v0.2.0 gồm:

- migrate v0.1.2 không mất text
- create/normalize schema v2
- resolve card bằng avatar/name
- group-style `name2` fallback
- multiple Global merge đúng order
- disabled/blank prompt bị bỏ qua
- matching Character prompt được cộng
- non-matching Character prompt bị bỏ
- không có active card => Global only
- final prompt chỉ có một aggregate system message
- legacy staged slot luôn clear
- extension disable behavior
- UI contract cho add/edit/delete/reorder/bind-current-card
- manifest/version contract `0.2.0`

## Test thật cần làm trên SillyTavern

1. Sau khi upgrade từ v0.1.2, kiểm tra prompt cũ xuất hiện thành `Prompt cũ` và nội dung còn nguyên.
2. Tạo hai prompt Global; Prompt Reviewer phải thấy cả hai nội dung ghép trong một block cuối.
3. Tạo prompt Character, bind card A; generate card A => có prompt Character.
4. Chuyển sang card B => prompt Character của A biến mất, Global vẫn còn.
5. Dùng marker:

```text
[AutoPromptCheck]: EXTENSION_ACTIVE
```

để xác nhận AI thực sự đọc aggregate reminder.

## Giới hạn đã biết

- Final hook hiện áp dụng cho Chat Completion; Text Completion chưa có đường final-string riêng.
- V0.2.0 chỉ có nút bind card hiện tại, chưa có browser chọn mọi card trong thư viện.
- Group chat phụ thuộc speaker/card SillyTavern expose qua context; resolve thất bại sẽ fallback Global-only.
- Reorder dùng nút lên/xuống, chưa drag-and-drop.
- Chưa có scheduling/frequency, regex condition, generation filters hoặc priority tiers.

## File cần ghi đè/push GitHub cho v0.2.0

```text
manifest.json
package.json
index.js
style.css
src/reminder-core.js
src/runtime.js
test/reminder-core.test.mjs
test/runtime.test.mjs
test/extension-contract.test.mjs
README.md
BAN_GIAO_DU_AN.md
docs/superpowers/specs/2026-09-17-multi-prompt-character-binding-design.md
docs/superpowers/plans/2026-09-17-multi-prompt-character-binding-implementation.md
```

`LICENSE` không đổi ở v0.2.0.

---

# Release v0.3.0 — Optional Card Event Memory

## Mục tiêu

Thêm Event Memory nhẹ theo card để một AI phụ tự ghi các sự kiện đã thực sự xảy ra, sau đó người dùng có thể chọn bơm toàn bộ nhật ký vào final system prompt nhằm giảm quên trong RP dài. Memory không tự bật.

## Thay đổi chính

- Schema root nâng từ 2 lên 3, giữ nguyên/migrate prompt v0.1.x/v0.2.0.
- Thêm `src/memory-core.js`: storage theo card, narrative extraction, append-only log, prompt cho Memory AI, parse JSON, message signature.
- Thêm `src/memory-api.js`: OpenAI-compatible Base URL/API key/model list/chat completions/test connection.
- Thêm `src/memory-runtime.js`: hook `MESSAGE_RECEIVED`, chỉ xử lý assistant message, dedupe response lặp, lỗi được cô lập.
- `src/runtime.js`: Auto Prompt + Event Log được merge thành đúng **một** system message cuối prompt.
- UI thêm drawer `Bộ nhớ sự kiện theo Card`, mặc định card memory OFF.
- Toggle auto-record và toggle inject Event Log độc lập.
- Event Log editable thủ công, AI chỉ append.
- Nút `Tải danh sách model`, dropdown model, `Kiểm tra kết nối`.
- Memory AI được yêu cầu đọc toàn bộ Event Log hiện tại + chính văn mới và ghi sự kiện chi tiết, không dùng planning chưa xảy ra làm fact.

## Verification

- Unit/contract/runtime/API tests bao phủ migration, optional memory, full-log injection, narrative extraction, model loading, API request, dedupe, append-only, lỗi API và no-duplicate final system message.
- `npm test`: 55/55 test pass trên source.
- `npm run check`: pass trên source.
- Sau khi đóng ZIP: giải nén sạch và chạy lại cả hai lệnh trên chính artifact.

## Giới hạn đã biết

- Provider OpenAI-compatible phải cho phép browser CORS vì request Memory AI hiện gọi trực tiếp từ frontend extension.
- Không có RAG, vector DB, auto-prune hay auto-summary. Event Log được inject toàn bộ theo yêu cầu.
- Nếu người dùng swipe/regenerate cùng một message thành nội dung khác, content signature khác sẽ cho phép AI ghi thêm entry mới thay vì tự sửa entry cũ. Vì auto-memory là append-only, người dùng có thể chỉnh Event Log thủ công nếu muốn loại bỏ sự kiện từ một swipe đã bỏ.

## Các file release v0.3.0 cần push/ghi đè GitHub

- `manifest.json`
- `package.json`
- `index.js`
- `style.css`
- `src/reminder-core.js`
- `src/runtime.js`
- `src/memory-core.js`
- `src/memory-api.js`
- `src/memory-runtime.js`
- `test/reminder-core.test.mjs`
- `test/runtime.test.mjs`
- `test/memory-core.test.mjs`
- `test/memory-api.test.mjs`
- `test/memory-runtime.test.mjs`
- `test/extension-contract.test.mjs`
- `README.md`
- `BAN_GIAO_DU_AN.md`
- `docs/superpowers/specs/2026-09-18-optional-card-event-memory-design.md`
- `docs/superpowers/plans/2026-09-18-optional-card-event-memory-implementation.md`
