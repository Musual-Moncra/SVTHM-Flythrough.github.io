# Thiết kế cốt lõi: "Đường lửa mở lối"

Tài liệu này do điều phối viên (claude-1) giữ. Không tự đổi nó; cần đổi thì hỏi trước.
Ba repo mẫu dùng chung phần 1 đến 5. Phần 6 chỉ áp dụng cho từng mẫu.

## 1. Ý tưởng

Một đường sáng duy nhất đi xuyên suốt câu chuyện. Nó là "lửa bánh bền lâu" và cũng là "mở lối":
bắt lửa từ biểu trưng, đi qua làng nghề, tách làm hai rồi gặp lại, và khép thành con dấu dự án.
Đường sáng phải thể hiện nội dung của từng cảnh, không chỉ là hình trang trí nối các khối.

## 2. Nội dung: giữ nguyên văn

Nguồn duy nhất: `docs/original/index.html`.

- Giữ nguyên văn toàn bộ chữ tiếng Việt, chú thích ảnh, trích dẫn, liên kết, logo. Không viết lại, không rút gọn, không thêm chữ mới
  ngoài nhãn điều khiển rất ngắn (ví dụ "Toàn cảnh").
- Bỏ các phần của giao diện cũ: con trỏ tùy biến, nhãn HUD quỹ đạo và các kiểu hình học 3D cũ.
- Giữ menu điều hướng và bộ chọn ngôn ngữ. Trong `initLanguageSelector` (`docs/original/main.js`), đổi URL đã xuất bản thành URL của repo mẫu.
- Giữ bản đồ Leaflet. Con lăn chuột phải cuộn trang, không được zoom bản đồ (`scrollWheelZoom: false`).
- Không xuất bản `docs/` như một phần của trải nghiệm: không liên kết tới nó từ trang.

## 3. Sáu cảnh

ID neo giữ nguyên để liên kết cũ vẫn chạy: `#hero`, `#origins`, `#challenge`, `#core`, `#evolution`. Cảnh kết dùng `#epilogue`.

| # | ID | Nội dung gốc | Đường sáng làm gì |
|---|---|---|---|
| 0 | `#hero` | Tiêu đề, khẩu hiệu, nút bắt đầu | Bắt lửa từ con dấu `project-seal-transparent.png` rồi chạy ra khỏi khung |
| 1 | `#origins` | Khối "DỰ ÁN • ĐIỂM KHỞI ĐẦU", `story-rice-racks`, `story-worker`, câu hỏi trích dẫn, bản đồ "ĐỊA ĐIỂM" | Chạy dọc các phên bánh, rồi hạ xuống đúng ghim Phú Hòa Đông |
| 2 | `#challenge` | Thơ "Quê Hương", `mm`, `mmm`, `mmmm`, 3 mốc 01-03 | Đi lần lượt qua 3 ảnh, mỗi ảnh sáng lên khi đường sáng tới |
| 3 | `#core` | "SỨ MỆNH", video thực địa, 3 trụ cột | **Khoảnh khắc chính:** tách làm hai sợi (người trẻ và làng nghề), rồi nhập lại tại trụ "KẾT NỐI" |
| 4 | `#evolution` | "VỀ CHÚNG TÔI", ảnh nhóm, 5 ngành, 3 mốc, 2 banner | 5 sợi mảnh, mỗi sợi một ngành, bện thành một |
| 5 | `#epilogue` | Khối "TINH THẦN CỦA DỰ ÁN", nút đọc lại, chân trang | Ôm thành vòng tròn quanh con dấu, sáng đều rồi dịu xuống |

Khối "TINH THẦN CỦA DỰ ÁN" chuyển từ cảnh 3 sang cảnh 5, đây là thay đổi vị trí duy nhất. Thứ tự còn lại theo trang gốc.

## 4. Ngôn ngữ thị giác

Chữ: `Space Grotesk` cho tiêu đề và nhãn, `Plus Jakarta Sans` cho nội dung (Google Fonts, có dấu tiếng Việt).

Đường lửa (dùng chung):

```css
--flame-core: #ffe3a3;   /* lõi */
--flame-mid: #f5a623;    /* thân */
--flame-ember: #c8501e;  /* đuôi, viền */
```

Thương hiệu gốc: xanh lá `#17633d`, vàng đất `#8b5e0a`, kem `#fff7e6`.

Quy tắc chuyển động:
- Đường sáng chỉ tiến theo cuộn và lùi lại khi cuộn ngược; không chạy tự do.
- Đầu đường sáng là điểm sáng nhất; phía sau dịu dần.
- Ease mặc định `cubic-bezier(0.16, 1, 0.3, 1)`.
- Khi người xem đang đọc, chữ đứng yên hoàn toàn. Chỉ chuyển động giữa các đoạn đọc.

## 5. Yêu cầu chung (dùng để nghiệm thu)

Kỹ thuật:
- HTML/CSS/JS thuần, không bước build, chạy được bằng `python3 -m http.server`.
- Đường dẫn tương đối, vì trang chạy dưới đường dẫn con `/<ten-repo>/`. Thư viện dùng từ `js/vendor/`.
- Không có lỗi hoặc 404 trong console ở mọi cảnh.

Đọc được:
- Chữ là HTML thật, chọn và dịch được (Google Translate phải chạy). Tương phản chữ tối thiểu 4.5:1.
- Không có chữ bị che, cắt, chồng lên nhau hoặc nằm dưới đường sáng ở 1440x900, 1024x768, 390x844, 360x640.
- Không có cuộn ngang ở mọi cỡ màn hình.
- Mọi cảnh đọc hết được chỉ bằng cuộn; tốc độ cuộn nhanh không làm mất nội dung.

Điều hướng và trợ năng:
- Menu nhảy đúng cảnh, `#id` trên URL mở đúng cảnh khi tải trang.
- Đi được bằng bàn phím, có viền focus thấy rõ.
- `prefers-reduced-motion`: bỏ bay và chạy, đường sáng hiện sẵn, nội dung đầy đủ.
- Không có WebGL hoặc JS lỗi: vẫn đọc được toàn bộ nội dung.
- Video: không tự phát, `preload="metadata"`, có nút điều khiển. Ảnh ngoài màn hình đầu dùng `loading="lazy"`.

Hiệu năng:
- Một vòng `requestAnimationFrame` duy nhất, dừng khi tab ẩn.
- `devicePixelRatio` tối đa 2 trên máy tính, 1.5 trên điện thoại.
- Ảnh hiển thị: mỗi file tối đa 500 KB, nén sang WebP trong repo mẫu. Không đổi nội dung ảnh.
- Cuộn mượt ở máy tính thông thường, không giật rõ trên điện thoại tầm trung.

## 6. Ba mẫu

### Mẫu 1: Flythrough (nền đêm)

Nền `#120d08`, chữ `#fff7e6`, phụ `#c9bda6`.

Three.js dùng một canvas cố định. Cuộn đưa camera bay dọc một đường cong 3D duy nhất (`CatmullRomCurve3`); đường sáng chính là đường cong đó và chỉ hiện đến vị trí đang cuộn.
Ảnh là mặt phẳng đặt trong không gian dọc đường bay. Chữ là panel HTML phủ trên canvas, có nền tối đủ đọc.
Camera dừng lại ở mỗi đoạn đọc, chỉ bay ở khoảng giữa. Thêm ít tàn lửa quanh đường sáng.
Điện thoại: bớt hạt, panel chữ chiếm toàn chiều ngang, cảnh vẫn theo cùng một đường.

### Mẫu 2: Storyboard (bảng tối)

Nền `#0f1d16`, chữ `#fff7e6`, phụ `#b9c7bb`.

Sáu khung tranh nằm trên một bảng 3D lớn, nghiêng nhẹ, xếp zigzag 2 cột x 3 hàng: 0→1, xuống 2 (bên phải), sang 3 (bên trái), xuống 4 (bên trái), sang 5 (bên phải).
Mở trang thấy toàn bộ bảng trước, sau đó phóng vào khung 0. Mỗi khung có số cảnh và ảnh đại diện; khi phóng vào thì hiện đầy đủ nội dung.
Đường sáng nối các khung trên mặt bảng. Giữa hai khung, camera lùi nhẹ để thấy đường sáng đi tới khung kế tiếp.
Cuộn đưa đi tuần tự. Thêm nút "Toàn cảnh" (phím Esc) để lùi về bảng, bấm một khung để nhảy tới.
Nên dựng khung bằng DOM với CSS 3D để chữ luôn sắc nét. Đường sáng dùng SVG hoặc canvas nằm trên cùng mặt bảng.
Điện thoại: bảng thành một cột, đường sáng chạy dọc, vẫn có nút "Toàn cảnh".

### Mẫu 3: Scrollline (nền kem, phương án an toàn)

Nền `#fff7e6`, chữ `#183428`, phụ `#41594b`, giữ nhận diện trang hiện tại.

Trang cuộn dọc bình thường, không khóa cuộn. Đường sáng là SVG vẽ theo các điểm neo trong DOM, tính lại khi đổi cỡ màn hình, chạy xuyên qua các khối và chạy theo cuộn.
Trên nền sáng, đường dùng `--flame-ember` và `--flame-mid` có quầng mờ để vẫn nổi rõ.
Chiều sâu đến từ parallax và nghiêng nhẹ của các khối ảnh, và đường sáng đi qua trước hoặc sau từng khối.
Three.js chỉ dùng ở cảnh 0 cho con dấu bắt lửa. Trang phải đọc được đầy đủ khi không có WebGL.
Điện thoại: đường sáng chạy sát lề trái, không đè lên chữ.

## 7. Quy trình

- Chỉ làm trong worktree được giao, nhánh `feat/sample`. Không sửa repo khác, không sửa `DESIGN.md`.
- Commit ở nhánh của mình. **Không push, không merge, không bật Pages.**
- Commit message không có `Co-Authored-By` hay bất kỳ dòng ghi công AI nào.
- Xong thì gửi claude-1 bằng `mxt_room.send` (probe): nhánh, commit, cách bạn đã kiểm tra, những gì chưa kiểm tra được. Báo thẳng phần chưa đạt.
- Bị chặn hoặc thấy thiết kế không làm được: hỏi claude-1 ngay, không tự đổi hướng.
