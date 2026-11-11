import test from "node:test";
import assert from "node:assert/strict";
import { getBranchChoices, getBranchName, syncTrainerProfileModal } from "./branches.js";

const branches = [
  { _id: "CN009", tenChiNhanh: "Gym Bình Thạnh", diaChi: "123 Điện Biên Phủ" },
  { _id: "CN005", tenChiNhanh: "Gym Quận 5" },
];
const user = { id: "ND013", name: "Anh", branch: "CN005" };
const legacy = {
  id: "profile", title: "Cập nhật thông tin cá nhân", note: "Nội dung cũ",
  fields: ["Họ tên", "Email", "Số điện thoại", "Chuyên môn", "Mô tả"],
  values: ["Anh đang sửa", "draft@example.com", "0901234567", "Gym", "Mô tả đang nhập"],
  meta: { type: "profile", role: "HUAN_LUYEN_VIEN" },
};

test("branch choices keep MongoDB IDs as values and show existing names and addresses", () => {
  assert.deepEqual(getBranchChoices([...branches, { tenChiNhanh: "Thiếu mã" }]), [
    { value: "CN009", label: "Gym Bình Thạnh - 123 Điện Biên Phủ" },
    { value: "CN005", label: "Gym Quận 5" },
  ]);
  assert.deepEqual(getBranchChoices(), []);
  assert.equal(getBranchName(branches, "CN009"), "Gym Bình Thạnh");
  assert.equal(getBranchName(branches, "CN001"), "Chưa xác định chi nhánh");
  assert.equal(getBranchName(branches, ""), "");
});

test("an open five-field trainer profile gains its saved branch without replacing the first five values", () => {
  const refreshed = syncTrainerProfileModal(legacy, user, "HUAN_LUYEN_VIEN", branches);
  assert.deepEqual(refreshed.fields, [...legacy.fields, "Chi nhánh"]);
  assert.deepEqual(refreshed.values, [...legacy.values, "CN005"]);
  assert.deepEqual(refreshed.meta.branchChoices, getBranchChoices(branches));
  assert.match(refreshed.note, /gửi yêu cầu chuyển/);
  assert.equal(legacy.fields.length, 5);
  assert.equal(syncTrainerProfileModal(refreshed, { ...user }, "HUAN_LUYEN_VIEN", [...branches]), refreshed);
});

test("branch metadata refreshes for Mongo changes while other profile values remain intact", () => {
  const current = syncTrainerProfileModal(legacy, user, "HUAN_LUYEN_VIEN", branches);
  const renamed = syncTrainerProfileModal(current, user, "HUAN_LUYEN_VIEN", [{ ...branches[0], tenChiNhanh: "Gym Trung Tâm" }, branches[1]]);
  assert.deepEqual(renamed.values, current.values);
  assert.equal(renamed.meta.branchChoices[0].label, "Gym Trung Tâm - 123 Điện Biên Phủ");
  const moved = syncTrainerProfileModal(current, { ...user, branch: "CN009" }, "HUAN_LUYEN_VIEN", branches);
  assert.deepEqual(moved.values.slice(0, 5), legacy.values);
  assert.equal(moved.values[5], "CN009");
});

test("a profile modal closes when its account or role changes", () => {
  const current = syncTrainerProfileModal(legacy, user, "HUAN_LUYEN_VIEN", branches);
  assert.equal(syncTrainerProfileModal(current, { id: "ND011" }, "HUAN_LUYEN_VIEN", branches), null);
  assert.equal(syncTrainerProfileModal(current, user, "NHAN_VIEN", branches), null);
  const unrelated = { meta: { type: "booking" } };
  assert.equal(syncTrainerProfileModal(unrelated, user, "HUAN_LUYEN_VIEN", branches), unrelated);
});
