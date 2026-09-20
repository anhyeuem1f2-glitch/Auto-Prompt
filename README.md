# ST Auto Prompt Reminder

Extension SillyTavern để quản lý nhiều prompt nhắc nhở và tự động ghép các prompt phù hợp thành **một system message duy nhất ở cuối prompt gửi AI**.

## V0.2.0 có gì

- Quản lý **nhiều prompt** thay vì một textarea duy nhất.
- Mỗi prompt có tên, ON/OFF, nội dung và thứ tự riêng.
- Hai phạm vi:
  - **Global**: luôn được cộng vào khi prompt đang bật.
  - **Character**: chỉ được cộng vào khi đang chat/generate bằng đúng card đã liên kết.
- Global + Character là **cộng dồn**, không thay thế nhau.
- Có nút **Gắn với card hiện tại**.
- Có nút đưa prompt lên/xuống để đổi thứ tự merge.
- Tự migrate dữ liệu v0.1.2: textarea cũ trở thành một prompt Global tên `Prompt cũ`, giữ nguyên nội dung đã viết.
- Tự lưu bằng `saveSettingsDebounced()`.
- Legacy `setExtensionPrompt()` slot luôn được clear để tránh duplicate từ các bản cũ.
- Ở `CHAT_COMPLETION_PROMPT_READY`, các prompt phù hợp được merge theo thứ tự rồi append thành **đúng một** final system message.
- Status hiển thị số prompt và tổng số ký tự vừa inject.

## Cài từ GitHub

1. Push toàn bộ repo lên GitHub.
2. Mở SillyTavern.
3. Vào **Extensions → Install Extension**.
4. Dán URL GitHub của repo.
5. Cài/enable extension rồi reload SillyTavern nếu được yêu cầu.
6. Trong Extensions Settings, mở **Tự động chèn Prompt**.

Không cần `npm install` và không cần build để sử dụng extension.

## Cách dùng

### Prompt Global

1. Bấm **+ Thêm prompt**.
2. Đặt tên prompt.
3. Chọn `Global — dùng cho mọi card`.
4. Nhập nội dung.
5. Giữ checkbox của prompt ở trạng thái bật.

Mọi generation sẽ nhận prompt Global này.

### Prompt theo card

1. Bấm **+ Thêm prompt** hoặc mở prompt có sẵn.
2. Chọn `Character — chỉ dùng cho card đã gắn`.
3. Đang mở đúng card cần dùng, bấm **Gắn với card hiện tại**.
4. Badge trong danh sách sẽ hiện `Card: <tên card>`.

Khi chuyển sang card khác, prompt Character đó tự động không tham gia. Prompt Global vẫn hoạt động bình thường.

### Thứ tự merge

Dùng nút `↑` / `↓` trong danh sách. Prompt ở trên được ghép trước prompt ở dưới.

Ví dụ có 3 prompt đang hoạt động:

```text
Global - Writing Rules
Global - Update Tables
Card: Alice - Character Fidelity
```

AI nhận **một system message cuối cùng** có dạng:

```text
<nội dung Writing Rules>

<nội dung Update Tables>

<nội dung Character Fidelity>
```

Extension không gửi ba system message riêng.

## Migration từ v0.1.2

Nếu settings cũ có:

```json
{
  "enabled": true,
  "promptText": "Nội dung cũ..."
}
```

v0.2.0 tự chuyển thành schema v2 và tạo một prompt:

```text
Prompt cũ · Global · ON
```

Nội dung textarea cũ được giữ nguyên.

## Test nhanh bằng Prompt Reviewer / Prompt Inspector

Tạo một prompt Global với nội dung:

```text
Trong phần <story_driver>, bắt buộc thêm đúng một dòng:
[AutoPromptCheck]: EXTENSION_ACTIVE
```

Sau đó:

1. Generate một lượt.
2. Mở Prompt Reviewer / Prompt Inspector.
3. Xác nhận block Auto Prompt chỉ xuất hiện **một lần ở cuối prompt**.
4. Kiểm tra output model có `[AutoPromptCheck]: EXTENSION_ACTIVE`.
5. Status extension nên hiện dạng:

```text
✓ Đã chèn 2 prompt ở cuối prompt gửi AI · 1,248 ký tự
```

## Injection behavior

V0.2.0 giữ đường injection đã được test thật từ v0.1.2:

1. Trước generation, legacy key `st_auto_prompt_reminder.main` được set thành chuỗi rỗng để không có staged copy.
2. Ở `CHAT_COMPLETION_PROMPT_READY`, extension resolve card hiện tại.
3. Lấy các Global prompt đang bật.
4. Lấy thêm Character prompt đang bật và khớp card.
5. Sort theo `order`.
6. Join nội dung bằng hai newline.
7. De-duplicate aggregate message nếu cần.
8. Append đúng một `{ role: "system", content: mergedText }` ở cuối `chat`.

Nếu không resolve được card hiện tại, chỉ Global prompt được chèn.

## Character binding

Binding ưu tiên avatar/card filename làm định danh ổn định và giữ tên card để hiển thị. Trong group chat, extension dùng character hiện SillyTavern đang expose qua context; nếu không resolve được người đang phản hồi thì an toàn quay về chỉ dùng Global prompt.

## Development tests

Yêu cầu Node.js hiện đại.

```bash
npm test
npm run check
```

Project không có dependency npm bên ngoài.

## Cấu trúc

```text
Auto-prompt/
├─ manifest.json
├─ index.js
├─ style.css
├─ package.json
├─ src/
│  ├─ reminder-core.js
│  └─ runtime.js
├─ test/
│  ├─ extension-contract.test.mjs
│  ├─ reminder-core.test.mjs
│  └─ runtime.test.mjs
├─ docs/superpowers/
├─ README.md
├─ BAN_GIAO_DU_AN.md
└─ LICENSE
```

## Giới hạn V0.2.0

- Final-stage enforcement hiện nhắm vào **Chat Completion** qua `CHAT_COMPLETION_PROMPT_READY`.
- Text Completion chưa có final-string injection riêng.
- Character binding chưa có selector duyệt toàn bộ thư viện card; v0.2.0 dùng nút **Gắn với card hiện tại**.
- Group chat phụ thuộc character hiện SillyTavern expose trong context; nếu không resolve được thì chỉ Global prompt chạy.
- Chưa có drag-and-drop; dùng nút lên/xuống.
- Chưa có scheduling/frequency, regex trigger, per-generation filter hay nhiều mức priority.

## License

MIT.

## v0.3.0 — Bộ nhớ sự kiện theo Card (optional)

Bản này thêm một hệ thống **Event Memory nhẹ**, đúng mục đích nhắc AI chứ không biến extension thành knowledge graph/RAG.

- Memory **mặc định tắt theo từng card**. Không có card nào tự bật.
- `Bật AI tự ghi sự kiện cho card này`: sau mỗi AI response đã commit, extension gọi một Memory AI riêng để đọc chính văn mới + **toàn bộ Event Log hiện có** và chỉ append sự kiện mới.
- `Bơm toàn bộ Nhật ký sự kiện vào prompt`: khi bật, toàn bộ Event Log của card hiện tại được ghép vào **cùng một system message cuối** với Auto Prompt reminders. Không retrieval, không cắt theo relevance.
- Hai toggle độc lập: có thể dừng auto-record nhưng vẫn inject log cũ, hoặc record mà chưa inject.
- Event Log là textarea riêng theo card và người dùng được sửa thủ công. AI phụ không rewrite/xóa log cũ.
- Memory AI được nhắc bắt buộc ghi chi tiết: vị trí, ai có mặt, bối cảnh, diễn biến, cách hành động xảy ra, kết quả, tình huống/tâm trạng có bằng chứng, hậu quả và liên kết với sự kiện cũ khi có.
- `<story_scene>` và `<parallel_line>` được ưu tiên làm chính văn canonical. Planning/reasoning như `<story_driver>`/`<think>` không được tính là sự kiện nếu chưa thực sự xảy ra trong chính văn.

### Memory AI Provider

Trong `Bộ nhớ sự kiện theo Card`:

1. Điền `Base URL` của API OpenAI-compatible, ví dụ `https://example.com/v1`.
2. Điền `API Key` nếu provider yêu cầu. Local API có thể để trống.
3. Bấm **Tải danh sách model**. Extension gọi endpoint `/models` và đổ model vào dropdown.
4. Chọn model trong dropdown.
5. Bấm **Kiểm tra kết nối**.
6. Sau đó mới bật auto-record cho card cần dùng.

Nếu bạn nhập Base URL dạng `.../chat/completions`, extension tự chuẩn hóa về API root trước khi gọi `/models` và `/chat/completions`.

### Lưu ý

Memory API được gọi trực tiếp từ trình duyệt SillyTavern. Provider cần cho phép request từ trình duyệt/CORS; nếu provider chặn CORS thì model list/test/memory call sẽ báo lỗi nhưng không ảnh hưởng đến phản hồi chính của SillyTavern.

Memory AI lỗi, trả JSON sai, hoặc mất mạng sẽ **không sửa chat history** và **không chặn AI chính**. Event Log chỉ thay đổi sau khi Memory AI trả dữ liệu hợp lệ.

## v0.3.1 — Relevant Memory Selector

v0.3.1 thay cơ chế “bơm toàn bộ Event Log mỗi lượt” của v0.3.0 bằng **Auto Relevant Memory** để tránh làm prompt chính phình vô hạn.

- `Bật AI tự ghi sự kiện cho card này` vẫn giữ nguyên: Memory AI đọc chính văn mới + Event Log hiện có và append sự kiện chi tiết.
- Mỗi event mới có thêm **hidden retrieval index** gồm summary ngắn, actor, location, topic, entity và `related_ids`. Index này chỉ dùng nội bộ để chọn ký ức; **không bao giờ được paste vào prompt của model chính**.
- `Tự chọn ký ức liên quan và chèn khi cần`: trước generation, Memory AI selector chỉ đọc prompt hiện tại + context gần nhất + hidden index, sau đó trả về các Message ID thực sự cần thiết.
- Nếu selector chọn event, extension mới lấy **full text** của các event đó và đặt vào `<MEMORY_CONTEXT>...</MEMORY_CONTEXT>` ở system message cuối.
- `<MEMORY_CONTEXT>` có chỉ dẫn rõ: dùng ký ức chỉ khi liên quan, không ép sự kiện cũ vào chính văn, không coi ký ức cũ là việc vừa xảy ra, không nhắc hidden trigger/Message ID trong truyện.
- Với quan hệ/lời hứa/xung đột kéo dài, selector được yêu cầu lấy **cả causal chain**, không chỉ event mới nhất.
- Nếu không event nào liên quan, không chèn Memory và không tạo block rỗng.
- Nút **Bơm toàn bộ ký ức vào lượt kế tiếp** là override một lần; sau khi full memory thực sự được inject, cờ tự tắt.
- Message ID đã xử lý sẽ không được Memory recorder append lần hai dù `MESSAGE_RECEIVED` phát lại với nội dung thay đổi, tránh hiện tượng `Message ID 24` bị ghi trùng.
- Dữ liệu v0.3.0 tự migrate: toggle inject cũ được chuyển thành `Auto Relevant` thay vì tiếp tục full-dump mỗi lượt. Event Log cũ được giữ nguyên; extension tạo fallback hidden index từ các block `Message ID` đã có.

### Luồng v0.3.1

```text
AI chính trả lời
    ↓
Memory recorder append Event Log + hidden index
    ↓
User gửi prompt mới
    ↓
Memory selector đọc prompt + context gần nhất + hidden index
    ↓
0 event liên quan → không inject Memory
N event liên quan → inject full text đúng N event
    ↓
Auto Prompt + MEMORY_CONTEXT → một system message cuối
```

Lưu ý: Memory recorder vẫn đọc toàn bộ Event Log để liên kết sự kiện dài hạn chính xác. Tối ưu v0.3.1 tập trung vào **context của model chính**, không cắt ngắn dữ liệu recorder dùng để hiểu lịch sử.
