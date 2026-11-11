// Dữ liệu hiển thị mẫu; không chứng minh trạng thái trong database.
export const packages = [
  {
    _id: "GT001",
    tenGoi: "Gói tập 1 tháng",
    thoiHanNgay: 30,
    gia: 320000,
    moTa: "Sử dụng phòng gym trong 30 ngày",
    chiNhanhId: "CN001",
    trangThai: "dang_ban",
  },
  {
    _id: "GT002",
    tenGoi: "Gói tập 3 tháng",
    thoiHanNgay: 90,
    gia: 864000,
    moTa: "Sử dụng phòng gym trong 90 ngày",
    chiNhanhId: "CN001",
    trangThai: "dang_ban",
  },
];
export const branches = [
  {
    _id: "CN001",
    tenChiNhanh: "Gym Quận 3",
    diaChi: "Quận 3, TP.HCM",
    soDienThoai: "0900000001",
    gioMoCua: "05:30",
    gioDongCua: "22:00",
  },
  {
    _id: "CN002",
    tenChiNhanh: "Gym Quận 10",
    diaChi: "Quận 10, TP.HCM",
    soDienThoai: "0900000002",
    gioMoCua: "05:30",
    gioDongCua: "22:00",
  },
];
export const trainers = [
  {
    _id: "PT001",
    hoTen: "Trần Văn B",
    chuyenMon: "Huấn luyện Gym cá nhân",
    kinhNghiemNam: 3,
    giaMoiBuoi: 200000,
    chiNhanhId: "CN001",
  },
];
export const members = [
  {
    _id: "ND001",
    hoTen: "Nguyễn Văn A",
    email: "nguyenvana@example.com",
    soDienThoai: "0912345678",
    vaiTro: "HOI_VIEN",
    chiNhanhId: "CN001",
    trangThai: "hoat_dong",
  },
  {
    _id: "ND002",
    hoTen: "Trần Văn B",
    email: "tranvanb@example.com",
    soDienThoai: "0912345679",
    vaiTro: "PT",
    chiNhanhId: "CN001",
    trangThai: "hoat_dong",
  },
  {
    _id: "ND003",
    hoTen: "Lê Văn C",
    email: "levanc03@example.com",
    soDienThoai: "0912345680",
    vaiTro: "HOI_VIEN",
    chiNhanhId: "CN001",
    trangThai: "hoat_dong",
  },
];
export const orders = [
  {
    _id: "DH001",
    nguoiDungId: "ND001",
    chiNhanhId: "CN001",
    goiTapId: "GT001",
    tongTien: 320000,
    ngayTao: "2026-10-09",
    trangThai: "da_thanh_toan",
  },
];
export const bookings = [
  {
    _id: "LDP001",
    hoiVienIds: ["ND001"],
    ptId: "PT001",
    chiNhanhId: "CN001",
    ngayTap: "2026-10-15",
    gioBatDau: "08:00",
    gioKetThuc: "09:00",
    trangThai: "da_xac_nhan",
  },
];
export const equipment = [
  {
    _id: "TB001",
    tenThietBi: "Máy chạy bộ",
    chiNhanhId: "CN001",
    soLuong: 5,
    tinhTrang: "tot",
    ngayBaoTriGanNhat: "2026-09-20",
  },
];
export const payments = [
  {
    _id: "TT001",
    donHangId: "DH001",
    soTien: 320000,
    phuongThuc: "chuyen_khoan",
    trangThai: "thanh_cong",
  },
];
export const maintenance = [
  {
    _id: "BT001",
    thietBiId: "TB001",
    ngayBaoTri: "2026-10-01",
    noiDung: "Kiểm tra và bảo dưỡng máy chạy bộ",
    chiPhi: 300000,
    trangThai: "hoan_thanh",
  },
];
export const checkins = [
  {
    _id: "CI001",
    hoiVienId: "ND001",
    ngayCheckin: "2026-10-15",
    gioVao: "07:30",
    gioRa: "09:30",
    trangThai: "da_checkout",
  },
];

export const workSchedules = [
  { ptId: "PT001", chiNhanhId: "CN001", ngayLam: "2026-10-15" },
  { ptId: "PT001", chiNhanhId: "CN001", ngayLam: "2026-10-16" },
];
