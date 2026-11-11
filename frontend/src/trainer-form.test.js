import test from "node:test";
import assert from "node:assert/strict";
import { buildTrainerModuleForm, validateTrainerBranch, buildTrainerModulePayload, getRealTrainerRoster } from "./trainer-form.js";

const fields = ["Họ tên", "Email", "Chuyên môn", "Mô tả", "Trạng thái"];
const branchChoices = [{ value: "CN001", label: "Gym Quận 1" }, { value: "CN002", label: "Gym Thủ Đức" }];
const branches = branchChoices.map(({ value, label }) => ({ _id: value, tenChiNhanh: label }));

test("new trainer form appends branch after the five existing fields and defaults to the manager branch", () => {
  const values = ["Tên mới", "new@example.com", "Thể hình", "Giới thiệu", "DANG_LAM"];
  const form = buildTrainerModuleForm({ fields, values, currentBranch: "CN002", branchChoices });
  assert.deepEqual(form.fields, [...fields, "Chi nhánh"]);
  assert.deepEqual(form.values, [...values, "CN002"]);
  assert.equal(fields.length, 5);
  assert.equal(values.length, 5);
});

test("editing an existing trainer selects its actual branch instead of the manager branch", () => {
  const form = buildTrainerModuleForm({ fields, values: ["Anh", "anh@example.com", "Gym", "", "DANG_LAM"], rawRecord: { chiNhanhId: "CN001" }, currentBranch: "CN002", branchChoices });
  assert.equal(form.values[5], "CN001");
  assert.equal(form.values[4], "DANG_LAM");
});

test("trainer submission accepts only a branch ID from the MongoDB collection", () => {
  assert.equal(validateTrainerBranch(["", "", "", "", "", "CN002"], branches), "CN002");
  for (const invalid of ["", "CN999", "Gym Thủ Đức", undefined]) {
    assert.throws(() => validateTrainerBranch(["", "", "", "", "", invalid], branches), /chọn chi nhánh/);
  }
  assert.throws(() => buildTrainerModuleForm({ fields, currentBranch: "CN001" }), /danh sách chi nhánh/);
});

test("the API payload retains the selected branch and actor without introducing a password field", () => {
  const values = ["PT Mới", "pt@example.com", "Gym", "Giới thiệu", "DANG_LAM", "CN002"];
  assert.deepEqual(buildTrainerModulePayload(values, "ND002"), {
    hoTen: "PT Mới", email: "pt@example.com", chuyenMon: "Gym", moTa: "Giới thiệu", trangThai: "DANG_LAM", chiNhanhId: "CN002", currentUserId: "ND002",
  });
});

test("a trainer roster never invents profiles for accounts, orphaned profiles, or synthetic IDs", () => {
  const accounts = [{ _id: "ND1", hoTen: "HLV thật", vaiTro: "HUAN_LUYEN_VIEN" }, { _id: "ND2", hoTen: "Hội viên", vaiTro: "KHACH" }];
  assert.deepEqual(getRealTrainerRoster({ accounts, trainers: [] }, "CN001"), []);
  assert.deepEqual(getRealTrainerRoster({ accounts, trainers: [
    { _id: "PT1", nguoiDungId: "missing", hoTen: "Hồ sơ mồ côi" },
    { _id: "PT2", nguoiDungId: "ND2" },
    { _id: "PT_ND1", nguoiDungId: "ND1" },
    { nguoiDungId: "ND1" },
  ] }, "CN001"), []);
});

test("real trainer profiles retain their IDs, account identity, and existing display fields", () => {
  const accounts = [
    { _id: "ND1", hoTen: "Anh", email: "anh1@example.com", vaiTro: "HUAN_LUYEN_VIEN", chiNhanhId: "CN001" },
    { _id: "ND2", hoTen: "Anh", email: "anh2@example.com", vaiTro: "HUAN_LUYEN_VIEN", chiNhanhId: "CN002" },
  ];
  const trainers = [
    { _id: "PT001", nguoiDungId: "ND1", hoTen: "Tên cũ", chiNhanhId: "CN002", chuyenMon: "Gym", moTa: "HLV cá nhân", trangThai: "DANG_LAM" },
    { _id: "PT002", nguoiDungId: "ND2" },
  ];
  const roster = getRealTrainerRoster({ accounts, trainers }, "CN001");
  assert.deepEqual(roster.map(({ id, userId, name, branch }) => ({ id, userId, name, branch })), [
    { id: "PT001", userId: "ND1", name: "Anh", branch: "CN002" },
    { id: "PT002", userId: "ND2", name: "Anh", branch: "CN002" },
  ]);
  assert.equal(roster[0].specialty, "Gym");
  assert.equal(roster[0].email, "anh1@example.com");
});
