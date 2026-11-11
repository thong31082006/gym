const { httpError } = require("./trainer-accounts");

function unavailableBranch() {
  return Object.assign(httpError(400, "Chi nhánh đã chọn chưa sẵn sàng đăng ký hoặc không còn quản lý đang hoạt động. Vui lòng chọn lại chi nhánh."), {
    code: "INVALID_REGISTRATION_BRANCH",
  });
}

async function listRegistrationBranches(db) {
  const branches = await db.collection("chi_nhanh").find({ trangThai: "HOAT_DONG" }).toArray();
  const managers = await db.collection("nguoi_dung").find({
    vaiTro: "QUAN_LY_CHI_NHANH",
    trangThai: "HOAT_DONG",
  }, { projection: { chiNhanhId: 1 } }).toArray();
  const managedIds = new Set(managers.map((manager) => manager.chiNhanhId));
  return branches
    .filter((branch) => typeof branch._id === "string" && branch.tenChiNhanh?.trim() && managedIds.has(branch._id))
    .map((branch) => ({ _id: branch._id, tenChiNhanh: branch.tenChiNhanh, diaChi: branch.diaChi || "" }))
    .sort((first, second) => first.tenChiNhanh.localeCompare(second.tenChiNhanh, "vi"));
}

async function validateRegistrationBranch(db, branchId, options = {}) {
  if (typeof branchId !== "string" || !branchId.trim()) throw unavailableBranch();
  const branch = await db.collection("chi_nhanh").findOne({ _id: branchId.trim(), trangThai: "HOAT_DONG" }, options);
  if (!branch || !branch.tenChiNhanh?.trim()) throw unavailableBranch();
  const manager = await db.collection("nguoi_dung").findOne({
    vaiTro: "QUAN_LY_CHI_NHANH",
    trangThai: "HOAT_DONG",
    chiNhanhId: branch._id,
  }, options);
  if (!manager) throw unavailableBranch();
  return branch._id;
}

async function validateManagerBranch(db, branchId) {
  const id = typeof branchId === "string" ? branchId.trim() : "";
  const branch = id && await db.collection("chi_nhanh").findOne({ _id: id, trangThai: "HOAT_DONG" });
  if (!branch) throw httpError(400, "Vui lòng chọn chi nhánh đang hoạt động đã được Admin lưu trong hệ thống.");
  return branch._id;
}

module.exports = { listRegistrationBranches, validateRegistrationBranch, validateManagerBranch };
