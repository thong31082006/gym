import { useEffect, useRef, useState } from "react";
import { STORAGE_KEY, createInitialState, dayKey, getActiveSubscription, transition } from "./model.js";
import "./StaffWorkspace.css";
import Icon from "./StaffIcon.jsx";

const pages = [
  { id: "overview", label: "Tổng quan", icon: "overview" },
  { id: "checkin", label: "Check-in / Check-out", uc: "UC16", icon: "checkin" },
  { id: "members", label: "Hồ sơ hội viên", uc: "UC13", icon: "members" },
  { id: "packages", label: "Đăng ký / gia hạn gói", uc: "UC14", icon: "packages" },
  { id: "payments", label: "Thanh toán", uc: "UC15", icon: "payments" },
  { id: "booking", label: "Đặt lịch PT", uc: "UC18", icon: "booking" },
  { id: "appointments", label: "Quản lý lịch hẹn", uc: "UC19", icon: "appointments" },
  { id: "profile", label: "Thông tin cá nhân", uc: "UC03", icon: "profile" },
];
const navigationGroups = [
  { label: "Vận hành", ids: ["overview", "checkin", "members"] },
  { label: "Dịch vụ hội viên", ids: ["packages", "payments", "booking", "appointments"] },
  { label: "Tài khoản", ids: ["profile"] },
];
const titles = {
  overview: ["Tổng quan ca làm việc", "Theo dõi hội viên, thanh toán và lịch tập trong ngày."],
  members: ["Hồ sơ hội viên", "Tìm kiếm, tiếp nhận và cập nhật thông tin hội viên tại chi nhánh."],
  packages: ["Đăng ký & gia hạn gói", "Chọn gói phù hợp và tạo đơn đăng ký cho hội viên."],
  payments: ["Đơn hàng & thanh toán", "Đối soát khoản thu và kích hoạt gói tập sau khi thanh toán."],
  checkin: ["Check-in / Check-out", "Ghi nhận lượt vào, ra và kiểm tra hiệu lực gói tập."],
  booking: ["Đặt lịch huấn luyện", "Sắp xếp buổi tập cá nhân hoặc nhóm nhỏ cùng huấn luyện viên."],
  appointments: ["Quản lý lịch hẹn", "Xác nhận, điều chỉnh và theo dõi các buổi tập của hội viên."],
  profile: ["Thông tin cá nhân", "Cập nhật hồ sơ và mật khẩu tài khoản nhân viên của bạn."],
};
const statusLabels = {
  ACTIVE: "Hoạt động", INACTIVE: "Tạm ngưng", PENDING: "Chờ thanh toán", PAID: "Đã thanh toán",
  CANCELLED: "Đã hủy", CONFIRMED: "Đã xác nhận", COMPLETED: "Hoàn thành", EXPIRED: "Hết hạn",
};
const money = (value) => new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(value || 0);
const dateLabel = (value) => {
  if (!value) return "—";
  const date = new Date(String(value).length === 10 ? `${value}T12:00:00+07:00` : value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }).format(date) : "—";
};
const timeLabel = (value) => value && Number.isFinite(new Date(value).getTime()) ? new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(value)) : "—";
const normalize = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase();
const initialBooking = () => ({ trainerId: "", date: dayKey(), startTime: "08:00", endTime: "09:00", type: "INDIVIDUAL", memberIds: [], note: "" });

function readState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    const stringFields = {
      members: ["id", "name", "email", "phone", "branch", "status"],
      packages: ["id", "name", "type", "branch", "status"],
      subscriptions: ["id", "memberId", "packageId", "branch", "orderId", "startDate", "endDate", "status"],
      orders: ["id", "memberId", "subscriptionId", "packageId", "branch", "status", "kind", "createdAt"],
      visits: ["id", "memberId", "subscriptionId", "branch", "checkIn"],
      trainers: ["id", "name", "branch", "availableStart", "availableEnd"],
      appointments: ["id", "trainerId", "branch", "date", "startTime", "endTime", "type", "status"],
    };
    if (stored?.version === 1 && Object.entries(stringFields).every(([key, fields]) => Array.isArray(stored[key]) && stored[key].every((row) => row && fields.every((field) => typeof row[field] === "string"))) && stored.appointments.every((item) => Array.isArray(item.memberIds) && item.memberIds.every((id) => typeof id === "string")) && stored.orders.every((item) => Number.isFinite(new Date(item.createdAt).getTime()) && Number.isFinite(item.total)) && stored.visits.every((item) => Number.isFinite(new Date(item.checkIn).getTime()))) return stored;
  } catch { /* Khôi phục bộ dữ liệu mẫu nếu trình duyệt không đọc được dữ liệu cũ. */ }
  return createInitialState();
}

function Badge({ status, children }) {
  return <span className={`sw-badge sw-badge-${status?.toLowerCase()}`}><span className="sw-status-dot" aria-hidden="true" />{children || statusLabels[status] || status}</span>;
}

function Field({ label, children, wide = false }) {
  return <label className={`sw-field${wide ? " sw-wide" : ""}`}><span>{label}</span>{children}</label>;
}

function Empty({ title = "Chưa có dữ liệu phù hợp", description = "Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm." }) {
  return <div className="sw-empty"><span aria-hidden="true"><Icon name="search" size={32} /></span><h3>{title}</h3><p>{description}</p></div>;
}

function DataTable({ columns, rows, empty }) {
  const label = `Danh sách: ${columns.join(", ")}`;
  return <>
    <div className="sw-table-scroll" tabIndex={rows.length ? 0 : undefined} role="region" aria-label={label}>
      <table>
        <caption className="sw-sr-only">{label}</caption>
        <thead><tr>{columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id}>{row.cells.map((cell, index) => <td key={index}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
    {!rows.length && <Empty {...empty} />}
    {rows.length > 0 && <p className="sw-mobile-table-hint"><Icon name="arrowRight" size={16} />Vuốt ngang để xem đầy đủ bảng</p>}
  </>;
}

function Modal({ title, children, onClose, onSubmit, error, submitLabel = "Lưu thay đổi", wide, readOnly = false }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  useEffect(() => {
    const previous = document.activeElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    (ref.current?.querySelector("input, select, textarea") || ref.current?.querySelector("button"))?.focus();
    function keydown(event) {
      if (event.key === "Escape") closeRef.current();
      if (event.key === "Tab") {
        const elements = [...(ref.current?.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]') || [])];
        const first = elements[0], last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    document.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener("keydown", keydown);
      if (previous?.isConnected) previous.focus?.();
      else document.getElementById("staff-page-title")?.focus();
    };
  }, []);
  return <div className="sw-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={`sw-modal${wide ? " sw-modal-wide" : ""}`} ref={ref} role="dialog" aria-modal="true" aria-labelledby="sw-dialog-title"><div className="sw-modal-heading"><div><span className="sw-kicker">GYM STATION / NHÂN VIÊN</span><h2 id="sw-dialog-title">{title}</h2></div><button type="button" className="sw-icon-button" onClick={onClose} aria-label="Đóng hộp thoại"><Icon name="close" /></button></div><form onSubmit={onSubmit}>{children}{error && <p className="sw-error" role="alert">{error}</p>}<div className="sw-form-actions"><button type="button" onClick={onClose}>{readOnly ? "Đóng" : "Hủy bỏ"}</button>{!readOnly && <button className="sw-primary" type="submit">{submitLabel}</button>}</div></form></section></div>;
}

function BookingFields({ values, setValues, members, trainers, state }) {
  const eligible = members.filter((member) => {
    return member.status === "ACTIVE" && state.subscriptions.some((subscription) => subscription.memberId === member.id && subscription.status === "ACTIVE" && subscription.startDate <= values.date && subscription.endDate >= values.date && state.orders.some((order) => order.id === subscription.orderId && order.status === "PAID") && state.packages.find((item) => item.id === subscription.packageId)?.type === "GYM_PT");
  });
  const change = (key, value) => setValues({ ...values, [key]: value });
  return <>
    <div className="sw-form-grid">
      <Field label="Huấn luyện viên"><select name="trainerId" required value={values.trainerId} onChange={(event) => change("trainerId", event.target.value)}><option value="">Chọn huấn luyện viên</option>{trainers.map((trainer) => <option key={trainer.id} value={trainer.id}>{trainer.name}</option>)}</select></Field>
      <Field label="Ngày tập"><input name="date" type="date" required min={dayKey()} value={values.date} onChange={(event) => change("date", event.target.value)} /></Field>
      <Field label="Giờ bắt đầu"><input name="startTime" type="time" required value={values.startTime} onChange={(event) => change("startTime", event.target.value)} /></Field>
      <Field label="Giờ kết thúc"><input name="endTime" type="time" required value={values.endTime} onChange={(event) => change("endTime", event.target.value)} /></Field>
      <Field label="Hình thức buổi tập" wide><select name="type" value={values.type} onChange={(event) => setValues({ ...values, type: event.target.value, memberIds: [] })}><option value="INDIVIDUAL">Cá nhân · 1 hội viên</option><option value="GROUP">Nhóm nhỏ · 2–6 hội viên</option></select></Field>
      {values.type === "INDIVIDUAL" ? <Field label="Hội viên tham gia" wide><select name="memberId" required value={values.memberIds[0] || ""} onChange={(event) => change("memberIds", event.target.value ? [event.target.value] : [])}><option value="">Chọn hội viên có gói PT còn hiệu lực</option>{eligible.map((member) => <option key={member.id} value={member.id}>{member.id} · {member.name}</option>)}</select></Field> : <fieldset className="sw-member-picker sw-wide"><legend>Hội viên tham gia ({values.memberIds.length}/6)</legend><div>{eligible.map((member) => <label key={member.id}><input type="checkbox" name="memberIds" value={member.id} checked={values.memberIds.includes(member.id)} disabled={!values.memberIds.includes(member.id) && values.memberIds.length >= 6} onChange={(event) => change("memberIds", event.target.checked ? [...values.memberIds, member.id] : values.memberIds.filter((id) => id !== member.id))} /><span>{member.name}<small>{member.id} · {member.phone}</small></span></label>)}</div></fieldset>}
      {!eligible.length && <p className="sw-inline-note sw-wide">Chưa có hội viên đủ điều kiện PT vào ngày đã chọn. Kiểm tra gói Gym + PT và trạng thái thanh toán.</p>}
      <Field label="Ghi chú buổi tập" wide><textarea name="note" rows={3} maxLength={500} placeholder="Mục tiêu buổi tập, lưu ý sức khỏe…" value={values.note} onChange={(event) => change("note", event.target.value)} /></Field>
    </div>
    <p className="sw-inline-note">Hệ thống kiểm tra hiệu lực gói PT, giờ làm việc và lịch trùng của huấn luyện viên lẫn hội viên.</p>
  </>;
}

function ProfileForm({ user, onSave, notify }) {
  const [values, setValues] = useState({ name: user.name || "", email: user.email || "", phone: user.phone || "", currentPassword: "", newPassword: "", confirmPassword: "" });
  const [error, setError] = useState("");
  const change = (event) => { setError(""); setValues({ ...values, [event.target.name]: event.target.value }); };
  function submit(event) {
    event.preventDefault();
    try {
      onSave(values);
      setValues({ ...values, currentPassword: "", newPassword: "", confirmPassword: "" });
      setError(""); notify("Đã cập nhật thông tin cá nhân.");
    } catch (failure) { setError(failure.message); }
  }
  return <div className="sw-profile-layout"><section className="sw-panel sw-profile-card"><div className="sw-profile-avatar">{user.name?.trim().split(/\s+/).at(-1)?.[0] || "N"}</div><h2>{user.name}</h2><Badge status="ACTIVE">Nhân viên</Badge><dl><dt>Mã tài khoản</dt><dd>{user.id}</dd><dt>Chi nhánh</dt><dd>{user.branch || "CN001"}</dd><dt>Phạm vi làm việc</dt><dd>Hội viên và nghiệp vụ tại chi nhánh</dd></dl></section><section className="sw-panel"><div className="sw-section-heading"><div><h2>Hồ sơ của bạn</h2><p>Thông tin liên hệ dùng trong ca làm việc.</p></div><span className="sw-uc">UC03</span></div><form className="sw-padded-form" onSubmit={submit}><div className="sw-form-grid"><Field label="Họ và tên" wide><input name="name" required maxLength={100} value={values.name} onChange={change} autoComplete="name" /></Field><Field label="Email"><input name="email" inputMode="email" required value={values.email} onChange={change} autoComplete="email" /></Field><Field label="Số điện thoại"><input name="phone" type="tel" required value={values.phone} onChange={change} autoComplete="tel" /></Field></div><div className="sw-subsection"><h3>Đổi mật khẩu</h3><p>Để trống các ô bên dưới nếu bạn chỉ cập nhật hồ sơ.</p></div><div className="sw-form-grid"><Field label="Mật khẩu hiện tại" wide><input name="currentPassword" type="password" value={values.currentPassword} onChange={change} autoComplete="current-password" /></Field><Field label="Mật khẩu mới"><input name="newPassword" type="password" minLength={6} value={values.newPassword} onChange={change} autoComplete="new-password" /></Field><Field label="Nhập lại mật khẩu mới"><input name="confirmPassword" type="password" minLength={6} value={values.confirmPassword} onChange={change} autoComplete="new-password" /></Field></div>{error && <p role="alert" className="sw-error">{error}</p>}<div className="sw-form-actions"><button className="sw-primary" type="submit">Lưu thông tin cá nhân</button></div></form></section></div>;
}

export default function StaffWorkspace({ user, onProfileSave, onLogout }) {
  const [state, setState] = useState(readState);
  const [page, setPage] = useState("overview");
  const [mobile, setMobile] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [modal, setModal] = useState(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [storageError, setStorageError] = useState("");
  const [checkinMember, setCheckinMember] = useState("");
  const [checkinError, setCheckinError] = useState("");
  const [bookingDraft, setBookingDraft] = useState(initialBooking);
  const [bookingError, setBookingError] = useState("");
  const [compact, setCompact] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches);
  const navigationRef = useRef(null);
  const titleRef = useRef(null);
  const previousPage = useRef("overview");
  const branch = user.branch || "CN001";
  const today = dayKey();
  const members = state.members.filter((item) => item.branch === branch);
  const packages = state.packages.filter((item) => item.branch === branch && item.status === "ACTIVE");
  const orders = state.orders.filter((item) => item.branch === branch);
  const subscriptions = state.subscriptions.filter((item) => item.branch === branch);
  const visits = state.visits.filter((item) => item.branch === branch);
  const trainers = state.trainers.filter((item) => item.branch === branch);
  const appointments = state.appointments.filter((item) => item.branch === branch);
  const memberName = (id) => members.find((item) => item.id === id)?.name || id;
  const packageName = (id) => packages.find((item) => item.id === id)?.name || state.packages.find((item) => item.id === id && item.branch === branch)?.name || id;
  const trainerName = (id) => trainers.find((item) => item.id === id)?.name || id;
  const matches = (...values) => normalize(values.join(" ")).includes(normalize(query));
  const pendingOrders = orders.filter((item) => item.status === "PENDING");
  const openVisits = visits.filter((item) => !item.checkOut);
  const todayAppointments = appointments.filter((item) => item.date === today && item.status !== "CANCELLED");
  const currentPage = pages.find((item) => item.id === page);
  const modalIsOpen = Boolean(modal);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); setStorageError(""); }
    catch { setStorageError("Trình duyệt không cho phép lưu dữ liệu. Các thay đổi hiện chỉ được giữ trong phiên đang mở."); }
  }, [state]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 6000); return () => clearTimeout(timer); }, [toast]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    function resize() { setCompact(media.matches); if (!media.matches) setMobile(false); }
    resize();
    media.addEventListener("change", resize);
    return () => media.removeEventListener("change", resize);
  }, []);

  useEffect(() => {
    if (previousPage.current !== page && !modalIsOpen) titleRef.current?.focus();
    previousPage.current = page;
  }, [page, modalIsOpen]);

  useEffect(() => {
    if (!mobile || !compact) return;
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    navigationRef.current?.querySelector(".sw-menu-close")?.focus();
    function handleKey(event) {
      if (event.key === "Escape") setMobile(false);
      if (event.key !== "Tab") return;
      const buttons = [...navigationRef.current.querySelectorAll("button:not([disabled]), a[href]")];
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", handleKey);
      // Preserve the new page heading's focus when a navigation item was chosen.
      if (document.activeElement !== titleRef.current) previous?.focus?.();
    };
  }, [mobile, compact]);

  function navigate(nextPage) { setPage(nextPage); setMobile(false); setQuery(""); setStatusFilter(""); setDateFilter(nextPage === "checkin" ? today : ""); setCheckinError(""); }
  function open(kind, values = {}) { setError(""); setModal({ kind, ...values }); }
  function close() { setModal(null); setError(""); }
  function run(type, payload, errorSetter = setError) {
    try {
      const result = transition(state, { type, payload }, { branch, actorId: user.id, role: "NHAN_VIEN" });
      setState(result.state); errorSetter(""); setToast(result.message); return true;
    } catch (failure) { errorSetter(failure.message || "Không thể thực hiện thao tác. Vui lòng kiểm tra lại."); return false; }
  }
  function openOrder(packageId, kind = "NEW", memberId = "") { open("order", { values: { packageId: packageId || packages[0]?.id || "", memberId, kind, startDate: today } }); }
  function orderForMember(memberId) { navigate("packages"); openOrder(undefined, "NEW", memberId); }
  function updateModalValues(nextValues) { setError(""); setModal((previous) => ({ ...previous, values: nextValues })); }
  function submitModal(event) {
    event.preventDefault();
    let action, payload = modal.values;
    if (modal.kind === "member") action = "SAVE_MEMBER";
    if (modal.kind === "order") action = "CREATE_ORDER";
    if (modal.kind === "payment") { action = "PAY_ORDER"; payload = { ...payload, amount: Number(payload.amount) }; }
    if (modal.kind === "cancelOrder") { action = "CANCEL_ORDER"; payload = { id: modal.id, reason: payload.reason }; }
    if (modal.kind === "editAppointment") action = "UPDATE_APPOINTMENT";
    if (modal.kind === "cancelAppointment") { action = "CANCEL_APPOINTMENT"; payload = { id: modal.id, reason: payload.reason }; }
    if (action && run(action, payload)) { close(); if (action === "CREATE_ORDER") navigate("payments"); }
  }
  function modalField(name, extra = {}) { return { name, value: modal.values[name] ?? "", onChange: (event) => updateModalValues({ ...modal.values, [name]: event.target.value }), ...extra }; }
  function appointmentActions(item) {
    const active = ["PENDING", "CONFIRMED"].includes(item.status);
    const canComplete = item.status === "CONFIRMED" && new Date(`${item.date}T${item.startTime}:00+07:00`).getTime() <= Date.now();
    return <div className="sw-row-actions">{item.status === "PENDING" && <button aria-label={`Xác nhận lịch ${item.id}`} onClick={() => run("CONFIRM_APPOINTMENT", { id: item.id }, setToast)}>Xác nhận</button>}{active && <button aria-label={`Đổi lịch ${item.id}`} onClick={() => open("editAppointment", { values: { ...item, memberIds: [...item.memberIds] } })}>Đổi lịch</button>}{canComplete && <button aria-label={`Hoàn thành lịch ${item.id}`} onClick={() => run("COMPLETE_APPOINTMENT", { id: item.id }, setToast)}>Hoàn thành</button>}{active && <button className="sw-text-danger" aria-label={`Hủy lịch ${item.id}`} onClick={() => open("cancelAppointment", { id: item.id, values: { reason: "" } })}>Hủy lịch</button>}{!active && <span className="sw-muted">{item.cancelReason || "Đã kết thúc"}</span>}</div>;
  }
  function appointmentsTable(items) {
    return <DataTable columns={["Buổi tập", "Hội viên", "Huấn luyện viên", "Hình thức", "Trạng thái", "Thao tác"]} rows={items.map((item) => ({ id: item.id, cells: [<div><strong>{dateLabel(item.date)}</strong><small>{item.startTime} – {item.endTime} · {item.id}</small></div>, <div>{item.memberIds.map(memberName).join(", ")}<small>{item.memberIds.length} hội viên</small></div>, trainerName(item.trainerId), item.type === "GROUP" ? "Nhóm nhỏ" : "Cá nhân", <Badge status={item.status}>{item.status === "PENDING" ? "Chờ xác nhận" : undefined}</Badge>, appointmentActions(item)] }))} empty={{ title: "Chưa có lịch hẹn", description: "Đặt buổi tập mới hoặc chọn bộ lọc khác." }} />;
  }

  function renderOverview() {
    const collected = orders.filter((item) => item.status === "PAID" && item.paidAt && dayKey(new Date(item.paidAt)) === today).reduce((sum, item) => sum + item.total, 0);
    const filteredPendingOrders = pendingOrders.filter((order) => matches(order.id, memberName(order.memberId), packageName(order.packageId), String(order.total)));
    const filteredAppointments = [...todayAppointments].filter((item) => matches(item.id, trainerName(item.trainerId), item.memberIds.map(memberName).join(" "), item.type, item.status)).sort((a, b) => a.startTime.localeCompare(b.startTime));
    const quickActions = [
      ["members", "members", "Thêm hội viên", "Tiếp nhận hồ sơ mới"],
      ["packages", "packages", "Đăng ký gói", "Tư vấn và tạo đơn"],
      ["booking", "booking", "Đặt lịch PT", "Cá nhân hoặc nhóm nhỏ"],
      ["checkin", "checkin", "Check-in", "Ghi nhận lượt tập"],
    ].filter(([target, icon, label, detail]) => matches(target, icon, label, detail));
    const stats = [
      ["Hội viên tại chi nhánh", members.length, "Xem và cập nhật hồ sơ", "members", "members"],
      ["Đang trong phòng tập", openVisits.length, "Theo dõi lượt vào / ra", "checkin", "checkin"],
      ["Đơn chờ thanh toán", pendingOrders.length, `${money(pendingOrders.reduce((sum, item) => sum + item.total, 0))} cần đối soát`, "payments", "receipt"],
      ["Đã thu hôm nay", money(collected), "Các khoản đã xác nhận", "payments", "wallet"],
    ];
    const addMember = () => open("member", { values: { name: "", email: "", phone: "", status: "ACTIVE", note: "" } });
    return <>
      <section className="sw-welcome" aria-label="Bắt đầu ca làm">
        <div className="sw-welcome-copy">
          <span className="sw-welcome-tag"><Icon name="location" size={16} />QUẦY LỄ TÂN · {branch}</span>
          <h2>Chào {user.name?.replace(/^Nhân viên\s+/i, "") || "bạn"}, sẵn sàng cho ca làm?</h2>
          <p>Tiếp nhận hội viên, xử lý dịch vụ và theo dõi lịch tập trong một không gian.</p>
          <div className="sw-welcome-actions">
            <button className="sw-primary" onClick={() => navigate("checkin")}><Icon name="checkin" />Check-in hội viên<Icon name="arrowRight" size={16} /></button>
            <button onClick={addMember}><Icon name="plus" size={16} />Thêm hội viên</button>
          </div>
        </div>
        <div className="sw-welcome-summary">
          <span className="sw-kicker">TÌNH HÌNH TẠI QUẦY</span>
          <div className="sw-welcome-metrics">
            <div className="sw-metric-item"><Icon name="checkin" /><strong>{openVisits.length.toString().padStart(2, "0")}</strong><small>Hội viên đang tập</small></div>
            <div className="sw-metric-item"><Icon name="appointments" /><strong>{todayAppointments.length.toString().padStart(2, "0")}</strong><small>Lịch tập hôm nay</small></div>
          </div>
        </div>
      </section>

      <div className="sw-stats" aria-label="Thống kê ca làm">
        {stats.map(([label, value, detail, target, icon]) => (
          <button className="sw-stat" key={label} onClick={() => navigate(target)}>
            <span className="sw-stat-icon"><Icon name={icon} /></span>
            <span>{label}</span>
            <strong className={typeof value === "string" ? "sw-stat-value-currency" : undefined}>{value}</strong>
            <small>{detail}<Icon name="arrowUpRight" size={16} /></small>
          </button>
        ))}
      </div>

      <div className="sw-dashboard-grid">
        <section className="sw-panel">
          <div className="sw-section-heading">
            <div><h2>Ưu tiên xử lý <span className="sw-count">{pendingOrders.length}</span></h2><p>Đơn hàng đang chờ xác nhận thanh toán</p></div>
            <button className="sw-link" onClick={() => navigate("payments")}>Xem tất cả<Icon name="arrowRight" size={16} /></button>
          </div>
          {filteredPendingOrders.length ? <div className="sw-task-list">
            {filteredPendingOrders.slice(0, 4).map((order) => (
              <div key={order.id}>
                <span className="sw-task-symbol"><Icon name="receipt" /></span>
                <div><strong>{memberName(order.memberId)}</strong><small>{order.id} · {packageName(order.packageId)}</small></div>
                <b>{money(order.total)}</b>
                <button aria-label={`Thu tiền đơn ${order.id}`} onClick={() => open("payment", { values: { id: order.id, amount: order.total, method: "CASH", reference: "" } })}>Thu tiền</button>
              </div>
            ))}
          </div> : <Empty title={query ? "Không có đơn hàng phù hợp" : "Đã xử lý hết đơn hàng"} description={query ? "Thử đổi từ khóa tìm kiếm khác để xem đơn chờ thanh toán." : "Bạn đã hoàn tất các đơn cần đối soát. Đơn mới sẽ xuất hiện tại đây."} />}
        </section>

        <section className="sw-panel">
          <div className="sw-section-heading"><div><h2>Thao tác nhanh</h2><p>Các công việc thường dùng tại quầy</p></div></div>
          <div className="sw-quick-grid">
            {quickActions.length ? quickActions.map(([target, icon, label, detail]) => (
              <button key={target} onClick={() => { navigate(target); if (target === "members") addMember(); }}>
                <span><Icon name={icon} size={24} /></span><Icon name="arrowUpRight" size={16} className="sw-quick-arrow" />
                <strong>{label}</strong><small>{detail}</small>
              </button>
            )) : <div className="sw-empty sw-full"><span aria-hidden="true"><Icon name="search" size={28} /></span><h3>Không có thao tác phù hợp</h3><p>Thử từ khóa khác hoặc xóa tìm kiếm để xem các lệnh nhanh.</p></div>}
          </div>
        </section>
      </div>

      <section className="sw-panel">
        <div className="sw-section-heading">
          <div><h2>Lịch tập hôm nay <span className="sw-count">{todayAppointments.length}</span></h2><p>{dateLabel(today)} · Lịch huấn luyện tại chi nhánh</p></div>
          <button className="sw-link" onClick={() => navigate("appointments")}>Quản lý lịch hẹn<Icon name="arrowRight" size={16} /></button>
        </div>
        {filteredAppointments.length ? appointmentsTable(filteredAppointments) : <Empty title={query ? "Không có lịch tập phù hợp" : "Chưa có lịch tập"} description={query ? "Thử đổi từ khóa tìm kiếm hoặc xóa bộ lọc." : "Chưa có buổi tập nào được lên lịch cho hôm nay."} />}
      </section>
    </>;
  }

  function renderMembers() {
    const shown = members.filter((member) => (!statusFilter || member.status === statusFilter) && matches(member.id, member.name, member.email, member.phone));
    return <section className="sw-panel"><div className="sw-section-heading"><div><h2>Danh sách hội viên <span className="sw-count">{members.length}</span></h2><p>Thông tin và tình trạng gói tập tại {branch}</p></div><button className="sw-primary" onClick={() => open("member", { values: { name: "", email: "", phone: "", status: "ACTIVE", note: "" } })}>+ Thêm hội viên</button></div><div className="sw-filter-bar"><span>{shown.length} hội viên phù hợp</span><label><span className="sw-sr-only">Lọc trạng thái hội viên</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">Tất cả trạng thái</option><option value="ACTIVE">Hoạt động</option><option value="INACTIVE">Tạm ngưng</option></select></label></div><DataTable columns={["Hội viên", "Thông tin liên hệ", "Gói tập hiện tại", "Trạng thái", "Thao tác"]} rows={shown.map((member) => {
      const subscription = getActiveSubscription(state, member.id);
      return { id: member.id, cells: [<div className="sw-person"><span>{member.name?.trim().split(/\s+/).at(-1)?.[0]}</span><div><strong>{member.name}</strong><small>{member.id}</small></div></div>, <div>{member.phone}<small>{member.email}</small></div>, subscription ? <div>{packageName(subscription.packageId)}<small>Đến {dateLabel(subscription.endDate)}</small></div> : <span className="sw-muted">Chưa có gói còn hiệu lực</span>, <Badge status={member.status} />, <div className="sw-row-actions"><button aria-label={`Xem hồ sơ ${member.name}`} onClick={() => open("memberDetails", { id: member.id })}>Chi tiết</button><button aria-label={`Sửa hội viên ${member.name}`} onClick={() => open("member", { values: { ...member } })}>Chỉnh sửa</button><button aria-label={`Đăng ký gói cho ${member.name}`} onClick={() => orderForMember(member.id)}>Đăng ký gói</button></div>] };
    })} /></section>;
  }

  function renderPackages() {
    const shown = subscriptions.filter((item) => matches(item.id, memberName(item.memberId), packageName(item.packageId)));
    return <><div className="sw-process-note"><span aria-hidden="true"><Icon name="info" size={24} /></span><div><strong>Chọn gói → Tạo đơn → Xác nhận thanh toán</strong><p>Gói chỉ được kích hoạt sau khi nhân viên xác nhận đã thu đủ tiền.</p></div></div><div className="sw-package-grid">{packages.map((item) => <article className={`sw-package${item.type === "GYM_PT" ? " sw-package-featured" : ""}`} key={item.id}><div className="sw-package-heading"><span>{item.type === "GYM_PT" ? "GYM + PERSONAL TRAINER" : "GYM MEMBERSHIP"}</span><Badge status="ACTIVE">{item.days} ngày</Badge></div><span className="sw-package-symbol" aria-hidden="true"><Icon name={item.type === "GYM_PT" ? "dumbbell" : "packages"} size={32} /></span><h2>{item.name}</h2><p>{item.type === "GYM_PT" ? "Kết hợp tập luyện và hướng dẫn chuyên môn cùng PT." : "Linh hoạt luyện tập và sử dụng thiết bị tại chi nhánh."}</p><div className="sw-package-price">{money(item.price)}<small>/ {item.days} ngày</small></div><ul><li>Áp dụng tại {branch}</li><li>Check-in trong thời gian gói còn hiệu lực</li>{item.type === "GYM_PT" && <li>{item.ptSessions || "Các"} buổi tập cùng PT</li>}</ul><button className="sw-primary" aria-label={`Đăng ký ${item.name}`} onClick={() => openOrder(item.id)}>Đăng ký gói</button><button className="sw-link" aria-label={`Gia hạn ${item.name}`} onClick={() => openOrder(item.id, "RENEW")}>Gia hạn gói hiện có →</button></article>)}</div><section className="sw-panel"><div className="sw-section-heading"><div><h2>Gói tập đã đăng ký</h2><p>Theo dõi thời hạn và trạng thái của từng đăng ký</p></div></div><DataTable columns={["Mã đăng ký", "Hội viên", "Gói tập", "Thời hạn", "Trạng thái"]} rows={shown.map((item) => ({ id: item.id, cells: [item.id, memberName(item.memberId), packageName(item.packageId), <div>{dateLabel(item.startDate)}<small>đến {dateLabel(item.endDate)}</small></div>, <Badge status={item.status === "ACTIVE" && item.endDate < today ? "EXPIRED" : item.status}>{item.status === "PENDING" ? "Chờ thanh toán" : item.status === "ACTIVE" && item.startDate > today ? "Chưa đến ngày hiệu lực" : item.status === "ACTIVE" && item.endDate >= today ? "Còn hiệu lực" : undefined}</Badge>] }))} /></section></>;
  }

  function renderPayments() {
    const shown = orders.filter((order) => (!statusFilter || order.status === statusFilter) && (!dateFilter || dayKey(new Date(order.createdAt)) === dateFilter) && matches(order.id, memberName(order.memberId), packageName(order.packageId))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return <><div className="sw-summary-line"><div><span>Chờ thanh toán</span><strong>{money(pendingOrders.reduce((sum, item) => sum + item.total, 0))}</strong><small>{pendingOrders.length} đơn hàng cần xử lý</small></div><div><span>Đã thu tại chi nhánh</span><strong>{money(orders.filter((item) => item.status === "PAID").reduce((sum, item) => sum + item.total, 0))}</strong><small>{orders.filter((item) => item.status === "PAID").length} đơn hàng đã thanh toán</small></div></div><section className="sw-panel"><div className="sw-section-heading"><div><h2>Đơn hàng</h2><p>Chọn “Thu tiền” khi đã nhận và đối soát đủ số tiền.</p></div><button onClick={() => navigate("packages")}>+ Tạo đơn đăng ký</button></div><div className="sw-filter-bar"><span>{shown.length} đơn hàng phù hợp</span><div><label><span className="sw-sr-only">Lọc ngày tạo đơn</span><input aria-label="Lọc ngày tạo đơn" type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} /></label><label><span className="sw-sr-only">Lọc trạng thái thanh toán</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">Tất cả trạng thái</option><option value="PENDING">Chờ thanh toán</option><option value="PAID">Đã thanh toán</option><option value="CANCELLED">Đã hủy</option></select></label>{(statusFilter || dateFilter) && <button className="sw-link" onClick={() => { setStatusFilter(""); setDateFilter(""); }}>Xóa bộ lọc</button>}</div></div><DataTable columns={["Đơn hàng", "Hội viên / Gói tập", "Loại đơn", "Tổng tiền", "Trạng thái", "Thao tác"]} rows={shown.map((order) => ({ id: order.id, cells: [<div><strong>{order.id}</strong><small>{dateLabel(order.createdAt)}</small></div>, <div>{memberName(order.memberId)}<small>{packageName(order.packageId)}</small></div>, order.kind === "RENEW" ? "Gia hạn" : "Đăng ký mới", <strong>{money(order.total)}</strong>, <Badge status={order.status} />, <div className="sw-row-actions">{order.status === "PENDING" ? <><button aria-label={`Thu tiền ${order.id}`} onClick={() => open("payment", { values: { id: order.id, amount: order.total, method: "CASH", reference: "" } })}>Thu tiền</button><button className="sw-text-danger" aria-label={`Hủy đơn ${order.id}`} onClick={() => open("cancelOrder", { id: order.id, values: { reason: "" } })}>Hủy đơn</button></> : order.status === "PAID" ? <button aria-label={`Xem phiếu thu ${order.id}`} onClick={() => open("receipt", { id: order.id })}>Xem phiếu thu</button> : <span className="sw-muted">Đã hủy</span>}</div>] }))} /></section></>;
  }

  function renderCheckin() {
    const member = members.find((item) => item.id === checkinMember);
    const subscription = member && getActiveSubscription(state, member.id);
    const eligibleMembers = members.filter((item) => item.status === "ACTIVE" && (getActiveSubscription(state, item.id) || subscriptions.some((s) => s.memberId === item.id) || orders.some((o) => o.memberId === item.id && o.status === "PAID")));
    const shown = visits.filter((item) => (!dateFilter || dayKey(new Date(item.checkIn)) === dateFilter) && (!statusFilter || (statusFilter === "OPEN" ? !item.checkOut : item.checkOut)) && matches(item.id, item.memberId, memberName(item.memberId))).sort((a, b) => b.checkIn.localeCompare(a.checkIn));
    return <><div className="sw-checkin-layout"><section className="sw-panel sw-checkin-form"><div className="sw-section-heading"><div><h2>Tiếp nhận lượt tập</h2><p>Chỉ hội viên có gói đang hiệu lực được check-in.</p></div><span className="sw-task-symbol"><Icon name="checkin" size={24} /></span></div><form className="sw-padded-form" onSubmit={(event) => { event.preventDefault(); run("CHECK_IN", { memberId: checkinMember }, setCheckinError); }}><Field label="Tên Hội Viên"><select name="memberId" required value={checkinMember} onChange={(event) => { setCheckinMember(event.target.value); setCheckinError(""); }}><option value="">Chọn tên hội viên đã mua gói</option>{eligibleMembers.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.phone}</option>)}</select></Field>{member && <div className="sw-checkin-preview"><strong>{member.name}</strong><small>{member.id} · {member.phone}</small><hr />{subscription ? <><Badge status="ACTIVE">Gói còn hiệu lực</Badge><p>{packageName(subscription.packageId)}<br />Đến ngày {dateLabel(subscription.endDate)}</p></> : <><Badge status="EXPIRED">Chưa có gói còn hiệu lực</Badge><p>Kiểm tra thanh toán hoặc đăng ký gói mới trước khi check-in.</p></>}</div>}{checkinError && <p className="sw-error" role="alert">{checkinError}</p>}<button className="sw-primary sw-full" type="submit">Xác nhận check-in</button></form></section><section className="sw-occupancy"><span className="sw-kicker">HIỆN TẠI / {branch}</span><strong>{openVisits.length}<small>hội viên đang tập</small></strong><div><span>{visits.filter((item) => dayKey(new Date(item.checkIn)) === today).length}</span> lượt đến trong ngày</div><p>Ghi nhận check-out khi hội viên kết thúc buổi tập. Mỗi hội viên chỉ có một lượt tập đang mở.</p></section></div><section className="sw-panel"><div className="sw-section-heading"><div><h2>Nhật ký vào / ra</h2><p>Thời gian được ghi nhận theo múi giờ Việt Nam</p></div></div><div className="sw-filter-bar"><span>{shown.length} lượt tập phù hợp</span><div><input aria-label="Lọc ngày check-in" type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} /><select aria-label="Lọc trạng thái lượt tập" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">Tất cả lượt tập</option><option value="OPEN">Đang tập</option><option value="CLOSED">Đã check-out</option></select><button className="sw-link" onClick={() => { setDateFilter(""); setStatusFilter(""); }}>Xem tất cả</button></div></div><DataTable columns={["Hội viên", "Ngày", "Giờ vào", "Giờ ra", "Trạng thái", "Thao tác"]} rows={shown.map((item) => ({ id: item.id, cells: [<div><strong>{memberName(item.memberId)}</strong><small>{item.memberId} · {item.id}</small></div>, dateLabel(item.checkIn), timeLabel(item.checkIn), timeLabel(item.checkOut), <Badge status={item.checkOut ? "COMPLETED" : "ACTIVE"}>{item.checkOut ? "Đã check-out" : "Đang tập"}</Badge>, !item.checkOut ? <button aria-label={`Check-out ${memberName(item.memberId)}`} onClick={() => run("CHECK_OUT", { id: item.id }, setToast)}>Check-out</button> : <span className="sw-muted">Đã ghi nhận</span>] }))} /></section></>;
  }

  function renderBooking() {
    return <div className="sw-booking-layout"><section className="sw-panel"><div className="sw-section-heading"><div><h2>Tạo lịch tập mới</h2><p>Chọn thời gian và hội viên tham gia buổi tập</p></div><span className="sw-uc">UC18</span></div><form className="sw-padded-form" onSubmit={(event) => { event.preventDefault(); if (run("CREATE_APPOINTMENT", bookingDraft, setBookingError)) { setBookingDraft(initialBooking()); navigate("appointments"); } }}><BookingFields values={bookingDraft} setValues={(values) => { setBookingDraft(values); setBookingError(""); }} members={members} trainers={trainers} state={state} />{bookingError && <p className="sw-error" role="alert">{bookingError}</p>}<div className="sw-form-actions"><button type="submit" className="sw-primary">Xác nhận đặt lịch</button></div></form></section><aside className="sw-booking-aside"><div className="sw-section-heading"><div><h2>Đội ngũ huấn luyện</h2><p>Huấn luyện viên tại {branch}</p></div></div>{trainers.map((trainer) => <article key={trainer.id} className="sw-trainer"><span className="sw-trainer-avatar">{trainer.name.trim().split(/\s+/).slice(-2).map((word) => word[0]).join("")}</span><div><h3>{trainer.name}</h3><p>{trainer.specialty}</p><small>Giờ làm việc: {trainer.availableStart} – {trainer.availableEnd}</small></div><button className="sw-link" aria-label={`Chọn PT ${trainer.name}`} onClick={() => setBookingDraft({ ...bookingDraft, trainerId: trainer.id })}>{bookingDraft.trainerId === trainer.id ? "Đã chọn ✓" : "Chọn PT →"}</button></article>)}<div className="sw-info-card"><span aria-hidden="true"><Icon name="info" size={24} /></span><h3>Đúng gói, đúng lịch</h3><p>Buổi cá nhân dành cho 1 hội viên. Nhóm nhỏ cần từ 2–6 hội viên, mỗi người có gói PT còn hiệu lực vào ngày tập.</p><p>Lịch mới sẽ chờ xác nhận trong mục Quản lý lịch hẹn.</p><button className="sw-link" onClick={() => navigate("appointments")}>Xem lịch hẹn hiện có →</button></div></aside></div>;
  }

  function renderAppointments() {
    const shown = appointments.filter((item) => (!statusFilter || item.status === statusFilter) && (!dateFilter || item.date === dateFilter) && matches(item.id, trainerName(item.trainerId), item.memberIds.map(memberName).join(" "))).sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));
    return <><div className="sw-appointment-stats">{[["Chờ xác nhận", "PENDING"], ["Đã xác nhận", "CONFIRMED"], ["Đã hoàn thành", "COMPLETED"]].map(([label, value]) => <button key={value} className={statusFilter === value ? "sw-selected" : ""} onClick={() => setStatusFilter(statusFilter === value ? "" : value)}><span>{label}</span><strong>{appointments.filter((item) => item.status === value).length}</strong></button>)}</div><section className="sw-panel"><div className="sw-section-heading"><div><h2>Danh sách lịch hẹn</h2><p>Chỉ hoàn thành buổi tập đã xác nhận và đã đến giờ bắt đầu.</p></div><button className="sw-primary" onClick={() => navigate("booking")}>+ Đặt lịch mới</button></div><div className="sw-filter-bar"><span>{shown.length} lịch hẹn phù hợp</span><div><input aria-label="Lọc ngày lịch hẹn" type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} /><select aria-label="Lọc trạng thái lịch hẹn" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">Tất cả trạng thái</option><option value="PENDING">Chờ xác nhận</option><option value="CONFIRMED">Đã xác nhận</option><option value="COMPLETED">Hoàn thành</option><option value="CANCELLED">Đã hủy</option></select>{(dateFilter || statusFilter) && <button className="sw-link" onClick={() => { setDateFilter(""); setStatusFilter(""); }}>Xóa bộ lọc</button>}</div></div>{appointmentsTable(shown)}</section></>;
  }

  function renderModal() {
    if (!modal) return null;
    const common = { onClose: close, onSubmit: submitModal, error };
    if (modal.kind === "member") return <Modal {...common} title={modal.values.id ? "Cập nhật hồ sơ hội viên" : "Tiếp nhận hội viên mới"} submitLabel={modal.values.id ? "Lưu hồ sơ" : "Thêm hội viên"}><div className="sw-form-grid"><Field label="Họ và tên" wide><input {...modalField("name", { required: true, maxLength: 100 })} placeholder="Nguyễn Văn An" /></Field><Field label="Email"><input {...modalField("email", { required: true, type: "email" })} placeholder="hoivien@example.com" /></Field><Field label="Số điện thoại"><input {...modalField("phone", { required: true, type: "tel" })} placeholder="0901234567" /></Field><Field label="Trạng thái" wide><select {...modalField("status")}><option value="ACTIVE">Hoạt động</option><option value="INACTIVE">Tạm ngưng</option></select></Field><Field label="Ghi chú" wide><textarea {...modalField("note", { rows: 3, maxLength: 500 })} placeholder="Thông tin cần lưu ý khi hỗ trợ hội viên" /></Field></div><p className="sw-inline-note">Hồ sơ thuộc chi nhánh {branch}. Tạo hồ sơ không đồng thời tạo tài khoản đăng nhập.</p></Modal>;
    if (modal.kind === "order") {
      const selectedPackage = packages.find((item) => item.id === modal.values.packageId);
      return <Modal {...common} title={modal.values.kind === "RENEW" ? "Gia hạn gói tập" : "Đăng ký gói tập"} submitLabel="Tạo đơn chờ thanh toán"><div className="sw-form-grid"><Field label="Hội viên" wide><select {...modalField("memberId", { required: true })}><option value="">Chọn hội viên</option>{members.filter((item) => item.status === "ACTIVE").map((item) => <option key={item.id} value={item.id}>{item.id} · {item.name} · {item.phone}</option>)}</select></Field><Field label="Gói tập" wide><select {...modalField("packageId", { required: true })}><option value="">Chọn gói tập</option>{packages.map((item) => <option key={item.id} value={item.id}>{item.name} · {money(item.price)}</option>)}</select></Field><Field label="Loại đăng ký"><select {...modalField("kind")}><option value="NEW">Đăng ký mới</option><option value="RENEW">Gia hạn gói hiện có</option></select></Field><Field label="Ngày bắt đầu mong muốn"><input {...modalField("startDate", { type: "date", required: true, min: today })} /></Field></div>{selectedPackage && <div className="sw-order-summary"><span>{selectedPackage.name} · {selectedPackage.days} ngày</span><strong>{money(selectedPackage.price)}</strong></div>}<p className="sw-inline-note">{modal.values.kind === "RENEW" ? "Nếu ngày chọn trùng thời hạn gói cũ cùng loại, gói gia hạn sẽ bắt đầu từ ngày kế tiếp sau khi gói cũ kết thúc. " : ""}Đơn mới ở trạng thái chờ thanh toán. Tiếp tục thu tiền tại mục Thanh toán để kích hoạt gói.</p></Modal>;
    }
    if (modal.kind === "payment") {
      const order = orders.find((item) => item.id === modal.values.id);
      const subscription = subscriptions.find((item) => item.id === order.subscriptionId);
      return <Modal {...common} title="Xác nhận thu tiền" submitLabel="Xác nhận đã thu đủ tiền"><div className="sw-receipt-summary"><span>ĐƠN HÀNG {order.id}</span><h3>{memberName(order.memberId)}</h3><p>{packageName(order.packageId)}</p>{subscription && <p>Thời hạn: {dateLabel(subscription.startDate)} – {dateLabel(subscription.endDate)}</p>}<strong>{money(order.total)}</strong></div><div className="sw-form-grid"><Field label="Phương thức thu tiền"><select {...modalField("method")}><option value="CASH">Tiền mặt</option><option value="TRANSFER">Chuyển khoản</option></select></Field><Field label="Số tiền thực nhận (đ)"><input {...modalField("amount", { required: true, type: "number", min: 0, step: 1 })} /></Field><Field label={modal.values.method === "TRANSFER" ? "Mã giao dịch chuyển khoản" : "Mã tham chiếu / ghi chú (nếu có)"} wide><input {...modalField("reference", { required: modal.values.method === "TRANSFER", maxLength: 100 })} placeholder={modal.values.method === "TRANSFER" ? "Nhập mã giao dịch đã đối soát" : "Ví dụ: thu tại quầy lễ tân"} /></Field></div><p className="sw-inline-note">Chỉ xác nhận khi đã thu và đối soát đủ tiền. Thao tác cập nhật phiếu thu và kích hoạt gói tập trong bản demo.</p></Modal>;
    }
    if (["cancelOrder", "cancelAppointment"].includes(modal.kind)) return <Modal {...common} title={modal.kind === "cancelOrder" ? `Hủy đơn ${modal.id}` : `Hủy lịch ${modal.id}`} submitLabel={modal.kind === "cancelOrder" ? "Xác nhận hủy đơn" : "Xác nhận hủy lịch"}><p className="sw-inline-note">{modal.kind === "cancelOrder" ? "Đơn bị hủy sẽ không được thanh toán hay kích hoạt gói." : "Lịch bị hủy sẽ không còn giữ khung giờ của huấn luyện viên và hội viên."}</p><Field label="Lý do hủy"><textarea {...modalField("reason", { required: true, rows: 3, maxLength: 500 })} placeholder="Nhập lý do để lưu lại khi tra cứu" /></Field></Modal>;
    if (modal.kind === "editAppointment") return <Modal {...common} wide title={`Điều chỉnh lịch ${modal.values.id}`} submitLabel="Lưu lịch hẹn"><BookingFields values={modal.values} setValues={updateModalValues} members={members} trainers={trainers} state={state} /></Modal>;
    if (modal.kind === "receipt") {
      const order = orders.find((item) => item.id === modal.id);
      const subscription = subscriptions.find((item) => item.id === order.subscriptionId);
      return <Modal {...common} readOnly title="Phiếu xác nhận thanh toán"><div className="sw-receipt-summary"><span>{order.id} · {branch}</span><h3>{memberName(order.memberId)}</h3><Badge status="PAID" /><strong>{money(order.total)}</strong></div><dl className="sw-detail-list"><dt>Gói tập</dt><dd>{packageName(order.packageId)}</dd><dt>Loại đơn</dt><dd>{order.kind === "RENEW" ? "Gia hạn" : "Đăng ký mới"}</dd><dt>Phương thức</dt><dd>{order.method === "TRANSFER" ? "Chuyển khoản" : "Tiền mặt"}</dd><dt>Thời điểm thu</dt><dd>{dateLabel(order.paidAt)} · {timeLabel(order.paidAt)}</dd><dt>Mã tham chiếu</dt><dd>{order.reference || "—"}</dd>{subscription && <><dt>Thời hạn gói</dt><dd>{dateLabel(subscription.startDate)} – {dateLabel(subscription.endDate)}</dd></>}</dl></Modal>;
    }
    if (modal.kind === "memberDetails") {
      const member = members.find((item) => item.id === modal.id);
      const memberSubscriptions = subscriptions.filter((item) => item.memberId === member.id);
      return <Modal {...common} wide readOnly title={`Hồ sơ ${member.name}`}><dl className="sw-detail-list"><dt>Mã hội viên</dt><dd>{member.id}</dd><dt>Email</dt><dd>{member.email}</dd><dt>Số điện thoại</dt><dd>{member.phone}</dd><dt>Trạng thái</dt><dd><Badge status={member.status} /></dd><dt>Chi nhánh</dt><dd>{branch}</dd><dt>Ghi chú</dt><dd>{member.note || "Chưa có ghi chú"}</dd></dl><h3 className="sw-detail-heading">Lịch sử đăng ký gói</h3><DataTable columns={["Gói tập", "Thời hạn", "Trạng thái"]} rows={memberSubscriptions.map((item) => ({ id: item.id, cells: [packageName(item.packageId), `${dateLabel(item.startDate)} – ${dateLabel(item.endDate)}`, <Badge status={item.status === "ACTIVE" && item.endDate < today ? "EXPIRED" : item.status}>{item.status === "ACTIVE" && item.startDate > today ? "Chưa đến ngày hiệu lực" : item.status === "ACTIVE" && item.endDate >= today ? "Còn hiệu lực" : undefined}</Badge>] }))} empty={{ title: "Chưa đăng ký gói tập", description: "Tạo đơn đăng ký để bắt đầu hỗ trợ hội viên này." }} /><div className="sw-member-detail-stats"><span><strong>{visits.filter((item) => item.memberId === member.id).length}</strong> lượt tập đã ghi nhận</span><span><strong>{appointments.filter((item) => item.memberIds.includes(member.id) && item.status !== "CANCELLED").length}</strong> buổi PT đã đặt</span></div></Modal>;
    }
    return null;
  }

  return (
    <div className="staff-workspace">
      <a className="sw-skip-link" href="#staff-main-content">Bỏ qua menu, đến nội dung</a>
      {mobile && compact && <button className="sw-nav-backdrop" tabIndex={-1} aria-label="Đóng menu điều hướng" onClick={() => setMobile(false)} />}
      <aside id="staff-navigation" ref={navigationRef}
        className={"sw-sidebar" + (mobile ? " sw-sidebar-open" : "")}
        inert={compact && !mobile} aria-hidden={compact && !mobile ? true : undefined}
        aria-label="Điều hướng Nhân viên">
        <button className="sw-brand" onClick={() => navigate("overview")} aria-label="Gym Station, về tổng quan">
          <span><Icon name="dumbbell" size={28} /></span>
          <div className="sw-brand-copy">GYM STATION<small>Không gian nhân viên</small></div>
        </button>
        <button className="sw-menu-close" aria-label="Đóng menu" onClick={() => setMobile(false)}><Icon name="close" /></button>
        <div className="sw-branch"><Icon name="location" size={24} /><div>Chi nhánh {branch}<small>Quầy lễ tân & dịch vụ</small></div><i aria-hidden="true" /></div>
        <nav aria-label="Chức năng nhân viên">
          {navigationGroups.map((group) => (
            <div className="sw-nav-group" key={group.label}>
              <div className="sw-nav-group-label">{group.label}</div>
              {group.ids.map((id) => {
                const item = pages.find((entry) => entry.id === id);
                return <button key={id} className={page === id ? "sw-nav-active" : ""}
                  aria-current={page === id ? "page" : undefined} onClick={() => navigate(id)}>
                  <span><Icon name={item.icon} /></span><b>{item.label}</b>
                </button>;
              })}
            </div>
          ))}
        </nav>
        <div className="sw-sidebar-bottom">
          <button className="sw-user" onClick={() => navigate("profile")}>
            <span>{user.name?.trim().split(/\s+/).at(-1)?.[0] || "N"}</span>
            <div><strong>{user.name}</strong><small>Nhân viên · {branch}</small></div>
            <Icon name="arrowUpRight" size={16} />
          </button>
        </div>
      </aside>

      <div className="sw-main-shell">
        <header className="sw-topbar">
          <button className="sw-menu-button" aria-label="Mở menu điều hướng" aria-expanded={mobile && compact}
            aria-controls="staff-navigation" onClick={() => setMobile(true)}><Icon name="menu" /></button>
          <div className="sw-topbar-context"><small>Không gian nhân viên</small><strong>{currentPage.label}</strong></div>
          <div className="sw-topbar-end">
            <span className="sw-current-branch"><Icon name="location" size={16} />{branch}</span>
            <button className="sw-top-avatar" aria-label="Mở hồ sơ cá nhân" onClick={() => navigate("profile")}>
              {user.name?.trim().split(/\s+/).at(-1)?.[0] || "N"}
            </button>
            <button className="sw-logout sw-topbar-logout" onClick={onLogout}><Icon name="logout" size={18} />Đăng xuất</button>
          </div>
        </header>
        <div className="sw-demo-strip"><span><Icon name="info" size={16} />Bản demo · Dữ liệu lưu trên trình duyệt</span><span>Phạm vi làm việc: {branch}</span></div>
        {storageError && <p className="sw-storage-warning" role="alert"><Icon name="alert" />{storageError}</p>}
        <main className="sw-main" id="staff-main-content" tabIndex={-1}>
          <div className="sw-page-heading">
            <div><span className="sw-kicker">GYM STATION{currentPage.uc ? " / " + currentPage.uc : " / NHÂN VIÊN"}</span>
              <h1 id="staff-page-title" ref={titleRef} tabIndex={-1}>{titles[page][0]}</h1><p>{titles[page][1]}</p>
            </div>
            <div className="sw-date-card">
              <span className="sw-date-icon"><Icon name="appointments" /></span>
              <div>
                <span>{new Intl.DateTimeFormat("vi-VN", { weekday: "long", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date())}</span>
              </div>
            </div>
          </div>
          {! ["booking", "profile"].includes(page) && (
            <div className="sw-searchbar"><Icon name="search" />
              <input aria-label="Tìm kiếm trong trang"
                placeholder={page === "overview" ? "Tìm mã, tên hội viên, gói hoặc lịch tập…" : page === "members" ? "Tìm mã hội viên, họ tên, email hoặc số điện thoại…" : "Tìm theo mã, tên hội viên hoặc nội dung…"}
                value={query} onChange={(event) => setQuery(event.target.value)} />
              {query && <button className="sw-icon-button" aria-label="Xóa tìm kiếm" onClick={() => setQuery("")}><Icon name="close" size={16} /></button>}
            </div>
          )}
          <section className="sw-main-content" key={page} aria-label={currentPage.label}>
            {page === "overview" && renderOverview()}
            {page === "members" && renderMembers()}
            {page === "packages" && renderPackages()}
            {page === "payments" && renderPayments()}
            {page === "checkin" && renderCheckin()}
            {page === "booking" && renderBooking()}
            {page === "appointments" && renderAppointments()}
            {page === "profile" && <ProfileForm user={user} onSave={onProfileSave} notify={setToast} />}
          </section>
          <footer className="sw-footer"><strong>GYM STATION</strong><span>Đồng hành cùng mỗi buổi tập.</span><small>Nhóm 11 · Tác nhân Nhân viên</small></footer>
        </main>
      </div>
      {renderModal()}
      {toast && <div className="sw-toast" role="status"><Icon name="info" /><span>{toast}</span><button aria-label="Đóng thông báo" onClick={() => setToast("")}><Icon name="close" size={18} /></button></div>}
    </div>
  );
}
