function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

async function validateTrainerBranch(db, branchId) {
  const id = typeof branchId === "string" ? branchId.trim() : "";
  if (!id || !await db.collection("chi_nhanh").findOne({ _id: id })) {
    throw httpError(400, "Vui lòng chọn chi nhánh đã được lưu trong hệ thống.");
  }
  return id;
}

async function ensureTrainerProfile(db, user, details = {}) {
  if (user.vaiTro !== "HUAN_LUYEN_VIEN") return null;
  const chiNhanhId = await validateTrainerBranch(db, user.chiNhanhId);
  const collection = db.collection("huan_luyen_vien");
  const existing = await collection.findOne({ nguoiDungId: user._id });
  const clean = (value, fallback) => typeof value === "string" && value.trim() ? value.trim() : fallback;
  const profile = {
    nguoiDungId: user._id,
    chiNhanhId,
    chuyenMon: clean(details.chuyenMon, existing?.chuyenMon || "Sức mạnh & thể hình"),
    moTa: clean(details.moTa, existing?.moTa || "Huấn luyện viên cá nhân chuyên nghiệp"),
    trangThai: details.trangThai || (details.reactivate || !existing
      ? user.trangThai === "KHOA" ? "NGHI_VIEC" : "DANG_LAM"
      : existing.trangThai),
  };
  if (!["DANG_LAM", "NGHI_VIEC"].includes(profile.trangThai)) throw httpError(400, "Trạng thái HLV không hợp lệ.");
  if (existing) {
    const { nguoiDungId, ...changes } = profile;
    await collection.updateOne({ _id: existing._id }, { $set: changes });
    return { _id: existing._id, ...profile };
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const ids = await collection.find({}, { projection: { _id: 1 } }).toArray();
    const next = ids.reduce((max, row) => {
      const match = String(row._id).match(/^PT(\d+)$/);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0) + 1;
    const record = { _id: `PT${String(next).padStart(3, "0")}`, ...profile };
    try {
      await collection.insertOne(record);
      return record;
    } catch (error) {
      if (error.code !== 11000 || attempt === 4) throw error;
      const winner = await collection.findOne({ nguoiDungId: user._id });
      if (winner) return await ensureTrainerProfile(db, user, details);
    }
  }
}

async function restoreTrainerProfile(db, userId, previous) {
  const collection = db.collection("huan_luyen_vien");
  if (!previous) {
    await collection.deleteOne({ nguoiDungId: userId });
    return;
  }
  const { _id, nguoiDungId, ...fields } = previous;
  await collection.updateOne({ _id }, { $set: fields });
}

async function createLinkedTrainer(db, user, details) {
  user.chiNhanhId = await validateTrainerBranch(db, user.chiNhanhId);
  user.email = user.email.trim().toLowerCase();
  user.tenDangNhap = user.tenDangNhap.trim().toLowerCase();
  const accounts = await db.collection("nguoi_dung").find({}, { projection: { email: 1, tenDangNhap: 1 } }).toArray();
  if (accounts.some((account) => account.email?.trim().toLowerCase() === user.email ||
      account.tenDangNhap?.trim().toLowerCase() === user.tenDangNhap)) {
    throw httpError(409, "Email hoặc tên đăng nhập đã tồn tại.");
  }
  if (await db.collection("huan_luyen_vien").findOne({ nguoiDungId: user._id })) {
    throw httpError(409, "Mã tài khoản đã được hồ sơ PT tham chiếu. Vui lòng thử lại.");
  }
  await db.collection("nguoi_dung").insertOne(user);
  try {
    return await ensureTrainerProfile(db, user, details);
  } catch (error) {
    const cleanup = await Promise.allSettled([
      db.collection("nguoi_dung").deleteOne({ _id: user._id }),
      db.collection("huan_luyen_vien").deleteOne({ nguoiDungId: user._id }),
    ]);
    for (const result of cleanup) {
      if (result.status === "rejected") console.error(`Không thể dọn bản ghi HLV ${user._id}:`, result.reason.message);
    }
    throw error;
  }
}

async function syncTrainerProfiles(db) {
  const users = await db.collection("nguoi_dung").find({ vaiTro: "HUAN_LUYEN_VIEN" }).toArray();
  const result = { created: 0, existing: 0, errors: [] };
  for (const user of users) {
    try {
      const previous = await db.collection("huan_luyen_vien").findOne({ nguoiDungId: user._id });
      await ensureTrainerProfile(db, user);
      result[previous ? "existing" : "created"] += 1;
    } catch (error) {
      result.errors.push({ userId: user._id, message: error.message });
    }
  }
  return result;
}

module.exports = { httpError, validateTrainerBranch, ensureTrainerProfile, restoreTrainerProfile, createLinkedTrainer, syncTrainerProfiles };
