import { buildTrainerModulePayload } from "../trainer-form.js";
import { getProfileUpdateAccount } from "../trainer-transfer.js";
import { clearAuthToken, saveAuthToken, getAuthHeaders } from "../auth.js";
export { clearAuthToken, getAuthHeaders };

const RAW_URL = (import.meta.env.VITE_API_URL || "http://localhost:5000/api").replace(/\/$/, "");
export const API_BASE = RAW_URL.endsWith("/api") ? RAW_URL : `${RAW_URL}/api`;

async function request(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
  const config = {
    ...options,
    headers: getAuthHeaders({ "Content-Type": "application/json", ...options.headers }),
  };

  const response = await fetch(url, config);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.message || (response.status === 401 ? "Vui lòng đăng nhập lại để tiếp tục." : `Lỗi API (${response.status})`));
    error.status = response.status;
    error.code = data.code;
    throw error;
  }

  return data;
}

// 1. Auth & Profile
export async function login({ email, password, role }) {
  clearAuthToken();
  const res = await request("/login", {
    method: "POST",
    body: JSON.stringify({ email, password, role }),
  });
  saveAuthToken(res.token);
  return res.account;
}

export async function register({ name, email, phone, password, branch }) {
  clearAuthToken();
  const res = await request("/register", {
    method: "POST",
    body: JSON.stringify({ name, email, phone, password, branch }),
  });
  saveAuthToken(res.token);
  return res.account;
}

export async function fetchRegistrationBranches(options = {}) {
  const result = await request("/registration-branches", { ...options, cache: "no-store" });
  if (!Array.isArray(result.branches)) throw new Error("Không tải được danh sách chi nhánh đăng ký.");
  return result.branches;
}

export async function updateProfile(id, values, extra = {}) {
  let payload = {};
  if (Array.isArray(values)) {
    const [hoTen, email, soDienThoai, field4, field5, chiNhanhId] = values;
    payload = {
      hoTen,
      email,
      soDienThoai,
      role: extra?.role,
    };
    if (extra?.role === "NHAN_VIEN") {
      if (field4) payload.chucDanh = field4;
    } else if (extra?.role === "HUAN_LUYEN_VIEN") {
      if (field4) payload.chuyenMon = field4;
      if (field5) payload.moTa = field5;
      payload.chiNhanhId = chiNhanhId;
    }
  } else if (typeof values === "object" && values !== null) {
    payload = { ...values, role: extra?.role || values.role };
  }
  payload.currentUserId = extra.currentUserId;

  const res = await request(`/profile/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  return getProfileUpdateAccount(res);
}

export async function decideTrainerTransfer(transferId, decision, currentUserId) {
  return await request(`/trainer-transfers/${encodeURIComponent(transferId)}/decision`, {
    method: "PUT",
    body: JSON.stringify({ currentUserId, decision }),
  });
}

export async function resetMemberPassword(memberId) {
  return await request(`/members/${memberId}/reset-password`, {
    method: "POST",
  });
}

// 2. Fetch all real data from MongoDB Atlas
export async function fetchAllData(branch = "CN001", role = "ADMIN", memberId = "") {
  return await request(`/data-all?branch=${encodeURIComponent(branch)}&role=${encodeURIComponent(role)}&memberId=${encodeURIComponent(memberId || "")}`);
}

// 3. Module Record Mutations
export async function saveModuleRecord(moduleId, values, recordId, branch, currentUserId) {
  let endpoint = `/${moduleId}`;
  let method = recordId ? "PUT" : "POST";
  if (recordId) {
    endpoint = `${endpoint}/${recordId}`;
  }

  let body = {};

  switch (moduleId) {
    case "accounts": {
      // ["Họ tên", "Email", "Tên đăng nhập", "Chi nhánh", "Trạng thái"]
      const [hoTen, email, tenDangNhap, chiNhanhId, trangThai] = values;
      body = { hoTen, email, tenDangNhap, chiNhanhId, trangThai };
      break;
    }
    case "permissions": {
      // ["Tài khoản", "Vai trò", "Chi nhánh"]
      endpoint = `/permissions/${recordId}`;
      method = "PUT";
      const [, vaiTro, chiNhanhId] = values;
      body = { vaiTro, chiNhanhId };
      break;
    }
    case "branches": {
      // ["Tên chi nhánh", "Địa chỉ", "Số điện thoại", "Trạng thái"]
      const [tenChiNhanh, diaChi, soDienThoai, trangThai] = values;
      body = { tenChiNhanh, diaChi, soDienThoai, trangThai };
      break;
    }
    case "staff": {
      // ["Họ tên", "Email", "Chức danh", "Ngày vào làm", "Trạng thái"]
      const [hoTen, email, chucDanh, ngayVaoLam, trangThai] = values;
      body = { hoTen, email, chucDanh, ngayVaoLam, trangThai, chiNhanhId: branch };
      break;
    }
    case "trainers": {
      // ["Họ tên", "Email", "Chuyên môn", "Mô tả", "Trạng thái", "Chi nhánh"]
      body = buildTrainerModulePayload(values, currentUserId);
      break;
    }
    case "equipment": {
      // ["Tên thiết bị", "Mã tài sản", "Loại thiết bị", "Vị trí", "Ngày mua", "Trạng thái"]
      const [tenThietBi, maTaiSan, loaiThietBi, viTri, ngayMua, trangThai] = values;
      body = { tenThietBi, maTaiSan, loaiThietBi, viTri, ngayMua, trangThai, chiNhanhId: branch };
      break;
    }
    case "maintenance": {
      // ["Thiết bị", "Ngày dự kiến", "Nội dung", "Chi phí", "Trạng thái"]
      const [thietBi, ngayDuKien, noiDung, chiPhi, trangThai] = values;
      body = { thietBi, ngayDuKien, noiDung, chiPhi, trangThai, currentUserId };
      break;
    }
    case "members": {
      // ["Họ tên", "Email", "Số điện thoại", "Trạng thái"]
      const [hoTen, email, soDienThoai, trangThai] = values;
      body = { hoTen, email, soDienThoai, trangThai, chiNhanhId: branch };
      break;
    }
    case "shifts": {
      // ["Huấn luyện viên", "Ngày tập", "Giờ bắt đầu", "Giờ kết thúc", "Trạng thái"]
      const [trainer, ngayTap, gioBatDau, gioKetThuc, trangThai] = values;
      body = { trainer, ngayTap, gioBatDau, gioKetThuc, trangThai, chiNhanhId: branch };
      break;
    }
    default:
      body = { values };
  }

  return await request(endpoint, {
    method,
    body: JSON.stringify(body),
  });
}

// 4. Packages
export async function savePackage(values, recordId, branch = "CN001") {
  // ["Tên gói", "Loại gói", "Giá", "Thời hạn ngày", "Chi nhánh", "Trạng thái"]
  const [tenGoi, loaiGoi, gia, thoiHanNgay, chiNhanhId, trangThai] = values;
  const endpoint = recordId ? `/goi-tap/${recordId}` : "/goi-tap";
  const method = recordId ? "PUT" : "POST";
  return await request(endpoint, {
    method,
    body: JSON.stringify({
      tenGoi,
      loaiGoi,
      gia: Number(gia),
      thoiHanNgay: Number(thoiHanNgay),
      chiNhanhId: chiNhanhId || branch,
      trangThai,
    }),
  });
}

// 5. Orders & Payments
export async function createOrder({ pkg, memberId, startDate, isRenew, currentUserId }) {
  return await request("/orders", {
    method: "POST",
    body: JSON.stringify({
      pkgId: pkg?._id,
      memberId,
      startDate,
      isRenew,
      currentUserId,
    }),
  });
}

export async function confirmPayment({ orderId, method, txCode, currentUserId }) {
  return await request("/payments", {
    method: "POST",
    body: JSON.stringify({
      orderId,
      method,
      txCode,
      currentUserId,
    }),
  });
}

export async function requestPaymentApproval({ orderId, currentUserId, method = "CHUYEN_KHOAN" }) {
  return await request("/payments/request", {
    method: "POST",
    body: JSON.stringify({
      orderId,
      currentUserId,
      method,
    }),
  });
}

export async function confirmPaymentApproval({ orderId, approved, currentUserId, reason }) {
  return await request("/payments/confirm", {
    method: "POST",
    body: JSON.stringify({
      orderId,
      approved,
      currentUserId,
      reason,
    }),
  });
}

// 6. Check-in & Check-out
export async function checkin({ memberId, memberName, packageId, branch, currentUserId }) {
  return await request("/checkin", {
    method: "POST",
    body: JSON.stringify({
      memberId,
      memberName,
      packageId,
      branch,
      currentUserId,
    }),
  });
}

export async function checkout(visitId) {
  return await request(`/checkout/${visitId}`, {
    method: "POST",
  });
}

// 7. Bookings & Appointments
export async function createBooking(values, role, branch, currentUserId) {
  // If KHACH: ["Huấn luyện viên", "Ngày tập", "Giờ bắt đầu", "Giờ kết thúc", "Ghi chú"]
  // If NHAN_VIEN: ["Huấn luyện viên", "Ngày tập", "Giờ bắt đầu", "Giờ kết thúc", "Loại buổi", "Mã hội viên (cách nhau bằng dấu phẩy)", "Ghi chú"]
  let trainerId, ngayTap, gioBatDau, gioKetThuc, loaiBuoi, hoiVienIds, ghiChu;

  if (role === "NHAN_VIEN") {
    [trainerId, ngayTap, gioBatDau, gioKetThuc, loaiBuoi, hoiVienIds, ghiChu] = values;
  } else {
    [trainerId, ngayTap, gioBatDau, gioKetThuc, ghiChu] = values;
    loaiBuoi = "CA_NHAN";
    hoiVienIds = currentUserId ? [currentUserId] : ["ND001"];
  }

  return await request("/appointments", {
    method: "POST",
    body: JSON.stringify({
      trainerId,
      ngayTap,
      gioBatDau,
      gioKetThuc,
      loaiBuoi,
      hoiVienIds,
      ghiChu,
      branch,
      currentUserId,
    }),
  });
}

export async function updateAppointmentStatus(appointmentId, status) {
  return await request(`/appointments/${appointmentId}/status`, {
    method: "PUT",
    body: JSON.stringify({ status }),
  });
}
