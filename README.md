# ST Auto Prompt Reminder

Extension tối giản cho SillyTavern: bạn nhập một đoạn prompt nhắc nhở duy nhất, extension sẽ tự động chèn nguyên văn đoạn đó vào **mọi generation** mà không làm thay đổi message bạn gõ trong chat.

## V0.1.0 có gì

- Một công tắc ON/OFF.
- Một textarea lớn để ghi toàn bộ prompt cần tự chèn.
- Tự lưu bằng SillyTavern extension settings.
- Tự chèn trước mỗi generation bằng extension prompt.
- Injection mặc định: **in-chat / depth 0 / system role**.
- Dòng trạng thái cho biết lần generation gần nhất đã inject bao nhiêu ký tự.
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

## Test nhanh bằng Prompt Inspector

Dùng một marker rất dễ nhận ra, ví dụ:

```text
AUTO_REMINDER_TEST_9F31
```

Sau đó:

1. Ghi marker vào textarea và bật extension.
2. Gửi một message bất kỳ.
3. Mở **Prompt Inspector** hoặc **Prompt Itemization** của lượt trả lời.
4. Tìm `AUTO_REMINDER_TEST_9F31`.
5. Marker phải có trong prompt model nhận nhưng không xuất hiện trong message user trên giao diện chat.
6. Tắt extension, generate lại và kiểm tra marker đã biến mất.

Nếu cần debug thêm, mở browser DevTools Console và tìm log có prefix:

```text
[ST Auto Prompt Reminder]
```

## Injection behavior

Extension sử dụng một extension prompt cố định:

- Key: `st_auto_prompt_reminder.main`
- Position: in-chat (`1`)
- Depth: `0`
- Role: system (`0`)
- World Info scan: off

Trước mỗi event `GENERATION_AFTER_COMMANDS`, extension đọc settings hiện tại và gọi `setExtensionPrompt()` lại. Nếu event đó không tồn tại trên một bản SillyTavern cũ hơn, runtime fallback sang `GENERATION_STARTED`.

Nếu extension bị tắt hoặc textarea chỉ chứa whitespace, extension ghi prompt rỗng để xóa injection cũ.

## Development tests

Yêu cầu Node.js hiện đại.

```bash
npm test
npm run check
```

Project không có dependency npm bên ngoài.

## Cấu trúc

```text
st-auto-prompt-reminder/
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

## Giới hạn V0.1.0

- Chỉ có một reminder global, chưa có cấu hình theo character/chat/preset.
- Chưa có UI xem raw final HTTP payload; cách kiểm tra chính là Prompt Inspector / Prompt Itemization và console log.
- Automated tests xác minh logic, settings contract và generation hook; vẫn cần test thật trên bản SillyTavern của bạn vì môi trường build này không chạy instance SillyTavern của bạn.

## License

MIT.
