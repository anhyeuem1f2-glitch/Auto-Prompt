# ST Auto Prompt Reminder

Extension tối giản cho SillyTavern: bạn nhập một đoạn prompt nhắc nhở duy nhất, extension sẽ tự động chèn nguyên văn đoạn đó vào **mọi generation** mà không làm thay đổi message bạn gõ trong chat.

## V0.1.2 có gì

- Một công tắc ON/OFF.
- Một textarea lớn để ghi toàn bộ prompt cần tự chèn.
- Tự lưu bằng SillyTavern extension settings.
- Không còn stage một bản reminder bằng `setExtensionPrompt()`, tránh model nhận hai bản giống nhau.
- Slot injection cũ `st_auto_prompt_reminder.main` luôn được clear để nâng cấp từ v0.1.1 không để lại prompt cũ.
- Với Chat Completion, ở event `CHAT_COMPLETION_PROMPT_READY`, extension **append đúng một system reminder ở cuối mảng messages ngay trước khi gửi AI**.
- Nếu final chat array đã có bản reminder trùng, extension de-duplicate rồi giữ đúng một bản cuối cùng.
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

V0.1.2 dùng **một đường injection duy nhất** cho Chat Completion:

### Bước 1 — clear legacy staged slot

Trước mỗi generation, extension gọi `setExtensionPrompt()` với chuỗi rỗng cho key `st_auto_prompt_reminder.main`. Mục đích chỉ là xóa staged copy của v0.1.1 hoặc bản cũ, không chèn reminder ở bước này.

### Bước 2 — final-stage injection

Ở `CHAT_COMPLETION_PROMPT_READY`, khi mảng Chat Completion messages đã được dựng:

1. Tìm các system message có content đúng bằng reminder và xóa bản trùng nếu có.
2. Append đúng một `{ role: "system", content: reminder }` ở cuối mảng `chat`.
3. Vì đây là bản duy nhất, Prompt Reviewer/Inspector chỉ nên thấy reminder **một lần**, ở cuối prompt.

Nếu extension bị tắt hoặc textarea chỉ chứa whitespace, final chat array không được thêm reminder và legacy staged slot vẫn được clear.

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

## Giới hạn V0.1.2

- Chỉ có một reminder global, chưa có cấu hình theo character/chat/preset.
- Final-stage enforcement hiện nhắm vào **Chat Completion** qua `CHAT_COMPLETION_PROMPT_READY`.
- Text Completion chưa có final-string injection riêng; v0.1.2 ưu tiên đúng luồng Chat Completion đã được test thực tế.
- Chưa có UI xem raw final HTTP payload; Prompt Reviewer/Inspector + marker output vẫn là cách test chính.
- Automated tests xác minh logic, clear legacy slot, settings contract và final-stage single-copy injection; vẫn cần test thật trên instance SillyTavern của bạn.

## License

MIT.
