# FluentGo — học tiếng Anh cùng Gemini AI

FluentGo là web app HTML/CSS/JavaScript/jQuery chạy trên GitHub Pages. Gemini được gọi qua Apps Script; API key chỉ nằm trong Google Sheet và bản cache Script Properties, không được gửi xuống trình duyệt.

## Kiến trúc bảo mật

```text
GitHub Pages → Apps Script iframe bridge → Gemini API
                          └──────────────→ Google Sheets
```

- `APP_SCRIPT_KEY` vẫn nằm trong tab `FluentGo Config`; bridge chỉ nhận proof HMAC tạm thời.
- `GEMINI_API_KEY` nằm trong tab `FluentGo Config`, được sao chép vào Script Properties và CacheService để request bình thường không phải đọc Sheet.
- Frontend có cooldown và chỉ cho một request AI đồng thời; Apps Script áp dụng rate limit theo user, toàn app và giới hạn lượt/ngày.
- Khi Google báo lỗi key/quyền, Apps Script mới đọc lại Sheet. Nếu key hoặc model đã thay đổi, request được thử lại đúng một lần.
- Người học đăng ký bằng tên, username, email và mật khẩu. Apps Script tạo `userId` cố định dạng `usr_<UUID>`.
- Mật khẩu được băm lặp với salt trước khi lưu; session token 30 ngày chỉ được lưu dạng HMAC hash trong Sheet.
- Mọi lệnh AI và đồng bộ đều lấy `userId` từ session đã xác thực, không tin ID do frontend tự gửi.

Quan trọng: không chia sẻ Google Sheet ở chế độ công khai. Chỉ Apps Script cần quyền truy cập Sheet.

## Thiết lập Google Sheet và Gemini

1. Tạo một Google Sheet mới.
2. Vào **Extensions → Apps Script**.
3. Chép toàn bộ [google-apps-script.gs](./google-apps-script.gs) vào file `Code.gs`, rồi lưu.
4. Trong Apps Script, chọn hàm `setupFluentGo` và nhấn **Run**. Cấp các quyền được yêu cầu.
5. Quay lại Google Sheet. Bốn tab `FluentGo Config`, `FluentGo Progress`, `FluentGo Users` và `FluentGo Sessions` sẽ được tạo.
6. `APP_SCRIPT_KEY` được tạo tự động. Không cần sửa và không chia sẻ giá trị này.
7. Tạo Gemini API key mới tại Google AI Studio và sao chép nguyên giá trị được cấp.
8. Trong tab `FluentGo Config`, dán key vào cột VALUE của dòng `GEMINI_API_KEY`.
9. Chọn menu **FluentGo → Nạp lại cấu hình từ Sheet**. Thao tác này lưu snapshot vào Script Properties; các request sau không đọc Sheet nữa.

Tab cấu hình có dạng:

| KEY | VALUE | MÔ TẢ |
|---|---|---|
| `GEMINI_API_KEY` | key từ AI Studio | Chỉ dùng ở Apps Script |
| `GEMINI_MODEL` | `gemini-3.5-flash` | Model Gemini |
| `APP_SCRIPT_KEY` | tự động tạo | Khóa bridge nội bộ |
| `DAILY_AI_LIMIT` | `100` | Lượt AI/user/ngày |
| `AI_REQUESTS_PER_MINUTE` | `6` | Lượt AI/user/phút |
| `GLOBAL_AI_REQUESTS_PER_MINUTE` | `60` | Lượt AI toàn app/phút |
| `SYNC_REQUESTS_PER_MINUTE` | `10` | Đồng bộ mỗi user/phút |
| `GLOBAL_REQUESTS_PER_MINUTE` | `180` | Tổng request bridge/phút |

Cấu hình frontend:

```javascript
window.FLUENTGO_CONFIG = Object.freeze({
  appsScriptUrl: 'https://script.google.com/macros/s/DEPLOYMENT_ID/exec'
});
```

## Deploy Apps Script

1. Trong Apps Script chọn **Deploy → New deployment**.
2. Chọn loại **Web app**.
3. **Execute as:** Me.
4. **Who has access:** Anyone.
5. Deploy và sao chép Web App URL kết thúc bằng `/exec`.
6. Mở [app-config.js](./app-config.js) và thay giá trị:

```javascript
appsScriptUrl: 'https://script.google.com/macros/s/DEPLOYMENT_ID/exec'
```

Khi sửa `google-apps-script.gs` sau này, vào **Deploy → Manage deployments → Edit → New version → Deploy** để bản đang chạy nhận code mới.

## Đăng ký, đăng nhập và tiến độ từng user

- Người dùng mới chọn **Tạo tài khoản**, nhập tên, username, email và mật khẩu tối thiểu 8 ký tự.
- Username và email đều là duy nhất. Người dùng có thể đăng nhập bằng một trong hai.
- Tài khoản cũ được tự tạo username từ phần đứng trước dấu `@` khi chạy lại `setupFluentGo`.
- Khi đăng nhập thành công, trình duyệt nhận session token 30 ngày. Token gốc nằm trong `localStorage`; Google Sheet chỉ lưu token hash.
- Nút đăng xuất có trong menu tài khoản bên trái và trang Hồ sơ. Đăng xuất thu hồi session phía Apps Script.
- Khi đăng nhập trên thiết bị khác, Apps Script trả lại JSON tiến độ trong `FluentGo Progress` theo đúng `userId`.
- Tiến độ cục bộ được lưu riêng theo khóa `fluentgo_state_v2_<userId>`, vì vậy nhiều tài khoản trên cùng trình duyệt không ghi đè nhau.
- Khi người dùng đổi tên trong Hồ sơ, tên tài khoản được cập nhật trong `FluentGo Users` trước khi lưu tiến độ.

Các tab dữ liệu:

| Tab | Nội dung |
|---|---|
| `FluentGo Config` | Apps Script key và hạn mức sync/bridge |
| `FluentGo Users` | userId, username, email, tên, password salt/hash, trạng thái |
| `FluentGo Sessions` | session token hash, userId và ngày hết hạn |
| `FluentGo Progress` | XP, streak, level và toàn bộ JSON tiến độ theo userId |

Không chỉnh sửa thủ công `passwordSalt`, `passwordHash` hoặc `tokenHash`. Có thể khóa tài khoản bằng cách đổi cột `status` của user thành `disabled`.

## Hạn chế spam và tiết kiệm quota Apps Script

- Frontend gom các thay đổi tiến độ trong khoảng 6,5 giây thay vì đồng bộ sau từng thao tác.
- Chỉ một request đồng bộ được chạy cùng lúc; request phát sinh thêm sẽ được gộp lại.
- Tiến độ không thay đổi sẽ không gửi lại. Backend cũng dùng fingerprint để bỏ qua lần ghi Sheet trùng.
- Mỗi thao tác AI tạo một invocation Apps Script; đổi lại key không xuất hiện trong source, Network hoặc DevTools.
- Chỉ một request Gemini được chạy tại một thời điểm ở frontend, có cooldown; backend giới hạn theo phút và theo ngày.
- Config được giữ trong Script Properties và cache 6 giờ. Sheet chỉ được đọc ở lần khởi tạo, khi quản trị viên bấm nạp lại, hoặc sau lỗi xác thực/quyền Gemini.
- Nếu Sheet có key/model mới sau một lỗi xác thực, backend tự thử lại một lần; nếu cấu hình không đổi thì không lặp request thất bại.

Các giới hạn này giảm đáng kể request hợp lệ và thao tác spam thông thường. Vì Web App được deploy công khai, một HTTP request độc hại vẫn tạo một invocation Apps Script trước khi code rate-limit chạy; muốn chặn trước invocation cần đặt backend có firewall/rate limiting như Cloudflare Worker ở phía trước.

## Hội thoại tình huống cùng AI

Trong **Luyện tập → Chat cùng Mochi**, người học có thể:

- Tự nhập tình huống hoặc chọn nhanh theo bốn nhóm: Đời sống, Công việc, Học tập và Du lịch.
- Chọn người học hoặc AI nói trước.
- Luyện theo vai cụ thể, ví dụ khách hàng/nhân viên, ứng viên/nhà tuyển dụng hoặc du khách/lễ tân.
- Nhập câu bằng bàn phím hoặc microphone trên Chrome/Edge.
- Nghe Mochi đọc câu trả lời bằng giọng tiếng Anh.
- Nhận điểm cho từng câu và mở thẻ review ngay dưới câu trả lời để xem ngữ pháp, chính tả, độ tự nhiên, mẹo phát âm và câu sửa tốt hơn.
- Nghe câu gợi ý bằng giọng tiếng Anh và nhận 2–3 lựa chọn trả lời tiếp theo.
- Duy trì tối đa 10 lượt hội thoại gần nhất trong context để Gemini trả lời đúng mạch.
- Nhận XP khi kết thúc buổi luyện, thay vì cộng XP sau từng request.

## Deploy GitHub Pages

1. Commit `index.html`, `styles.css`, `app.js`, `app-config.js`, `assets/` và các file cần thiết. Không commit `key_ai.txt`.
2. Vào repository **Settings → Pages**.
3. Chọn **Deploy from a branch**, branch `main`, thư mục `/ (root)`.
4. Mở URL `https://username.github.io/repository/`.

Ứng dụng dùng đường dẫn tương đối nên hoạt động trong subpath của GitHub Pages. Có thể mở trực tiếp `index.html`, nhưng microphone và một số API trình duyệt hoạt động ổn định hơn qua HTTPS của GitHub Pages.

## Dữ liệu được lưu

- `localStorage`: session token và tiến độ riêng của tài khoản trên thiết bị.
- `FluentGo Progress`: mỗi `userId` có một dòng, được cập nhật sau hoạt động học.
- `FluentGo Config`: cấu hình riêng của chủ app, không được trả về frontend.
- `FluentGo Users` và `FluentGo Sessions`: tài khoản và phiên đăng nhập dạng hash.

## Các file chính

```text
index.html                 Giao diện ứng dụng
styles.css                 Giao diện responsive
app.js                     Bài tập, speech, state và Apps Script bridge
app-config.js              Web App URL công khai của Apps Script
google-apps-script.gs      Gemini proxy, cache config, tài khoản, session và đồng bộ Sheets
BA_ANALYSIS.md             Audit BA, yêu cầu và product backlog
smoke-test.js              Kiểm tra dataset, Next flow và kiến trúc Gemini proxy
assets/mochi.png           Mascot Mochi
assets/favicon.svg         Icon tab trình duyệt
```

## Kiểm tra cú pháp

```powershell
npm run check
```

Tài liệu tham khảo: [Gemini text generation](https://ai.google.dev/gemini-api/docs/text-generation), [Gemini audio understanding](https://ai.google.dev/gemini-api/docs/audio).
