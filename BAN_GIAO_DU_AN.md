# BÀN GIAO DỰ ÁN — ST Auto Prompt Reminder

## Phiên bản

`v0.1.2` — 2026-09-17

## Mục tiêu V1

Một extension SillyTavern tối giản cho phép người dùng viết toàn bộ lời nhắc trong một textarea và tự động chèn nguyên văn nội dung đó vào mỗi Chat Completion mà không cần lặp lại reminder trong message chat.

## Thay đổi v0.1.2

### Lý do sửa

Test thật trên SillyTavern xác nhận v0.1.1 đã đưa reminder xuống cuối prompt và model làm theo marker, nhưng Prompt Reviewer cho thấy reminder xuất hiện **hai lần**: một bản staged cũ và một bản final ở cuối. Nguyên nhân là staged `setExtensionPrompt()` đã được merge vào layer prompt trước khi `CHAT_COMPLETION_PROMPT_READY` chạy, nên de-duplicate theo `eventData.chat` không thể xóa bản đã merge đó.

### Cách sửa

- Không còn stage reminder bằng `setExtensionPrompt()`.
- Key cũ `st_auto_prompt_reminder.main` luôn được ghi chuỗi rỗng để dọn staged prompt từ v0.1.1.
- `CHAT_COMPLETION_PROMPT_READY` là nơi duy nhất chèn reminder thật.
- Final hook de-duplicate system message trùng và append đúng một reminder ở cuối `chat`.
- Bỏ field `author` khỏi `manifest.json` và bỏ tên cá nhân khỏi metadata/license hiển thị của project.
- Bump version lên `0.1.2`.

## Tính năng hiện có

- Một toggle bật/tắt.
- Một textarea lớn, không chia category/reminder type.
- Autosave vào `extensionSettings.st_auto_prompt_reminder`.
- Clear legacy staged slot ở mỗi generation.
- Final Chat Completion injection ở `CHAT_COMPLETION_PROMPT_READY`.
- Reminder được đặt thành system message cuối cùng.
- Console log có prefix `[ST Auto Prompt Reminder]`.
- Test Node không cần dependency ngoài.

## Kiểm thử tự động

```bash
npm test
npm run check
```

Test bao phủ settings, clear staged slot, generation hook, final-stage de-duplicate/single-copy injection, disable behavior, manifest và entry-point wiring.

## Test thật cần làm trên SillyTavern

Dùng reminder:

```text
Hãy làm đúng thiết lập nhân vật
Trong phần <story_driver>, bắt buộc thêm đúng một dòng:
[AutoPromptCheck]: EXTENSION_ACTIVE
```

Kiểm tra:

1. Prompt Reviewer chỉ thấy reminder **một lần**.
2. Bản đó nằm ở cuối prompt.
3. Status UI hiện `✓ Đã chèn ở cuối prompt gửi AI ...`.
4. Output model có `[AutoPromptCheck]: EXTENSION_ACTIVE` trong `<story_driver>`.

## Giới hạn đã biết

- Một reminder global.
- Không có per-character/per-chat/preset profile.
- Final-stage injection hiện áp dụng cho Chat Completion; Text Completion chưa có final-string injection riêng.
- Không có raw final HTTP payload inspector riêng.

## File cần ghi đè/push GitHub cho v0.1.2

```text
manifest.json
package.json
index.js
src/runtime.js
test/runtime.test.mjs
test/extension-contract.test.mjs
README.md
BAN_GIAO_DU_AN.md
LICENSE
```

Các file khác không đổi.
