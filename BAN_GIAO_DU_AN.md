# BÀN GIAO DỰ ÁN — ST Auto Prompt Reminder

## Phiên bản

`v0.1.0` — 2026-09-17

## Mục tiêu V1

Một extension SillyTavern tối giản cho phép người dùng viết toàn bộ lời nhắc trong một textarea và tự động chèn nguyên văn nội dung đó vào mọi generation mà không cần lặp lại reminder trong message chat.

## Đã làm

- Một toggle bật/tắt extension reminder.
- Một textarea lớn, không chia category/reminder type.
- Autosave vào `extensionSettings.st_auto_prompt_reminder`.
- Injection bằng `setExtensionPrompt()` ở in-chat depth 0, role system.
- Re-apply injection ở mỗi `GENERATION_AFTER_COMMANDS`, fallback `GENERATION_STARTED`.
- Khi tắt/để trống, prompt cũ được clear bằng injection rỗng.
- Status UI báo lần generation gần nhất đã inject và số ký tự.
- Console log có prefix `[ST Auto Prompt Reminder]`.
- Lifecycle disable hook xóa injection đang tồn tại.
- Test Node không cần dependency ngoài.

## Kiểm thử tự động

Lệnh:

```bash
npm test
npm run check
```

Test bao phủ:

- Khởi tạo/migrate default settings.
- Giữ nguyên prompt text do user viết.
- Disabled/blank => clear injection.
- Đúng prompt key/position/depth/role.
- Generation hook gọi injection ở mọi lần event chạy.
- Fallback event.
- Manifest/entry-point wiring.

## Test thật cần làm trên SillyTavern của người dùng

1. Cài extension.
2. Nhập `AUTO_REMINDER_TEST_9F31` vào textarea.
3. Bật extension.
4. Gửi message bất kỳ.
5. Mở Prompt Inspector hoặc Prompt Itemization.
6. Xác nhận marker có trong prompt nhưng không nằm trong visible user message.
7. Tắt extension và generate lại; marker phải biến mất.

## Giới hạn đã biết

- V0.1.0 chỉ có một reminder global.
- Không có per-character/per-chat/preset profile.
- Không có final HTTP payload inspector riêng.
- Chưa chạy trực tiếp trên instance SillyTavern của người dùng trong môi trường build này; cần test marker ở trên sau khi cài.

## File cần upload/ghi đè GitHub cho v0.1.0

Đây là release đầu tiên, upload toàn bộ các file/folder sau:

```text
manifest.json
index.js
style.css
package.json
src/
test/
docs/
README.md
BAN_GIAO_DU_AN.md
LICENSE
.gitignore
```

Không upload `.git/`.
