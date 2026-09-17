# BÀN GIAO DỰ ÁN — ST Auto Prompt Reminder

## Phiên bản

`v0.1.1` — 2026-09-17

## Mục tiêu V1

Một extension SillyTavern tối giản cho phép người dùng viết toàn bộ lời nhắc trong một textarea và tự động chèn nguyên văn nội dung đó vào mọi generation mà không cần lặp lại reminder trong message chat.

## Thay đổi v0.1.1

### Lý do sửa

Test thực tế xác nhận reminder có trong Prompt Reviewer, nhưng một lệnh marker bắt buộc vẫn bị model bỏ qua. Prompt Reviewer cũng cho thấy sau reminder vẫn còn layer prompt khác, nên `in-chat depth 0 system` không bảo đảm reminder là message cuối cùng của final Chat Completion prompt.

### Cách sửa

- Vẫn dùng `setExtensionPrompt()` ở `in-chat / depth 0 / system` để reminder có mặt trong pipeline và dễ kiểm tra bằng Prompt Reviewer.
- Thêm final-stage hook ở `CHAT_COMPLETION_PROMPT_READY`.
- Khi final chat array sẵn sàng:
  - tìm system message có content đúng bằng reminder;
  - xóa bản trùng;
  - di chuyển một bản duy nhất xuống cuối mảng messages;
  - nếu staged copy không tồn tại thì append một system reminder mới ở cuối.
- Status UI đổi thành `✓ Đã chèn ở cuối prompt gửi AI ...` khi final-stage hook chạy.
- Khi disable extension, cả generation hook và final prompt hook đều được cleanup.

## Tính năng hiện có

- Một toggle bật/tắt extension reminder.
- Một textarea lớn, không chia category/reminder type.
- Autosave vào `extensionSettings.st_auto_prompt_reminder`.
- Injection bằng `setExtensionPrompt()` ở in-chat depth 0, role system.
- Re-apply injection ở mỗi `GENERATION_AFTER_COMMANDS`, fallback `GENERATION_STARTED`.
- Final Chat Completion reminder enforcement ở `CHAT_COMPLETION_PROMPT_READY`.
- Khi tắt/để trống, prompt cũ được clear bằng injection rỗng.
- Console log có prefix `[ST Auto Prompt Reminder]`.
- Test Node không cần dependency ngoài.

## Kiểm thử tự động

Lệnh:

```bash
npm test
npm run check
```

Test bao phủ:

- Khởi tạo/default settings.
- Giữ nguyên prompt text do user viết.
- Disabled/blank => clear injection.
- Đúng prompt key/position/depth/role.
- Generation hook gọi injection ở mọi lượt.
- Fallback generation event.
- Final-stage function di chuyển staged reminder xuống cuối.
- Final-stage de-duplicate, không gửi nhiều bản reminder.
- Nếu staged reminder bị thiếu, final-stage sẽ append system reminder cuối.
- Disabled reminder không sửa final chat array.
- `CHAT_COMPLETION_PROMPT_READY` hook registration + cleanup.
- Manifest/entry-point wiring.

## Test thật cần làm trên SillyTavern của người dùng

Dùng reminder:

```text
Hãy làm đúng thiết lập nhân vật
Trong phần <story_driver>, bắt buộc thêm đúng một dòng:
[AutoPromptCheck]: EXTENSION_ACTIVE
```

Kiểm tra:

1. Prompt Reviewer vẫn thấy reminder.
2. Status UI hiện `✓ Đã chèn ở cuối prompt gửi AI ...`.
3. Output model có `[AutoPromptCheck]: EXTENSION_ACTIVE` trong `<story_driver>`.
4. Nếu vẫn không có marker dù status final-stage đã hiện, khi đó lỗi còn lại là model/preset instruction conflict chứ không còn là reminder bị đặt trước layer prompt khác.

## Giới hạn đã biết

- Một reminder global.
- Không có per-character/per-chat/preset profile.
- Final-stage enforcement mới áp dụng cho Chat Completion; Text Completion chưa có final-string rewrite.
- Không có raw final HTTP payload inspector riêng.

## File cần ghi đè/push GitHub cho v0.1.1

```text
manifest.json
package.json
index.js
src/runtime.js
test/runtime.test.mjs
test/extension-contract.test.mjs
README.md
BAN_GIAO_DU_AN.md
```

Các file khác không đổi.
