// Browser-local demonstration data. These rules do not replace server authorization.
export const STORAGE_KEY = "gym_staff_workspace_v1";

export function dayKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(now));
  const value = (type) => parts.find((part) => part.type === type).value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

const fail = (message) => { throw new Error(message); };
const clean = (value) => String(value ?? "").trim();
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) &&
  new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
const validTime = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const timestamp = (date, time) => new Date(`${date}T${time}:00+07:00`).getTime();
const addDays = (date, amount) => {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + amount);
  return result.toISOString().slice(0, 10);
};
const newId = (rows, prefix) => `${prefix}${String(Math.max(0, ...rows.map((row) =>
  Number(String(row.id).replace(/^\D+/, "")) || 0)) + 1).padStart(3, "0")}`;
const scoped = (rows, id, branch, label) => {
  const row = rows.find((item) => item.id === id && item.branch === branch);
  if (!row) fail(`${label} không tồn tại tại chi nhánh của bạn.`);
  return row;
};
const paidSubscriptions = (state, memberId) => state.subscriptions.filter((subscription) =>
  subscription.memberId === memberId && subscription.status === "ACTIVE" &&
  state.orders.some((order) => order.id === subscription.orderId && order.status === "PAID"));

export function getActiveSubscription(state, memberId, date = dayKey()) {
  return paidSubscriptions(state, memberId)
    .filter((subscription) => subscription.startDate <= date && subscription.endDate >= date)
    .sort((a, b) => b.endDate.localeCompare(a.endDate))[0] || null;
}

function activeMember(state, id, branch) {
  const member = scoped(state.members, id, branch, "Hội viên");
  if (member.status !== "ACTIVE") fail(`Hồ sơ ${member.name} đang tạm ngưng.`);
  return member;
}

function appointmentSubscriptions(state, appointment, branch, ignoreId = null) {
  const subscriptionIds = {};
  for (const memberId of appointment.memberIds) {
    const member = activeMember(state, memberId, branch);
    const eligible = paidSubscriptions(state, memberId)
      .filter((subscription) => subscription.branch === branch &&
        subscription.startDate <= appointment.date && subscription.endDate >= appointment.date &&
        state.packages.some((pack) => pack.id === subscription.packageId && pack.type === "GYM_PT"))
      .sort((a, b) => a.endDate.localeCompare(b.endDate));
    if (!eligible.length) fail(`${member.name} chưa có gói Gym + PT đã thanh toán còn hiệu lực vào ngày tập.`);
    const available = eligible.find((subscription) => {
      const reserved = state.appointments.filter((item) => item.id !== ignoreId && item.status !== "CANCELLED" &&
        item.memberIds.includes(memberId) &&
        (item.subscriptionIds?.[memberId] === subscription.id ||
          (!item.subscriptionIds?.[memberId] && item.date >= subscription.startDate && item.date <= subscription.endDate))).length;
      return reserved < Number(subscription.ptSessions || 0);
    });
    if (!available) fail(`${member.name} đã dùng hoặc đặt hết số buổi PT của gói.`);
    subscriptionIds[memberId] = available.id;
  }
  return subscriptionIds;
}

function validateAppointment(state, payload, branch, now, ignoreId = null) {
  const trainer = scoped(state.trainers, payload.trainerId, branch, "Huấn luyện viên");
  const date = clean(payload.date), startTime = clean(payload.startTime), endTime = clean(payload.endTime);
  if (!validDate(date) || !validTime(startTime) || !validTime(endTime)) fail("Ngày và giờ tập không hợp lệ.");
  if (startTime >= endTime) fail("Giờ kết thúc phải sau giờ bắt đầu.");
  if (timestamp(date, startTime) <= new Date(now).getTime()) fail("Vui lòng chọn lịch tập trong tương lai.");
  if (startTime < trainer.availableStart || endTime > trainer.availableEnd) {
    fail(`PT ${trainer.name} nhận lịch từ ${trainer.availableStart} đến ${trainer.availableEnd}.`);
  }
  const memberIds = Array.isArray(payload.memberIds) ? payload.memberIds.map(clean) : [];
  if (new Set(memberIds).size !== memberIds.length) fail("Danh sách hội viên không được trùng nhau.");
  if (payload.type !== "INDIVIDUAL" && payload.type !== "GROUP") fail("Loại buổi tập không hợp lệ.");
  if (payload.type === "INDIVIDUAL" && memberIds.length !== 1) fail("Buổi cá nhân cần đúng 1 hội viên.");
  if (payload.type === "GROUP" && (memberIds.length < 2 || memberIds.length > 6)) fail("Buổi nhóm cần từ 2 đến 6 hội viên.");
  const candidate = { trainerId: trainer.id, memberIds, branch, date, startTime, endTime,
    type: payload.type, note: clean(payload.note) };
  const clash = state.appointments.find((appointment) => appointment.id !== ignoreId && appointment.status !== "CANCELLED" &&
    appointment.date === date && appointment.startTime < endTime && appointment.endTime > startTime &&
    (appointment.trainerId === trainer.id || appointment.memberIds.some((id) => memberIds.includes(id))));
  if (clash) fail("Trùng lịch huấn luyện viên hoặc hội viên. Vui lòng chọn khung giờ khác.");
  return { ...candidate, subscriptionIds: appointmentSubscriptions(state, candidate, branch, ignoreId) };
}

export function transition(original, action, context, now = new Date()) {
  if (context?.role !== "NHAN_VIEN" || !context.branch) fail("Chỉ nhân viên được thực hiện thao tác này.");
  const state = structuredClone(original), { branch, actorId } = context;
  const { type, payload = {} } = action;
  const today = dayKey(now), isoNow = new Date(now).toISOString();
  let message;
  switch (type) {
    case "SAVE_MEMBER": {
      const existing = payload.id ? scoped(state.members, payload.id, branch, "Hội viên") : null;
      const name = clean(payload.name), email = clean(payload.email).toLowerCase();
      const phone = clean(payload.phone).replace(/[\s().-]/g, "");
      if (name.length < 2 || name.length > 100) fail("Họ tên cần từ 2 đến 100 ký tự.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("Email hội viên không hợp lệ.");
      if (!/^(0\d{9}|\+84\d{9})$/.test(phone)) fail("Số điện thoại cần 10 chữ số bắt đầu bằng 0 hoặc dạng +84.");
      const canonicalPhone = (value) => value.replace(/^\+84/, "0");
      if (state.members.some((member) => member.id !== existing?.id &&
        (member.email.toLowerCase() === email || canonicalPhone(member.phone) === canonicalPhone(phone)))) {
        fail("Email hoặc số điện thoại đã được dùng cho hội viên khác.");
      }
      const status = payload.status || existing?.status || "ACTIVE";
      if (!["ACTIVE", "INACTIVE"].includes(status)) fail("Trạng thái hội viên không hợp lệ.");
      if (status === "INACTIVE" && state.visits.some((visit) => visit.memberId === existing?.id && !visit.checkOut)) {
        fail("Hội viên đang tập. Vui lòng check-out trước khi tạm ngưng hồ sơ.");
      }
      const values = { name, email, phone, status, note: clean(payload.note), branch };
      if (existing) Object.assign(existing, values);
      else state.members.push({ id: newId(state.members, "HV"), ...values });
      message = existing ? "Đã cập nhật hồ sơ hội viên." : "Đã thêm hồ sơ hội viên.";
      break;
    }
    case "CREATE_ORDER": {
      const member = activeMember(state, payload.memberId, branch);
      const pack = scoped(state.packages, payload.packageId, branch, "Gói tập");
      if (pack.status !== "ACTIVE") fail("Gói tập đang ngừng bán.");
      if (!["NEW", "RENEW"].includes(payload.kind)) fail("Vui lòng chọn đăng ký mới hoặc gia hạn.");
      let startDate = clean(payload.startDate);
      if (!validDate(startDate) || startDate < today) fail("Ngày bắt đầu phải hợp lệ và từ hôm nay trở đi.");
      if (state.orders.some((order) => order.memberId === member.id && order.status === "PENDING" &&
        state.packages.find((item) => item.id === order.packageId)?.type === pack.type)) {
        fail("Hội viên đang có đơn cùng loại gói chờ thanh toán. Vui lòng xử lý đơn đó trước.");
      }
      const existing = paidSubscriptions(state, member.id).filter((sub) =>
        state.packages.find((item) => item.id === sub.packageId)?.type === pack.type);
      if (payload.kind === "RENEW") {
        if (!existing.length) fail("Hội viên chưa từng mua loại gói này. Vui lòng chọn đăng ký mới.");
        const latestEnd = existing.map((sub) => sub.endDate).sort().at(-1);
        if (startDate <= latestEnd) startDate = addDays(latestEnd, 1);
      }
      const endDate = addDays(startDate, Number(pack.days) - 1);
      if (existing.some((sub) => sub.startDate <= endDate && sub.endDate >= startDate)) {
        fail("Thời gian gói mới trùng với gói đã thanh toán. Vui lòng chọn gia hạn hoặc ngày khác.");
      }
      const orderId = newId(state.orders, "DH"), subscriptionId = newId(state.subscriptions, "DK");
      state.subscriptions.push({ id: subscriptionId, memberId: member.id, packageId: pack.id, branch,
        orderId, startDate, endDate, status: "PENDING", ptSessions: Number(pack.ptSessions || 0) });
      state.orders.push({ id: orderId, memberId: member.id, subscriptionId, packageId: pack.id, branch,
        total: pack.price, status: "PENDING", kind: payload.kind, createdAt: isoNow,
        paidAt: null, method: null, reference: "", createdBy: actorId });
      message = `Đã tạo đơn ${orderId}. Gói chỉ có hiệu lực sau khi xác nhận thanh toán.`;
      break;
    }
    case "PAY_ORDER": {
      const order = scoped(state.orders, payload.id, branch, "Đơn hàng");
      if (order.status !== "PENDING") fail("Chỉ được thanh toán đơn đang chờ. Đơn này đã được xử lý.");
      activeMember(state, order.memberId, branch);
      if (!["CASH", "TRANSFER"].includes(payload.method)) fail("Vui lòng chọn phương thức thanh toán hợp lệ.");
      if (!Number.isFinite(Number(payload.amount)) || Number(payload.amount) !== Number(order.total)) {
        fail("Số tiền xác nhận phải bằng đúng tổng tiền của đơn hàng.");
      }
      if (payload.method === "TRANSFER" && !clean(payload.reference)) fail("Vui lòng nhập mã tham chiếu chuyển khoản đã đối soát.");
      const subscription = scoped(state.subscriptions, order.subscriptionId, branch, "Đăng ký gói");
      if (subscription.endDate < today) fail("Gói trong đơn đã hết hạn. Vui lòng hủy đơn và tạo lại với ngày mới.");
      const pack = scoped(state.packages, order.packageId, branch, "Gói tập");
      if (paidSubscriptions(state, order.memberId).some((sub) => sub.id !== subscription.id &&
        state.packages.find((item) => item.id === sub.packageId)?.type === pack.type &&
        sub.startDate <= subscription.endDate && sub.endDate >= subscription.startDate)) {
        fail("Gói trong đơn trùng thời gian với gói đã thanh toán.");
      }
      Object.assign(order, { status: "PAID", paidAt: isoNow, method: payload.method,
        reference: clean(payload.reference), paidBy: actorId });
      subscription.status = "ACTIVE";
      message = `Đã ghi nhận thanh toán ${order.id} và kích hoạt gói tập.`;
      break;
    }
    case "CANCEL_ORDER": {
      const order = scoped(state.orders, payload.id, branch, "Đơn hàng");
      if (order.status !== "PENDING") fail("Chỉ có thể hủy đơn đang chờ thanh toán.");
      if (!clean(payload.reason)) fail("Vui lòng nhập lý do hủy đơn.");
      order.status = "CANCELLED";
      order.cancelReason = clean(payload.reason);
      scoped(state.subscriptions, order.subscriptionId, branch, "Đăng ký gói").status = "CANCELLED";
      message = `Đã hủy đơn ${order.id}.`;
      break;
    }
    case "CHECK_IN": {
      const member = activeMember(state, payload.memberId, branch);
      if (state.visits.some((visit) => visit.memberId === member.id && !visit.checkOut)) {
        fail("Hội viên đã check-in và chưa check-out.");
      }
      const subscription = getActiveSubscription(state, member.id, today);
      if (!subscription || subscription.branch !== branch) fail("Hội viên chưa có gói đã thanh toán còn hiệu lực hôm nay.");
      state.visits.push({ id: newId(state.visits, "LT"), memberId: member.id, subscriptionId: subscription.id,
        branch, checkIn: isoNow, checkOut: null, checkInBy: actorId });
      message = `Đã check-in cho ${member.name}.`;
      break;
    }
    case "CHECK_OUT": {
      const visit = scoped(state.visits, payload.id, branch, "Lượt tập");
      if (visit.checkOut) fail("Lượt tập này đã check-out.");
      if (new Date(visit.checkIn).getTime() > new Date(now).getTime()) fail("Giờ check-out không thể trước giờ check-in.");
      Object.assign(visit, { checkOut: isoNow, checkOutBy: actorId });
      message = "Đã check-out hội viên.";
      break;
    }
    case "CREATE_APPOINTMENT": {
      const values = validateAppointment(state, payload, branch, now);
      state.appointments.push({ id: newId(state.appointments, "LH"), ...values,
        status: "PENDING", createdAt: isoNow, createdBy: actorId, cancelReason: "" });
      message = "Đã đặt lịch PT, đang chờ xác nhận.";
      break;
    }
    case "UPDATE_APPOINTMENT": {
      const appointment = scoped(state.appointments, payload.id, branch, "Lịch hẹn");
      if (!["PENDING", "CONFIRMED"].includes(appointment.status)) fail("Lịch đã hoàn thành hoặc đã hủy không thể chỉnh sửa.");
      if (timestamp(appointment.date, appointment.startTime) <= new Date(now).getTime()) fail("Không thể sửa lịch đã bắt đầu.");
      const values = validateAppointment(state, payload, branch, now, appointment.id);
      Object.assign(appointment, values, { status: "PENDING", updatedAt: isoNow });
      message = "Đã cập nhật lịch hẹn. Vui lòng xác nhận lại lịch mới.";
      break;
    }
    case "CONFIRM_APPOINTMENT": {
      const appointment = scoped(state.appointments, payload.id, branch, "Lịch hẹn");
      if (appointment.status !== "PENDING") fail("Chỉ xác nhận lịch đang chờ xử lý.");
      const values = validateAppointment(state, appointment, branch, now, appointment.id);
      Object.assign(appointment, values, { status: "CONFIRMED", confirmedAt: isoNow });
      message = "Đã xác nhận lịch hẹn.";
      break;
    }
    case "COMPLETE_APPOINTMENT": {
      const appointment = scoped(state.appointments, payload.id, branch, "Lịch hẹn");
      if (appointment.status !== "CONFIRMED") fail("Chỉ hoàn thành lịch đã xác nhận.");
      if (timestamp(appointment.date, appointment.startTime) > new Date(now).getTime()) fail("Buổi tập chưa bắt đầu, chưa thể đánh dấu hoàn thành.");
      Object.assign(appointment, { status: "COMPLETED", completedAt: isoNow });
      message = "Đã hoàn thành buổi tập PT.";
      break;
    }
    case "CANCEL_APPOINTMENT": {
      const appointment = scoped(state.appointments, payload.id, branch, "Lịch hẹn");
      if (!["PENDING", "CONFIRMED"].includes(appointment.status)) fail("Lịch đã hoàn thành hoặc đã hủy không thể hủy tiếp.");
      if (!clean(payload.reason)) fail("Vui lòng nhập lý do hủy lịch.");
      Object.assign(appointment, { status: "CANCELLED", cancelReason: clean(payload.reason), cancelledAt: isoNow });
      message = "Đã hủy lịch hẹn và trả lại số buổi PT đã giữ chỗ.";
      break;
    }
    default: fail("Thao tác không được hỗ trợ.");
  }
  return { state, message };
}

export function createInitialState(now = new Date()) {
  const isoNow = new Date(now).toISOString();
  return {
    version: 1,
    createdAt: isoNow,
    members: [],
    packages: [],
    subscriptions: [],
    orders: [],
    visits: [],
    trainers: [],
    appointments: [],
  };
}
