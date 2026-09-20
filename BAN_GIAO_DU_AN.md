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

---


## Quy tắc bàn giao bắt buộc từ v0.3.2

- Mọi release ZIP phải có root `Auto-prompt/`.
- Bên trong ZIP **luôn phải có `BAN_GIAO_DU_AN.md`**.
- File bàn giao phải được cập nhật ở **mỗi đợt sửa/build**, ghi version, nguyên nhân thay đổi, file đã đổi, test đã chạy, giới hạn còn lại và hướng dẫn GitHub.
- Không phát hành ZIP mới nếu `BAN_GIAO_DU_AN.md` vẫn mô tả release cũ.

# Release v0.3.1 — Relevant Memory Selector

## Mục tiêu

Giữ Event Memory chính xác nhưng không paste toàn bộ Event Log vào model chính ở mọi lượt. Memory chỉ được inject khi liên quan tới prompt hiện tại; hidden trigger/index không xuất hiện trong prompt model chính.

## Root cause của lỗi/token issue

- v0.3.0 dùng `injectEnabled`, nên khi bật thì `getMemoryInjectionText()` trả toàn bộ Event Log ở mọi generation.
- Cách đó đúng với “full memory” nhưng sai mục tiêu ban đầu là “ghi sẵn rồi gọi khi cần”. Event Log càng dài thì context model chính càng tăng tuyến tính.
- Duplicate `Message ID 24` xuất hiện vì dedupe v0.3.0 dùng `messageId + content signature`; nếu cùng ID được event host phát lại với content khác, signature đổi và recorder gọi lần hai.

## Thay đổi chính

- Memory schema nâng `1 → 2`.
- Thay `injectEnabled` bằng:
  - `autoRelevantEnabled`: selector tự chọn event liên quan.
  - `fullInjectNext`: override full-memory một lần.
- Thêm hidden `eventIndex[]` theo Message ID, lưu summary/actors/locations/topics/entities/relatedIds.
- Recorder trả thêm index trong cùng một API call, không cần call thứ hai để index event mới.
- Event Log cũ được parse thành fallback index khi migrate; nội dung log không bị xóa.
- Thêm `buildSelectorMessages()` + `parseMemorySelectionResponse()` + `selectEventTextByIds()`.
- Selector chỉ nhận prompt hiện tại, recent assistant context và hidden index; không nhận raw full Event Log.
- Model chính chỉ nhận `<MEMORY_CONTEXT>` chứa full text của event được selector chọn.
- Memory block có hướng dẫn rõ “chỉ dùng khi liên quan / không force vào chính văn / không coi là sự kiện vừa xảy ra / không nhắc retrieval hay IDs”.
- Relationship/promise/conflict dài hạn yêu cầu selector trả cả causal chain cần thiết.
- Manual `Bơm toàn bộ ký ức vào lượt kế tiếp` bypass selector; cờ được consume sau khi inject thành công.
- Dedupe recorder đổi sang Message ID tuyệt đối: cùng Message ID chỉ được xử lý một lần trong Event Log.
- Status UI hiển thị số event selector chọn trên tổng số event và số ký tự Memory thực sự inject.

## Migration v0.3.0 → v0.3.1

- `injectEnabled=true` → `autoRelevantEnabled=true`.
- `injectEnabled=false` → `autoRelevantEnabled=false`.
- `fullInjectNext=false` mặc định.
- `processedMessageIds` được seed từ key của `processedSignatures` cũ để không ghi lại các message đã từng xử lý.
- Event Log cũ giữ nguyên byte text; hidden index fallback được sinh từ các block `Message ID`.

## Verification cần giữ

- Auto Relevant không paste toàn bộ Event Log.
- Hidden index không xuất hiện trong final prompt.
- Selector trả rỗng => 0 Memory được inject.
- Selector trả IDs => chỉ full event text của IDs đó được inject.
- Duplicate Message ID không gọi recorder API lần hai, kể cả content thay đổi.
- Manual full-next bypass selector và tự tắt sau khi inject.
- Auto Prompt + selected Memory vẫn là đúng một system message cuối.
- Full regression suite và syntax check phải xanh trước khi đóng release.

## Các file release v0.3.1 cần push/ghi đè GitHub

- `manifest.json`
- `package.json`
- `index.js`
- `style.css`
- `src/runtime.js`
- `src/memory-core.js`
- `src/memory-runtime.js`
- `test/reminder-core.test.mjs`
- `test/runtime.test.mjs`
- `test/memory-core.test.mjs`
- `test/memory-runtime.test.mjs`
- `test/extension-contract.test.mjs`
- `README.md`
- `BAN_GIAO_DU_AN.md`

`src/reminder-core.js`, `src/memory-api.js` và `LICENSE` không đổi ở v0.3.1.


---

# Release v0.3.2 — Cancel Full Memory Toggle

## Root cause

- Ở v0.3.1, click handler của nút `Bơm toàn bộ ký ức vào lượt kế tiếp` luôn gán `card.fullInjectNext = true`.
- Khi cờ đã bật, click lần nữa vẫn tiếp tục gán `true`, vì vậy người dùng không thể hủy trước generation.
- Ngoài ra, nếu Event Log bị xóa sau khi đã lên lịch full-memory, nút có thể bị disable theo điều kiện log rỗng và càng không thể hủy.

## Fix

- Thêm `toggleFullInjectNext(card)` trong `src/memory-core.js`.
- Nút full-memory giờ toggle `false → true → false`.
- Khi đang lên lịch, label đổi thành `Hủy bơm toàn bộ ký ức ở lượt kế tiếp`.
- Status báo rõ đã lên lịch hoặc đã hủy.
- Khi `fullInjectNext=true`, nút vẫn clickable kể cả Event Log vừa bị người dùng xóa, để không tạo trạng thái mắc kẹt.
- Cơ chế consume sau generation thành công vẫn giữ nguyên: nếu không hủy thủ công, full-memory chỉ chạy một lượt rồi tự tắt.

## Verification

- Regression test mới xác nhận `toggleFullInjectNext()` bật và hủy được cờ one-shot.
- Contract test xác nhận UI có cả label lên lịch và label hủy, đồng thời entry point dùng toggle helper.
- Full suite + syntax check phải pass trên source và trên ZIP giải nén sạch trước khi bàn giao.

## File thay đổi v0.3.2

- `manifest.json`
- `package.json`
- `index.js`
- `src/memory-core.js`
- `test/memory-core.test.mjs`
- `test/extension-contract.test.mjs`
- `README.md`
- `BAN_GIAO_DU_AN.md`

## GitHub

Chỉ cần ghi đè/push các file ở danh sách trên.
