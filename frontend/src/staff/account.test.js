import test from "node:test";
import assert from "node:assert/strict";
import { mergeAccounts, updateStaffProfile } from "./account.js";

const original = {
  id: "acc-staff", name: "Nhân viên Lan", email: "nhanvien@gymstation.vn",
  username: "nhanvien", password: "123", role: "NHAN_VIEN", branch: "CN001", phone: "0909000003",
};
const form = { name: "Lan Nguyễn", email: "lan@example.com", phone: "0901234567" };

test("profile changes and password survive account normalization without restoring the default credential", () => {
  const updated = updateStaffProfile(original, [original], {
    ...form, currentPassword: "123", newPassword: "password456", confirmPassword: "password456",
    role: "ADMIN", branch: "CN002",
  });
  const reloaded = mergeAccounts([original], JSON.parse(JSON.stringify([updated])));
  assert.equal(reloaded.length, 1);
  assert.equal(reloaded[0].email, "lan@example.com");
  assert.equal(reloaded[0].password, "password456");
  assert.equal(reloaded[0].role, "NHAN_VIEN");
  assert.equal(reloaded[0].branch, "CN001");
  assert.equal(original.password, "123");
});

test("legacy default staff account migrates its invalid email while retaining user changes", () => {
  const [account] = mergeAccounts([original], [{ ...original, email: "Nhi@", name: "Lan đã sửa" }]);
  assert.equal(account.email, original.email);
  assert.equal(account.name, "Lan đã sửa");
  assert.deepEqual(mergeAccounts([original], [null]), [original]);
});

test("profile rejects wrong password, duplicate email, invalid contacts and non-staff accounts", () => {
  assert.throws(() => updateStaffProfile(original, [original], { ...form, currentPassword: "wrong", newPassword: "123456", confirmPassword: "123456" }), /hiện tại/);
  assert.throws(() => updateStaffProfile(original, [original], { ...form, currentPassword: "123", newPassword: "123456", confirmPassword: "mismatch" }), /không khớp/);
  assert.throws(() => updateStaffProfile(original, [original, { id: "other", email: form.email }], form), /đã được/);
  assert.throws(() => updateStaffProfile(original, [original], { ...form, phone: "123" }), /điện thoại/);
  assert.throws(() => updateStaffProfile(original, [original], { ...form, email: "invalid@" }), /Email/);
  assert.throws(() => updateStaffProfile({ id: "other" }, [{ id: "other", role: "KHACH" }], form), /Nhân viên/);
});
