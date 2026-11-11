# Gym Station

Ứng dụng quản lý phòng gym với React/Vite, Express và MongoDB. Hệ thống có các vai trò Admin, quản lý chi nhánh, nhân viên, huấn luyện viên và hội viên.

## Chạy trên máy

Cần Node.js 22.12 trở lên và một cơ sở dữ liệu MongoDB. Bản này đã được kiểm tra bằng Node.js 24.

Mở terminal tại thư mục dự án và chạy backend:

```powershell
cd backend
npm ci
Copy-Item .env.example .env
```

Điền chuỗi kết nối MongoDB của bạn vào `MONGO_URI` trong `backend/.env`, sau đó chạy:

```powershell
node server.js
```

Mở terminal thứ hai để chạy frontend:

```powershell
cd frontend
npm ci
Copy-Item .env.example .env
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Truy cập **http://localhost:5173**. API chạy ở **http://localhost:5000/api**; có thể đổi địa chỉ API qua `VITE_API_URL` trong `frontend/.env`.

## Thiết lập dữ liệu

- Tài khoản Admin mặc định của bản demo: tên đăng nhập `admin`, mật khẩu `12345`.
- Admin tạo chi nhánh và tài khoản quản lý tại chi nhánh đó. Đăng ký hội viên chỉ hiển thị chi nhánh đang hoạt động, có quản lý đang hoạt động.
- Hội viên chỉ xem và đặt PT thuộc chi nhánh được phân công.
- Tài khoản được tạo hoặc phân quyền thành huấn luyện viên có hồ sơ liên kết trong collection `huan_luyen_vien`; mật khẩu ban đầu là `1`.
- HLV đổi chi nhánh bằng yêu cầu chờ quản lý chi nhánh hiện tại duyệt. Yêu cầu được lưu trong `yeu_cau_chuyen_chi_nhanh`; tài khoản và hồ sơ PT chỉ chuyển khi được duyệt.
- Ứng dụng không tự tạo chi nhánh mẫu. MongoDB cần cho phép tài khoản kết nối đọc/ghi dữ liệu, tạo index và dùng transaction, chẳng hạn một MongoDB Atlas cluster.

## Kiểm tra

Backend dùng database giả trong các kiểm thử, không ghi dữ liệu vào MongoDB thật:

```powershell
cd backend
node --test profile.test.js trainer-account.test.js transfer.test.js registration.test.js
```

Kiểm thử các luồng chi nhánh, tài khoản và tạo bản build frontend:

```powershell
cd frontend
node --test src/registration-branches.test.js src/branches.test.js src/trainer-transfer.test.js src/auth.test.js src/trainer-form.test.js src/staff/account.test.js
npm run build
```

Các file `.env`, thư mục `node_modules` và bản build `dist` không được đưa lên Git. Repository chỉ chứa cấu hình mẫu; bạn cần tự điền kết nối MongoDB khi chạy.
