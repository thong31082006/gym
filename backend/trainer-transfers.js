const { randomUUID } = require("crypto");
const { httpError, validateTrainerBranch } = require("./trainer-accounts");

const REQUESTS = "yeu_cau_chuyen_chi_nhanh";
const TRAINER_ROLE = "HUAN_LUYEN_VIEN";
const MANAGER_ROLE = "QUAN_LY_CHI_NHANH";

async function readActor(db, actor, options = {}) {
  if (!actor?._id) throw httpError(401, "Vui lòng đăng nhập bằng tài khoản hợp lệ.");
  const current = await db.collection("nguoi_dung").findOne({ _id: actor._id }, options);
  if (!current) throw httpError(401, "Tài khoản đang đăng nhập không còn tồn tại.");
  if (current.trangThai !== "HOAT_DONG") throw httpError(403, "Tài khoản không còn hoạt động.");
  return current;
}

function assertCurrentTrainer(user, profile, sourceBranch, stale = false) {
  if (!user || user.vaiTro !== TRAINER_ROLE || user.trangThai !== "HOAT_DONG" ||
      !profile || profile.nguoiDungId !== user._id || profile.trangThai !== "DANG_LAM" ||
      !sourceBranch || user.chiNhanhId !== sourceBranch || profile.chiNhanhId !== sourceBranch) {
    throw httpError(409, stale
      ? "Thông tin HLV hoặc chi nhánh đã thay đổi. Không thể xử lý yêu cầu này."
      : "Hồ sơ HLV và chi nhánh làm việc chưa hợp lệ để gửi yêu cầu.");
  }
}

function pendingResult(request, profile, fromBranchId, toBranchId) {
  if (request.ptId !== profile._id || request.fromBranchId !== fromBranchId) {
    throw httpError(409, "Yêu cầu chờ duyệt đã không còn khớp với chi nhánh hiện tại.");
  }
  if (request.toBranchId !== toBranchId) {
    throw httpError(409, "Bạn đã có yêu cầu chuyển chi nhánh đang chờ duyệt.");
  }
  return request;
}

async function ensureTransferIndexes(db) {
  return await db.collection(REQUESTS).createIndex(
    { nguoiDungId: 1 },
    {
      name: "unique_pending_trainer_transfer",
      unique: true,
      partialFilterExpression: { status: "PENDING" },
    },
  );
}

async function requestTrainerTransfer(db, actor, targetUser, toBranchId) {
  const current = await readActor(db, actor);
  if (current.vaiTro !== TRAINER_ROLE || targetUser?._id !== current._id) {
    throw httpError(403, "HLV chỉ được gửi yêu cầu chuyển chi nhánh cho chính mình.");
  }
  const profile = await db.collection("huan_luyen_vien").findOne({ nguoiDungId: current._id });
  assertCurrentTrainer(current, profile, current.chiNhanhId);
  const fromBranchId = await validateTrainerBranch(db, current.chiNhanhId);
  const destination = await validateTrainerBranch(db, toBranchId);
  if (destination === fromBranchId) throw httpError(400, "Vui lòng chọn chi nhánh khác chi nhánh đang làm việc.");

  const collection = db.collection(REQUESTS);
  const existing = await collection.findOne({ nguoiDungId: current._id, status: "PENDING" });
  if (existing) return pendingResult(existing, profile, fromBranchId, destination);
  const request = {
    _id: `YCCN_${randomUUID()}`,
    nguoiDungId: current._id,
    ptId: profile._id,
    fromBranchId,
    toBranchId: destination,
    status: "PENDING",
    requestedAt: new Date(),
    reviewedBy: null,
    reviewedAt: null,
  };
  try {
    await collection.insertOne(request);
    return request;
  } catch (error) {
    if (error.code !== 11000) throw error;
    // A duplicate key aborts a Mongo transaction. Let its owner retry from a
    // fresh snapshot instead of attempting to read the winner on this session.
    if (db.inTransaction) {
      error.trainerTransferConflict = true;
      throw error;
    }
    const winner = await collection.findOne({ nguoiDungId: current._id, status: "PENDING" });
    if (winner) return pendingResult(winner, profile, fromBranchId, destination);
    throw httpError(409, "Yêu cầu vừa thay đổi. Vui lòng tải lại và thử lại.");
  }
}

async function activeBranch(db, branchId, options = {}) {
  if (!branchId) return null;
  return await db.collection("chi_nhanh").findOne({ _id: branchId, trangThai: "HOAT_DONG" }, options);
}

async function decideTrainerTransfer(db, actor, requestId, decision) {
  if (!["APPROVED", "REJECTED"].includes(decision)) {
    throw httpError(400, "Quyết định xử lý yêu cầu không hợp lệ.");
  }
  if (!actor?._id) throw httpError(401, "Vui lòng đăng nhập để xử lý yêu cầu.");
  if (!db.client || typeof db.client.startSession !== "function") {
    throw httpError(503, "Chưa thể xử lý yêu cầu chuyển chi nhánh một cách an toàn. Vui lòng thử lại.");
  }

  const session = db.client.startSession();
  try {
    return await session.withTransaction(async () => {
      const options = { session };
      const manager = await readActor(db, actor, options);
      if (manager.vaiTro !== MANAGER_ROLE) {
        throw httpError(403, "Chỉ quản lý chi nhánh hiện tại được duyệt yêu cầu chuyển của HLV.");
      }
      const collection = db.collection(REQUESTS);
      const request = await collection.findOne({ _id: requestId }, options);
      if (!request) throw httpError(404, "Không tìm thấy yêu cầu chuyển chi nhánh.");
      if (!manager.chiNhanhId || manager.chiNhanhId !== request.fromBranchId) {
        throw httpError(403, "Yêu cầu không thuộc chi nhánh bạn phụ trách.");
      }
      if (!await activeBranch(db, request.fromBranchId, options)) {
        throw httpError(409, "Chi nhánh bạn phụ trách không còn tồn tại hoặc đang ngừng hoạt động.");
      }
      if (request.status !== "PENDING") {
        if (request.status === decision) return request;
        throw httpError(409, "Yêu cầu đã được xử lý bằng một quyết định khác.");
      }

      const user = await db.collection("nguoi_dung").findOne({ _id: request.nguoiDungId }, options);
      const profile = await db.collection("huan_luyen_vien").findOne({ _id: request.ptId }, options);
      assertCurrentTrainer(user, profile, request.fromBranchId, true);
      if (!request.toBranchId || request.toBranchId === request.fromBranchId) {
        throw httpError(409, "Chi nhánh đích của yêu cầu không còn hợp lệ.");
      }

      if (decision === "APPROVED") {
        const destinationBranch = await activeBranch(db, request.toBranchId, options);
        if (!destinationBranch) {
          throw httpError(409, "Chi nhánh đích không còn tồn tại hoặc đang ngừng hoạt động.");
        }
        const destination = destinationBranch._id;
        const userUpdate = await db.collection("nguoi_dung").updateOne(
          { _id: user._id, vaiTro: TRAINER_ROLE, chiNhanhId: request.fromBranchId, trangThai: "HOAT_DONG" },
          { $set: { chiNhanhId: destination } },
          options,
        );
        if (userUpdate.matchedCount !== 1) throw httpError(409, "Chi nhánh HLV vừa thay đổi. Vui lòng tải lại.");
        const profileUpdate = await db.collection("huan_luyen_vien").updateOne(
          { _id: profile._id, nguoiDungId: user._id, chiNhanhId: request.fromBranchId, trangThai: "DANG_LAM" },
          { $set: { chiNhanhId: destination } },
          options,
        );
        if (profileUpdate.matchedCount !== 1) throw httpError(409, "Hồ sơ PT vừa thay đổi. Vui lòng tải lại.");
      }

      const changes = { status: decision, reviewedBy: manager._id, reviewedAt: new Date() };
      const requestUpdate = await collection.updateOne(
        { _id: request._id, status: "PENDING" },
        { $set: changes },
        options,
      );
      if (requestUpdate.matchedCount !== 1) throw httpError(409, "Yêu cầu vừa được xử lý. Vui lòng tải lại.");
      return { ...request, ...changes };
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
  } finally {
    await session.endSession();
  }
}

async function listVisibleTransfers(db, actor) {
  // The existing fixed-admin identity is resolved by the server and is read-only here.
  const current = actor?._id === "ADMIN_FIXED" && actor.vaiTro === "ADMIN"
    ? actor
    : await readActor(db, actor);
  let filter;
  if (current.vaiTro === "ADMIN") filter = {};
  else if (current.vaiTro === TRAINER_ROLE) filter = { nguoiDungId: current._id };
  else if (current.vaiTro === MANAGER_ROLE && await activeBranch(db, current.chiNhanhId)) filter = { fromBranchId: current.chiNhanhId };
  else return [];
  const requests = await db.collection(REQUESTS).find(filter).toArray();
  return requests.sort((first, second) => new Date(second.requestedAt).getTime() - new Date(first.requestedAt).getTime());
}

module.exports = { requestTrainerTransfer, decideTrainerTransfer, listVisibleTransfers, ensureTransferIndexes };
