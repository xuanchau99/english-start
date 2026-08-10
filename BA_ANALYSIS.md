# FluentGo — Phân tích Business Analyst và kế hoạch sản phẩm

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

1. Gemini gọi trực tiếp từ browser, không tạo action Gemini trên Apps Script.
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

1. User chọn level.
2. Hệ thống lấy node đầu tiên chưa hoàn thành làm `current`.
3. Node tương lai bị khóa; node hoàn thành có thể mở lại để ôn.
4. Khi nhận thưởng, lesson ID được thêm vào `completedLessons`.
5. Node kế tiếp mở ngay, không kiểm tra giới hạn theo ngày.
6. XP, phút học và progress được lưu local rồi debounce lên Google Sheets.

### Luyện nghe/đọc

1. Hệ thống lấy bộ bài theo level hiện tại.
2. User chọn một đáp án; danh sách khóa để tránh chấm hai lần.
3. Hiển thị đúng/sai, đáp án đúng và giải thích.
4. Ghi `practiceStats`, lỗi sai và XP.
5. Hiện nút Next; hết deck thì quay vòng và báo hoàn thành một vòng.

### Luyện nói/viết

1. Hệ thống lấy target/prompt theo level.
2. User ghi âm hoặc viết nội dung.
3. Browser gọi Gemini trực tiếp và nhận JSON review.
4. UI hiển thị điểm, sửa lỗi và gợi ý.
5. Ghi XP, số bài và lỗi viết; mở bài tiếp theo.

## 7. Kiến trúc và rủi ro

### Kiến trúc hiện tại

- GitHub Pages: HTML/CSS/jQuery, lesson data, Gemini REST request và `key_ai.txt`.
- Apps Script: đăng ký, đăng nhập, session, profile và sync progress.
- Google Sheets: Config, Users, Sessions và Progress.
- LocalStorage: session token, state theo user và bộ đếm AI theo ngày trên thiết bị.

### Rủi ro key Gemini ở frontend

Repository private không làm key trong website trở thành bí mật: trình duyệt phải tải key và user có thể xem trong DevTools/network. Google cũng khuyến cáo không hard-code API key trong production client. Nguồn: [Google — Using Gemini API keys](https://ai.google.dev/gemini-api/docs/generate-content/api-key).

Biện pháp giảm rủi ro trong phạm vi yêu cầu hiện tại:

- Dùng một key riêng chỉ cho FluentGo.
- Restrict key chỉ được dùng với Gemini API nếu Google Cloud/AI Studio hỗ trợ cấu hình đó.
- Đặt budget alert và theo dõi Usage.
- Giữ `dailyAiLimit`, cooldown và một request đồng thời ở frontend để ngăn thao tác nhầm; các giới hạn này không chống được người đã lấy key.
- Có quy trình rotate key khi nghi ngờ bị lộ.

## 8. Acceptance criteria P0

- Không còn `bridgeCall('gemini', ...)` trong frontend.
- Apps Script từ chối action `gemini` và không còn code `UrlFetchApp.fetch` tới Gemini.
- Mỗi level có tối thiểu năm bài nghe, năm bài đọc, ba câu nói, ba đề viết và sáu từ.
- Chọn đáp án nghe/đọc luôn xuất hiện nút Next.
- Hết phiên nghe/đọc/flashcard phải dừng ở màn hình kết quả; không tự quay về câu đầu.
- Có thể luyện lại riêng câu sai/từ khó hoặc trộn và bắt đầu phiên mới.
- Chuyển level làm mới đúng bộ bài.
- Hoàn thành roadmap node mở node tiếp theo ngay trong cùng ngày.
- Reload/đăng nhập lại vẫn khôi phục `completedLessons`, XP, mistakes và `practiceStats`.
- Frontend và Apps Script qua kiểm tra cú pháp.
