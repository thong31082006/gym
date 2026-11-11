# Gym Station frontend

Giao diện React/Vite sử dụng API Express và dữ liệu MongoDB của backend.

Xem [hướng dẫn cài đặt và chạy đầy đủ](../README.md). Backend cần chạy ở cổng 5000 trước khi sử dụng dữ liệu thực.

```powershell
npm ci
Copy-Item .env.example .env
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Địa chỉ mặc định: http://localhost:5173. Cấu hình `VITE_API_URL` trong `.env` để đổi địa chỉ API. Tạo bản build bằng `npm run build`.
