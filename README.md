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
