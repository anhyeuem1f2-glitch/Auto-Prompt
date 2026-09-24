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


## v0.3.2 — Có thể hủy Full Memory trước khi gửi

- Nút **Bơm toàn bộ ký ức vào lượt kế tiếp** giờ là toggle thật sự.
- Bấm lần đầu: xếp full Event Log cho generation kế tiếp.
- Khi đã xếp, nút đổi thành **Hủy bơm toàn bộ ký ức ở lượt kế tiếp**.
- Bấm lần hai trước khi generate: hủy cờ `fullInjectNext`, lượt kế tiếp quay lại Auto Relevant bình thường.
- Nếu Event Log bị xóa sau khi đã xếp full-memory, nút vẫn giữ khả năng bấm để hủy; không thể rơi vào trạng thái đã xếp nhưng nút bị khóa.
- Quy tắc đóng gói release: `Auto-prompt.zip` luôn phải chứa `BAN_GIAO_DU_AN.md` đã cập nhật đúng với release hiện tại.

## v0.3.3 — Auto Retry + Recall Memory lỗi

Bản này chống mất ký ức khi Memory AI/provider lỗi tạm thời.

- Mỗi Memory recorder call thất bại sẽ **tự retry thêm 5 lần** sau lần gọi đầu tiên, tổng tối đa 6 lần gọi.
- Khoảng cách giữa mỗi retry là **20 giây**.
- UI status báo rõ Message ID nào đang retry, lần `x/5`, và khoảng chờ 20 giây.
- Sau khi hết 5 retry mà vẫn lỗi, message được lưu vào **Failed Memory Queue theo card** thay vì bị bỏ quên.
- Failed Queue được lưu trong extension settings, có `Message ID`, số lần đã thử, lỗi cuối, thời điểm lỗi và **snapshot response gốc** để Recall không phụ thuộc chat hiện tại còn giữ message ở đúng index hay không.
- UI thêm nút **Recall ký ức lỗi (N)**. Nút chỉ bật khi card hiện tại còn message lỗi.
- Recall chạy lại toàn bộ message đang chờ. Message thành công tự biến mất khỏi queue; message vẫn lỗi tiếp tục được giữ để có thể Recall lại sau.
- Một lần Recall thủ công mở một chu kỳ gọi mới và vẫn được hưởng 5 auto-retry/20 giây nếu provider tiếp tục chập chờn.
- Dedupe theo Message ID vẫn giữ nguyên: khi một message Recall thành công, event không thể bị append lần hai do hook phát lại.

Failed Memory Queue không được inject vào model chính. Nó chỉ là hàng đợi phục hồi nội bộ cho recorder.

## v0.3.4 — Memory theo từng Chat + tự đồng bộ khi rewind/xóa/swipe

v0.3.4 sửa việc Event Memory trước đây chỉ scope theo card. Từ bản này Memory được nhận diện theo **card + Chat ID**, vì vậy:

- **New Chat của cùng card bắt đầu Event Log trống**; không kế thừa sự kiện của chat cũ.
- Bật/tắt `Ghi sự kiện` và `Auto Relevant` được kế thừa tiện lợi từ phiên chat gần nhất của card, nhưng dữ liệu Event Log/index/processed/failed queue là riêng từng chat.
- UI hiển thị rõ `Card hiện tại` và `Chat ID hiện tại`.
- Extension nghe `CHAT_CHANGED`, `MESSAGE_DELETED` và `MESSAGE_SWIPED`, đồng thời còn reconcile trước khi ghi/Recall/select Memory.
- Nếu source assistant message của một event đã biến mất do rewind/xóa, event đó tự bị xóa khỏi Event Log, hidden index, processed markers và failed Recall queue.
- Nếu cùng Message ID bị thay bằng một swipe khác, `source_signature` không còn khớp nên ký ức của swipe cũ bị loại bỏ.
- Dữ liệu v0.3.3 cũ được migrate một lần vào chat đang mở khi nâng cấp; log `Message ID ...` cũ được đổi sang block mới.

### Định dạng Event Log mới

Mỗi event được extension tự bọc thành một block có metadata nguồn rõ ràng:

```text
<MEMORY_EVENT chat_id="Thế Giới Pokémon - 2026-09-20" message_id="24" source_signature="24:1a2b3c4d">
Nội dung sự kiện chi tiết do Memory AI ghi...
</MEMORY_EVENT>
```

`chat_id` giúp kiểm tra event thuộc đúng phiên chat nào. `message_id` xác định source message, còn `source_signature` giúp phát hiện source đã bị sửa/thay bằng swipe khác.

Khi Auto Relevant chọn event, model chính nhận nguyên các `<MEMORY_EVENT>` block được chọn bên trong `<MEMORY_CONTEXT>`, nên Prompt Reviewer dễ kiểm tra chính xác ID nào đã được đưa vào.

### Quy tắc reconcile

Trước khi Memory được ghi, Recall hoặc inject, extension so Event Log với `context.chat` hiện tại:

1. Source message còn tồn tại và vẫn là assistant message → giữ.
2. Source message đã bị xóa/rewind → xóa event tương ứng.
3. Source cùng Message ID nhưng nội dung đổi → signature khác → xóa event cũ.
4. Hidden index, processed markers và failed queue được dọn cùng event/source tương ứng.
5. Nếu log trở thành rỗng, `Bơm toàn bộ ký ức lượt kế tiếp` cũng tự hủy để không giữ trạng thái ma.

## v0.3.5 — Retry riêng cho Memory selector

v0.3.5 tách lỗi **Memory recorder** và lỗi **Memory selector** thành hai luồng độc lập.

- Memory selector tự retry thêm **5 lần**, mỗi lần cách **20 giây**, trước khi bỏ qua Memory cho generation hiện tại.
- Nếu vẫn thất bại, extension lưu `failedSelector` theo đúng **Card + Chat ID**, gồm prompt người dùng, recent assistant context, số lần thử, lỗi cuối và thời điểm lỗi.
- UI luôn có nút **Retry Memory selector**. Nút chỉ bật khi selector của chat hiện tại đang có lỗi.
- `Recall ký ức lỗi (N)` vẫn chỉ dành cho các assistant response chưa ghi được vào Event Log; hai loại lỗi không bị trộn chung.
- Retry selector thủ công thành công sẽ lưu kết quả chọn event vào `pendingSelector` để **Regenerate với đúng prompt đó** có thể dùng ngay mà không call selector lần nữa.
- Nếu prompt đã thay đổi, selection chờ cũ bị bỏ và selector chạy lại theo prompt mới để tránh inject Memory sai ngữ cảnh.
- Nếu manual retry vẫn lỗi, `failedSelector` vẫn được giữ để người dùng có thể bấm lại sau.

Lưu ý: nếu generation đã được gửi đi trong lúc selector thất bại, retry thủ công không thể sửa request đã gửi. Hãy dùng Retry rồi **Regenerate cùng prompt** để áp dụng kết quả Memory vừa khôi phục.


## v0.3.6 — Tauri Tavern manifest compatibility

- Thêm trường `"author": "Unknown"` vào `manifest.json` để các loader yêu cầu metadata tác giả, gồm Tauri Tavern theo cấu hình được cung cấp, có thể nhận extension.
- Bump version extension/package lên `0.3.6`.
- Không thay đổi logic Auto Prompt, Event Memory, retry/Recall, selector hay chat-scoped reconciliation của v0.3.5.
- Contract test khóa cả `version: 0.3.6` và `author: Unknown` để các release sau không vô tình xóa metadata tương thích.
- `BAN_GIAO_DU_AN.md` tiếp tục là file bắt buộc trong mọi ZIP release.
