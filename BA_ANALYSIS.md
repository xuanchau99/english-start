# FluentGo — Phân tích Business Analyst và kế hoạch sản phẩm

## Bản cập nhật: học theo mục tiêu và kho nội dung dài hạn

Kho nội dung được tổ chức theo chuỗi `mục tiêu → trình độ → chặng → chủ đề → dạng bài`.

| Hạng mục | Thiết kế đã triển khai |
|---|---|
| Mục tiêu học | 6 lựa chọn: giao tiếp, lập trình viên, công sở, du lịch/định cư, du học, dịch vụ/bán hàng |
| Lộ trình | 12 chặng cho mỗi mục tiêu và mỗi A1–B2; 6 bài/chặng; cho phép mở mọi chặng và học vượt kế hoạch |
| Quy mô | 288 chặng, 1.728 bài lộ trình, 5.760 bài luyện cố định |
| Dạng bài | Nghe, đọc, điền từ, ngữ pháp, dịch, sắp xếp câu, ghép nghĩa, chính tả, nói, viết |
| Flashcard | Tối thiểu 24 từ theo mỗi mục tiêu/trình độ; lọc 12 chủ đề; lịch ôn tách theo mục tiêu |
| AI | Hội thoại, chấm nói, sửa viết và giải thích sâu theo yêu cầu; không dùng AI cho thao tác Next thông thường |
| Đồng bộ | Mục tiêu và vị trí chặng nằm trong state người dùng, được lưu cục bộ và đồng bộ Google Sheets |

Nguyên tắc sản phẩm: dữ liệu cốt lõi phải chạy offline, nhanh và dự đoán được; AI là lớp coach giúp phản hồi cá nhân hóa, không phải điều kiện để mở một bài học.

## 1. Mục tiêu sản phẩm

FluentGo là web app học tiếng Anh mobile-first cho người Việt từ A1 đến B2. Giá trị cốt lõi:

- Học theo lộ trình nhưng không bị giới hạn số bài trong ngày.
- Luyện đủ nghe, nói, đọc, viết, từ vựng và hội thoại tình huống.
- Nhận phản hồi AI tức thời bằng tiếng Việt.
- Giữ tiến độ theo tài khoản trên Google Sheets và tiếp tục học trên thiết bị khác.
- Duy trì động lực bằng XP, streak, mục tiêu ngày, mascot và sổ lỗi.

## 2. Người dùng mục tiêu

### Persona A — Người mới bắt đầu

- Trình độ A1–A2, cần hướng dẫn tiếng Việt và bài ngắn.
- Muốn giao tiếp trong đời sống, du lịch và công việc cơ bản.
- Dễ bỏ cuộc nếu bài quá dài hoặc không biết mình sai ở đâu.

### Persona B — Người học độc lập

- Trình độ B1–B2, muốn bài đa dạng và có chiều sâu.
- Cần luyện ý kiến, email, thuyết trình, phỏng vấn và đàm phán.
- Muốn học nhiều hơn kế hoạch ngày khi có thời gian.

### Persona C — Chủ ứng dụng riêng

- Tự quản lý tài khoản, quota AI và dữ liệu Sheet.
- Ưu tiên triển khai đơn giản trên GitHub Pages.
- Chấp nhận key Gemini nằm ở frontend để giảm invocation Apps Script.

## 3. Audit chức năng trước khi cải tiến

| Khu vực | Hiện trạng ban đầu | Vấn đề chính |
|---|---|---|
| Đăng ký/đăng nhập | Có username/email, session 30 ngày | Mỗi login tạo session mới; chưa có đổi/quên mật khẩu |
| Trang hôm nay | Có mục tiêu, XP, streak, task | Task mang tính minh họa; chưa liên kết chặt với lesson ID |
| Bản đồ | Có A1–B2 | Trạng thái node hard-code; chỉ một lesson dùng cho mọi node |
| Luyện nghe | Một câu tĩnh | Chọn xong bị khóa, không có Next |
| Luyện đọc | Một bài tĩnh | Không có Next, không đổi theo level |
| Luyện nói | Một câu mẫu | Không có danh sách câu theo level |
| Luyện viết | Một đề giới thiệu | Không đổi chủ đề hoặc yêu cầu độ dài theo level |
| Từ vựng | Sáu flashcard A1 | Không có deck A2–B2 |
| Hội thoại AI | Có scenario, voice, review | Trước đây có lỗi JSON lồng; lịch sử chỉ nằm trong phiên hiện tại |
| Sổ lỗi | Hiển thị lỗi gần đây | Nút ôn chỉ phát đáp án, chưa tạo phiên ôn thích nghi |
| Hồ sơ | Tên, level, goal, Sheets sync | Thành tích và mục tiêu nghề nghiệp còn tĩnh |
| AI | Đi qua Apps Script | Làm tăng invocation Apps Script cho mỗi lượt AI |

## 4. Benchmark tính năng

- Duolingo Practice Hub gom luyện nghe, nói, lỗi sai, từ vựng, Stories và Radio; bài ngắn, XP và node mở dần giúp tạo thói quen. Nguồn: [Duolingo Practice Hub](https://blog.duolingo.com/guide-to-duolingo-practice-hub/) và [Duolingo ways to practice](https://blog.duolingo.com/ways-to-practice-in-duolingo/).
- ELSA tập trung AI Conversation Coach, Pronunciation Coach, role-play tự tạo, phản hồi chi tiết và theo dõi tiến bộ. Nguồn: [ELSA new experience](https://blog.elsaspeak.com/en/discover-the-new-elsa-speak-experience/) và [ELSA features](https://us.elsaspeak.com/infus/).
- Các mini-unit hiện đại giới thiệu ít kiến thức mới rồi áp dụng ngay bằng nghe/nói/truyện/hội thoại, thay vì một unit dài. Nguồn: [Duolingo mini-units](https://blog.duolingo.com/intermediate-mini-units/).

## 5. Yêu cầu nghiệp vụ ưu tiên

### P0 — Đã triển khai trong phiên bản này

1. Gemini gọi qua Apps Script để không lộ key; cấu hình dùng Script Properties/CacheService và chỉ đọc lại Sheet khi lỗi xác thực hoặc quản trị viên chủ động nạp lại.
2. Listening và Reading có phiên hữu hạn 5 bài/level, giải thích, transcript sau khi trả lời, tổng kết và luyện lại câu sai.
3. Speaking và Writing có nhiều đề theo level; AI chấm xong mở đề tiếp theo.
4. Vocabulary có deck riêng A1, A2, B1 và B2; phiên dừng khi hết deck, tổng kết và luyện lại riêng nhóm “Chưa nhớ”.
5. Roadmap dùng lesson ID thật, hoàn thành bài mở ngay bài tiếp theo trong cùng ngày.
6. Mỗi node roadmap tạo lesson dựa trên nội dung level/node thay vì dùng một lesson cố định.
7. Sai nghe/đọc và lỗi viết được đưa vào sổ lỗi; `practiceStats` được lưu trong progress.
8. Dữ liệu cũ `completedLessons: [1,2,...]` được migrate sang ID `A1-0`, `A1-1`, ...

### P1 — Đề xuất phiên bản kế tiếp

1. Placement test 10–15 câu để đề xuất level đầu vào.
2. Spaced repetition thật: mỗi từ có `ease`, `interval`, `nextReviewAt` và hàng đợi đến hạn.
3. Phiên “Ôn lỗi thích nghi”: tạo lại câu hỏi từ lỗi gần đây, không chỉ hiển thị đáp án.
4. Báo cáo tiến bộ theo kỹ năng: accuracy nghe/đọc, điểm nói/viết trung bình, số từ đến hạn.
5. Streak chuẩn theo ngày hoạt động thực tế, có streak freeze và timezone nhất quán.
6. Onboarding chọn mục tiêu: du lịch, công việc, giao tiếp, IELTS; ưu tiên nội dung tương ứng.
7. Download/export tiến độ JSON/CSV và chức năng xóa tài khoản/dữ liệu.

### P2 — Mở rộng nổi bật

1. Story/mini podcast kèm transcript bật tắt và câu hỏi xen kẽ.
2. Word matching/timed challenge và daily quest để tăng tính trò chơi.
3. AI tạo lesson cá nhân từ lỗi sai và mục tiêu nghề nghiệp.
4. Conversation report cuối phiên: fluency, grammar, vocabulary range và “câu nên luyện lại”.
5. Accent/voice selector US–UK, tốc độ đọc và chế độ shadowing.
6. Leaderboard nhóm riêng hoặc thử thách với bạn bè nếu sản phẩm mở rộng nhiều người.

## 6. Luồng nghiệp vụ sau cải tiến

### Lộ trình

1. User chọn mục tiêu, level và một trong 12 chặng.
2. Hệ thống đánh dấu bài đầu tiên chưa hoàn thành là `current`; các bài khác vẫn mở để học vượt.
3. Khi nhận thưởng, lesson ID gồm mục tiêu, level, chặng và bài được thêm vào `completedLessons`.
4. Nút chặng trước/sau cho phép đi xuyên suốt lộ trình, không kiểm tra giới hạn theo ngày.
5. XP, phút học, mục tiêu và vị trí chặng được lưu local rồi debounce lên Google Sheets.

### Luyện nghe/đọc

1. Hệ thống lấy bộ bài theo mục tiêu, level và chủ đề hiện tại.
2. User chọn một đáp án; danh sách khóa để tránh chấm hai lần.
3. Hiển thị đúng/sai, đáp án đúng và giải thích.
4. Ghi `practiceStats`, lỗi sai và XP.
5. Hiện nút Next; hết deck thì dừng ở màn hình kết quả và cho phép chủ động học lại.

### Luyện nói/viết

1. Hệ thống lấy target/prompt theo mục tiêu, level và chủ đề.
2. User ghi âm hoặc viết nội dung.
3. Browser gọi Apps Script bridge; Apps Script xác thực session, quota rồi proxy sang Gemini.
4. UI hiển thị điểm, sửa lỗi và gợi ý.
5. Ghi XP, số bài và lỗi viết; mở bài tiếp theo.

## 7. Kiến trúc và rủi ro

### Kiến trúc hiện tại

- GitHub Pages: HTML/CSS/jQuery, lesson data và Apps Script iframe bridge; không chứa Gemini key.
- Apps Script: Gemini proxy, config cache, đăng ký, đăng nhập, session, profile và sync progress.
- Google Sheets: Config, Users, Sessions và Progress.
- LocalStorage: session token và state học tập theo user; không lưu Gemini key.

### Kiểm soát rủi ro Gemini key

Repository private không làm key trong website trở thành bí mật: trình duyệt phải tải key và user có thể xem trong DevTools/network. Google cũng khuyến cáo không hard-code API key trong production client. Nguồn: [Google — Using Gemini API keys](https://ai.google.dev/gemini-api/docs/generate-content/api-key).

Kiến trúc hiện tại loại key khỏi frontend và áp dụng:

- Dùng một key riêng chỉ cho FluentGo.
- Restrict key chỉ được dùng với Gemini API nếu Google Cloud/AI Studio hỗ trợ cấu hình đó.
- Đặt budget alert và theo dõi Usage.
- Giữ cooldown và một request đồng thời ở frontend; rate limit và daily limit bắt buộc được kiểm tra lại trong Apps Script.
- Cache cấu hình bằng Script Properties/CacheService; chỉ đọc Sheet khi khởi tạo, quản trị viên nạp lại hoặc Gemini báo lỗi key/quyền.
- Có quy trình rotate key khi nghi ngờ bị lộ.

## 8. Acceptance criteria P0

- Frontend gọi `bridgeCall('gemini', ...)` và không chứa `x-goog-api-key` hay Gemini credential.
- Apps Script xác thực session, rate-limit rồi mới dùng `UrlFetchApp.fetch` gọi Gemini.
- Mỗi level có tối thiểu năm bài nghe, năm bài đọc, ba câu nói, ba đề viết và sáu từ.
- Chọn đáp án nghe/đọc luôn xuất hiện nút Next.
- Hết phiên nghe/đọc/flashcard phải dừng ở màn hình kết quả; không tự quay về câu đầu.
- Có thể luyện lại riêng câu sai/từ khó hoặc trộn và bắt đầu phiên mới.
- Chuyển level làm mới đúng bộ bài.
- Hoàn thành roadmap node mở node tiếp theo ngay trong cùng ngày.
- Reload/đăng nhập lại vẫn khôi phục `completedLessons`, XP, mistakes và `practiceStats`.
- Frontend và Apps Script qua kiểm tra cú pháp.
