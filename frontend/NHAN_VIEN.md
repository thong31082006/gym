# Phần tác nhân Nhân viên — Gym Station

## Chạy và đăng nhập (UC01)

Trong workspace hiện tại, nhấn F5 với cấu hình **Gym Station - Frontend**. Nếu chạy bằng terminal, mở thư mục `frontend`, chạy `npm.cmd ci` lần đầu rồi `npm.cmd run dev`.

Chọn vai trò **Nhân viên**, nhập tên đăng nhập `nhanvien`, mật khẩu ban đầu `123`. Email ban đầu là `nhanvien@gymstation.vn`; tên đăng nhập cũ `Nhi@` vẫn dùng được cho dữ liệu demo. Khi đổi mật khẩu trong hồ sơ, dùng mật khẩu mới cho lần đăng nhập sau.

## Các chức năng

| Use case | Màn hình | Thao tác |
| --- | --- | --- |
| UC01 | Đăng nhập | Kiểm tra thông tin theo vai trò, báo sai thông tin, khôi phục phiên demo và đăng xuất. |
| UC03 | Thông tin cá nhân | Sửa họ tên, email, điện thoại; đổi mật khẩu bằng mật khẩu hiện tại. Không tự sửa vai trò hoặc chi nhánh. |
| UC13 | Hồ sơ hội viên | Tìm kiếm, lọc, thêm và cập nhật hồ sơ trong chi nhánh; xem trạng thái và gói tập. |
| UC14 | Đăng ký / gia hạn | Chọn hội viên, gói và ngày bắt đầu để tạo đơn chờ thanh toán. Gia hạn nối tiếp gói đã thanh toán cùng loại. |
| UC15 | Thanh toán | Xem đơn và xác nhận thu tiền mặt hoặc chuyển khoản; kiểm tra số tiền và mã tham chiếu chuyển khoản. Gói chỉ kích hoạt khi đơn được xác nhận. Hủy đơn chờ cần lý do. |
| UC16 | Check-in / check-out | Tiếp nhận hội viên có gói đã thanh toán và còn hiệu lực; chặn check-in trùng; ghi giờ ra và lịch sử lượt tập. |
| UC18 | Đặt lịch PT | Đặt buổi cá nhân hoặc nhóm 2–6 hội viên có gói PT hợp lệ; kiểm tra giờ làm việc, số buổi và trùng lịch PT/hội viên. |
| UC19 | Quản lý lịch hẹn | Tìm kiếm/lọc lịch, xác nhận, chỉnh sửa, hoàn thành và hủy có lý do; kiểm tra chuyển trạng thái. |

## Luồng trình bày bài

1. Đăng nhập Nhân viên, xem tổng quan của chi nhánh.
2. Thêm hội viên ở **Hồ sơ hội viên**.
3. Tạo đơn gói **Gym + PT** ở **Đăng ký / gia hạn**.
4. Sang **Thanh toán**, xác nhận thu đúng số tiền; xem ngày hiệu lực gói.
5. Sang **Check-in / check-out**, ghi nhận lượt vào và lượt ra của hội viên.
6. Đặt lịch PT trong thời hạn gói, rồi sang **Quản lý lịch hẹn** để xác nhận hoặc sửa/hủy lịch.
7. Cập nhật thông tin cá nhân, tải lại trang để kiểm tra dữ liệu được giữ lại; đăng xuất.

## Phạm vi lưu dữ liệu

Đây là **bản demo chạy trên trình duyệt**, độc lập với backend/MongoDB. Hồ sơ, đơn, gói đăng ký, lượt tập và lịch hẹn được lưu trong `localStorage` với khóa `gym_staff_workspace_v1`. Tài khoản demo dùng khóa `gym_accounts`; phiên demo dùng `gym_current_user`. Dữ liệu gắn với trình duyệt và địa chỉ web: `localhost:5173` và `127.0.0.1:5173` có vùng lưu trữ riêng. Không xóa dữ liệu trang nếu cần giữ bài demo.

Xác nhận thanh toán chỉ ghi nhận dữ liệu demo, không chuyển tiền hay kết nối ngân hàng. Tài khoản/mật khẩu và kiểm tra vai trò ở phía trình duyệt chỉ phục vụ bài tập; bản triển khai thật cần xác thực, phân quyền chi nhánh, lưu trữ và kiểm tra giao dịch ở server. Dữ liệu mẫu dùng các ngày tương đối theo múi giờ Việt Nam khi khởi tạo lần đầu.

## Mã nguồn và kiểm tra

- `src/staff/StaffWorkspace.jsx`: giao diện và biểu mẫu Nhân viên.
- `src/staff/StaffWorkspace.css`: giao diện riêng, có bố cục cho màn hình nhỏ.
- `src/staff/model.js`: quy tắc nghiệp vụ và dữ liệu mẫu.
- `src/staff/account.js`: cập nhật hồ sơ và chuẩn hóa tài khoản demo.
- `src/App.jsx`: nối đăng nhập, phiên và phần Nhân viên vào ứng dụng.

Chạy `npm.cmd run test:staff` để kiểm tra quy tắc nghiệp vụ, sau đó `npm.cmd run build` để kiểm tra bản build.

## Nguyên tắc layout Nhân viên

| Kỹ thuật | Áp dụng |
| --- | --- |
| CSS Grid / Flexbox | Grid cho khung ứng dụng, thống kê, dashboard và form; Flexbox để căn các nút, bộ lọc và nội dung từng hàng. |
| Hệ khoảng cách 8px | Biến CSS dùng chung cho khoảng cách 8, 16, 24, 32, 40, 48px; 4px dành cho chi tiết nhỏ. |
| Phân cấp thị giác | Tiêu đề trang lớn nhất, tiếp theo là số liệu và tiêu đề khu vực; thao tác Check-in là nút chính trên tổng quan. |
| Màu sắc | Nền đen than `#101113`, sidebar/header `#0B0C0E`, thẻ/form `#1B1D21`, hover `#272A30`, viền `#34373E`, chữ `#F3F4F6` / `#A8ADB7`, điểm nhấn đỏ trầm `#C9363E`; trạng thái có cả màu và chữ. |
| Thang chữ | Các mức 12, 14, 16, 20, 24, 32, 40px; nhãn và nội dung không bị thu nhỏ để ép vừa màn hình. |
| Responsive | Sidebar chuyển thành menu kéo ở màn hình nhỏ; các cụm nội dung và form xếp lại theo cột; bảng cuộn ngang trong vùng riêng. |
| Design system | Token màu, khoảng cách, chữ, bo góc; dùng chung nút, ô nhập, badge, panel, modal và bộ icon SVG. |
| Chuyển động / phản hồi | Hiệu ứng hover/focus và đổi trang nhẹ, có chế độ giảm chuyển động; thông báo thành công, lỗi và trạng thái trống rõ ràng. Loading xuất hiện khi tải mô-đun Nhân viên, không tạo thời gian chờ giả cho thao tác đồng bộ. |

Menu di động hỗ trợ phím Escape, giữ focus trong menu và khóa cuộn nền. Có liên kết bỏ qua menu; vùng bảng cuộn được bằng bàn phím. Sau khi chuyển trang, focus về tiêu đề trang mới.

Banner và nền đăng nhập dùng ảnh chụp thật được lưu tại `src/assets/gym-training.jpg`, phủ gradient đen bằng CSS. Xem [nguồn ảnh và giấy phép](src/assets/PHOTO_CREDITS.md). Ảnh gốc được giữ nguyên; không dùng ảnh người do AI tạo. Bản giao diện đen xám giữ các thông số bố cục và luồng nghiệp vụ trước đó.
