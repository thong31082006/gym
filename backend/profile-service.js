const { httpError, validateTrainerBranch, ensureTrainerProfile } = require("./trainer-accounts");
const { requestTrainerTransfer } = require("./trainer-transfers");

function sessionDatabase(db, session) {
  return {
    client: db.client,
    inTransaction: true,
    collection(name) {
      const collection = db.collection(name);
      return {
        find: (query, options = {}) => collection.find(query, { ...options, session }),
        findOne: (query, options = {}) => collection.findOne(query, { ...options, session }),
        insertOne: (record, options = {}) => collection.insertOne(record, { ...options, session }),
        updateOne: (query, update, options = {}) => collection.updateOne(query, update, { ...options, session }),
        deleteOne: (query, options = {}) => collection.deleteOne(query, { ...options, session }),
      };
    },
  };
}

async function updateProfile(db, actor, id, values, hashPassword) {
  if (!db.client?.startSession) throw httpError(503, "Chưa sẵn sàng lưu thông tin an toàn. Vui lòng thử lại.");
  const session = db.client.startSession();
  try {
    const save = () => session.withTransaction(async () => {
      const work = sessionDatabase(db, session);
      let user = await work.collection("nguoi_dung").findOne({ _id: id });
      if (!user) {
        const profile = await work.collection("huan_luyen_vien").findOne({ _id: id }) ||
          await work.collection("nhan_vien").findOne({ _id: id });
        if (profile) user = await work.collection("nguoi_dung").findOne({ _id: profile.nguoiDungId });
      }
      if (!user) user = await work.collection("nguoi_dung").findOne({ $or: [{ tenDangNhap: id }, { email: id }] });
      if (!user) throw httpError(404, "Không tìm thấy tài khoản.");
      const isMemberAssignment = actor.vaiTro === "QUAN_LY_CHI_NHANH" && user.vaiTro === "KHACH";
      if (actor._id !== user._id && actor.vaiTro !== "ADMIN" && !isMemberAssignment) {
        throw httpError(403, "Bạn chỉ được cập nhật thông tin của mình.");
      }
      const hasBranch = Object.prototype.hasOwnProperty.call(values, "chiNhanhId");
      const branch = hasBranch ? await validateTrainerBranch(work, values.chiNhanhId) : user.chiNhanhId;
      const changedBranch = hasBranch && branch !== user.chiNhanhId;
      const updates = {};
      if (values.hoTen?.trim()) updates.hoTen = values.hoTen.trim();
      if (values.email?.trim()) updates.email = values.email.trim().toLowerCase();
      if (values.soDienThoai?.trim()) updates.soDienThoai = values.soDienThoai.trim();
      if (values.password) updates.matKhauHash = hashPassword(values.password);
      if (changedBranch && user.vaiTro !== "HUAN_LUYEN_VIEN") {
        if (actor.vaiTro !== "ADMIN" && !(isMemberAssignment && branch === actor.chiNhanhId)) {
          throw httpError(403, "Chi nhánh được quản lý phân công, bạn không thể tự thay đổi.");
        }
        updates.chiNhanhId = branch;
      }
      if (changedBranch && user.vaiTro === "HUAN_LUYEN_VIEN" &&
          (actor._id !== user._id || actor.vaiTro !== "HUAN_LUYEN_VIEN")) {
        throw httpError(409, "Vui lòng xử lý yêu cầu chuyển chi nhánh của HLV qua chức năng duyệt.");
      }
      if (isMemberAssignment && actor.vaiTro !== "ADMIN" &&
          (updates.chiNhanhId || user.chiNhanhId) !== actor.chiNhanhId) {
        throw httpError(403, "Chỉ được phân công hội viên vào chi nhánh bạn phụ trách.");
      }
      if (Object.keys(updates).length) await work.collection("nguoi_dung").updateOne({ _id: user._id }, { $set: updates });
      const updated = { ...user, ...updates };
      let trainer = null;
      let staff = await work.collection("nhan_vien").findOne({ nguoiDungId: user._id });
      if (user.vaiTro === "HUAN_LUYEN_VIEN") {
        trainer = await ensureTrainerProfile(work, updated, { chuyenMon: values.chuyenMon, moTa: values.moTa });
      } else if (user.vaiTro === "NHAN_VIEN" && staff && values.chucDanh?.trim()) {
        await work.collection("nhan_vien").updateOne({ _id: staff._id }, { $set: { chucDanh: values.chucDanh.trim() } });
        staff = { ...staff, chucDanh: values.chucDanh.trim() };
      }
      const branchTransfer = changedBranch && user.vaiTro === "HUAN_LUYEN_VIEN"
        ? await requestTrainerTransfer(work, actor, updated, branch) : undefined;
      return {
        message: branchTransfer ? "Đã gửi yêu cầu chuyển chi nhánh, chờ quản lý chi nhánh hiện tại duyệt." : "Đã cập nhật thông tin cá nhân.",
        account: { id: updated._id, name: updated.hoTen, email: updated.email, username: updated.tenDangNhap,
          role: updated.vaiTro, branch: updated.chiNhanhId, phone: updated.soDienThoai,
          ...(trainer ? { specialty: trainer.chuyenMon, bio: trainer.moTa } : {}),
          ...(staff ? { title: staff.chucDanh } : {}) },
        ...(branchTransfer ? { branchTransfer } : {}),
      };
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await save();
      } catch (error) {
        if (!error.trainerTransferConflict) throw error;
        if (attempt === 1) throw httpError(409, "Yêu cầu vừa thay đổi. Vui lòng tải lại và thử lại.");
      }
    }
  } finally {
    await session.endSession();
  }
}

module.exports = { updateProfile };
