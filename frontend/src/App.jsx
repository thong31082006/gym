import { lazy, Suspense, useState, useEffect, useRef, useCallback } from "react";
import {
  roles,
  modules,
  extra,
  labels,
  options,
  statuses,
  money,
  rolePermissions,
} from "./new-ui/config";
import "./App.css";
import Icon from "./staff/StaffIcon.jsx";
import { mergeAccounts, updateStaffProfile } from "./staff/account.js";
import { getBranchChoices, getBranchName, syncTrainerProfileModal } from "./branches.js";
import { buildTrainerModuleForm, validateTrainerBranch, getRealTrainerRoster } from "./trainer-form.js";
import { getBranchTrainerRoster, getBranchBookingRows, getOwnTrainerTransfer, getManagerPendingTransfers, getTransferTrainerName, transferStatusLabels } from "./trainer-transfer.js";
import { getRegistrationBranchChoices, retainRegistrationBranch } from "./registration-branches.js";
import {
  login as apiLogin,
  register as apiRegister,
  fetchRegistrationBranches,
  updateProfile as apiUpdateProfile,
  resetMemberPassword,
  fetchAllData,
  saveModuleRecord,
  savePackage,
  createOrder,
  confirmPayment,
  requestPaymentApproval,
  confirmPaymentApproval,
  checkin as apiCheckin,
  checkout as apiCheckout,
  createBooking,
  updateAppointmentStatus,
  decideTrainerTransfer,
  getAuthHeaders,
  clearAuthToken,
} from "./services/api.js";

const glyphs = {
  overview: "◫",
  reports: "▥",
  packages: "▣",
  payments: "↗",
  checkin: "⇄",
  booking: "▦",
  history: "◷",
  profile: "◎",
  accounts: "♙",
  permissions: "◇",
  branches: "⌂",
  staff: "♧",
  trainers: "★",
  equipment: "▤",
  maintenance: "⚙",
  members: "♙",
  shifts: "◷",
  appointments: "▦",
};

const initialPackages = [];

function Badge({ value }) {
  return (
    <span
      className={
        "badge " +
        (/HUY|KHOA|HONG|HET_HAN|TU_CHOI/.test(value)
          ? "red"
          : /CHO|BAO_TRI|DU_KIEN|CHO_DUYET/.test(value)
            ? "amber"
            : "")
      }
    >
      {labels[value] || roles[value] || value}
    </span>
  );
}

const loginRoles = [
  { id: "KHACH", label: "Hội viên" },
  { id: "HUAN_LUYEN_VIEN", label: "Huấn luyện viên" },
  { id: "NHAN_VIEN", label: "Nhân viên" },
  { id: "ADMIN", label: "Admin" },
  { id: "QUAN_LY_CHI_NHANH", label: "Quản lý chi nhánh" },
];

const defaultAccounts = [
  {
    id: "acc-admin",
    name: "Admin",
    email: "admin@gymstation.vn",
    username: "admin",
    password: "12345",
    role: "ADMIN",
    phone: "0909000005",
    branch: "CN001",
  },
];

const getStoredAccounts = () => {
  try {
    const saved = localStorage.getItem("gym_accounts");
    const parsed = saved ? JSON.parse(saved) : null;
    const cleanParsed = Array.isArray(parsed)
      ? parsed.filter((a) => !["acc-nhi", "acc-pt", "acc-staff", "acc-branch"].includes(a?.id))
      : null;
    return mergeAccounts(defaultAccounts, cleanParsed);
  } catch (error) {
    console.warn("Không đọc được dữ liệu tài khoản lưu trữ:", error);
  }
  return mergeAccounts(defaultAccounts, null);
};

function LoginScreen({
  onLogin,
  loginRole,
  setLoginRole,
  credentials,
  setCredentials,
  onRegister,
  notice,
}) {
  return (
    <div className="auth-shell">
      <div className="auth-visual" aria-hidden="true">
        <div className="auth-visual-overlay">
          <span className="visual-badge">GYM STATION</span>
          <h2>Train smarter. Live stronger.</h2>
        </div>
      </div>

      <div className="auth-panel">
        <div className="auth-card">
          <div className="auth-brand-wrap">
            <div className="auth-brand-icon" aria-label="Gym Station logo">
              <Icon name="dumbbell" size={26} />
            </div>
            <div>
              <div className="auth-brand">GYM STATION</div>
              <small>Member access portal</small>
            </div>
          </div>

          <h1>Đăng nhập</h1>
          <p className="auth-subtitle">
            Truy cập hệ thống theo vai trò. Dữ liệu xác thực trực tiếp với MongoDB Atlas.
          </p>

          <div className="login-role-grid">
            {loginRoles.map((item) => (
              <button
                key={item.id}
                type="button"
                className={loginRole === item.id ? "role-pill active" : "role-pill"}
                onClick={() => setLoginRole(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          {notice && <p className="auth-notice" role="alert">{notice}</p>}
          <form className="auth-form" onSubmit={onLogin}>
            <label>
              Email hoặc tên đăng nhập
              <input
                type="text"
                autoComplete="username"
                required
                value={credentials.email}
                onChange={(e) =>
                  setCredentials((prev) => ({ ...prev, email: e.target.value }))
                }
                placeholder="member@gymstation.vn hoặc tên đăng nhập"
              />
            </label>

            <label>
              Mật khẩu
              <input
                type="password"
                autoComplete="current-password"
                required
                value={credentials.password}
                onChange={(e) =>
                  setCredentials((prev) => ({ ...prev, password: e.target.value }))
                }
                placeholder="••••••••"
              />
            </label>

            <div className="auth-actions">
              <button type="submit" className="primary auth-login-btn">
                Đăng nhập
              </button>
              {loginRole === "KHACH" && (
                <button
                  type="button"
                  className="secondary auth-register-btn"
                  onClick={onRegister}
                >
                  Đăng ký tài khoản
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function RegisterScreen({ onBack, onSubmit, notice }) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
    branch: "",
  });
  const [branches, setBranches] = useState([]);
  const [branchState, setBranchState] = useState("loading");
  const [branchError, setBranchError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const branchRequest = useRef(0);
  const branchAbort = useRef(null);
  const mounted = useRef(false);
  const branchChoices = branchState === "ready" ? getRegistrationBranchChoices(branches) : [];
  const selectedBranch = retainRegistrationBranch(form.branch, branchChoices);
  const canSubmit = branchState === "ready" && Boolean(selectedBranch) && !submitting;

  const refreshBranches = useCallback(async () => {
    const sequence = ++branchRequest.current;
    branchAbort.current?.abort();
    const controller = new AbortController();
    branchAbort.current = controller;
    setBranchState("loading");
    setBranchError("");
    try {
      const savedBranches = await fetchRegistrationBranches({ signal: controller.signal });
      if (!mounted.current || sequence !== branchRequest.current) return;
      const choices = getRegistrationBranchChoices(savedBranches);
      setBranches(savedBranches);
      setForm((prev) => ({ ...prev, branch: retainRegistrationBranch(prev.branch, choices) }));
      setBranchState("ready");
    } catch (error) {
      if (!mounted.current || sequence !== branchRequest.current) return;
      setBranches([]);
      setForm((prev) => ({ ...prev, branch: "" }));
      setBranchState("error");
      setBranchError(error.message || "Không tải được danh sách chi nhánh. Vui lòng mở lại trang đăng ký để thử lại.");
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    refreshBranches();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshBranches();
    };
    window.addEventListener("focus", refreshBranches);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      mounted.current = false;
      branchRequest.current += 1;
      branchAbort.current?.abort();
      window.removeEventListener("focus", refreshBranches);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshBranches]);

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const result = await onSubmit(event);
      if (mounted.current && result?.refreshBranches) await refreshBranches();
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-visual" aria-hidden="true">
        <div className="auth-visual-overlay">
          <span className="visual-badge">GYM STATION</span>
          <h2>Become stronger every day.</h2>
        </div>
      </div>

      <div className="auth-panel">
        <div className="auth-card auth-register-card">
          <div className="auth-brand-wrap">
            <div className="auth-brand-icon" aria-label="Gym Station logo">
              <Icon name="dumbbell" size={26} />
            </div>
            <div>
              <div className="auth-brand">GYM STATION</div>
              <small>Member registration</small>
            </div>
          </div>

          <h1>Đăng ký tài khoản</h1>
          <p className="auth-subtitle">
            Tạo tài khoản hội viên để quản lý gói tập, lịch PT và lịch sử tập luyện trên MongoDB.
          </p>

          {(branchError || notice) && <p className="auth-notice" role="alert">{branchError || notice}</p>}
          <form className="auth-form" onSubmit={handleSubmit}>
            <label>
              Họ và tên
              <input
                name="name"
                value={form.name}
                onChange={handleChange}
                placeholder="Nguyễn Văn A"
                required
              />
            </label>

            <div className="register-grid">
              <label>
                Email
                <input
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={handleChange}
                  placeholder="member@gymstation.vn"
                  required
                />
              </label>

              <label>
                Số điện thoại
                <input
                  name="phone"
                  value={form.phone}
                  onChange={handleChange}
                  placeholder="0901 234 567"
                  required
                />
              </label>
            </div>

            <div className="register-grid">
              <label>
                Chi nhánh
                <select name="branch" value={selectedBranch} onChange={handleChange} required disabled={branchState !== "ready" || !branchChoices.length || submitting}>
                  <option value="">{branchState === "loading" ? "Đang tải chi nhánh..." : branchState === "error" ? "Không tải được chi nhánh" : !branchChoices.length ? "Chưa có chi nhánh có quản lý" : "Chọn chi nhánh"}</option>
                  {branchChoices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
                </select>
              </label>

              <label>
                Mật khẩu
                <input
                  name="password"
                  type="password"
                  value={form.password}
                  onChange={handleChange}
                  placeholder="••••••••"
                  required
                />
              </label>
            </div>

            <label>
              Xác nhận mật khẩu
              <input
                name="confirmPassword"
                type="password"
                value={form.confirmPassword}
                onChange={handleChange}
                placeholder="••••••••"
                required
              />
            </label>

            <div className="auth-actions register-actions">
              <button
                type="button"
                className="secondary auth-register-btn"
                onClick={onBack}
              >
                Quay lại đăng nhập
              </button>
              <button type="submit" className="primary auth-login-btn" disabled={!canSubmit}>
                {submitting ? "Đang đăng ký..." : "Đăng ký"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [accounts, setAccounts] = useState(() => getStoredAccounts());
  const mergedAccounts = [...accounts];
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const saved = localStorage.getItem("gym_current_user");
      const session = saved ? JSON.parse(saved) : null;
      if (!session) return null;
      if (["acc-nhi", "acc-pt", "acc-staff", "acc-branch"].includes(session?.id)) {
        return null;
      }
      if (session?.name && session?.role) {
        return session;
      }
      return (
        accounts.find((item) => item.id === session?.id && item.role === session?.role) ||
        null
      );
    } catch (error) {
      return null;
    }
  });

  const [role, setRole] = useState(currentUser?.role || "KHACH"),
    [page, setPage] = useState("overview"),
    [branch, setBranch] = useState(currentUser?.branch || "CN001"),
    [query, setQuery] = useState(""),
    [modal, setModal] = useState(null),
    [toast, setToast] = useState(""),
    [mobile, setMobile] = useState(false),
    [isAuthenticated, setIsAuthenticated] = useState(Boolean(currentUser)),
    [loginRole, setLoginRole] = useState(currentUser?.role || "KHACH"),
    [authView, setAuthView] = useState("login"),
    [credentials, setCredentials] = useState({ email: "", password: "" });

  // MongoDB Real Data States
  const [data, setData] = useState(() =>
    Object.fromEntries(modules.map((m) => [m.id, m.rows])),
  );
  const [records, setRecords] = useState(() => ({}));
  const dataLoadSequence = useRef(0);
  const [packages, setPackages] = useState(initialPackages);
  const [orders, setOrders] = useState([]);
  const [visits, setVisits] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [trainerTransfers, setTrainerTransfers] = useState([]);
  const [transferDecisionId, setTransferDecisionId] = useState("");
  const availableTrainers = getBranchTrainerRoster(getRealTrainerRoster(records, branch), role, currentUser?.branch);
  const bookingPageBookings = getBranchBookingRows(bookings, records.appointments, availableTrainers, role, currentUser?.branch);
  const ownTrainerTransfer = getOwnTrainerTransfer(trainerTransfers, currentUser?.id, records);
  const pendingTrainerTransfers = getManagerPendingTransfers(trainerTransfers, role, currentUser?.branch);

  const [dismissedNotifs, setDismissedNotifs] = useState([]);
  const [changePasswordModal, setChangePasswordModal] = useState(false);
  const [addManagerModal, setAddManagerModal] = useState(false);

  const getEligibleMembers = () => {
    const list = [];
    const seenNames = new Set();

    // 1. Members who have paid orders
    orders.forEach((o) => {
      if (
        o.status === "DA_THANH_TOAN" ||
        o.status === "da_thanh_toan" ||
        o.status === "DA_DUYET"
      ) {
        const memObj =
          (records.members || []).find(
            (m) => m._id === o.member || m.hoTen === o.member || m.hoTen === o.memberName,
          ) ||
          (records.accounts || []).find(
            (u) => u._id === o.member || u.hoTen === o.member,
          ) ||
          accounts.find((a) => a.id === o.member || a.name === o.member);

        const name = o.memberName || (memObj ? memObj.hoTen || memObj.name : null) || o.member;
        if (name && !seenNames.has(name) && !name.startsWith("ND")) {
          seenNames.add(name);
          list.push({
            id: memObj ? memObj._id || memObj.id : o.member,
            name: name,
            package: o.name || "Gói gym",
          });
        }
      }
    });

    // 2. Members from data.members who have active packages
    (data.members || []).forEach((row, idx) => {
      const name = row[0];
      const pkg = row[3];
      const status = row[4];
      if (
        pkg &&
        pkg !== "Chưa có gói" &&
        pkg !== "Không" &&
        status !== "HET_HAN"
      ) {
        if (name && !seenNames.has(name)) {
          seenNames.add(name);
          const raw = records.members?.[idx];
          list.push({
            id: raw?._id || `ND00${idx + 1}`,
            name,
            package: pkg,
          });
        }
      }
    });

    return list;
  };

  const handleStaffDecision = async (order, approved) => {
    const question = approved
      ? `Xác nhận ĐÃ NHẬN ĐỦ số tiền ${money(order.total)} cho đơn hàng ${order.id} từ hội viên ${order.memberName || order.member}? Gói tập sẽ được kích hoạt ngay.`
      : `Xác nhận CHƯA NHẬN ĐƯỢC tiền cho đơn hàng ${order.id}? Đơn sẽ chuyển sang trạng thái Chưa duyệt và hội viên sẽ nhận được thông báo.`;

    const ok = window.confirm(question);
    if (!ok) return;

    try {
      await confirmPaymentApproval({
        orderId: order.id,
        approved,
        currentUserId: currentUser?.id,
      });
    } catch (e) {
      console.warn("api confirmPaymentApproval fallback:", e);
    }

    const nextStatus = approved ? "DA_THANH_TOAN" : "TU_CHOI";
    const notifMsg = approved
      ? `Đơn hàng ${order.id} (${order.name}) của bạn đã được nhân viên DUYỆT THÀNH CÔNG! Gói tập đã được kích hoạt.`
      : `Đơn hàng ${order.id} (${order.name}) CHƯA ĐƯỢC DUYỆT (Nhân viên chưa nhận được tiền thanh toán).`;

    setOrders((prev) =>
      prev.map((o) =>
        o.id === order.id
          ? {
              ...o,
              status: nextStatus,
              thongBao: {
                trangThai: approved ? "DA_DUYET" : "TU_CHOI",
                noiDung: notifMsg,
              },
            }
          : o,
      ),
    );

    notify(
      approved
        ? `Đã duyệt đơn hàng ${order.id}! Gói tập của hội viên đã được kích hoạt.`
        : `Đã xác nhận chưa nhận được tiền cho đơn hàng ${order.id}. Đơn chuyển sang Chưa duyệt.`,
    );
  };

  function requireNewLogin() {
    dataLoadSequence.current += 1;
    clearAuthToken();
    setCurrentUser(null);
    setIsAuthenticated(false);
    setAuthView("login");
    setModal(null);
    setToast("Phiên đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại.");
  }

  const loadRealData = async (activeBranch = branch, activeRole = role, activeUser = currentUser) => {
    const loadSequence = ++dataLoadSequence.current;
    try {
      const res = await fetchAllData(activeBranch, activeRole, activeUser?.id || "");
      if (loadSequence !== dataLoadSequence.current) return;
      if (res) {
        if (res.data) setData((prev) => ({ ...prev, ...res.data }));
        if (res.records) {
          setRecords(res.records);
          // Đồng bộ tài khoản hiện tại với bản ghi mới nhất từ MongoDB
          if (res.records.accounts && res.records.accounts.length > 0 && activeUser) {
            const targetId = activeUser.id;
            const targetUsername = activeUser.username;
            const targetEmail = activeUser.email;

            // Bắt buộc so khớp chính xác theo ID, username hoặc email của tài khoản đang đăng nhập
            const dbUser = res.records.accounts.find(
              (u) =>
                (targetId && u._id === targetId) ||
                (targetUsername && u.tenDangNhap && u.tenDangNhap.toLowerCase() === targetUsername.toLowerCase()) ||
                (targetEmail && u.email && u.email.toLowerCase() === targetEmail.toLowerCase()),
            );
            if (dbUser) {
              const updatedAccount = {
                id: dbUser._id,
                name: dbUser.hoTen,
                email: dbUser.email,
                username: dbUser.tenDangNhap,
                role: dbUser.vaiTro,
                branch: dbUser.chiNhanhId || activeBranch || "CN001",
                phone: dbUser.soDienThoai,
              };
              if (dbUser.vaiTro === "NHAN_VIEN" && res.records.staff) {
                const s = res.records.staff.find((st) => st.nguoiDungId === dbUser._id);
                if (s) updatedAccount.title = s.chucDanh;
              } else if (dbUser.vaiTro === "HUAN_LUYEN_VIEN" && res.records.trainers) {
                const t = res.records.trainers.find((tr) => tr.nguoiDungId === dbUser._id);
                if (t) {
                  updatedAccount.specialty = t.chuyenMon;
                  updatedAccount.bio = t.moTa;
                }
              }
              setCurrentUser((prev) => {
                const merged = { ...(prev || {}), ...updatedAccount };
                try {
                  localStorage.setItem("gym_current_user", JSON.stringify(merged));
                } catch (e) {}
                return merged;
              });
              if (dbUser.vaiTro === "HUAN_LUYEN_VIEN" && dbUser.chiNhanhId) setBranch(dbUser.chiNhanhId);
            }
          }
        }
        setPackages(Array.isArray(res.packages) ? res.packages : []);
        setOrders(Array.isArray(res.orders) ? res.orders : []);
        setVisits(Array.isArray(res.visits) ? res.visits : []);
        setBookings(Array.isArray(res.bookings) ? res.bookings : []);
        setTrainerTransfers(Array.isArray(res.trainerTransfers) ? res.trainerTransfers : []);
      }
    } catch (err) {
      if (loadSequence !== dataLoadSequence.current) return;
      if (err.status === 401) {
        requireNewLogin();
        return;
      }
      console.warn("Lỗi load dữ liệu MongoDB Atlas:", err);
    }
  };

  useEffect(() => {
    try {
      localStorage.setItem("gym_accounts", JSON.stringify(accounts));
    } catch (error) {
      console.warn("Không lưu được tài khoản:", error);
    }
  }, [accounts]);

  useEffect(() => {
    try {
      if (currentUser) {
        localStorage.setItem(
          "gym_current_user",
          JSON.stringify(currentUser),
        );
      } else {
        localStorage.removeItem("gym_current_user");
      }
    } catch (error) {
      console.warn("Không lưu được phiên:", error);
    }
  }, [currentUser]);

  useEffect(() => {
    if (isAuthenticated) {
      loadRealData(branch, role, currentUser);
    }
  }, [isAuthenticated, branch, role, currentUser?.id]);

  const profile = [
    currentUser?.name || "",
    currentUser?.email || "",
    currentUser?.phone || "",
  ];

  const allowed = [extra[0], ...modules, ...extra.slice(1)].filter(
    (m) =>
      m.roles.includes(role) &&
      (!rolePermissions[role] || rolePermissions[role].includes(m.id)),
  );
  const current = allowed.find((m) => m.id === page) || allowed[0];
  const liveModal = syncTrainerProfileModal(modal, currentUser, role, records.branches);
  useEffect(() => {
    if (liveModal !== modal) setModal(liveModal);
  }, [liveModal, modal]);
  const isBookingModal = modal?.meta?.type === "booking";
  const bookingModalIsCurrent = !isBookingModal || (
    modal.meta.bookingUserId === currentUser?.id && modal.meta.bookingRole === role &&
    modal.meta.bookingBranch === currentUser?.branch && availableTrainers.some((trainer) => trainer.id === modal.values?.[0])
  );
  useEffect(() => {
    if (!bookingModalIsCurrent) setModal(null);
  }, [bookingModalIsCurrent]);
  const isManager = ["ADMIN", "QUAN_LY_CHI_NHANH"].includes(role);
  const isBranchScopedRole = ["NHAN_VIEN", "QUAN_LY_CHI_NHANH"].includes(role);
  const canAccessAllBranches = role === "ADMIN";
  const visiblePackages = packages.filter((p) => {
    if (canAccessAllBranches) return true;
    return p.branch === (role === "KHACH" ? currentUser?.branch : branch);
  });

  const notify = (t) => setToast(t);

  // Giữ mã chi nhánh trong dữ liệu, hiển thị tên đang có trên MongoDB.
  function branchName(id) {
    return getBranchName(records.branches, id);
  }

  function navigate(id) {
    setPage(id);
    setQuery("");
    setMobile(false);
  }

  function form(title, fields, values, note = "", id = "", meta = null) {
    setModal({ title, fields, values, note, id, meta });
  }

  function editModule(m, index) {
    let fields =
      m.id === "members"
        ? ["Họ tên", "Email", "Số điện thoại", "Trạng thái"]
        : m.fields;
    let row;
    if (index === null) {
      row = fields.map(() => "");
      if (m.id === "members") {
        row = ["", "", "", "DANG_SU_DUNG"];
      }
    } else {
      if (m.id === "members") {
        const raw = records.members?.[index];
        const r = data.members?.[index] || [];
        row = [
          raw?.hoTen || r[0] || "",
          raw?.email || r[1] || "",
          raw?.soDienThoai || r[2] || "",
          raw?.trangThai === "HOAT_DONG" ? "DANG_SU_DUNG" : (r[4] || "DANG_SU_DUNG"),
        ];
      } else {
        row = data[m.id] ? data[m.id][index] : fields.map(() => "");
      }
    }
    const rawRecord =
      index !== null && records[m.id] ? records[m.id][index] : null;
    let note = "Dữ liệu được lưu trực tiếp vào cơ sở dữ liệu MongoDB Atlas.";
    if (m.id === "trainers") {
      try {
        const trainerForm = buildTrainerModuleForm({
          fields, values: row, rawRecord, currentBranch: currentUser?.branch || branch,
          branchChoices: getBranchChoices(records.branches),
        });
        fields = trainerForm.fields;
        row = trainerForm.values;
      } catch (error) {
        notify(error.message);
        return;
      }
      if (index === null) note += " Mật khẩu đăng nhập mặc định của tài khoản mới: 1.";
    }

    form(
      (index === null ? "Thêm " : "Cập nhật ") + m.title.toLowerCase(),
      fields,
      row,
      note,
      m.id,
      { type: "module", moduleId: m.id, index, rawRecord },
    );
  }

  async function handleResetMemberPassword(i) {
    const mem = records.members ? records.members[i] : null;
    const row = data.members ? data.members[i] : null;
    const memberName = mem?.hoTen || row?.[0] || "hội viên";
    const memberId = mem?._id || `ND00${i + 1}`;

    const ok = window.confirm(
      `Xác nhận cấp lại mật khẩu cho hội viên "${memberName}"?\n\nMật khẩu của tài khoản sẽ được đặt lại về: 1`,
    );
    if (!ok) return;

    try {
      const res = await resetMemberPassword(memberId);
      notify(
        res.message ||
          `Đã cấp lại mật khẩu cho hội viên "${memberName}" thành công! Mật khẩu mới là 1.`,
      );
      setAccounts((prev) =>
        prev.map((acc) =>
          acc.id === memberId ||
          acc.name === memberName ||
          (acc.role === "KHACH" && acc.email === mem?.email)
            ? { ...acc, password: "1", daCapLaiMatKhau: true }
            : acc,
        ),
      );
      await loadRealData(branch, role, currentUser);
    } catch (err) {
      setAccounts((prev) =>
        prev.map((acc) =>
          acc.id === memberId ||
          acc.name === memberName ||
          (acc.role === "KHACH" && acc.email === mem?.email)
            ? { ...acc, password: "1", daCapLaiMatKhau: true }
            : acc,
        ),
      );
      notify(
        `Đã cấp lại mật khẩu cho hội viên "${memberName}" về 1! (Lưu cục bộ: ${err.message})`,
      );
    }
  }

  function openEditProfile() {
    let fields = ["Họ tên", "Email", "Số điện thoại"];
    let values = [
      currentUser?.name || "",
      currentUser?.email || "",
      currentUser?.phone || "",
    ];
    let note = "Cập nhật thông tin cá nhân và lưu trực tiếp vào cơ sở dữ liệu MongoDB Atlas.";
    let branchChoices;

    if (role === "NHAN_VIEN") {
      fields.push("Chức danh");
      values.push(currentUser?.title || "Lễ tân");
      note = "Cập nhật thông tin nhân viên (họ tên, email, số điện thoại, chức danh) trên MongoDB Atlas.";
    } else if (role === "HUAN_LUYEN_VIEN") {
      branchChoices = getBranchChoices(records.branches);
      if (branchChoices.length === 0) {
        notify("Chưa tải được danh sách chi nhánh. Vui lòng thử lại.");
        return;
      }
      fields.push("Chuyên môn", "Mô tả", "Chi nhánh");
      values.push(
        currentUser?.specialty || "Sức mạnh & thể hình",
        currentUser?.bio || "Huấn luyện viên cá nhân",
        currentUser?.branch || "",
      );
      note = "Cập nhật thông tin huấn luyện viên. Chọn chi nhánh khác để gửi yêu cầu chuyển; chi nhánh hiện tại chỉ đổi sau khi quản lý duyệt.";
    } else if (role === "ADMIN") {
      note = "Cập nhật thông tin quản trị viên hệ thống (Admin) trên MongoDB Atlas.";
    } else if (role === "QUAN_LY_CHI_NHANH") {
      note = "Cập nhật thông tin quản lý chi nhánh trên MongoDB Atlas.";
    }

    form(
      "Cập nhật thông tin cá nhân",
      fields,
      values,
      note,
      "profile",
      { type: "profile", role, branchChoices, profileUserId: currentUser?.id, profileBranch: currentUser?.branch || "" },
    );
  }

  async function handleChangePassword(oldPw, newPw) {
    if (!oldPw || !newPw) {
      notify("Vui lòng nhập đầy đủ mật khẩu cũ và mới.");
      return false;
    }
    if (newPw.length < 4) {
      notify("Mật khẩu mới phải có ít nhất 4 ký tự.");
      return false;
    }
    try {
      const res = await fetch(`http://localhost:5000/api/profile/${currentUser?.id}/change-password`, {
        method: "POST",
        headers: getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ matKhauCu: oldPw, matKhauMoi: newPw }),
      });
      const data2 = await res.json();
      if (!res.ok) throw new Error(data2.message || "Lỗi đổi mật khẩu");
      // Cập nhật local accounts
      setAccounts((prev) =>
        prev.map((acc) =>
          acc.id === currentUser?.id ? { ...acc, password: newPw } : acc
        )
      );
      notify("Đổi mật khẩu thành công!");
      setChangePasswordModal(false);
      return true;
    } catch (err) {
      notify("Lỗi: " + err.message);
      return false;
    }
  }

  async function handleAddManager(formData) {
    try {
      const res = await fetch("http://localhost:5000/api/admin/create-manager", {
        method: "POST",
        headers: getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(formData),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.message || "Lỗi tạo tài khoản");
      notify(`Đã tạo tài khoản quản lý chi nhánh cho ${formData.hoTen} thành công!`);
      setAddManagerModal(false);
      await loadRealData(branch, role, currentUser);
    } catch (err) {
      notify("Lỗi: " + err.message);
    }
  }

  function order(p, renew = false) {
    form(
      renew ? "Gia hạn gói tập" : "Đăng ký gói tập",
      [...(role === "NHAN_VIEN" ? ["Mã hội viên"] : []), "Ngày bắt đầu"],
      [
        ...(role === "NHAN_VIEN" ? [currentUser?.id || ""] : []),
        new Date().toISOString().slice(0, 10),
      ],
      `${p.name} · ${money(p.price)} · ${p.days} ngày. Đơn hàng sẽ được tạo và lưu vào MongoDB Atlas.`,
      "order",
      { type: "order", pkg: p, renew },
    );
  }

  function packageForm(p, index) {
    form(
      index === null ? "Thêm gói tập" : "Cập nhật gói tập",
      [
        "Tên gói",
        "Loại gói",
        "Giá",
        "Thời hạn ngày",
        "Chi nhánh",
        "Trạng thái",
      ],
      p
        ? [p.name, p.type, p.price, p.days, p.branch, p.status]
        : ["", "GYM", 290000, 30, branch, "DANG_BAN"],
      "Gói tập sẽ được lưu trực tiếp vào cơ sở dữ liệu MongoDB Atlas.",
      "packages",
      { type: "package", pkg: p, index },
    );
  }

  const getAvailableTrainers = () => {
    return availableTrainers;
  };

  function booking(preselectedTrainer = "") {
    const trainerList = getAvailableTrainers();
    const trainerChoices = trainerList.map((trainer) => ({ value: trainer.id, label: trainer.name }));

    if (trainerChoices.length === 0) {
      notify(role === "KHACH" ? "Hiện chưa có huấn luyện viên tại chi nhánh đăng ký của bạn." : "Hiện tại chưa có huấn luyện viên nào trong hệ thống.");
      return;
    }

    const defaultTrainer = preselectedTrainer && trainerList.some((trainer) => trainer.id === preselectedTrainer)
      ? preselectedTrainer
      : trainerChoices[0].value;

    form(
      "Đặt buổi tập cùng PT",
      [
        "Huấn luyện viên",
        "Ngày tập",
        "Giờ bắt đầu",
        "Giờ kết thúc",
        ...(role === "NHAN_VIEN"
          ? ["Loại buổi", "Mã hội viên (cách nhau bằng dấu phẩy)"]
          : []),
        "Ghi chú",
      ],
      [
        defaultTrainer,
        new Date().toISOString().slice(0, 10),
        "08:00",
        "09:00",
        ...(role === "NHAN_VIEN" ? ["CA_NHAN", currentUser?.id || ""] : []),
        "",
      ],
      "Lịch đặt sẽ được lưu trực tiếp vào MongoDB Atlas ở trạng thái Chờ xác nhận.",
      "booking",
      { type: "booking", trainerChoices, bookingUserId: currentUser?.id, bookingRole: role, bookingBranch: currentUser?.branch },
    );
  }

  async function handleModalSubmit(values, meta) {
    try {
      if (!meta) {
        notify("Đã lưu dữ liệu.");
        setModal(null);
        return;
      }

      if (meta.type === "module") {
        if (meta.moduleId === "trainers") validateTrainerBranch(values, records.branches);
        await saveModuleRecord(
          meta.moduleId,
          values,
          meta.rawRecord?._id,
          branch,
          currentUser?.id,
        );
        notify(meta.moduleId === "trainers" && meta.index === null
          ? "Đã thêm huấn luyện viên. Mật khẩu đăng nhập mặc định: 1."
          : `Đã lưu ${modules.find((m) => m.id === meta.moduleId)?.title || "thông tin"} vào MongoDB Atlas!`);
      } else if (meta.type === "package") {
        await savePackage(values, meta.pkg?._id, branch);
        notify("Đã lưu thông tin gói tập vào MongoDB Atlas!");
      } else if (meta.type === "order") {
        const memberId =
          role === "NHAN_VIEN" ? values[0] : (currentUser?.id || "");
        const startDate = role === "NHAN_VIEN" ? values[1] : values[0];
        await createOrder({
          pkg: meta.pkg,
          memberId,
          startDate,
          isRenew: meta.renew,
          currentUserId: currentUser?.id,
        });
        notify("Tạo đơn hàng thành công! Đã lưu vào MongoDB Atlas. Vui lòng thanh toán.");
        setPage("payments");
      } else if (meta.type === "payment") {
        const method = values[0] || "CHUYEN_KHOAN";
        if (meta.role === "KHACH") {
          // Member submitted payment request
          try {
            await requestPaymentApproval({
              orderId: meta.order.id,
              currentUserId: currentUser?.id,
              method,
            });
          } catch (e) {
            console.warn("requestPaymentApproval fallback:", e);
          }
          setOrders((prev) =>
            prev.map((o) =>
              o.id === meta.order.id
                ? {
                    ...o,
                    status: "CHO_DUYET",
                    phuongThuc: method,
                    thongBao: {
                      trangThai: "CHO_DUYET",
                      noiDung: `Đơn hàng ${meta.order.id} đang chờ nhân viên đối soát và xác nhận chuyển khoản.`,
                    },
                  }
                : o,
            ),
          );
          notify("Đã gửi yêu cầu xác nhận chuyển khoản! Vui lòng chờ nhân viên duyệt.");
        } else {
          // Staff confirmed payment
          const approved = meta.approved !== undefined ? meta.approved : true;
          try {
            await confirmPaymentApproval({
              orderId: meta.order.id,
              approved,
              currentUserId: currentUser?.id,
            });
          } catch (e) {
            console.warn("confirmPaymentApproval fallback:", e);
          }
          const nextStatus = approved ? "DA_THANH_TOAN" : "TU_CHOI";
          const notifMsg = approved
            ? `Đơn hàng ${meta.order.id} (${meta.order.name}) của bạn đã được nhân viên DUYỆT THÀNH CÔNG! Gói tập đã được kích hoạt.`
            : `Đơn hàng ${meta.order.id} (${meta.order.name}) CHƯA ĐƯỢC DUYỆT (Nhân viên chưa nhận được tiền thanh toán).`;

          setOrders((prev) =>
            prev.map((o) =>
              o.id === meta.order.id
                ? {
                    ...o,
                    status: nextStatus,
                    thongBao: {
                      trangThai: approved ? "DA_DUYET" : "TU_CHOI",
                      noiDung: notifMsg,
                    },
                  }
                : o,
            ),
          );
          notify(
            approved
              ? "Đã duyệt thanh toán thành công! Gói tập đã được kích hoạt."
              : "Đã xác nhận chưa nhận được tiền cho đơn hàng.",
          );
        }
      } else if (meta.type === "checkin") {
        const [selectedMemberName, selectedPackage] = values;
        const eligibleList = meta.eligibleMembers || getEligibleMembers();
        const found = eligibleList.find(
          (m) => (typeof m === "object" ? m.name : m) === selectedMemberName,
        );
        const memberId = found?.id || found?._id || "";
        const packageId = found?.package || selectedPackage || "DKG001";

        try {
          await apiCheckin({
            memberId,
            memberName: selectedMemberName,
            packageId,
            branch,
            currentUserId: currentUser?.id,
          });
        } catch (e) {
          console.warn("apiCheckin fallback:", e);
        }

        const now = new Date();
        const timeStr = now.toLocaleTimeString("vi-VN", {
          hour: "2-digit",
          minute: "2-digit",
        });
        setVisits((prev) => [
          {
            _id: `CI${Date.now().toString().slice(-4)}`,
            member: selectedMemberName,
            memberId,
            package: packageId,
            time: timeStr,
            out: "—",
            status: "DANG_TAP",
          },
          ...prev,
        ]);
        notify(
          `Check-in thành công cho hội viên "${selectedMemberName}"! Lượt tập đã được lưu.`,
        );
      } else if (meta.type === "booking") {
        const trainer = getAvailableTrainers().find((item) => item.id === values[0]);
        if (!trainer) throw new Error("Huấn luyện viên không còn thuộc danh sách được đặt lịch. Vui lòng chọn lại.");
        await createBooking(values, role, trainer.branch, currentUser?.id);
        notify("Đặt lịch PT thành công! Lịch hẹn đã được lưu vào MongoDB.");
      } else if (meta.type === "profile") {
        const targetId = currentUser?.id || currentUser?._id;
        if (!targetId) {
          notify("Lỗi: Không tìm thấy ID tài khoản hiện tại để cập nhật.");
          return;
        }
        const currentRole = meta.role || currentUser?.role || role;
        if (currentRole === "HUAN_LUYEN_VIEN" && !(records.branches || []).some((item) => item._id === values[5])) {
          throw new Error("Vui lòng chọn chi nhánh trong danh sách hiện có.");
        }
        const updated = await apiUpdateProfile(targetId, values, {
          role: currentRole,
          currentUserId: currentUser?.id,
        });
        if (updated) {
          if (updated.branchTransfer) {
            setTrainerTransfers((prev) => [updated.branchTransfer, ...prev.filter((item) => item._id !== updated.branchTransfer._id)]);
          }
          const nextUser = {
            ...(currentUser || {}),
            ...updated,
          };
          setCurrentUser(nextUser);
          if (updated.branch) setBranch(updated.branch);
          try {
            localStorage.setItem("gym_current_user", JSON.stringify(nextUser));
          } catch (e) {}

          setAccounts((prev) =>
            prev.map((acc) =>
              acc.id === targetId || acc.username === updated.username || acc.email === updated.email
                ? {
                    ...acc,
                    name: updated.name,
                    email: updated.email,
                    phone: updated.phone,
                    ...(updated.branch ? { branch: updated.branch } : {}),
                    ...(updated.title ? { title: updated.title } : {}),
                    ...(updated.specialty ? { specialty: updated.specialty } : {}),
                    ...(updated.bio ? { bio: updated.bio } : {}),
                  }
                : acc,
            ),
          );
          notify(updated.branchTransfer?.status === "PENDING"
            ? `Đã gửi yêu cầu chuyển sang ${branchName(updated.branchTransfer.toBranchId)}. Chi nhánh hiện tại giữ nguyên trong khi chờ quản lý duyệt.`
            : "Cập nhật thông tin thành công và đã lưu vào MongoDB Atlas!");
          await loadRealData(updated.branch || branch, role, nextUser);
          setModal(null);
          return;
        }
      }

      await loadRealData(branch, role, currentUser);
      setModal(null);
    } catch (err) {
      if (err.status === 401) {
        requireNewLogin();
        return;
      }
      notify("Lỗi: " + (err.message || "Không thể thực hiện thao tác"));
    }
  }

  async function statusAppointment(i, newStatus) {
    try {
      const apt =
        (records.appointments && records.appointments[i]) || bookings[i];
      const aptId = apt?._id || `LDP00${i + 1}`;
      await updateAppointmentStatus(aptId, newStatus);
      notify(`Đã cập nhật trạng thái lịch hẹn: ${labels[newStatus] || newStatus}!`);
      await loadRealData(branch, role, currentUser);
    } catch (err) {
      notify("Lỗi cập nhật lịch hẹn: " + err.message);
    }
  }

  async function handleTrainerTransferDecision(transferId, decision) {
    if (transferDecisionId) return;
    setTransferDecisionId(transferId);
    try {
      await decideTrainerTransfer(transferId, decision, currentUser?.id);
      await loadRealData(branch, role, currentUser);
      notify(decision === "APPROVED" ? "Đã duyệt yêu cầu chuyển chi nhánh." : "Đã từ chối yêu cầu chuyển chi nhánh.");
    } catch (error) {
      if (error.status === 401) {
        requireNewLogin();
        return;
      }
      notify("Lỗi: " + (error.message || "Không thể xử lý yêu cầu chuyển chi nhánh."));
    } finally {
      setTransferDecisionId("");
    }
  }

  async function handleCheckout(i) {
    try {
      const v = visits[i];
      if (!v?._id) {
        notify("Lỗi: Không tìm thấy mã lượt tập.");
        return;
      }
      await apiCheckout(v._id);
      notify("Hội viên đã check-out thành công!");
      await loadRealData(branch, role, currentUser);
    } catch (err) {
      notify("Lỗi check-out: " + err.message);
    }
  }

  const count = bookings.length + (data.appointments ? data.appointments.length : 0);
  const today = new Date();
  const dateChipText = new Intl.DateTimeFormat("vi-VN", {
    weekday: "long",
    day: "numeric",
    month: "numeric",
    year: "numeric",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(today);

  const heading = (
    <div className="heading">
      <div>
        <div className="eyebrow">GYM STATION / {roles[role]}</div>
        <h1>{current.title}</h1>
        <p>
          {page === "overview"
            ? "Một nơi để theo dõi và vận hành phòng tập của bạn."
            : current.uc
              ? current.uc +
                " · " +
                (role === "KHACH"
                  ? "Thông tin của bạn"
                  : role === "ADMIN"
                    ? "Phạm vi toàn hệ thống"
                    : "Phạm vi " + branchName(currentUser?.branch || branch))
              : "Thông tin dành cho bạn"}
        </p>
      </div>
      <div className="date-chip">
        <span className="date-chip-icon">
          <Icon name="appointments" size={16} />
        </span>
        <div>
          <span>{dateChipText}</span>
          <small>Hôm nay</small>
        </div>
      </div>
    </div>
  );

  async function handleLogin(event) {
    event.preventDefault();
    try {
      const account = await apiLogin({
        email: credentials.email,
        password: credentials.password,
        role: loginRole,
      });

      setCurrentUser(account);
      setRole(account.role);
      setLoginRole(account.role);
      setBranch(account.branch || "CN001");
      setIsAuthenticated(true);
      setPage("overview");
      setQuery("");
      try {
        localStorage.setItem("gym_current_user", JSON.stringify(account));
      } catch (e) {}
      setToast(
        account.role === "KHACH"
          ? `Đăng nhập thành công với tài khoản ${account.name} (MongoDB).`
          : `Đăng nhập thành công với vai trò ${roles[account.role] || account.role} (MongoDB).`,
      );
      loadRealData(account.branch || "CN001", account.role, account);
    } catch (apiError) {
      if (apiError.status) {
        setToast(apiError.message || "Không thể đăng nhập. Vui lòng kiểm tra tài khoản và mật khẩu.");
        return;
      }
      const identifier = credentials.email.trim().toLowerCase();
      const account = mergedAccounts.find(
        (item) =>
          [item.email, item.name, item.username, ...(item.aliases || [])].some(
            (value) => typeof value === "string" && value.toLowerCase() === identifier,
          ) &&
          (item.password === credentials.password || (credentials.password === "1" && (item.password === "1" || item.daCapLaiMatKhau))) &&
          item.role === loginRole,
      );

      if (!account) {
        setToast(
          apiError.message ||
            "Tài khoản hoặc mật khẩu không đúng cho vai trò đã chọn.",
        );
        return;
      }

      setCurrentUser(account);
      setRole(account.role);
      setLoginRole(account.role);
      setBranch(account.branch || "CN001");
      setIsAuthenticated(true);
      setPage("overview");
      setQuery("");
      try {
        localStorage.setItem("gym_current_user", JSON.stringify(account));
      } catch (e) {}
      setToast(
        account.role === "KHACH"
          ? `Đăng nhập thành công với tài khoản ${account.name}.`
          : `Đăng nhập thành công với vai trò ${roles[account.role] || account.role}.`,
      );
    }
  }

  function handleRegister() {
    setRole("KHACH");
    setLoginRole("KHACH");
    setAuthView("register");
    setToast("");
  }

  async function handleRegisterSubmit(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("name") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const phone = String(formData.get("phone") || "").trim();
    const password = String(formData.get("password") || "");
    const confirmPassword = String(formData.get("confirmPassword") || "");
    const regBranch = String(formData.get("branch") || "").trim();

    if (!name || !email || !phone || !password) {
      setToast("Vui lòng điền đầy đủ thông tin đăng ký.");
      return;
    }

    if (!regBranch) {
      setToast("Vui lòng chọn chi nhánh có quản lý trong danh sách đăng ký.");
      return { refreshBranches: true };
    }

    if (password !== confirmPassword) {
      setToast("Mật khẩu xác nhận không khớp.");
      return;
    }

    try {
      const newAccount = await apiRegister({
        name,
        email,
        phone,
        password,
        branch: regBranch,
      });

      setCurrentUser(newAccount);
      setRole("KHACH");
      setLoginRole("KHACH");
      setBranch(newAccount.branch || regBranch);
      setAuthView("login");
      setIsAuthenticated(true);
      setPage("overview");
      try {
        localStorage.setItem("gym_current_user", JSON.stringify(newAccount));
      } catch (e) {}
      setToast(
        `Đăng ký tài khoản thành công cho ${name}! Dữ liệu đã lưu vào MongoDB.`,
      );
      setCredentials({ email, password });
      loadRealData(newAccount.branch || regBranch, "KHACH", newAccount);
    } catch (err) {
      setToast(err.message || "Lỗi đăng ký tài khoản.");
      return { refreshBranches: err.code === "INVALID_REGISTRATION_BRANCH" };
    }
  }

  function table(headers, rows = [], actions) {
    const shown = rows
      .map((r, i) => ({ r: r.map((value, index) => headers[index] === "Chi nhánh" ? branchName(value) || "—" : value), i }))
      .filter(({ r }) =>
        r.join(" ").toLowerCase().includes(query.toLowerCase()),
      );
    return (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h}>{h}</th>
              ))}
              {actions && <th>Thao tác</th>}
            </tr>
          </thead>
          <tbody>
            {shown.map(({ r, i }) => (
              <tr key={i}>
                {r.map((v, j) => (
                  <td key={j}>
                    {labels[v] || roles[v] ? <Badge value={v} /> : v}
                  </td>
                ))}
                {actions && (
                  <td>
                    <div className="row-actions">{actions(i)}</div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && (
          <div className="empty">
            <span>◇</span>
            <h3>Chưa có dữ liệu phù hợp</h3>
            <p>Thêm bản ghi mới hoặc thay đổi từ khóa tìm kiếm.</p>
          </div>
        )}
      </div>
    );
  }

  function moduleContent(m) {
    const rows = data[m.id] || [];
    return (
      <>
      <section className="panel">
        <div className="panel-top">
          <div>
            <h2>{m.title}</h2>
            <p>{rows.length} bản ghi cơ sở dữ liệu</p>
          </div>
          {!["permissions", "appointments"].includes(m.id) && (
            <button className="primary" onClick={() => editModule(m, null)}>
              + Thêm mới
            </button>
          )}
        </div>
        {table(m.fields, rows, (i) =>
          m.id === "appointments" ? (
            <>
              {rows[i]?.at(-1) === "CHO_XAC_NHAN" && (
                <button onClick={() => statusAppointment(i, "DA_XAC_NHAN")}>
                  Xác nhận
                </button>
              )}
              {rows[i]?.at(-1) === "DA_XAC_NHAN" && (
                <button onClick={() => statusAppointment(i, "HOAN_THANH")}>
                  Hoàn thành
                </button>
              )}
              {["CHO_XAC_NHAN", "DA_XAC_NHAN"].includes(rows[i]?.at(-1)) && (
                <button onClick={() => statusAppointment(i, "DA_HUY")}>
                  Hủy
                </button>
              )}
            </>
          ) : m.id === "members" ? (
            <>
              <button onClick={() => editModule(m, i)}>Chỉnh sửa</button>
              <button
                className="secondary"
                style={{ marginLeft: "6px" }}
                onClick={() => handleResetMemberPassword(i)}
                title="Cấp lại mật khẩu mặc định về 1 cho hội viên"
              >
                Cấp lại MK
              </button>
            </>
          ) : (
            <button onClick={() => editModule(m, i)}>
              {m.id === "permissions" ? "Đổi quyền" : "Chỉnh sửa"}
            </button>
          ),
        )}
      </section>
      {m.id === "trainers" && role === "QUAN_LY_CHI_NHANH" && (
        <section className="panel">
          <div className="panel-top">
            <div>
              <h2>Yêu cầu chuyển chi nhánh</h2>
              <p>Yêu cầu của huấn luyện viên đang thuộc {branchName(currentUser?.branch)}.</p>
            </div>
          </div>
          {pendingTrainerTransfers.length ? table(
            ["Huấn luyện viên", "Chi nhánh hiện tại", "Chi nhánh đề nghị", "Trạng thái"],
            pendingTrainerTransfers.map((transfer) => [getTransferTrainerName(transfer, records), branchName(transfer.fromBranchId), branchName(transfer.toBranchId), transferStatusLabels[transfer.status] || transfer.status]),
            (index) => <>
              <button className="primary" disabled={Boolean(transferDecisionId)} onClick={() => handleTrainerTransferDecision(pendingTrainerTransfers[index]._id, "APPROVED")}>Duyệt</button>
              <button disabled={Boolean(transferDecisionId)} onClick={() => handleTrainerTransferDecision(pendingTrainerTransfers[index]._id, "REJECTED")}>Từ chối</button>
            </>,
          ) : <div className="empty"><h3>Chưa có yêu cầu đang chờ duyệt</h3></div>}
        </section>
      )}
      </>
    );
  }

  const paid = orders
    .filter((o) => o.status === "DA_THANH_TOAN")
    .reduce((s, o) => s + (Number(o.total) || 0), 0);

  if (!isAuthenticated) {
    if (authView === "register") {
      return (
        <RegisterScreen
          onBack={() => setAuthView("login")}
          onSubmit={handleRegisterSubmit}
          notice={toast}
        />
      );
    }

    return (
      <LoginScreen
        onLogin={handleLogin}
        loginRole={loginRole}
        setLoginRole={setLoginRole}
        credentials={credentials}
        setCredentials={setCredentials}
        onRegister={handleRegister}
        notice={toast}
      />
    );
  }

  return (
    <div className="app">
      <aside className={"sidebar " + (mobile ? "show" : "")}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("overview");
          }}
        >
          <span className="brandmark" aria-label="Gym Station logo">
            <Icon name="dumbbell" size={24} />
          </span>
          <div>
            GYM STATION<small>MANAGEMENT SPACE</small>
          </div>
        </a>
        {role === "KHACH" ? (
          <>
            <div className="member-summary">
              <div className="member-summary-top">
                <div className="member-summary-avatar">
                  {(currentUser?.name || "H").charAt(0).toUpperCase()}
                </div>
                <div className="member-summary-info">
                  <strong>{currentUser?.name || "Hội viên"}</strong>
                  <small>Hội viên</small>
                </div>
              </div>
              <button
                type="button"
                className="member-summary-button"
                onClick={() => navigate("profile")}
              >
                Xem thông tin
              </button>
            </div>
          </>
        ) : (
          <div className="workspace">
            <span className="branch-icon">⌂</span>
            <div>
              {role === "ADMIN" ? "Toàn hệ thống" : branchName(currentUser?.branch || branch)}
              <small>Không gian làm việc</small>
            </div>
            <span className="online" />
          </div>
        )}
        <div className="nav-label">ĐIỀU HƯỚNG</div>
        <nav>
          {allowed.map((m) => (
            <button
              key={m.id}
              onClick={() => navigate(m.id)}
              className={current.id === m.id ? "active" : ""}
            >
              <span>{glyphs[m.id]}</span>
              {m.title}
              {current.id === m.id && <i />}
            </button>
          ))}
        </nav>
        <div
          className="sidebar-bottom"
          onClick={() => navigate("profile")}
          style={{ cursor: "pointer" }}
          title="Nhấp để xem và chỉnh sửa thông tin cá nhân"
        >
          <div className="avatar">{(currentUser?.name || roles[role]).slice(0, 1)}</div>
          <div>
            {roles[role]}
            <small>{currentUser?.name || "Hồ sơ cá nhân"}</small>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="mobile-menu"
            onClick={() => setMobile(!mobile)}
            aria-label="Mở menu"
          >
            ☰
          </button>
          <div className="search">
            <span>⌕</span>
            <input
              aria-label="Tìm trong trang"
              placeholder="Tìm trong trang hiện tại…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button
            className="primary compact logout-button"
            onClick={() => {
              dataLoadSequence.current += 1;
              clearAuthToken();
              setCurrentUser(null);
              setIsAuthenticated(false);
              setAuthView("login");
              setRole("KHACH");
              setPage("overview");
              setToast("Đăng xuất thành công.");
            }}
          >
            <svg className="logout-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M9 7V5.8A1.8 1.8 0 0 1 10.8 4h7.4A1.8 1.8 0 0 1 20 5.8v12.4A1.8 1.8 0 0 1 18.2 20h-7.4A1.8 1.8 0 0 1 9 18.2V17"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M4 12h10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
              <path
                d="M11 8l4 4-4 4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>Đăng xuất</span>
          </button>
        </header>
        <div className="demo-strip">
          <span>
            <b>HỆ THỐNG GYM STATION</b> · Đã kết nối MongoDB Atlas (GymManagement) · Dữ liệu thực
          </span>
          {role === "ADMIN" && (
            <select
              aria-label="Lọc chi nhánh"
              value={branch}
              onChange={(e) => {
                const nextBranch = e.target.value;
                setBranch(nextBranch);
                loadRealData(nextBranch, role, currentUser);
              }}
            >
              {(records.branches || []).map((item) => <option key={item._id} value={item._id}>{branchName(item._id)}</option>)}
            </select>
          )}
          {isBranchScopedRole && (
            <span className="branch-fixed-pill">Chi nhánh: {branchName(currentUser?.branch || branch)}</span>
          )}
        </div>
        <main>
          {heading}
          {page === "overview" && (
            <>
              <section className="welcome">
                <div>
                  <div className="eyebrow">SẴN SÀNG CHO MỘT NGÀY NĂNG ĐỘNG</div>
                  <h2>
                    Vận hành gọn gàng.
                    <br />
                    Tập trung vào trải nghiệm.
                  </h2>
                  <p>
                    {role === "KHACH"
                      ? "Chọn gói tập, đặt lịch cùng PT và theo dõi hành trình của bạn."
                      : "Theo dõi công việc, lịch tập và dịch vụ tại cùng một không gian."}
                  </p>
                  <button
                    onClick={() =>
                      navigate(
                        role === "HUAN_LUYEN_VIEN"
                          ? "shifts"
                          : role === "NHAN_VIEN"
                            ? "checkin"
                            : "packages",
                      )
                    }
                  >
                    {role === "HUAN_LUYEN_VIEN"
                      ? "Xem ca làm việc"
                      : role === "NHAN_VIEN"
                        ? "Tiếp nhận hội viên"
                        : "Khám phá gói tập"}{" "}
                    <span>↗</span>
                  </button>
                </div>
                <div className="art" aria-hidden="true">
                  <div className="orbit" />
                  <div className="weight">
                    <i />
                    <b />
                    <span />
                    <b />
                    <i />
                  </div>
                  <div className="art-label">
                    BUILD YOUR
                    <br />
                    <strong>BETTER.</strong>
                  </div>
                </div>
              </section>
              <div className="stats">
                {[
                  [
                    isManager ? "Gói tập đang bán" : "Gói tập tham khảo",
                    visiblePackages.filter((p) => p.status === "DANG_BAN").length,
                    canAccessAllBranches
                      ? "Toàn bộ chi nhánh"
                      : "Danh mục tại " + branchName(currentUser?.branch || branch),
                  ],
                  ["Lịch hẹn PT", count, "Lịch hẹn trên MongoDB"],
                  ["Đơn hàng", orders.length, "Tổng đơn hàng hệ thống"],
                  [
                    "Lượt đang tập",
                    visits.filter((v) => v.status === "DANG_TAP").length,
                    "Hội viên check-in hôm nay",
                  ],
                ].map(([t, n, s], i) => (
                  <article key={t}>
                    <span className="stat-icon">{["▣", "▦", "↗", "⇄"][i]}</span>
                    <p>{t}</p>
                    <strong>{n.toString().padStart(2, "0")}</strong>
                    <small>{s}</small>
                  </article>
                ))}
              </div>
              <div className="two-col">
                <section className="panel">
                  <div className="panel-top">
                    <h2>Truy cập nhanh</h2>
                    <span className="muted">Theo vai trò</span>
                  </div>
                  <div className="quick-grid">
                    {allowed
                      .filter((m) => !["overview", "profile"].includes(m.id))
                      .slice(0, 6)
                      .map((m) => (
                        <button key={m.id} onClick={() => navigate(m.id)}>
                          <span>{glyphs[m.id]}</span>
                          <strong>{m.title}</strong>
                          <small>{m.uc}</small>
                          <b>↗</b>
                        </button>
                      ))}
                  </div>
                </section>
                <section className="panel notice">
                  <span className="eyebrow">LỊCH LÀM VIỆC HUẤN LUYỆN VIÊN</span>
                  <h2>Nhịp tập mỗi ngày</h2>
                  {data.shifts && data.shifts.length > 0 ? (
                    data.shifts.slice(0, 3).map((row, idx) => (
                      <div className="timeline" key={idx}>
                        <b>{row[2] || "08:00"}</b>
                        <div>
                          <strong>Ca làm việc PT</strong>
                          <small>{row[0] || "HLV"} · 60 phút</small>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="hint" style={{ marginTop: "12px", marginBottom: "8px" }}>
                      Chưa có ca làm việc nào được xếp lịch tại {branchName(currentUser?.branch || branch)}.
                    </p>
                  )}
                  <p className="hint">
                    Lịch tập chuẩn hóa kết nối ca làm việc tại {branchName(currentUser?.branch || branch)}.
                  </p>
                </section>
              </div>
            </>
          )}
          {modules.some((m) => m.id === page) &&
            page === "permissions" ? (
            <section className="panel">
              <div className="panel-top">
                <div>
                  <h2>Phân quyền hệ thống</h2>
                  <p>Quản lý vai trò và tài khoản theo từng nhóm chức năng</p>
                </div>
                <button className="primary" onClick={() => setAddManagerModal(true)}>
                  + Thêm quản lý chi nhánh
                </button>
              </div>
              {[
                { label: "🏢 Quản lý chi nhánh", key: "QUAN_LY_CHI_NHANH", desc: "Quản lý nhân viên, HLV, thiết bị, lịch làm việc, báo cáo chi nhánh" },
                { label: "🧑‍💼 Nhân viên", key: "NHAN_VIEN", desc: "Tiếp nhận hội viên, check-in/out, xác nhận thanh toán, đặt lịch" },
                { label: "💪 Huấn luyện viên", key: "HUAN_LUYEN_VIEN", desc: "Xem ca làm việc, lịch hẹn PT" },
                { label: "🏃 Hội viên", key: "KHACH", desc: "Xem gói tập, đặt lịch PT, thanh toán, lịch sử" },
              ].map(({ label, key, desc }) => {
                const usersOfRole = (records.accounts || []).filter((u) => u.vaiTro === key);
                return (
                  <div key={key} style={{ marginBottom: "24px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                      <h3 style={{ margin: 0, fontSize: "15px" }}>{label}</h3>
                      <span style={{ fontSize: "12px", color: "var(--muted, #888)", background: "var(--surface2, #f4f4f4)", padding: "2px 10px", borderRadius: "20px" }}>{usersOfRole.length} tài khoản</span>
                    </div>
                    <p style={{ fontSize: "12px", color: "var(--muted, #888)", marginBottom: "8px" }}>{desc}</p>
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>Họ tên</th><th>Email</th><th>Tên đăng nhập</th><th>Chi nhánh</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
                        <tbody>
                          {usersOfRole.length === 0 ? (
                            <tr><td colSpan={6} style={{ color: "var(--muted, #888)", textAlign: "center" }}>Chưa có tài khoản trong nhóm này</td></tr>
                          ) : usersOfRole.map((u) => (
                            <tr key={u._id}>
                              <td>{u.hoTen}</td>
                              <td>{u.email}</td>
                              <td>{u.tenDangNhap || "—"}</td>
                              <td>{branchName(u.chiNhanhId) || "—"}</td>
                              <td><span className={"badge " + (u.trangThai === "HOAT_DONG" ? "" : "red")}>{u.trangThai === "HOAT_DONG" ? "Hoạt động" : (u.trangThai || "Không rõ")}</span></td>
                              <td>
                                <div className="row-actions">
                                  <select
                                    style={{ fontSize: "12px", padding: "2px 6px", borderRadius: "6px", border: "1px solid var(--border, #333)", background: "var(--surface2, #1e1e1e)", color: "inherit" }}
                                    value={u.vaiTro}
                                    onChange={async (e) => {
                                      const newRole = e.target.value;
                                      try {
                                        const r = await fetch("http://localhost:5000/api/admin/change-role", {
                                          method: "PUT", headers: getAuthHeaders({ "Content-Type": "application/json" }),
                                          body: JSON.stringify({ userId: u._id, newRole, chiNhanhId: u.chiNhanhId }),
                                        });
                                        const result = await r.json();
                                        if (!r.ok) throw new Error(result.message);
                                        notify("Đã cập nhật vai trò thành công!");
                                        await loadRealData(branch, role, currentUser);
                                      } catch (err) { notify("Lỗi: " + err.message); }
                                    }}
                                  >
                                    <option value="KHACH">Hội viên</option>
                                    <option value="NHAN_VIEN">Nhân viên</option>
                                    <option value="HUAN_LUYEN_VIEN">Huấn luyện viên</option>
                                    <option value="QUAN_LY_CHI_NHANH">Quản lý chi nhánh</option>
                                  </select>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </section>
          ) : modules.some((m) => m.id === page) && page === "accounts" ? (
            // Accounts module with custom render: show Vai trò + khóa tài khoản
            (() => {
              const m = modules.find((m) => m.id === page);
              const rows = data[m.id] || [];
              const headers = ["Họ tên", "Email", "Tên đăng nhập", "Chi nhánh", "Trạng thái", "Vai trò"];
              return (
                <section className="panel">
                  <div className="panel-top">
                    <div>
                      <h2>{m.title}</h2>
                      <p>{rows.length} bản ghi cơ sở dữ liệu</p>
                    </div>
                    <button className="primary" onClick={() => editModule(m, null)}>+ Thêm mới</button>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          {headers.map((h) => <th key={h}>{h}</th>)}
                          <th>Thao tác</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(rows.length === 0 ? [] : rows.map((r, i) => ({ r, i }))).filter(({ r }) => [...(r || []), branchName(r?.[3])].join(" ").toLowerCase().includes(query.toLowerCase())).map(({ r, i }) => {
                          const rawUser = records.accounts ? records.accounts[i] : null;
                          return (
                            <tr key={i}>
                              {r.map((v, j) => <td key={j}>{j === 3 ? branchName(v) || "—" : labels[v] || roles[v] ? <Badge value={v} /> : v}</td>)}
                              <td>
                                <div className="row-actions">
                                  <button onClick={() => editModule(m, i)}>Chỉnh sửa</button>
                                  {rawUser && rawUser.trangThai !== "KHOA" && (
                                    <button
                                      className="secondary"
                                      style={{ marginLeft: "6px", background: "var(--red-muted, #3a1a1a)", color: "#e57373" }}
                                      onClick={async () => {
                                        if (!window.confirm(`Khóa tài khoản "${rawUser.hoTen}"? Người dùng sẽ không đăng nhập được.`)) return;
                                        try {
                                          const res = await fetch("http://localhost:5000/api/admin/set-status", {
                                            method: "PUT", headers: getAuthHeaders({ "Content-Type": "application/json" }),
                                            body: JSON.stringify({ userId: rawUser._id, trangThai: "KHOA" }),
                                          });
                                          const result = await res.json();
                                          if (!res.ok) throw new Error(result.message);
                                          notify(`Đã khóa tài khoản ${rawUser.hoTen}!`);
                                          await loadRealData(branch, role, currentUser);
                                        } catch (err) { notify("Lỗi: " + err.message); }
                                      }}
                                    >Khóa TK</button>
                                  )}
                                  {rawUser && rawUser.trangThai === "KHOA" && (
                                    <button
                                      className="secondary"
                                      style={{ marginLeft: "6px", background: "var(--green-muted, #1a3a1a)", color: "#81c784" }}
                                      onClick={async () => {
                                        try {
                                          const res = await fetch("http://localhost:5000/api/admin/set-status", {
                                            method: "PUT", headers: getAuthHeaders({ "Content-Type": "application/json" }),
                                            body: JSON.stringify({ userId: rawUser._id, trangThai: "HOAT_DONG" }),
                                          });
                                          const result = await res.json();
                                          if (!res.ok) throw new Error(result.message);
                                          notify(`Đã mở khóa tài khoản ${rawUser.hoTen}!`);
                                          await loadRealData(branch, role, currentUser);
                                        } catch (err) { notify("Lỗi: " + err.message); }
                                      }}
                                    >Mở khóa</button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        {rows.length === 0 && (
                          <tr><td colSpan={headers.length + 1} style={{ textAlign: "center", color: "var(--muted)" }}>Chưa có dữ liệu</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              );
            })()
          ) : modules.some((m) => m.id === page) &&
            moduleContent(modules.find((m) => m.id === page))}
          {page === "packages" && (
            <>
              <div className="section-tools">
                <p>
                  {role === "ADMIN" ? (
                    <>
                      Gói tập toàn hệ thống · Đơn vị giá: VND
                    </>
                  ) : (
                    <>
                      Gói tập tại <strong>{branchName(currentUser?.branch || branch)}</strong> · Đơn vị giá: VND
                    </>
                  )}
                </p>
                {isManager && (
                  <button
                    className="primary"
                    onClick={() => packageForm(null, null)}
                  >
                    + Thêm gói tập
                  </button>
                )}
              </div>
              <div className="package-grid">
                {visiblePackages
                  .map((p, i) => ({ ...p, i }))
                  .filter(
                    (p) =>
                      p.name.toLowerCase().includes(query.toLowerCase()) &&
                      (isManager || p.status === "DANG_BAN"),
                  )
                  .map((p) => (
                    <article
                      className={
                        "package-card " +
                        (p.type === "GYM_PT" ? "featured" : "")
                      }
                      key={p.i}
                    >
                      <div className="package-top">
                        <span>
                          {p.type === "GYM_PT"
                            ? "CÙNG HUẤN LUYỆN VIÊN"
                            : "TỰ DO TẬP LUYỆN"}
                        </span>
                        <Badge value={p.status} />
                      </div>
                      <div className="package-symbol">
                        {p.type === "GYM_PT" ? "↗" : "◈"}
                      </div>
                      <h2>{p.name}</h2>
                      <p>
                        {p.type === "GYM_PT"
                          ? "Hành trình tập luyện có người đồng hành."
                          : "Chủ động thời gian, duy trì thói quen tốt."}
                      </p>
                      <div className="price">
                        {money(p.price)}
                        <small>/ {p.days} ngày</small>
                      </div>
                      <ul>
                        <li>Không gian tập tại {branchName(p.branch)}</li>
                        <li>Sử dụng khu vực gym</li>
                        <li>
                          {p.type === "GYM_PT"
                            ? "Đặt lịch tập với PT"
                            : "Tập luyện theo lịch cá nhân"}
                        </li>
                      </ul>
                      {isManager ? (
                        <button
                          className="primary"
                          onClick={() => packageForm(p, p.i)}
                        >
                          Chỉnh sửa gói
                        </button>
                      ) : (
                        <>
                          <button className="primary" onClick={() => order(p)}>
                            Đăng ký gói ↗
                          </button>
                          <button
                            className="text-button"
                            onClick={() => order(p, true)}
                          >
                            Gia hạn gói
                          </button>
                        </>
                      )}
                    </article>
                  ))}
              </div>
            </>
          )}
          {page === "payments" && (
            <section className="panel">
              <div className="panel-top">
                <div>
                  <h2>Đơn hàng của {role === "KHACH" ? "bạn" : "hội viên"}</h2>
                  <p>Dữ liệu đơn hàng thực tế từ MongoDB Atlas (GymManagement).</p>
                </div>
                <button onClick={() => navigate("packages")}>
                  Chọn gói tập ↗
                </button>
              </div>

              {role === "KHACH" && (
                <div className="member-notifications-wrap">
                  {orders
                    .filter((o) => {
                      const isMine =
                        (currentUser?.id && o.member === currentUser.id) ||
                        (currentUser?.name && (o.member === currentUser.name || o.memberName === currentUser.name)) ||
                        (currentUser?.username && o.member === currentUser.username);
                      return isMine && !dismissedNotifs.includes(o.id);
                    })
                    .map((o) => {
                      if (o.status === "DA_THANH_TOAN" || o.status === "DA_DUYET") {
                        return (
                          <div key={o.id} className="payment-alert success">
                            <span className="payment-alert-icon">✓</span>
                            <div className="payment-alert-body">
                              <strong>Thông báo duyệt đơn hàng</strong>
                              <p>
                                Đơn hàng <b>{o.id}</b> ({o.name}) của bạn đã được nhân viên <b>DUYỆT THÀNH CÔNG</b>! Gói tập đã được kích hoạt.
                              </p>
                            </div>
                            <button
                              className="payment-alert-close"
                              title="Đóng thông báo"
                              onClick={() => setDismissedNotifs((prev) => [...prev, o.id])}
                            >
                              ×
                            </button>
                          </div>
                        );
                      }
                      if (o.status === "TU_CHOI") {
                        return (
                          <div key={o.id} className="payment-alert danger">
                            <span className="payment-alert-icon">✕</span>
                            <div className="payment-alert-body">
                              <strong>Thông báo duyệt đơn hàng</strong>
                              <p>
                                Đơn hàng <b>{o.id}</b> ({o.name}) <b>CHƯA ĐƯỢC DUYỆT</b> (Nhân viên chưa nhận được tiền chuyển khoản). Vui lòng kiểm tra lại giao dịch hoặc chuyển khoản lại.
                              </p>
                            </div>
                            <button
                              className="payment-alert-close"
                              title="Đóng thông báo"
                              onClick={() => setDismissedNotifs((prev) => [...prev, o.id])}
                            >
                              ×
                            </button>
                          </div>
                        );
                      }
                      if (o.status === "CHO_DUYET") {
                        return (
                          <div key={o.id} className="payment-alert pending">
                            <span className="payment-alert-icon">⏳</span>
                            <div className="payment-alert-body">
                              <strong>Yêu cầu thanh toán đang chờ xử lý</strong>
                              <p>
                                Đơn hàng <b>{o.id}</b> ({o.name}) đã gửi yêu cầu thanh toán chuyển khoản. Đang chờ nhân viên đối soát và xác nhận.
                              </p>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    })}
                </div>
              )}

              {table(
                ["Mã đơn", "Gói tập", "Loại đơn", "Thành tiền", "Trạng thái"],
                orders.map((o) => [
                  o.id,
                  o.name,
                  o.kind,
                  money(o.total),
                  o.status,
                ]),
                (i) => {
                  const order = orders[i];
                  if (role === "KHACH") {
                    if (order.status === "CHO_THANH_TOAN" || order.status === "TU_CHOI") {
                      return (
                        <button
                          className="primary"
                          onClick={() =>
                            form(
                              `Thanh toán đơn hàng ${order.id}`,
                              ["Phương thức"],
                              ["CHUYEN_KHOAN"],
                              `Gói tập: ${order.name} · ${money(order.total)}. Quét mã VietQR MB Bank bên dưới để chuyển khoản.`,
                              "payment",
                              { type: "payment", order, role },
                            )
                          }
                        >
                          {order.status === "TU_CHOI" ? "Thanh toán lại" : "Thanh toán"}
                        </button>
                      );
                    }
                    if (order.status === "CHO_DUYET") {
                      return <span className="badge amber">Đang chờ duyệt</span>;
                    }
                    return null;
                  }

                  // Staff & Admin actions
                  if (order.status === "CHO_DUYET") {
                    return (
                      <div className="row-actions">
                        <button
                          className="btn-approve"
                          title="Xác nhận đã nhận được tiền (Duyệt đơn)"
                          onClick={() => handleStaffDecision(order, true)}
                        >
                          ✓ Có (Đã nhận)
                        </button>
                        <button
                          className="btn-reject"
                          title="Chưa nhận được tiền (Từ chối duyệt)"
                          onClick={() => handleStaffDecision(order, false)}
                        >
                          ✕ Không
                        </button>
                      </div>
                    );
                  }

                  if (order.status === "CHO_THANH_TOAN") {
                    return (
                      <button
                        onClick={() =>
                          form(
                            "Xác nhận thu tiền",
                            ["Phương thức", "Mã giao dịch"],
                            ["CHUYEN_KHOAN", `TX-${Date.now().toString().slice(-6)}`],
                            "Xác nhận thu tiền sau đối soát. Gói tập sẽ được kích hoạt ngay trên MongoDB.",
                            "payment",
                            { type: "payment", order, role },
                          )
                        }
                      >
                        Xác nhận thu tiền
                      </button>
                    );
                  }

                  return null;
                },
              )}
            </section>
          )}
          {page === "checkin" && (
            <section className="panel">
              <div className="panel-top">
                <div>
                  <h2>Tiếp nhận hội viên</h2>
                  <p>Quản lý lượt vào / ra phòng tập lưu trên MongoDB</p>
                </div>
                <button
                  className="primary"
                  onClick={() => {
                    const eligible = getEligibleMembers();
                    if (!eligible.length) {
                      notify("Chưa có hội viên nào đã mua gói tập để check-in!");
                      return;
                    }
                    const names = eligible.map((e) => e.name);
                    form(
                      "Check-in hội viên",
                      ["Tên Hội Viên", "Gói tập"],
                      [names[0], eligible[0].package || "Gym cơ bản"],
                      "Chỉ hiển thị những hội viên đã mua gói tập trong hệ thống.",
                      "checkin",
                      { type: "checkin", eligibleMembers: eligible, memberChoices: names },
                    );
                  }}
                >
                  + Check-in
                </button>
              </div>
              {table(
                ["Hội viên", "Đăng ký gói", "Giờ vào", "Giờ ra", "Trạng thái"],
                visits.map((v) => [
                  v.member,
                  v.package,
                  v.time,
                  v.out,
                  v.status,
                ]),
                (i) =>
                  visits[i].status === "DANG_TAP" && (
                    <button onClick={() => handleCheckout(i)}>
                      Check-out
                    </button>
                  ),
              )}
            </section>
          )}
          {page === "booking" && (
            <>
              {(() => {
                const trainerList = getAvailableTrainers();
                if (trainerList.length === 0) {
                  return (
                    <section className="panel" style={{ padding: "32px", textAlign: "center" }}>
                      <p className="muted">
                        {role === "KHACH" ? "Chưa có huấn luyện viên tại chi nhánh đăng ký của bạn." : "Chưa có huấn luyện viên nào trong hệ thống. Quản lý chi nhánh hoặc Admin có thể thêm hoặc phân quyền huấn luyện viên."}
                      </p>
                    </section>
                  );
                }
                return (
                  <div className="trainers-cards-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "16px", marginBottom: "20px" }}>
                    {trainerList.map((tr) => (
                      <section className="booking-hero" key={tr.id} style={{ margin: 0 }}>
                        <div className="trainer-avatar">{tr.name.trim().split(" ").slice(-1)[0].slice(0, 2).toUpperCase()}</div>
                        <div>
                          <span className="eyebrow">PERSONAL TRAINER</span>
                          <h2>{tr.name}</h2>
                          <p>{tr.specialty} · {branchName(tr.branch || branch)}</p>
                          <Badge value={tr.status === "DANG_LAM" ? "SAN_SANG" : tr.status} />
                        </div>
                        <button className="primary" onClick={() => booking(tr.id)}>
                          + Đặt lịch PT
                        </button>
                      </section>
                    ))}
                  </div>
                );
              })()}
              <section className="panel">
                <div className="panel-top">
                  <h2>Lịch đặt huấn luyện viên</h2>
                  <span className="muted">Dữ liệu thời gian thực từ MongoDB</span>
                </div>
                {table(
                  [
                    "PT",
                    "Ngày",
                    "Bắt đầu",
                    "Kết thúc",
                    "Loại buổi",
                    "Hội viên",
                    "Trạng thái",
                  ],
                  bookingPageBookings.map((b) => [
                    b.pt,
                    b.date,
                    b.start,
                    b.end,
                    b.type,
                    b.members,
                    b.status,
                  ]),
                )}
              </section>
            </>
          )}
          {page === "reports" && (
            <>
              <div className="stats">
                {[
                  ["Doanh thu đã thu", money(paid)],
                  [
                    "Đơn đã thanh toán",
                    orders.filter((o) => o.status === "DA_THANH_TOAN").length,
                  ],
                  ["Tổng lượt vào tập", visits.length],
                  [
                    "Chi phí bảo trì",
                    money(
                      (data.maintenance || []).reduce(
                        (s, r) => s + (Number(r[3]) || 0),
                        0,
                      ),
                    ),
                  ],
                ].map(([t, n]) => (
                  <article key={t}>
                    <p>{t}</p>
                    <strong>{n}</strong>
                    <small>
                      {role === "ADMIN"
                        ? "Toàn hệ thống"
                        : "Chi nhánh " + branchName(currentUser?.branch || branch)}
                    </small>
                  </article>
                ))}
              </div>
              <section className="panel">
                <div className="panel-top">
                  <div>
                    <h2>Hiệu quả giao dịch</h2>
                    <p>Tổng hợp trực tiếp từ bảng đơn hàng và thanh toán trên MongoDB Atlas.</p>
                  </div>
                </div>
                {table(
                  ["Chỉ tiêu", "Giá trị"],
                  [
                    [
                      "Đơn chờ thanh toán",
                      orders.filter((o) => o.status === "CHO_THANH_TOAN")
                        .length + " đơn",
                    ],
                    [
                      "Đơn đã thanh toán",
                      orders.filter((o) => o.status === "DA_THANH_TOAN")
                        .length + " đơn",
                    ],
                    ["Tổng đã thu", money(paid)],
                  ],
                )}
              </section>
            </>
          )}
          {page === "history" && (
            <section className="panel">
              <div className="panel-top">
                <h2>Hành trình của bạn</h2>
                <span className="muted">Tài khoản {currentUser?.username || currentUser?.id || ""}</span>
              </div>
              <h3 className="subheading">Đơn hàng & thanh toán</h3>
              {table(
                ["Gói", "Thành tiền", "Trạng thái"],
                orders
                  .filter(
                    (o) =>
                      (currentUser?.id && o.member === currentUser.id) ||
                      (currentUser?.name && (o.memberName === currentUser.name || o.member === currentUser.name)) ||
                      (currentUser?.username && o.member === currentUser.username),
                  )
                  .map((o) => [o.name, money(o.total), o.status]),
              )}
              <h3 className="subheading">Gói đã đăng ký</h3>
              {table(
                ["Gói", "Ngày bắt đầu", "Thanh toán"],
                orders
                  .filter(
                    (o) =>
                      ((currentUser?.id && o.member === currentUser.id) ||
                        (currentUser?.name && (o.memberName === currentUser.name || o.member === currentUser.name)) ||
                        (currentUser?.username && o.member === currentUser.username)) &&
                      o.status === "DA_THANH_TOAN",
                  )
                  .map((o) => [o.name, o.start, o.status]),
              )}
              <h3 className="subheading">Lịch PT</h3>
              {table(
                ["PT", "Ngày", "Giờ", "Trạng thái"],
                bookings
                  .filter((b) =>
                    (b.members || "")
                      .split(",")
                      .map((s) => s.trim())
                      .some(
                        (m) =>
                          (currentUser?.name && m === currentUser.name) ||
                          (currentUser?.id && m === currentUser.id) ||
                          (currentUser?.username && m === currentUser.username),
                      ),
                  )
                  .map((b) => [b.pt, b.date, b.start, b.status]),
              )}
              <h3 className="subheading">Lịch sử vào tập</h3>
              {table(
                ["Giờ vào", "Giờ ra", "Trạng thái"],
                visits
                  .filter(
                    (v) =>
                      (currentUser?.id && v.memberId === currentUser.id) ||
                      (currentUser?.name && v.member === currentUser.name),
                  )
                  .map((v) => [v.time, v.out, v.status]),
              )}
            </section>
          )}
          {page === "profile" && (
            <section className="panel profile">
              <div className="profile-avatar">
                {(currentUser?.name || profile[0]).trim().split(" ").slice(-1)[0].slice(0, 1).toUpperCase()}
              </div>
              <h2>{currentUser?.name || profile[0]}</h2>
              <Badge value={role} />
              <dl>
                <dt>Email</dt>
                <dd>{currentUser?.email || profile[1]}</dd>
                <dt>Số điện thoại</dt>
                <dd>{currentUser?.phone || profile[2]}</dd>
                {role === "NHAN_VIEN" && (
                  <>
                    <dt>Chức danh</dt>
                    <dd>{currentUser?.title || "Lễ tân & CSKH"}</dd>
                    <dt>Chi nhánh làm việc</dt>
                    <dd>{branchName(currentUser?.branch || branch)}</dd>
                  </>
                )}
                {role === "HUAN_LUYEN_VIEN" && (
                  <>
                    <dt>Chuyên môn</dt>
                    <dd>{currentUser?.specialty || "Sức mạnh & thể hình"}</dd>
                    <dt>Giới thiệu</dt>
                    <dd>{currentUser?.bio || "Huấn luyện viên cá nhân"}</dd>
                    <dt>Chi nhánh</dt>
                    <dd>{branchName(currentUser?.branch || branch)}</dd>
                    {ownTrainerTransfer && <>
                      <dt>Yêu cầu chuyển chi nhánh</dt>
                      <dd>{branchName(ownTrainerTransfer.fromBranchId)} → {branchName(ownTrainerTransfer.toBranchId)} · {transferStatusLabels[ownTrainerTransfer.status] || ownTrainerTransfer.status}</dd>
                    </>}
                  </>
                )}
                {role === "QUAN_LY_CHI_NHANH" && (
                  <>
                    <dt>Vai trò</dt>
                    <dd>Quản lý chi nhánh</dd>
                    <dt>Chi nhánh phụ trách</dt>
                    <dd>{branchName(currentUser?.branch || branch)}</dd>
                  </>
                )}
                {role === "ADMIN" && (
                  <>
                    <dt>Vai trò</dt>
                    <dd>Quản trị viên hệ thống (Admin)</dd>
                    <dt>Phạm vi quản trị</dt>
                    <dd>Toàn hệ thống</dd>
                  </>
                )}
                {role === "KHACH" && (
                  <>
                    <dt>Chi nhánh đăng ký</dt>
                    <dd>{branchName(currentUser?.branch || branch)}</dd>
                  </>
                )}
              </dl>
              <button
                className="primary"
                onClick={openEditProfile}
              >
                Chỉnh sửa thông tin
              </button>
              {role !== "ADMIN" && (
                <button
                  className="secondary"
                  style={{ marginTop: "10px" }}
                  onClick={() => setChangePasswordModal(true)}
                >
                  Đổi mật khẩu
                </button>
              )}
            </section>
          )}
          <footer>
            GYM STATION <span>Nhóm 11 · Bài tập lớn Quản lý hệ thống Gym</span>
            <small>Đã kết nối cơ sở dữ liệu MongoDB Atlas (GymManagement)</small>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button aria-label="Đóng thông báo" onClick={() => setToast("")}>
            ×
          </button>
        </div>
      )}
      {liveModal && bookingModalIsCurrent && (
        <Modal
          modal={isBookingModal ? { ...liveModal, meta: { ...liveModal.meta, trainerChoices: availableTrainers.map((trainer) => ({ value: trainer.id, label: trainer.name })) } } : liveModal}
          branchChoices={getBranchChoices(records.branches)}
          close={() => setModal(null)}
          onSubmit={handleModalSubmit}
          notify={notify}
        />
      )}
      {changePasswordModal && (
        <ChangePasswordModal
          onClose={() => setChangePasswordModal(false)}
          onSubmit={handleChangePassword}
        />
      )}
      {addManagerModal && (
        <AddManagerModal
          branches={records.branches || []}
          onClose={() => setAddManagerModal(false)}
          onSubmit={handleAddManager}
        />
      )}
    </div>
  );
}

function Modal({ modal: m, close, onSubmit, notify, branchChoices = [] }) {
  const dialogRef = useRef(null);
  const [payMethod, setPayMethod] = useState(
    m.values && m.values[0] ? m.values[0] : "CHUYEN_KHOAN",
  );

  useEffect(() => {
    const prev = document.activeElement;
    const box = dialogRef.current;
    const selector = 'button,input,select,[tabindex="0"]';
    box?.querySelector(selector)?.focus();
    function trap(e) {
      if (e.key !== "Tab") return;
      const items = [...box.querySelectorAll(selector)];
      const first = items[0],
        last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    box?.addEventListener("keydown", trap);
    return () => {
      box?.removeEventListener("keydown", trap);
      prev?.focus();
    };
  }, []);

  function submit(e) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const values = m.fields.map((_, i) => formData.get("f" + i));
    if (m.meta?.type === "payment" && m.meta?.role === "KHACH") {
      values[0] = payMethod;
    }
    if (onSubmit) {
      onSubmit(values, m.meta);
    } else {
      notify("Đã lưu dữ liệu.");
      close();
    }
  }

  const isPayment = m.meta?.type === "payment";
  const isMemberPayment = isPayment && m.meta?.role === "KHACH";
  const isStaffPayment = isPayment && m.meta?.role !== "KHACH";
  const paymentOrder = m.meta?.order;

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className="modal"
        onKeyDown={(e) => e.key === "Escape" && close()}
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">GYM STATION</span>
            <h2 id="modal-title">{m.title}</h2>
          </div>
          <button onClick={close} aria-label="Đóng biểu mẫu">
            ×
          </button>
        </div>
        <p className="modal-note">{m.note}</p>
        <form onSubmit={submit}>
          <div className="form-grid">
            {m.fields.map((f, i) => {
              let choices =
                f === "Tên Hội Viên"
                  ? m.meta?.memberChoices || options[f]
                  : f === "Huấn luyện viên"
                    ? m.meta?.trainerChoices || options[f]
                    : options[f];
              if (f === "Trạng thái")
                choices =
                  m.id === "packages"
                    ? ["DANG_BAN", "NGUNG_BAN"]
                    : statuses[m.id] || options[f];
              if (f === "Chi nhánh") choices = branchChoices;
              if (f === "Chi nhánh" && m.id === "packages")
                choices = branchChoices.filter((choice) => choice.value === m.values[i]);
              if (f === "Chi nhánh" && m.meta?.type === "profile" && m.meta?.role === "HUAN_LUYEN_VIEN")
                choices = m.meta.branchChoices || [];
              if (f === "Phương thức" && isMemberPayment) {
                choices = ["CHUYEN_KHOAN", "TIEN_MAT"];
              }
              const type = f.includes("Mật khẩu")
                ? "password"
                : f === "Email"
                  ? "email"
                  : f.startsWith("Ngày")
                    ? "date"
                    : f.startsWith("Giờ")
                      ? "time"
                      : ["Giá", "Chi phí", "Thời hạn ngày"].includes(f)
                        ? "number"
                        : "text";
              return (
                <label key={f}>
                  {f}
                  {choices ? (
                    <select
                      key={f === "Chi nhánh" && m.meta?.type === "profile" ? m.meta.profileBranch : undefined}
                      name={"f" + i}
                      value={f === "Phương thức" && isMemberPayment ? payMethod : undefined}
                      defaultValue={f === "Phương thức" && isMemberPayment ? undefined : (m.values[i] || choices[0]?.value || choices[0])}
                      onChange={
                        f === "Phương thức" && isMemberPayment
                          ? (e) => setPayMethod(e.target.value)
                          : undefined
                      }
                    >
                      {choices.map((choice) => {
                        const value = typeof choice === "object" ? choice.value : choice;
                        const label = typeof choice === "object" ? choice.label : undefined;
                        return (
                        <option key={value} value={value}>
                          {label || labels[value] ||
                            roles[value] ||
                            {
                              TIEN_MAT: "Tiền mặt tại quầy",
                              CHUYEN_KHOAN: "Chuyển khoản (VietQR)",
                              GYM: "Gym",
                              GYM_PT: "Gym + PT",
                            }[value] ||
                            value}
                        </option>
                        );
                      })}
                    </select>
                  ) : (
                    <input
                      autoFocus={i === 0}
                      name={"f" + i}
                      defaultValue={m.values[i] || ""}
                      type={type}
                      min={f === "Thời hạn ngày" ? 1 : 0}
                      step={type === "number" ? 1 : undefined}
                    />
                  )}
                </label>
              );
            })}
          </div>

          {/* Member Payment: QR Code & Total Amount details */}
          {isMemberPayment && paymentOrder && (
            <div className="member-payment-details">
              {payMethod === "CHUYEN_KHOAN" ? (
                <>
                  <div className="qr-payment-amount-display">
                    <span className="qr-label">TỔNG TIỀN THANH TOÁN</span>
                    <span className="qr-amount">{money(paymentOrder.total)}</span>
                  </div>
                  <div className="qr-code-box">
                    <img
                      src="/qr-payment.jpg"
                      alt="Mã QR Chuyển khoản VietQR MB Bank"
                      className="qr-payment-image"
                    />
                  </div>
                  <div className="qr-bank-details">
                    <div className="qr-row">
                      <span>Ngân hàng:</span>
                      <b>MB Bank (Quân Đội)</b>
                    </div>
                    <div className="qr-row">
                      <span>Chủ tài khoản:</span>
                      <b>DINH BUU KHANG</b>
                    </div>
                    <div className="qr-row">
                      <span>Số tài khoản:</span>
                      <b>0816751719</b>
                    </div>
                    <div className="qr-row">
                      <span>Số tiền:</span>
                      <b className="highlight-green">{money(paymentOrder.total)}</b>
                    </div>
                    <div className="qr-row">
                      <span>Nội dung chuyển khoản:</span>
                      <b className="highlight-code">THANHTOAN {paymentOrder.id}</b>
                    </div>
                  </div>
                  <p className="qr-instruction">
                    Quét mã VietQR bằng ứng dụng ngân hàng và kiểm tra đúng số tiền <b>{money(paymentOrder.total)}</b>. Sau khi hoàn tất chuyển khoản, bấm nút bên dưới để gửi yêu cầu cho nhân viên đối soát và duyệt.
                  </p>
                </>
              ) : (
                <>
                  <div className="qr-payment-amount-display">
                    <span className="qr-label">TỔNG TIỀN THANH TOÁN</span>
                    <span className="qr-amount">{money(paymentOrder.total)}</span>
                  </div>
                  <p className="qr-instruction">
                    Vui lòng đến quầy lễ tân chi nhánh để thanh toán trực tiếp số tiền <b>{money(paymentOrder.total)}</b> cho nhân viên.
                  </p>
                </>
              )}
            </div>
          )}

          {/* Staff Payment: Review amount */}
          {isStaffPayment && paymentOrder && (
            <div className="staff-payment-review">
              <div className="qr-payment-amount-display">
                <span className="qr-label">SỐ TIỀN CẦN THU / ĐỐI SOÁT</span>
                <span className="qr-amount">{money(paymentOrder.total)}</span>
              </div>
              <p className="qr-instruction">
                Hội viên: <b>{paymentOrder.memberName || paymentOrder.member}</b> · Đơn hàng: <b>{paymentOrder.id}</b> ({paymentOrder.name})
              </p>
            </div>
          )}

          <div className="form-actions">
            <button type="button" onClick={close}>
              Hủy
            </button>
            {isMemberPayment ? (
              <button className="primary" type="submit">
                {payMethod === "CHUYEN_KHOAN"
                  ? "Tôi đã chuyển khoản - Gửi xác nhận"
                  : "Xác nhận thanh toán tại quầy"}
              </button>
            ) : isStaffPayment ? (
              <>
                <button
                  type="button"
                  className="btn-reject"
                  onClick={() => {
                    onSubmit(["CHUYEN_KHOAN", "KHONG"], { ...m.meta, approved: false });
                    close();
                  }}
                >
                  ✕ Không (Chưa nhận)
                </button>
                <button className="primary btn-approve" type="submit">
                  ✓ Có (Xác nhận đã nhận tiền)
                </button>
              </>
            ) : (
              <button className="primary" type="submit">
                {m.id === "login"
                  ? "Đăng nhập"
                  : m.id === "register"
                    ? "Đăng ký"
                    : "Xác nhận"}
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}

function ChangePasswordModal({ onClose, onSubmit }) {
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [err, setErr] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setErr("");
    if (newPw !== confirmPw) { setErr("Mật khẩu xác nhận không khớp."); return; }
    if (newPw.length < 4) { setErr("Mật khẩu mới phải có ít nhất 4 ký tự."); return; }
    const ok = await onSubmit(oldPw, newPw);
    if (!ok) setErr("Mật khẩu cũ không đúng hoặc có lỗi. Thử lại.");
  }

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="cpw-title" onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <div className="modal-header">
          <div>
            <span className="eyebrow">GYM STATION</span>
            <h2 id="cpw-title">Đổi mật khẩu</h2>
          </div>
          <button onClick={onClose} aria-label="Đóng">×</button>
        </div>
        <p className="modal-note">Nhập mật khẩu hiện tại và mật khẩu mới. Mật khẩu mới phải có ít nhất 4 ký tự.</p>
        {err && <p style={{ color: "var(--red, #e53935)", marginBottom: "8px", fontSize: "13px" }}>{err}</p>}
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <label>Mật khẩu hiện tại<input type="password" value={oldPw} onChange={e => setOldPw(e.target.value)} required autoFocus /></label>
            <label>Mật khẩu mới<input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} required /></label>
            <label>Xác nhận mật khẩu mới<input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} required /></label>
          </div>
          <div className="form-actions">
            <button type="button" onClick={onClose}>Hủy</button>
            <button className="primary" type="submit">Xác nhận đổi mật khẩu</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function AddManagerModal({ branches, onClose, onSubmit }) {
  const [form, setForm] = useState({ hoTen: "", email: "", soDienThoai: "", chiNhanhId: "", matKhau: "" });
  const [err, setErr] = useState("");
  const branchChoices = getRegistrationBranchChoices((branches || []).filter((branch) => branch.trangThai === "HOAT_DONG"));
  const selectedBranch = retainRegistrationBranch(form.chiNhanhId, branchChoices);

  function handleChange(e) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErr("");
    if (!form.hoTen || !form.email || !form.matKhau || !selectedBranch) {
      setErr("Vui lòng điền đầy đủ thông tin."); return;
    }
    await onSubmit({ ...form, chiNhanhId: selectedBranch });
  }

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="am-title" onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <div className="modal-header">
          <div>
            <span className="eyebrow">GYM STATION</span>
            <h2 id="am-title">Thêm quản lý chi nhánh</h2>
          </div>
          <button onClick={onClose} aria-label="Đóng">×</button>
        </div>
        <p className="modal-note">Tạo tài khoản mới với vai trò Quản lý chi nhánh. Tài khoản sẽ được lưu vào MongoDB Atlas.</p>
        {err && <p style={{ color: "var(--red, #e53935)", marginBottom: "8px", fontSize: "13px" }}>{err}</p>}
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <label>Họ và tên<input name="hoTen" value={form.hoTen} onChange={handleChange} required autoFocus placeholder="Nguyễn Văn A" /></label>
            <label>Email<input name="email" type="email" value={form.email} onChange={handleChange} required placeholder="manager@gymstation.vn" /></label>
            <label>Số điện thoại<input name="soDienThoai" value={form.soDienThoai} onChange={handleChange} placeholder="0901234567" /></label>
            <label>Chi nhánh phụ trách
              <select name="chiNhanhId" value={selectedBranch} onChange={handleChange} required disabled={!branchChoices.length}>
                <option value="">{branchChoices.length ? "-- Chọn chi nhánh --" : "Chưa có chi nhánh được tạo"}</option>
                {branchChoices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
              </select>
            </label>
            <label>Mật khẩu tạm thời<input name="matKhau" type="password" value={form.matKhau} onChange={handleChange} required placeholder="••••••••" /></label>
          </div>
          <div className="form-actions">
            <button type="button" onClick={onClose}>Hủy</button>
            <button className="primary" type="submit" disabled={!selectedBranch}>Tạo tài khoản</button>
          </div>
        </form>
      </section>
    </div>
  );
}
