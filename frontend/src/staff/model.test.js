import test from "node:test";
import assert from "node:assert/strict";
import { createInitialState, dayKey, getActiveSubscription, transition } from "./model.js";

const now = new Date("2026-11-08T03:00:00.000Z"); // 10:00 in Vietnam.
const context = { role: "NHAN_VIEN", branch: "CN001", actorId: "staff-test" };
const seed = () => createInitialState(now);
const run = (state, type, payload, at = now, scope = context) => transition(state, { type, payload }, scope, at).state;
const appointment = (extra = {}) => ({ memberIds: ["HV004"], trainerId: "PT001", date: "2026-11-09",
  startTime: "10:00", endTime: "11:00", type: "INDIVIDUAL", note: "Buổi kiểm tra", ...extra });

test("Vietnam calendar day is independent of the machine timezone", () => {
  assert.equal(dayKey(new Date("2026-11-08T18:01:00Z")), "2026-11-09");
});

test("member records are saved immutably, normalized, and scoped to employee branch", () => {
  const original = seed();
  const next = run(original, "SAVE_MEMBER", { name: "  Đặng Thanh Tâm ", email: "TAM@example.com",
    phone: "0912 345 678", note: "Tư vấn gói", branch: "CN002" });
  assert.equal(original.members.length, 6);
  const member = next.members.at(-1);
  assert.equal(member.name, "Đặng Thanh Tâm");
  assert.equal(member.email, "tam@example.com");
  assert.equal(member.phone, "0912345678");
  assert.equal(member.branch, "CN001");
  assert.throws(() => run(next, "SAVE_MEMBER", { ...member, id: undefined, email: "other@example.com", phone: "+84912345678" }), /đã được dùng/);
  assert.throws(() => run(next, "SAVE_MEMBER", { ...member, id: "HV006" }), /chi nhánh/);
});

test("invalid member contact and deactivating someone inside the gym are rejected", () => {
  const state = seed();
  assert.throws(() => run(state, "SAVE_MEMBER", { name: "A", email: "bad", phone: "12" }), /Họ tên/);
  assert.throws(() => run(state, "SAVE_MEMBER", { ...state.members[0], status: "INACTIVE" }), /check-out/);
  const checkedOut = run(state, "CHECK_OUT", { id: "LT001" });
  const stopped = run(checkedOut, "SAVE_MEMBER", { ...state.members[0], status: "INACTIVE" });
  assert.equal(stopped.members[0].status, "INACTIVE");
});

test("an unpaid order cannot grant check-in access, payment activates it exactly once", () => {
  const original = seed();
  assert.equal(getActiveSubscription(original, "HV003", dayKey(now)), null);
  assert.throws(() => run(original, "CHECK_IN", { memberId: "HV003" }), /đã thanh toán/);
  const next = run(original, "PAY_ORDER", { id: "DH003", method: "CASH", amount: 290000 });
  assert.equal(original.orders.find((order) => order.id === "DH003").status, "PENDING");
  assert.equal(getActiveSubscription(next, "HV003", dayKey(now)).id, "DK003");
  assert.throws(() => run(next, "PAY_ORDER", { id: "DH003", method: "CASH", amount: 290000 }), /đã được xử lý/);
});

test("payment requires exact amount, valid method, and transfer reconciliation reference", () => {
  const state = seed();
  assert.throws(() => run(state, "PAY_ORDER", { id: "DH003", method: "CASH", amount: 1000 }), /Số tiền/);
  assert.throws(() => run(state, "PAY_ORDER", { id: "DH003", method: "OTHER", amount: 290000 }), /phương thức/);
  assert.throws(() => run(state, "PAY_ORDER", { id: "DH003", method: "TRANSFER", amount: 290000 }), /tham chiếu/);
  const paid = run(state, "PAY_ORDER", { id: "DH003", method: "TRANSFER", amount: 290000, reference: "FT260001" });
  assert.equal(paid.orders.find((order) => order.id === "DH003").reference, "FT260001");
});

test("renewal continues after the current paid package and includes exactly the package duration", () => {
  const state = run(seed(), "CREATE_ORDER", { memberId: "HV001", packageId: "G002", startDate: "2026-11-08", kind: "RENEW" });
  const sub = state.subscriptions.at(-1);
  assert.equal(sub.startDate, "2026-11-28");
  assert.equal(sub.endDate, "2026-12-27");
  assert.equal(sub.status, "PENDING");
  const paid = run(state, "PAY_ORDER", { id: state.orders.at(-1).id, method: "CASH", amount: 690000 });
  assert.equal(getActiveSubscription(paid, "HV001", "2026-11-27").id, "DK001");
  assert.equal(getActiveSubscription(paid, "HV001", "2026-11-28").id, sub.id);
});

test("renewal requires prior same-type package; new orders reject overlap, invalid days and duplicate pending orders", () => {
  const state = seed();
  assert.throws(() => run(state, "CREATE_ORDER", { memberId: "HV004", packageId: "G001", startDate: "2026-11-08", kind: "RENEW" }), /chưa từng mua/);
  assert.throws(() => run(state, "CREATE_ORDER", { memberId: "HV001", packageId: "G002", startDate: "2026-11-08", kind: "NEW" }), /trùng/);
  assert.throws(() => run(state, "CREATE_ORDER", { memberId: "HV002", packageId: "G001", startDate: "2026-02-30", kind: "NEW" }), /Ngày bắt đầu/);
  assert.throws(() => run(state, "CREATE_ORDER", { memberId: "HV003", packageId: "G001", startDate: "2026-11-08", kind: "NEW" }), /chờ thanh toán/);
  const fresh = run(state, "CREATE_ORDER", { memberId: "HV002", packageId: "G001", startDate: "2026-11-08", kind: "RENEW" });
  assert.equal(fresh.subscriptions.at(-1).startDate, "2026-11-08");
});

test("cancelling pending orders requires a reason and cannot revoke already paid packages", () => {
  const state = seed();
  assert.throws(() => run(state, "CANCEL_ORDER", { id: "DH003", reason: " " }), /lý do/);
  assert.throws(() => run(state, "CANCEL_ORDER", { id: "DH001", reason: "Nhầm" }), /đang chờ/);
  const next = run(state, "CANCEL_ORDER", { id: "DH003", reason: "Hội viên đổi gói" });
  assert.equal(next.orders.find((order) => order.id === "DH003").status, "CANCELLED");
  assert.equal(next.subscriptions.find((sub) => sub.id === "DK003").status, "CANCELLED");
  assert.equal(getActiveSubscription(next, "HV003", "2026-11-08"), null);
});

test("expired, inactive and already checked-in members cannot check in", () => {
  const state = seed();
  assert.throws(() => run(state, "CHECK_IN", { memberId: "HV002" }), /còn hiệu lực/);
  assert.throws(() => run(state, "CHECK_IN", { memberId: "HV005" }), /tạm ngưng/);
  assert.throws(() => run(state, "CHECK_IN", { memberId: "HV001" }), /chưa check-out/);
  const inside = run(state, "CHECK_IN", { memberId: "HV004" });
  const visit = inside.visits.at(-1);
  assert.equal(visit.subscriptionId, "DK004");
  const outside = run(inside, "CHECK_OUT", { id: visit.id });
  assert.equal(outside.visits.at(-1).checkOut, now.toISOString());
  assert.throws(() => run(outside, "CHECK_OUT", { id: visit.id }), /đã check-out/);
});

test("all foreign-branch references and unauthorized actors are rejected", () => {
  const state = seed();
  assert.throws(() => run(state, "CHECK_IN", { memberId: "HV006" }), /chi nhánh/);
  assert.throws(() => run(state, "CREATE_ORDER", { memberId: "HV001", packageId: "G004", startDate: "2026-11-08", kind: "NEW" }), /chi nhánh/);
  assert.throws(() => run(state, "PAY_ORDER", { id: "DH005", method: "CASH", amount: 350000 }), /chi nhánh/);
  assert.throws(() => run(state, "CREATE_APPOINTMENT", appointment({ trainerId: "PT003" })), /chi nhánh/);
  assert.throws(() => run(state, "CHECK_OUT", { id: "LT001" }, now, { ...context, role: "KHACH" }), /Chỉ nhân viên/);
});

test("PT booking requires a paid Gym + PT package valid on the session day", () => {
  assert.throws(() => run(seed(), "CREATE_APPOINTMENT", appointment({ memberIds: ["HV003"] })), /Gym \+ PT/);
  assert.throws(() => run(seed(), "CREATE_APPOINTMENT", appointment({ memberIds: ["HV001"], date: "2026-12-20" })), /còn hiệu lực/);
  const next = run(seed(), "CREATE_APPOINTMENT", appointment());
  assert.equal(next.appointments.at(-1).status, "PENDING");
  assert.equal(next.appointments.at(-1).subscriptionIds.HV004, "DK004");
});

test("individual and group attendee counts and duplicates are validated", () => {
  const state = seed();
  assert.throws(() => run(state, "CREATE_APPOINTMENT", appointment({ memberIds: [] })), /đúng 1/);
  assert.throws(() => run(state, "CREATE_APPOINTMENT", appointment({ type: "GROUP" })), /2 đến 6/);
  assert.throws(() => run(state, "CREATE_APPOINTMENT", appointment({ type: "GROUP", memberIds: ["HV001", "HV001"] })), /trùng nhau/);
  assert.throws(() => run(state, "CREATE_APPOINTMENT", appointment({ type: "GROUP", memberIds: ["1", "2", "3", "4", "5", "6", "7"] })), /2 đến 6/);
  const next = run(state, "CREATE_APPOINTMENT", appointment({ type: "GROUP", memberIds: ["HV001", "HV004"] }));
  assert.equal(next.appointments.at(-1).memberIds.length, 2);
});

test("PT and member overlaps are blocked, adjacent appointments are allowed", () => {
  const state = seed();
  assert.throws(() => run(state, "CREATE_APPOINTMENT", appointment({ startTime: "08:30", endTime: "09:30" })), /Trùng lịch/);
  assert.throws(() => run(state, "CREATE_APPOINTMENT", appointment({ memberIds: ["HV001"], trainerId: "PT002", startTime: "08:30", endTime: "09:30" })), /Trùng lịch/);
  const next = run(state, "CREATE_APPOINTMENT", appointment({ startTime: "09:00", endTime: "10:00" }));
  assert.equal(next.appointments.length, 3);
});

test("PT bookings validate future times, real dates, ordering and trainer hours", () => {
  const state = seed();
  assert.throws(() => run(state, "CREATE_APPOINTMENT", appointment({ date: "2026-11-08", startTime: "08:00", endTime: "09:00" })), /tương lai/);
  assert.throws(() => run(state, "CREATE_APPOINTMENT", appointment({ date: "2026-11-31" })), /không hợp lệ/);
  assert.throws(() => run(state, "CREATE_APPOINTMENT", appointment({ startTime: "11:00", endTime: "10:00" })), /sau giờ bắt đầu/);
  assert.throws(() => run(state, "CREATE_APPOINTMENT", appointment({ startTime: "05:00", endTime: "06:00" })), /nhận lịch/);
});

test("PT session allowance reserves places and cancellation returns the allowance", () => {
  let state = seed();
  state.subscriptions.find((sub) => sub.id === "DK004").ptSessions = 1;
  assert.throws(() => run(state, "CREATE_APPOINTMENT", appointment()), /đặt hết/);
  assert.throws(() => run(state, "CANCEL_APPOINTMENT", { id: "LH002", reason: "" }), /lý do/);
  state = run(state, "CANCEL_APPOINTMENT", { id: "LH002", reason: "Đổi giờ" });
  state = run(state, "CREATE_APPOINTMENT", appointment());
  assert.equal(state.appointments.at(-1).subscriptionIds.HV004, "DK004");
});

test("editing revalidates conflicts, ignores its own slot and resets confirmation", () => {
  let state = seed();
  state = run(state, "UPDATE_APPOINTMENT", { ...state.appointments[1], startTime: "16:00", endTime: "17:00" });
  assert.equal(state.appointments[1].status, "PENDING");
  assert.throws(() => run(state, "UPDATE_APPOINTMENT", { ...state.appointments[1], trainerId: "PT001", startTime: "08:30", endTime: "09:30" }), /Trùng lịch/);
  state = run(state, "CONFIRM_APPOINTMENT", { id: "LH002" });
  assert.equal(state.appointments[1].status, "CONFIRMED");
});

test("appointment transitions reject early, repeated, cancelled or unconfirmed completion", () => {
  const state = seed();
  assert.throws(() => run(state, "COMPLETE_APPOINTMENT", { id: "LH001" }), /đã xác nhận/);
  assert.throws(() => run(state, "COMPLETE_APPOINTMENT", { id: "LH002" }), /chưa bắt đầu/);
  const afterSession = new Date("2026-11-09T11:00:00.000Z");
  const completed = run(state, "COMPLETE_APPOINTMENT", { id: "LH002" }, afterSession);
  assert.equal(completed.appointments[1].status, "COMPLETED");
  assert.throws(() => run(completed, "CANCEL_APPOINTMENT", { id: "LH002", reason: "Muộn" }), /không thể hủy/);
  const cancelled = run(state, "CANCEL_APPOINTMENT", { id: "LH001", reason: "Hội viên bận" });
  assert.throws(() => run(cancelled, "CONFIRM_APPOINTMENT", { id: "LH001" }), /đang chờ/);
});
