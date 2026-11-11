import test from "node:test";
import assert from "node:assert/strict";
import { getRegistrationBranchChoices, retainRegistrationBranch } from "./registration-branches.js";

test("registration choices use only persisted branch IDs and Mongo names with no sample fallback", () => {
  const branches = [{ _id: "branch-real", tenChiNhanh: "Gym Trung Tâm", diaChi: "123 Điện Biên Phủ" }];
  assert.deepEqual(getRegistrationBranchChoices(branches), [{ value: "branch-real", label: "Gym Trung Tâm - 123 Điện Biên Phủ" }]);
  assert.deepEqual(getRegistrationBranchChoices([]), []);
  assert.deepEqual(getRegistrationBranchChoices(), []);
});

test("invalid and duplicate branch entries cannot become selectable fictional choices", () => {
  assert.deepEqual(getRegistrationBranchChoices([
    { _id: "real", tenChiNhanh: "Tên thật" },
    { _id: "real", tenChiNhanh: "Tên trùng" },
    { _id: "", tenChiNhanh: "Thiếu mã" },
    { _id: "unnamed" },
    null,
  ]), [{ value: "real", label: "Tên thật" }]);
});

test("refresh keeps an eligible choice and clears a removed or unmanaged branch without selecting another", () => {
  const choices = [{ value: "CN005", label: "Gym thật" }];
  assert.equal(retainRegistrationBranch("CN005", choices), "CN005");
  assert.equal(retainRegistrationBranch("CN001", choices), "");
  assert.equal(retainRegistrationBranch("", choices), "");
  assert.equal(retainRegistrationBranch("CN005", []), "");
});
