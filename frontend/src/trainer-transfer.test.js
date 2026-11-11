import test from "node:test";
import assert from "node:assert/strict";
import { getBranchTrainerRoster, getBranchBookingRows, getOwnTrainerTransfer, getManagerPendingTransfers, getTransferTrainerName, getProfileUpdateAccount } from "./trainer-transfer.js";

const roster = [{ id: "PT1", branch: "CN001" }, { id: "PT2", branch: "CN002" }];

test("members can select only trainers in their saved branch while other roles retain their roster", () => {
  assert.deepEqual(getBranchTrainerRoster(roster, "KHACH", "CN002"), [roster[1]]);
  assert.deepEqual(getBranchTrainerRoster(roster, "KHACH", ""), []);
  assert.equal(getBranchTrainerRoster(roster, "NHAN_VIEN", "CN002"), roster);
});

test("the booking table requires both an appointment and its actual trainer to belong to the member branch", () => {
  const bookings = [{ _id: "L1" }, { _id: "L2" }, { _id: "L3" }, { _id: "unknown" }];
  const appointments = [
    { _id: "L1", ptId: "PT1", chiNhanhId: "CN001" },
    { _id: "L2", ptId: "PT2", chiNhanhId: "CN002" },
    { _id: "L3", ptId: "PT1", chiNhanhId: "CN002" },
  ];
  assert.deepEqual(getBranchBookingRows(bookings, appointments, roster, "KHACH", "CN002"), [bookings[1]]);
  assert.deepEqual(getBranchBookingRows(bookings, appointments, roster, "KHACH", ""), []);
  assert.equal(getBranchBookingRows(bookings, appointments, roster, "NHAN_VIEN", "CN002"), bookings);
  assert.equal(bookings.length, 4);
});

test("only the manager of the trainer's current branch receives pending decision rows", () => {
  const transfers = [
    { _id: "T1", fromBranchId: "CN001", toBranchId: "CN002", status: "PENDING" },
    { _id: "T2", fromBranchId: "CN002", toBranchId: "CN001", status: "PENDING" },
    { _id: "T3", fromBranchId: "CN001", toBranchId: "CN002", status: "APPROVED" },
  ];
  assert.deepEqual(getManagerPendingTransfers(transfers, "QUAN_LY_CHI_NHANH", "CN001"), [transfers[0]]);
  assert.deepEqual(getManagerPendingTransfers(transfers, "HUAN_LUYEN_VIEN", "CN001"), []);
  assert.deepEqual(getManagerPendingTransfers(transfers, "QUAN_LY_CHI_NHANH", ""), []);
});

test("a trainer sees its own pending request and names come from the linked account", () => {
  const transfers = [
    { _id: "T1", trainerUserId: "ND1", status: "REJECTED" },
    { _id: "T2", trainerUserId: "ND2", status: "PENDING" },
    { _id: "T3", trainerId: "PT1", status: "PENDING", trainerName: "Tên cũ" },
  ];
  const records = { trainers: [{ _id: "PT1", nguoiDungId: "ND1" }], accounts: [{ _id: "ND1", hoTen: "Anh" }] };
  assert.equal(getOwnTrainerTransfer(transfers, "ND1", records)._id, "T3");
  assert.equal(getOwnTrainerTransfer(transfers, "ND2", records)._id, "T2");
  assert.equal(getOwnTrainerTransfer(transfers, "", records), undefined);
  assert.equal(getTransferTrainerName(transfers[2], records), "Anh");
  const actualRecord = { _id: "T4", nguoiDungId: "ND1", ptId: "PT1", fromBranchId: "CN001", toBranchId: "CN002", status: "PENDING" };
  assert.equal(getOwnTrainerTransfer([actualRecord], "ND1", records), actualRecord);
  assert.equal(getTransferTrainerName(actualRecord, records), "Anh");
});

test("a requested branch never replaces the account's actual branch in the profile response", () => {
  const account = { id: "ND1", branch: "CN001", name: "Anh" };
  const branchTransfer = { _id: "T1", fromBranchId: "CN001", toBranchId: "CN002", status: "PENDING" };
  const result = getProfileUpdateAccount({ account, branchTransfer });
  assert.equal(result.branch, "CN001");
  assert.equal(result.branchTransfer, branchTransfer);
  assert.deepEqual(account, { id: "ND1", branch: "CN001", name: "Anh" });
  assert.equal(getProfileUpdateAccount({ account }), account);
});
