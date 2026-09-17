# ST Auto Prompt Reminder

Extension tối giản cho SillyTavern: bạn nhập một đoạn prompt nhắc nhở duy nhất, extension sẽ tự động chèn nguyên văn đoạn đó vào **mọi generation** mà không làm thay đổi message bạn gõ trong chat.

## V0.1.1 có gì

- Một công tắc ON/OFF.
- Một textarea lớn để ghi toàn bộ prompt cần tự chèn.
- Tự lưu bằng SillyTavern extension settings.
- Tự chèn trước mỗi generation bằng extension prompt.
- Giữ injection `in-chat / depth 0 / system role` để Prompt Reviewer/Inspector vẫn nhìn thấy reminder.
- Với Chat Completion, ở event `CHAT_COMPLETION_PROMPT_READY`, extension tìm đúng reminder đã chèn, xóa các bản trùng và **đưa một bản system reminder duy nhất xuống cuối mảng messages ngay trước khi gửi AI**.
- Nếu vì lý do nào đó bản depth-0 không có trong final chat array, extension tự append một system reminder ở cuối.
- Dòng trạng thái báo khi reminder đã được đưa xuống cuối prompt gửi AI.
- Không có category, lịch chạy, rule, profile hay các tùy chọn phức tạp.

## Cài từ GitHub

1. Push toàn bộ repo này lên GitHub.
2. Mở SillyTavern.
3. Vào **Extensions → Install Extension**.
4. Dán URL GitHub của repo.
5. Cài/enable extension rồi reload SillyTavern nếu được yêu cầu.
6. Trong phần Extensions Settings, mở **Tự động chèn Prompt**.

Không cần `npm install` và không cần build để sử dụng extension.

## Cách dùng

1. Bật **Bật tự động chèn vào mọi lượt**.
2. Ghi toàn bộ reminder vào textarea.
3. Nội dung được tự lưu.
4. Gửi chat bình thường.

Ví dụ textarea:

```text
Always keep every character faithful to their established personality.
Remember to update all relevant tables after the response.
Never contradict established events, relationships, locations, or facts.
```

Message người dùng vẫn chỉ chứa nội dung bạn gõ trong chat. Reminder được thêm riêng vào prompt gửi model.

## Test nhanh bằng Prompt Reviewer / Prompt Inspector

Để kiểm tra không chỉ việc "đã chèn" mà cả việc model thực sự nhận và làm theo, dùng marker bắt buộc:

```text
Trong phần <story_driver>, bắt buộc thêm đúng một dòng:
[AutoPromptCheck]: EXTENSION_ACTIVE
```

Sau đó:

1. Ghi marker vào textarea và bật extension.
2. Gửi một message bất kỳ.
3. Mở **Prompt Reviewer / Prompt Inspector / Prompt Itemization**.
4. Xác nhận reminder có trong prompt.
5. Kiểm tra output model có dòng `[AutoPromptCheck]: EXTENSION_ACTIVE`.
6. Dòng trạng thái extension nên hiện `✓ Đã chèn ở cuối prompt gửi AI ...`.
7. Tắt extension, generate lại và kiểm tra marker đã biến mất.

Nếu cần debug thêm, mở browser DevTools Console và tìm log có prefix:

```text
[ST Auto Prompt Reminder]
```

## Injection behavior

Extension dùng hai bước cho cùng một reminder, nhưng model chỉ nhận một bản trong final Chat Completion messages:

### Bước 1 — staged injection

- Key: `st_auto_prompt_reminder.main`
- Position: in-chat (`1`)
- Depth: `0`
- Role: system (`0`)
- World Info scan: off

Trước mỗi event `GENERATION_AFTER_COMMANDS`, extension đọc settings hiện tại và gọi `setExtensionPrompt()` lại. Nếu event đó không tồn tại trên một bản SillyTavern cũ hơn, runtime fallback sang `GENERATION_STARTED`.

### Bước 2 — final-stage enforcement

Ở `CHAT_COMPLETION_PROMPT_READY`, khi mảng Chat Completion messages đã được dựng:

1. Tìm mọi system message có content đúng bằng reminder.
2. Xóa các bản trùng.
3. Giữ một bản canonical và đưa nó xuống cuối mảng `chat`.
4. Nếu chưa tồn tại thì append `{ role: "system", content: reminder }`.

Mục tiêu là để reminder nằm **sau các layer prompt khác**, thay vì chỉ tin rằng depth 0 luôn đồng nghĩa với vị trí cuối cùng.

Nếu extension bị tắt hoặc textarea chỉ chứa whitespace, extension ghi prompt rỗng để xóa staged injection và không thay đổi final chat array.

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

## Giới hạn V0.1.1

- Chỉ có một reminder global, chưa có cấu hình theo character/chat/preset.
- Final-stage enforcement hiện nhắm vào **Chat Completion** qua `CHAT_COMPLETION_PROMPT_READY`.
- Text Completion vẫn dùng staged `setExtensionPrompt()` như V0.1.0, chưa có final-string rewrite riêng.
- Chưa có UI xem raw final HTTP payload; Prompt Reviewer/Inspector + marker output vẫn là cách test chính.
- Automated tests xác minh logic, settings contract, generation hook và final-stage promotion; vẫn cần test thật trên instance SillyTavern của bạn.

## License

MIT.
