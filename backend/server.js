require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const crypto = require("crypto");
const { httpError, validateTrainerBranch, ensureTrainerProfile, restoreTrainerProfile, createLinkedTrainer, syncTrainerProfiles } = require("./trainer-accounts");
const { issueAuthToken, authenticatedActor, allowRoles } = require("./auth");
const { updateProfile } = require("./profile-service");
const { decideTrainerTransfer, listVisibleTransfers, ensureTransferIndexes } = require("./trainer-transfers");
const { listRegistrationBranches, validateRegistrationBranch, validateManagerBranch } = require("./registration-branches");

const app = express();
let mongoReady = false;

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:3000",
      "http://127.0.0.1:5173",
      "http://127.0.0.1:5174",
      "http://127.0.0.1:3000",
    ],
  }),
);

app.use(express.json());

// --- Helper Crypto Functions ---
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const N = 16384,
    r = 8,
    p = 1;
  const hash = crypto.scryptSync(password, salt, 64, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash) return false;
  try {
    const parts = storedHash.split("$");
    if (parts.length === 6 && parts[0] === "scrypt") {
      const [_, N, r, p, saltHex, hashHex] = parts;
      const salt = Buffer.from(saltHex, "hex");
      const hash = crypto.scryptSync(password, salt, 64, {
        N: parseInt(N, 10),
        r: parseInt(r, 10),
        p: parseInt(p, 10),
      });
      return crypto.timingSafeEqual(hash, Buffer.from(hashHex, "hex"));
    }
  } catch (err) {
    console.error("verifyPassword error:", err);
  }
  return false;
}

// --- ID Generation Helper ---
async function getNextId(collectionName, prefix, db = mongoose.connection.db, options = {}) {
    const docs = await db
      .collection(collectionName)
      .find({}, { projection: { _id: 1 }, ...options })
      .toArray();
    if (collectionName === "nguoi_dung" && prefix === "ND") {
      for (const name of ["huan_luyen_vien", "nhan_vien"]) {
        const references = await db.collection(name).find({}, { projection: { nguoiDungId: 1 }, ...options }).toArray();
        for (const row of references) docs.push({ _id: row.nguoiDungId });
      }
    }
    const nums = docs
      .map((d) => {
        const m = String(d._id).match(new RegExp(`^${prefix}(\\d+)$`));
        return m ? parseInt(m[1], 10) : 0;
      })
      .filter((n) => !isNaN(n));
    const max = nums.length > 0 ? Math.max(...nums) : 0;
    return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

async function assignUserRole(db, id, newRole, branchId) {
  if (!["ADMIN", "QUAN_LY_CHI_NHANH", "NHAN_VIEN", "KHACH", "HUAN_LUYEN_VIEN"].includes(newRole)) {
    throw httpError(400, "Vai trò không hợp lệ.");
  }
  const user = await db.collection("nguoi_dung").findOne({ _id: id });
  if (!user) throw httpError(404, "Không tìm thấy tài khoản.");
  if (user.vaiTro === "HUAN_LUYEN_VIEN" && newRole === "HUAN_LUYEN_VIEN" &&
      branchId !== undefined && branchId !== user.chiNhanhId) {
    throw httpError(409, "Chuyển chi nhánh HLV phải được xử lý qua yêu cầu chờ quản lý duyệt.");
  }
  const update = { vaiTro: newRole };
  if (newRole === "ADMIN") update.chiNhanhId = null;
  else update.chiNhanhId = branchId === undefined ? user.chiNhanhId : branchId;
  if (newRole === "QUAN_LY_CHI_NHANH") update.chiNhanhId = await validateManagerBranch(db, update.chiNhanhId);
  if (newRole !== "HUAN_LUYEN_VIEN") {
    await db.collection("nguoi_dung").updateOne({ _id: id }, { $set: update });
    return { ...user, ...update };
  }
  update.chiNhanhId = await validateTrainerBranch(db, update.chiNhanhId);
  const isPromotion = user.vaiTro !== "HUAN_LUYEN_VIEN";
  if (isPromotion) update.matKhauHash = hashPassword("1");
  const previous = await db.collection("huan_luyen_vien").findOne({ nguoiDungId: id });
  let profileWritten = false;
  try {
    await ensureTrainerProfile(db, { ...user, ...update }, { reactivate: isPromotion });
    profileWritten = true;
    await db.collection("nguoi_dung").updateOne({ _id: id }, {
      $set: update,
      ...(isPromotion ? { $unset: { matKhau: "", daCapLaiMatKhau: "" } } : {}),
    });
  } catch (error) {
    if (!previous) await db.collection("huan_luyen_vien").deleteOne({ nguoiDungId: id });
    else if (profileWritten) await restoreTrainerProfile(db, id, previous);
    throw error;
  }
  return { ...user, ...update };
}

function formatDate(d) {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toISOString().slice(0, 10);
}

function formatTime(d) {
  if (!d) return "08:00";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toISOString().slice(11, 16);
}

// --- Base Endpoints ---
app.get("/", (req, res) => {
  res.send("Backend Gym dang hoat dong voi MongoDB Atlas!");
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    mode: mongoReady ? "database" : "offline",
    message: mongoReady
      ? "MongoDB connected (GymManagement)"
      : "MongoDB not connected",
  });
});

// --- Auth Endpoints ---
// Tài khoản admin cố định (fallback khi DB không có admin)
const ADMIN_FIXED = {
  _id: "ADMIN_FIXED",
  hoTen: "Admin Hệ Thống",
  email: "admin@gymstation.vn",
  tenDangNhap: "admin",
  matKhau: "12345",
  soDienThoai: "0909000005",
  vaiTro: "ADMIN",
  chiNhanhId: null,
  trangThai: "HOAT_DONG",
};

app.post("/api/login", async (req, res) => {
  const { email, password, role } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ message: "Vui lòng nhập tên đăng nhập và mật khẩu." });
  }

  const idTrim = email.trim().toLowerCase();

  // Admin cố định: username "admin", password "12345" - luôn ưu tiên
  const isAdminLogin =
    (idTrim === "admin" || idTrim === "admin@gymstation.vn") &&
    password === "12345" &&
    (!role || role === "ADMIN");
  if (isAdminLogin) {
    return res.json({
      message: "Đăng nhập thành công",
      token: issueAuthToken(ADMIN_FIXED._id),
      account: {
        id: ADMIN_FIXED._id,
        name: ADMIN_FIXED.hoTen,
        email: ADMIN_FIXED.email,
        username: ADMIN_FIXED.tenDangNhap,
        role: ADMIN_FIXED.vaiTro,
        branch: "CN001",
        phone: ADMIN_FIXED.soDienThoai,
      },
    });
  }

  try {
    if (mongoReady || mongoose.connection.db) {
      const users = await mongoose.connection.db
        .collection("nguoi_dung")
        .find({})
        .toArray();

      // Resolve the real account before aliases and before checking its password.
      const exact = users.find((u) => u.email?.toLowerCase() === idTrim) ||
        users.find((u) => u.tenDangNhap?.toLowerCase() === idTrim);
      const names = exact ? [] : users.filter((u) => u.hoTen?.toLowerCase() === idTrim && (!role || u.vaiTro === role));
      if (names.length > 1) return res.status(400).json({ message: "Có nhiều tài khoản cùng họ tên. Vui lòng dùng email hoặc tên đăng nhập." });
      let matched = exact || names[0] || users.find((u) => {
        if (role && u.vaiTro !== role) return false;

        // Alias support for convenient login:
        const isNhi = idTrim === "nhi@" || idTrim === "nhi";
        const isStaffAlias =
          (idTrim === "nhanvien" || idTrim === "nhanvien1" || idTrim === "nhanvien@gymstation.vn") &&
          u.vaiTro === "NHAN_VIEN";
        const isAdminAlias = (idTrim === "admin" || idTrim === "admin@example.com") && u.vaiTro === "ADMIN";
        const isBranchAlias =
          (idTrim === "quanly" || idTrim === "quanly1" || idTrim === "quanly2" || idTrim === "quanly1@example.com") &&
          u.vaiTro === "QUAN_LY_CHI_NHANH";
        const isPtAlias =
          (idTrim === "pt" || idTrim === "pt1" || idTrim === "pt1@example.com") &&
          u.vaiTro === "HUAN_LUYEN_VIEN";
        const isKhachAlias =
          (idTrim === "khach" || idTrim === "khach1" || idTrim === "khach2" || idTrim === "khach1@example.com") &&
          u.vaiTro === "KHACH";

        const aliasMatch =
          (isNhi && (!role || u.vaiTro === role)) ||
          isStaffAlias ||
          isAdminAlias ||
          isBranchAlias ||
          isPtAlias ||
          isKhachAlias;

        return aliasMatch;
      });

      if (matched) {
        if (role && matched.vaiTro !== role) {
          return res.status(401).json({ message: `Tài khoản này không có vai trò ${role}.` });
        }
        // Check password: match hash, plain password, or reset password "1"
        const isHashValid = verifyPassword(password, matched.matKhauHash);
        const isPlainValid = matched.matKhau && matched.matKhau === password;
        // Admin cố định: username "admin", password "12345"
        const isAdminFixed = matched.vaiTro === "ADMIN" &&
          (matched.tenDangNhap === "admin" || matched._id === "ND001") &&
          password === "12345";
        const isResetValid =
          password === "1" &&
          (matched.matKhau === "1" ||
            matched.daCapLaiMatKhau ||
            verifyPassword("1", matched.matKhauHash));

        if (isHashValid || isPlainValid || isAdminFixed || isResetValid) {
          // Kiểm tra tài khoản bị khóa
          if (matched.trangThai === "KHOA") {
            return res.status(403).json({ message: "Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên." });
          }

          let extraInfo = {};
          if (matched.vaiTro === "NHAN_VIEN") {
            const s = await mongoose.connection.db
              .collection("nhan_vien")
              .findOne({ nguoiDungId: matched._id });
            if (s) extraInfo.title = s.chucDanh;
          } else if (matched.vaiTro === "HUAN_LUYEN_VIEN") {
            const t = await mongoose.connection.db
              .collection("huan_luyen_vien")
              .findOne({ nguoiDungId: matched._id });
            if (t) {
              extraInfo.specialty = t.chuyenMon;
              extraInfo.bio = t.moTa;
            }
          }

          return res.json({
            message: "Đăng nhập thành công",
            token: issueAuthToken(matched._id),
            account: {
              id: matched._id,
              name: matched.hoTen,
              email: matched.email,
              username: matched.tenDangNhap,
              role: matched.vaiTro,
              branch: matched.chiNhanhId || "CN001",
              phone: matched.soDienThoai,
              ...extraInfo,
            },
          });
        }
      }
    }
  } catch (err) {
    console.error("Lỗi login:", err);
  }

  return res.status(401).json({
    message: "Tài khoản hoặc mật khẩu không chính xác.",
  });
});

app.get("/api/registration-branches", async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const branches = await listRegistrationBranches(mongoose.connection.db);
    return res.json({ branches });
  } catch (error) {
    return res.status(503).json({ message: "Chưa tải được danh sách chi nhánh. Vui lòng thử lại." });
  }
});

app.post("/api/register", async (req, res) => {
  const { name, email, phone, password, branch } = req.body || {};
  if (![name, email, phone, password].every((value) => typeof value === "string" && value.trim())) {
    return res.status(400).json({ message: "Vui lòng nhập đầy đủ thông tin đăng ký." });
  }

  try {
    const db = mongoose.connection.db;
    if (!db?.client?.startSession) throw httpError(503, "Chưa thể đăng ký tài khoản an toàn. Vui lòng thử lại.");
    const session = db.client.startSession();
    let newUser;
    try {
      newUser = await session.withTransaction(async () => {
        const options = { session };
        const chiNhanhId = await validateRegistrationBranch(db, branch, options);
        const cleanUsername = email.split("@")[0].replace(/[^a-zA-Z0-9]/g, "").toLowerCase() ||
          `khach${Date.now().toString().slice(-4)}`;
        const existing = await db.collection("nguoi_dung").findOne({
          $or: [{ email: email.trim().toLowerCase() }, { tenDangNhap: cleanUsername }],
        }, options);
        if (existing) throw httpError(400, "Email hoặc tài khoản này đã tồn tại.");
        const nextId = await getNextId("nguoi_dung", "ND", db, options);
        const account = {
          _id: nextId,
          hoTen: name.trim(),
          email: email.trim().toLowerCase(),
          tenDangNhap: cleanUsername,
          matKhauHash: hashPassword(password),
          soDienThoai: phone.trim(),
          vaiTro: "KHACH",
          chiNhanhId,
          trangThai: "HOAT_DONG",
          ngayTao: new Date(),
          version: 0,
        };
        await db.collection("nguoi_dung").insertOne(account, options);
        return account;
      }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
    } finally {
      await session.endSession();
    }

    return res.json({
      message: "Đăng ký tài khoản thành công!",
      token: issueAuthToken(newUser._id),
      account: {
        id: newUser._id,
        name: newUser.hoTen,
        email: newUser.email,
        username: newUser.tenDangNhap,
        role: newUser.vaiTro,
        branch: newUser.chiNhanhId,
        phone: newUser.soDienThoai,
      },
    });
  } catch (error) {
    return res.status(error.statusCode || (error.code === 11000 ? 409 : 500)).json({
      message: error.statusCode ? error.message : "Chưa đăng ký được tài khoản. Vui lòng thử lại.",
      ...(error.code === "INVALID_REGISTRATION_BRANCH" ? { code: error.code } : {}),
    });
  }
});

app.use("/api", async (req, res, next) => {
  try {
    req.actor = await authenticatedActor(req, mongoose.connection.db);
    next();
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
});

app.put("/api/profile/:id", async (req, res) => {
  try {
    const result = await updateProfile(mongoose.connection.db, req.actor, req.params.id, req.body || {}, hashPassword);
    return res.json(result);
  } catch (error) {
    return res.status(error.statusCode || (error.code === 11000 ? 409 : 500)).json({ message: error.message });
  }
});

app.post("/api/profile/:id/change-password", async (req, res) => {
  const { id } = req.params;
  const { matKhauCu, matKhauMoi } = req.body || {};
  if (!matKhauCu || !matKhauMoi) {
    return res.status(400).json({ message: "Thiếu mật khẩu cũ hoặc mới." });
  }
  try {
    const db = mongoose.connection.db;
    let user = await db.collection("nguoi_dung").findOne({ _id: id });
    if (!user) {
      user = await db.collection("nguoi_dung").findOne({
        $or: [{ tenDangNhap: id }, { email: id }],
      });
    }
    if (!user) return res.status(404).json({ message: "Không tìm thấy người dùng." });
    if (req.actor._id !== user._id) return res.status(403).json({ message: "Bạn chỉ được đổi mật khẩu của mình." });
    // Không cho admin đổi qua endpoint này
    if (user.vaiTro === "ADMIN") return res.status(403).json({ message: "Admin không dùng chức năng này." });
    // Kiểm tra mật khẩu cũ
    const validOld =
      user.matKhau === matKhauCu ||
      verifyPassword(matKhauCu, user.matKhauHash) ||
      (matKhauCu === "1" && user.daCapLaiMatKhau);
    if (!validOld) return res.status(401).json({ message: "Mật khẩu hiện tại không đúng." });
    await db.collection("nguoi_dung").updateOne(
      { _id: user._id },
      { $set: { matKhauHash: hashPassword(matKhauMoi) }, $unset: { matKhau: "", daCapLaiMatKhau: "" } }
    );
    return res.json({ message: "Đổi mật khẩu thành công!" });
  } catch (err) {
    return res.status(500).json({ message: "Lỗi: " + err.message });
  }
});

// --- Admin tạo quản lý chi nhánh ---
app.post("/api/admin/create-manager", allowRoles("ADMIN"), async (req, res) => {
  const { hoTen, email, soDienThoai, chiNhanhId, matKhau } = req.body || {};
  if (!hoTen || !email || !matKhau || !chiNhanhId) {
    return res.status(400).json({ message: "Thiếu thông tin bắt buộc." });
  }
  try {
    const db = mongoose.connection.db;
    const selectedBranch = await validateManagerBranch(db, chiNhanhId);
    // Kiểm tra email trùng
    const existing = await db.collection("nguoi_dung").findOne({ email: email.trim().toLowerCase() });
    if (existing) return res.status(409).json({ message: "Email đã tồn tại trong hệ thống." });
    const nextId = await getNextId("nguoi_dung", "ND");
    await db.collection("nguoi_dung").insertOne({
      _id: nextId,
      hoTen: hoTen.trim(),
      email: email.trim().toLowerCase(),
      tenDangNhap: email.trim().toLowerCase().split("@")[0],
      matKhauHash: hashPassword(matKhau),
      soDienThoai: soDienThoai || "0900000000",
      vaiTro: "QUAN_LY_CHI_NHANH",
      chiNhanhId: selectedBranch,
      trangThai: "HOAT_DONG",
      ngayTao: new Date(),
      version: 0,
    });
    return res.json({ message: `Đã tạo tài khoản quản lý chi nhánh cho ${hoTen}!`, id: nextId });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: "Lỗi: " + err.message });
  }
});

// --- Modules CRUD & Data-All ---
app.get("/api/data-all", async (req, res) => {
  const role = req.actor.vaiTro;
  const memberId = req.actor._id;
  const branch = role === "ADMIN" ? req.query.branch || "CN001" : req.actor.chiNhanhId;

  try {
    const db = mongoose.connection.db;

    // Load raw collections
    const [
      users,
      branches,
      staffList,
      trainersList,
      equipmentList,
      maintenanceList,
      packageList,
      orderList,
      checkinList,
      shiftList,
      allBookings,
      dkgList,
      paymentList,
      yeuCauList,
    ] = await Promise.all([
      db.collection("nguoi_dung").find({}).toArray(),
      db.collection("chi_nhanh").find({}).toArray(),
      db.collection("nhan_vien").find({}).toArray(),
      db.collection("huan_luyen_vien").find({}).toArray(),
      db.collection("thiet_bi").find({}).toArray(),
      db.collection("bao_tri_thiet_bi").find({}).toArray(),
      db.collection("goi_tap").find({}).toArray(),
      db.collection("don_hang").find({}).sort({ ngayTao: -1 }).toArray(),
      db.collection("luot_checkin").find({}).sort({ vaoLuc: -1 }).toArray(),
      db.collection("lich_lam_viec_pt").find({}).sort({ batDauLuc: 1 }).toArray(),
      db.collection("lich_dat_pt").find({}).sort({ batDauLuc: -1 }).toArray(),
      db.collection("dang_ky_goi").find({}).toArray(),
      db.collection("thanh_toan").find({}).toArray(),
      db.collection("yeu_cau_thanh_toan").find({}).toArray(),
    ]);

    const reqMap = new Map((yeuCauList || []).map((r) => [r.donHangId, r]));

    // Map helper lookups
    const userMap = new Map(users.map((u) => [u._id, u]));
    const isMember = role === "KHACH";
    const memberTrainerIds = new Set(trainersList.filter((profile) => {
      const user = userMap.get(profile.nguoiDungId);
      return branch && profile.chiNhanhId === branch && user?.chiNhanhId === branch &&
        user.vaiTro === "HUAN_LUYEN_VIEN" && user.trangThai === "HOAT_DONG" && profile.trangThai === "DANG_LAM";
    }).map((profile) => profile._id));
    const memberTrainerUserIds = new Set(trainersList.filter((profile) => memberTrainerIds.has(profile._id)).map((profile) => profile.nguoiDungId));
    const visibleUsers = isMember ? users.filter((user) => user._id === memberId || memberTrainerUserIds.has(user._id)) : users;
    const bookingList = isMember ? allBookings.filter((booking) =>
      booking.chiNhanhId === branch && memberTrainerIds.has(booking.ptId) && (booking.hoiVienIds || []).includes(memberId)) : allBookings;
    const visibleShifts = isMember ? shiftList.filter((shift) => shift.chiNhanhId === branch && memberTrainerIds.has(shift.ptId)) : shiftList;
    const publicUsers = visibleUsers.map(({ matKhauHash, matKhau, daCapLaiMatKhau, ...user }) => user);
    const trainerTransfers = (await listVisibleTransfers(db, req.actor)).map((transfer) => ({
      ...transfer, trainerName: userMap.get(transfer.nguoiDungId)?.hoTen || "Huấn luyện viên",
    }));
    const branchMap = new Map(branches.map((b) => [b._id, b]));
    const equipmentMap = new Map(equipmentList.map((e) => [e._id, e]));
    const packageMap = new Map(packageList.map((p) => [p._id, p]));
    const ptUserMap = new Map();
    trainersList.forEach((t) => {
      const u = userMap.get(t.nguoiDungId);
      const ptInfo = u || { hoTen: t.hoTen || t.tenHLV || "Huấn luyện viên", email: t.email || "" };
      ptUserMap.set(t._id, ptInfo);
      if (t.nguoiDungId) ptUserMap.set(t.nguoiDungId, ptInfo);
    });
    users.filter((u) => u.vaiTro === "HUAN_LUYEN_VIEN").forEach((u) => {
      ptUserMap.set(u._id, u);
      ptUserMap.set(u.hoTen, u);
      if (u.tenDangNhap) ptUserMap.set(u.tenDangNhap, u);
    });

    // 1. ACCOUNTS (UC04)
    const accountsRows = visibleUsers.map((u) => [
      u.hoTen || "",
      u.email || "",
      u.tenDangNhap || "",
      u.chiNhanhId || "CN001",
      u.trangThai || "HOAT_DONG",
      u.vaiTro || "KHACH",
    ]);

    // 2. PERMISSIONS (UC05)
    const permissionsRows = visibleUsers.map((u) => [
      u.tenDangNhap || u.email || "",
      u.vaiTro || "KHACH",
      u.chiNhanhId || "CN001",
    ]);

    // 3. BRANCHES (UC06)
    const branchesRows = branches.map((b) => [
      b.tenChiNhanh || b._id,
      b.diaChi || "",
      b.soDienThoai || "",
      b.trangThai || "HOAT_DONG",
    ]);

    // 4. STAFF (UC08)
    const existingStaffMap = new Map(staffList.map((s) => [s.nguoiDungId, s]));
    const staffUsers = users.filter((u) => u.vaiTro === "NHAN_VIEN");
    const allStaffList = staffUsers.map((u) => {
      const sDoc = existingStaffMap.get(u._id);
      return {
        _id: sDoc ? sDoc._id : `NS_${u._id}`,
        nguoiDungId: u._id,
        chiNhanhId: u.chiNhanhId || "CN001",
        chucDanh: sDoc?.chucDanh || "Lễ tân & CSKH",
        ngayVaoLam: sDoc?.ngayVaoLam || u.ngayTao || new Date(),
        trangThai: sDoc?.trangThai || (u.trangThai === "HOAT_DONG" ? "DANG_LAM" : "NGHI_VIEC"),
        hoTen: u.hoTen,
        email: u.email,
        soDienThoai: u.soDienThoai,
      };
    });
    staffList.forEach((s) => {
      if (!allStaffList.some((as) => as._id === s._id || as.nguoiDungId === s.nguoiDungId)) {
        const u = userMap.get(s.nguoiDungId);
        allStaffList.push({
          ...s,
          hoTen: u?.hoTen || "Nhân viên",
          email: u?.email || "",
          soDienThoai: u?.soDienThoai || "",
        });
      }
    });
    const staffRows = allStaffList.map((s) => [
      s.hoTen || "Nhân viên",
      s.email || "",
      s.chucDanh || "Lễ tân",
      formatDate(s.ngayVaoLam),
      s.trangThai || "DANG_LAM",
    ]);

    // 5. TRAINERS (UC09)
    const existingPtMap = new Map(trainersList.map((t) => [t.nguoiDungId, t]));
    const ptUsers = users.filter((u) => u.vaiTro === "HUAN_LUYEN_VIEN");
    const allTrainersList = ptUsers.flatMap((u) => {
      const tDoc = existingPtMap.get(u._id);
      if (!tDoc) return [];
      if (isMember && !memberTrainerIds.has(tDoc._id)) return [];
      return [{
        _id: tDoc._id,
        nguoiDungId: u._id,
        chiNhanhId: u.chiNhanhId || "CN001",
        chuyenMon: tDoc?.chuyenMon || "Sức mạnh & thể hình",
        moTa: tDoc?.moTa || "Huấn luyện viên cá nhân chuyên nghiệp",
        trangThai: tDoc?.trangThai || (u.trangThai === "HOAT_DONG" ? "DANG_LAM" : "NGHI_VIEC"),
        hoTen: u.hoTen,
        email: u.email,
        soDienThoai: u.soDienThoai,
      }];
    });
    const trainersRows = allTrainersList.map((t) => [
      t.hoTen || "Huấn luyện viên",
      t.email || "",
      t.chuyenMon || "Sức mạnh & thể hình",
      t.moTa || "Huấn luyện cá nhân",
      t.trangThai || "DANG_LAM",
    ]);

    // 6. EQUIPMENT (UC11)
    const equipmentRows = equipmentList.map((e) => [
      e.tenThietBi || "",
      e.maTaiSan || e._id,
      e.loaiThietBi || "Cardio",
      e.viTri || "Tầng 1",
      formatDate(e.ngayMua),
      e.trangThai || "SU_DUNG",
    ]);

    // 7. MAINTENANCE (UC12)
    const maintenanceRows = maintenanceList.map((m) => {
      const eq = equipmentMap.get(m.thietBiId);
      const eqLabel = eq ? `${eq.tenThietBi} • ${eq.maTaiSan}` : m.thietBiId;
      return [
        eqLabel,
        formatDate(m.ngayDuKien),
        m.noiDung || "",
        String(m.chiPhi || 0),
        m.trangThai || "DU_KIEN",
      ];
    });

    // 8. MEMBERS (UC13)
    const members = visibleUsers.filter((u) => u.vaiTro === "KHACH");
    const membersRows = members.map((m) => {
      const dkg = dkgList.find(
        (d) => d.hoiVienId === m._id && d.trangThai === "DANG_SU_DUNG",
      );
      const pkg = dkg ? packageMap.get(dkg.goiTapId) : null;
      return [
        m.hoTen || "",
        m.email || "",
        m.soDienThoai || "",
        pkg ? pkg.tenGoi : "Chưa có gói",
        m.trangThai === "HOAT_DONG" ? "DANG_SU_DUNG" : "HET_HAN",
      ];
    });

    // 9. SHIFTS (UC17)
    const shiftsRows = visibleShifts.map((s) => {
      const ptUser = ptUserMap.get(s.ptId) || { hoTen: "Huấn luyện viên" };
      return [
        ptUser.hoTen,
        formatDate(s.batDauLuc),
        formatTime(s.batDauLuc),
        formatTime(s.ketThucLuc),
        s.trangThai || "SAN_SANG",
      ];
    });

    // 10. APPOINTMENTS (UC19)
    const appointmentsRows = bookingList.map((b) => {
      const ptUser = ptUserMap.get(b.ptId) || { hoTen: "Huấn luyện viên" };
      const memberNames = (b.hoiVienIds || [])
        .map((mid) => userMap.get(mid)?.hoTen || mid)
        .join(", ");
      return [
        memberNames || "Hội viên",
        ptUser.hoTen,
        formatDate(b.batDauLuc),
        formatTime(b.batDauLuc),
        b.loaiBuoi || "CA_NHAN",
        b.trangThai || "CHO_XAC_NHAN",
      ];
    });

    // Formatted Packages
    const packages = packageList.filter((p) => !isMember || Boolean(branch && p.chiNhanhId === branch)).map((p) => ({
      _id: p._id,
      name: p.tenGoi,
      type: p.loaiGoi,
      price: Number(p.gia || 0),
      days: Number(p.thoiHanNgay || 30),
      branch: p.chiNhanhId,
      status: p.trangThai,
    }));

    // Formatted Orders
    const orders = orderList.map((o) => {
      const buyer = userMap.get(o.nguoiDungId);
      const req = reqMap.get(o._id);
      let finalStatus = o.trangThai;
      if (req && req.trangThai === "CHO_DUYET" && o.trangThai === "CHO_THANH_TOAN") {
        finalStatus = "CHO_DUYET";
      } else if (req && req.trangThai === "TU_CHOI" && o.trangThai === "CHO_THANH_TOAN") {
        finalStatus = "TU_CHOI";
      } else if (o.trangThai === "DA_THANH_TOAN") {
        finalStatus = "DA_THANH_TOAN";
      }
      return {
        id: o._id,
        name: o.tenGoiLucMua || "Gói gym",
        total: Number(o.tongTien || o.giaLucMua || 0),
        status: finalStatus,
        kind: o.loaiDon === "DANG_KY" ? "Đăng ký" : "Gia hạn",
        start: formatDate(o.ngayTao),
        member: o.nguoiDungId,
        memberName: buyer ? buyer.hoTen : o.nguoiDungId,
        thongBao: req?.thongBao || null,
        phuongThuc: req?.phuongThuc || "CHUYEN_KHOAN",
      };
    });

    // Formatted Visits (Check-in)
    const visits = checkinList.map((v) => {
      const mem = userMap.get(v.hoiVienId);
      return {
        _id: v._id,
        member: mem ? mem.hoTen : v.hoiVienId,
        memberId: v.hoiVienId,
        package: v.dangKyGoiId,
        time: formatTime(v.vaoLuc),
        out: v.raLuc ? formatTime(v.raLuc) : "—",
        status: v.trangThai,
      };
    });

    // Formatted Bookings (PT)
    const bookings = bookingList.map((b) => {
      const ptUser = ptUserMap.get(b.ptId) || { hoTen: "Huấn luyện viên" };
      const memberNames = (b.hoiVienIds || [])
        .map((mid) => userMap.get(mid)?.hoTen || mid)
        .join(", ");
      return {
        _id: b._id,
        pt: ptUser.hoTen,
        date: formatDate(b.batDauLuc),
        start: formatTime(b.batDauLuc),
        end: formatTime(b.ketThucLuc),
        type: b.loaiBuoi,
        members: memberNames,
        status: b.trangThai,
      };
    });

    return res.json({
      data: {
        accounts: accountsRows,
        permissions: permissionsRows,
        branches: branchesRows,
        staff: staffRows,
        trainers: trainersRows,
        equipment: equipmentRows,
        maintenance: maintenanceRows,
        members: membersRows,
        shifts: shiftsRows,
        appointments: appointmentsRows,
      },
      records: {
        accounts: publicUsers,
        permissions: publicUsers,
        branches: branches,
        staff: allStaffList,
        trainers: allTrainersList,
        equipment: equipmentList,
        maintenance: maintenanceList,
        members: members.map(({ matKhauHash, matKhau, daCapLaiMatKhau, ...member }) => member),
        shifts: visibleShifts,
        appointments: bookingList,
      },
      packages,
      orders,
      visits,
      bookings,
      trainerTransfers,
    });
  } catch (err) {
    console.error("Lỗi get data-all:", err);
    return res.status(500).json({ message: "Lỗi tải dữ liệu: " + err.message });
  }
});

app.put("/api/trainer-transfers/:id/decision", allowRoles("QUAN_LY_CHI_NHANH"), async (req, res) => {
  try {
    const transfer = await decideTrainerTransfer(mongoose.connection.db, req.actor, req.params.id, req.body?.decision);
    return res.json({ message: transfer.status === "APPROVED" ? "Đã duyệt chuyển chi nhánh." : "Đã từ chối yêu cầu chuyển chi nhánh.", transfer });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
});

// --- MODULE CRUD ENDPOINTS ---

// 1. Accounts
app.post("/api/accounts", allowRoles("ADMIN"), async (req, res) => {
  const { hoTen, email, tenDangNhap, chiNhanhId, trangThai, vaiTro } = req.body || {};
  try {
    const nextId = await getNextId("nguoi_dung", "ND");
    const newUser = {
      _id: nextId,
      hoTen: hoTen || "Hội viên mới",
      email: email || `${nextId.toLowerCase()}@gymstation.vn`,
      tenDangNhap: tenDangNhap || nextId.toLowerCase(),
      matKhauHash: hashPassword(vaiTro === "HUAN_LUYEN_VIEN" ? "1" : "123"),
      soDienThoai: "0900000000",
      vaiTro: vaiTro || "KHACH",
      chiNhanhId: vaiTro === "ADMIN" ? null : chiNhanhId || "CN001",
      trangThai: trangThai || "HOAT_DONG",
      ngayTao: new Date(),
      version: 0,
    };
    if (vaiTro === "QUAN_LY_CHI_NHANH") newUser.chiNhanhId = await validateManagerBranch(mongoose.connection.db, chiNhanhId);
    if (vaiTro === "HUAN_LUYEN_VIEN") {
      newUser.chiNhanhId = await validateTrainerBranch(mongoose.connection.db, chiNhanhId);
      await createLinkedTrainer(mongoose.connection.db, newUser);
    } else {
      await mongoose.connection.db.collection("nguoi_dung").insertOne(newUser);
    }
    if (vaiTro === "NHAN_VIEN") {
      const nextStaffId = await getNextId("nhan_vien", "NS");
      await mongoose.connection.db.collection("nhan_vien").insertOne({
        _id: nextStaffId,
        nguoiDungId: nextId,
        chiNhanhId: chiNhanhId || "CN001",
        chucDanh: "Lễ tân & CSKH",
        ngayVaoLam: new Date(),
        trangThai: trangThai === "HOAT_DONG" ? "DANG_LAM" : "NGHI_VIEC",
      });
    }

    return res.json({ message: "Thêm tài khoản thành công!", record: newUser });
  } catch (err) {
    return res.status(err.statusCode || (err.code === 11000 ? 409 : 500)).json({ message: "Lỗi tạo tài khoản: " + err.message });
  }
});

app.put("/api/accounts/:id", allowRoles("ADMIN", "QUAN_LY_CHI_NHANH"), async (req, res) => {
  const { id } = req.params;
  const { hoTen, email, tenDangNhap, chiNhanhId, trangThai } = req.body || {};
  try {
    const user = await mongoose.connection.db.collection("nguoi_dung").findOne({ _id: id });
    if (!user) throw httpError(404, "Không tìm thấy tài khoản.");
    if (req.actor.vaiTro !== "ADMIN" && (user.vaiTro !== "KHACH" || (chiNhanhId || user.chiNhanhId) !== req.actor.chiNhanhId)) {
      throw httpError(403, "Chỉ được phân công hội viên vào chi nhánh bạn phụ trách.");
    }
    if (chiNhanhId !== undefined && chiNhanhId !== user.chiNhanhId) {
      if (user.vaiTro === "HUAN_LUYEN_VIEN") throw httpError(409, "Vui lòng duyệt yêu cầu chuyển chi nhánh của HLV.");
      if (user.vaiTro === "QUAN_LY_CHI_NHANH") await validateManagerBranch(mongoose.connection.db, chiNhanhId);
      else await validateTrainerBranch(mongoose.connection.db, chiNhanhId);
    }
    const update = {};
    if (hoTen) update.hoTen = hoTen;
    if (email) update.email = email;
    if (tenDangNhap) update.tenDangNhap = tenDangNhap;
    if (chiNhanhId) update.chiNhanhId = chiNhanhId;
    if (trangThai) update.trangThai = trangThai;

    await mongoose.connection.db
      .collection("nguoi_dung")
      .updateOne({ _id: id }, { $set: update });
    return res.json({ message: "Cập nhật tài khoản thành công!" });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: "Lỗi cập nhật tài khoản: " + err.message });
  }
});

// 2. Permissions
app.put("/api/permissions/:id", allowRoles("ADMIN"), async (req, res) => {
  const { id } = req.params;
  const { vaiTro, chiNhanhId } = req.body || {};
  try {
    const updated = await assignUserRole(mongoose.connection.db, id, vaiTro || "KHACH", chiNhanhId);
    if (vaiTro === "NHAN_VIEN") {
      const staffDoc = await mongoose.connection.db.collection("nhan_vien").findOne({ nguoiDungId: id });
      if (!staffDoc) {
        const nextStaffId = await getNextId("nhan_vien", "NS");
        await mongoose.connection.db.collection("nhan_vien").insertOne({
          _id: nextStaffId,
          nguoiDungId: id,
          chiNhanhId: updated.chiNhanhId || "CN001",
          chucDanh: "Lễ tân & CSKH",
          ngayVaoLam: new Date(),
          trangThai: "DANG_LAM",
        });
      }
    }

    return res.json({ message: "Cập nhật phân quyền thành công!" });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: "Lỗi phân quyền: " + err.message });
  }
});

// Admin đổi vai trò người dùng
app.put("/api/admin/change-role", allowRoles("ADMIN"), async (req, res) => {
  const { userId, newRole, chiNhanhId } = req.body || {};
  if (!userId || !newRole) return res.status(400).json({ message: "Thiếu userId hoặc newRole." });
  const allowedRoles = ["KHACH", "NHAN_VIEN", "HUAN_LUYEN_VIEN", "QUAN_LY_CHI_NHANH"];
  if (!allowedRoles.includes(newRole)) return res.status(400).json({ message: "Vai trò không hợp lệ." });
  try {
    const db = mongoose.connection.db;
    const updated = await assignUserRole(db, userId, newRole, chiNhanhId);
    if (newRole === "NHAN_VIEN") {
      const staffDoc = await db.collection("nhan_vien").findOne({ nguoiDungId: userId });
      if (!staffDoc) {
        const nextStaffId = await getNextId("nhan_vien", "NS");
        await db.collection("nhan_vien").insertOne({
          _id: nextStaffId,
          nguoiDungId: userId,
          chiNhanhId: updated.chiNhanhId || "CN001",
          chucDanh: "Lễ tân & CSKH",
          ngayVaoLam: new Date(),
          trangThai: "DANG_LAM",
        });
      }
    }

    return res.json({ message: `Đã cập nhật vai trò thành ${newRole}!` });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: "Lỗi đổi vai trò: " + err.message });
  }
});

// Admin set trạng thái tài khoản (khóa/mở khóa)
app.put("/api/admin/set-status", allowRoles("ADMIN"), async (req, res) => {
  const { userId, trangThai } = req.body || {};
  if (!userId || !trangThai) return res.status(400).json({ message: "Thiếu userId hoặc trangThai." });
  try {
    const db = mongoose.connection.db;
    await db.collection("nguoi_dung").updateOne({ _id: userId }, { $set: { trangThai } });
    return res.json({ message: `Đã cập nhật trạng thái tài khoản!` });
  } catch (err) {
    return res.status(500).json({ message: "Lỗi cập nhật trạng thái: " + err.message });
  }
});

// 3. Branches
app.post("/api/branches", allowRoles("ADMIN"), async (req, res) => {
  const { tenChiNhanh, diaChi, soDienThoai, trangThai } = req.body || {};
  try {
    const nextId = await getNextId("chi_nhanh", "CN");
    const newBranch = {
      _id: nextId,
      tenChiNhanh: tenChiNhanh || `Chi nhánh ${nextId}`,
      diaChi: diaChi || "Địa chỉ mới",
      soDienThoai: soDienThoai || "0900000000",
      trangThai: trangThai || "HOAT_DONG",
    };
    await mongoose.connection.db.collection("chi_nhanh").insertOne(newBranch);
    return res.json({ message: "Thêm chi nhánh thành công!", record: newBranch });
  } catch (err) {
    return res.status(500).json({ message: "Lỗi tạo chi nhánh: " + err.message });
  }
});

app.put("/api/branches/:id", allowRoles("ADMIN"), async (req, res) => {
  const { id } = req.params;
  const { tenChiNhanh, diaChi, soDienThoai, trangThai } = req.body || {};
  try {
    const update = {};
    if (tenChiNhanh) update.tenChiNhanh = tenChiNhanh;
    if (diaChi) update.diaChi = diaChi;
    if (soDienThoai) update.soDienThoai = soDienThoai;
    if (trangThai) update.trangThai = trangThai;

    await mongoose.connection.db
      .collection("chi_nhanh")
      .updateOne({ _id: id }, { $set: update });
    return res.json({ message: "Cập nhật chi nhánh thành công!" });
  } catch (err) {
    return res.status(500).json({ message: "Lỗi cập nhật chi nhánh: " + err.message });
  }
});

// 4. Staff
app.post("/api/staff", allowRoles("ADMIN", "QUAN_LY_CHI_NHANH"), async (req, res) => {
  const { hoTen, email, chucDanh, ngayVaoLam, trangThai, chiNhanhId = "CN001" } = req.body || {};
  try {
    const nextUserId = await getNextId("nguoi_dung", "ND");
    const newUser = {
      _id: nextUserId,
      hoTen: hoTen || "Nhân viên mới",
      email: email || `${nextUserId.toLowerCase()}@gymstation.vn`,
      tenDangNhap: nextUserId.toLowerCase(),
      matKhauHash: hashPassword("123"),
      soDienThoai: "0900000000",
      vaiTro: "NHAN_VIEN",
      chiNhanhId,
      trangThai: "HOAT_DONG",
      ngayTao: new Date(),
      version: 0,
    };
    await mongoose.connection.db.collection("nguoi_dung").insertOne(newUser);

    const nextStaffId = await getNextId("nhan_vien", "NS");
    const newStaff = {
      _id: nextStaffId,
      nguoiDungId: nextUserId,
      chiNhanhId,
      chucDanh: chucDanh || "Lễ tân",
      ngayVaoLam: ngayVaoLam ? new Date(ngayVaoLam) : new Date(),
      trangThai: trangThai || "DANG_LAM",
    };
    await mongoose.connection.db.collection("nhan_vien").insertOne(newStaff);

    return res.json({ message: "Thêm nhân viên thành công!", record: newStaff });
  } catch (err) {
    return res.status(500).json({ message: "Lỗi tạo nhân viên: " + err.message });
  }
});

app.put("/api/staff/:id", allowRoles("ADMIN", "QUAN_LY_CHI_NHANH"), async (req, res) => {
  const { id } = req.params;
  const { hoTen, email, chucDanh, ngayVaoLam, trangThai, soDienThoai } = req.body || {};
  try {
    const staff = await mongoose.connection.db.collection("nhan_vien").findOne({ _id: id });
    if (!staff) return res.status(404).json({ message: "Không tìm thấy nhân viên" });

    const staffUpdate = {};
    if (chucDanh) staffUpdate.chucDanh = chucDanh.trim();
    if (ngayVaoLam) staffUpdate.ngayVaoLam = new Date(ngayVaoLam);
    if (trangThai) staffUpdate.trangThai = trangThai;

    await mongoose.connection.db
      .collection("nhan_vien")
      .updateOne({ _id: id }, { $set: staffUpdate });

    if (hoTen || email || soDienThoai || trangThai) {
      const userUpdate = {};
      if (hoTen) userUpdate.hoTen = hoTen.trim();
      if (email) userUpdate.email = email.trim().toLowerCase();
      if (soDienThoai) userUpdate.soDienThoai = soDienThoai.trim();
      if (trangThai) {
        userUpdate.trangThai = trangThai === "DANG_LAM" ? "HOAT_DONG" : "KHOA";
      }
      await mongoose.connection.db
        .collection("nguoi_dung")
        .updateOne({ _id: staff.nguoiDungId }, { $set: userUpdate });
    }

    return res.json({ message: "Cập nhật nhân viên thành công!" });
  } catch (err) {
    return res.status(500).json({ message: "Lỗi cập nhật nhân viên: " + err.message });
  }
});

// 5. Trainers
app.post("/api/trainers", allowRoles("ADMIN", "QUAN_LY_CHI_NHANH"), async (req, res) => {
  const { hoTen, email, chuyenMon, moTa, trangThai, chiNhanhId } = req.body || {};
  try {
    const db = mongoose.connection.db;
    const selectedBranch = await validateTrainerBranch(db, chiNhanhId);
    const nextUserId = await getNextId("nguoi_dung", "ND");
    const newUser = {
      _id: nextUserId,
      hoTen: hoTen || "Huấn luyện viên",
      email: email?.trim().toLowerCase() || `${nextUserId.toLowerCase()}@gymstation.vn`,
      tenDangNhap: nextUserId.toLowerCase(),
      matKhauHash: hashPassword("1"),
      soDienThoai: "0900000000",
      vaiTro: "HUAN_LUYEN_VIEN",
      chiNhanhId: selectedBranch,
      trangThai: trangThai === "NGHI_VIEC" ? "KHOA" : "HOAT_DONG",
      ngayTao: new Date(),
      version: 0,
    };
    const newTrainer = await createLinkedTrainer(db, newUser, { chuyenMon, moTa, trangThai });

    return res.json({ message: "Thêm huấn luyện viên thành công!", record: newTrainer });
  } catch (err) {
    return res.status(err.statusCode || (err.code === 11000 ? 409 : 500)).json({ message: "Lỗi thêm HLV: " + err.message });
  }
});

app.put("/api/trainers/:id", allowRoles("ADMIN", "QUAN_LY_CHI_NHANH"), async (req, res) => {
  const { id } = req.params;
  const { hoTen, email, chuyenMon, moTa, trangThai, soDienThoai, chiNhanhId } = req.body || {};
  try {
    const db = mongoose.connection.db;
    const trainer = await db.collection("huan_luyen_vien").findOne({ _id: id });
    if (!trainer) return res.status(404).json({ message: "Không tìm thấy HLV" });
    const user = await db.collection("nguoi_dung").findOne({ _id: trainer.nguoiDungId });
    if (!user || user.vaiTro !== "HUAN_LUYEN_VIEN") {
      return res.status(404).json({ message: "Tài khoản HLV liên kết không còn tồn tại." });
    }
    if (req.actor.vaiTro === "QUAN_LY_CHI_NHANH" && user.chiNhanhId !== req.actor.chiNhanhId) {
      throw httpError(403, "HLV không thuộc chi nhánh bạn phụ trách.");
    }
    if (chiNhanhId !== undefined && chiNhanhId !== user.chiNhanhId) {
      throw httpError(409, "Vui lòng duyệt yêu cầu chuyển chi nhánh của HLV.");
    }
    const userUpdate = {};
    if (hoTen?.trim()) userUpdate.hoTen = hoTen.trim();
    if (email?.trim()) userUpdate.email = email.trim().toLowerCase();
    if (soDienThoai?.trim()) userUpdate.soDienThoai = soDienThoai.trim();
    if (chiNhanhId !== undefined) userUpdate.chiNhanhId = await validateTrainerBranch(db, chiNhanhId);
    if (trangThai) userUpdate.trangThai = trangThai === "DANG_LAM" ? "HOAT_DONG" : "KHOA";
    let profileWritten = false;
    try {
      await ensureTrainerProfile(db, { ...user, ...userUpdate }, { chuyenMon, moTa, trangThai });
      profileWritten = true;
      if (Object.keys(userUpdate).length > 0) await db.collection("nguoi_dung").updateOne({ _id: user._id }, { $set: userUpdate });
    } catch (error) {
      if (profileWritten) await restoreTrainerProfile(db, user._id, trainer);
      throw error;
    }

    return res.json({ message: "Cập nhật HLV thành công!" });
  } catch (err) {
    return res.status(err.statusCode || (err.code === 11000 ? 409 : 500)).json({ message: "Lỗi cập nhật HLV: " + err.message });
  }
});

// 6. Equipment
app.post("/api/equipment", async (req, res) => {
  const { tenThietBi, maTaiSan, loaiThietBi, viTri, ngayMua, trangThai, chiNhanhId = "CN001" } = req.body || {};
  try {
    const nextId = await getNextId("thiet_bi", "TB");
    const newEq = {
      _id: nextId,
      chiNhanhId,
      tenThietBi: tenThietBi || "Thiết bị mới",
      loaiThietBi: loaiThietBi || "CARDIO",
      maTaiSan: maTaiSan || `TS-${nextId}`,
      viTri: viTri || "Tầng 1",
      ngayMua: ngayMua ? new Date(ngayMua) : new Date(),
      trangThai: trangThai || "SU_DUNG",
    };
    await mongoose.connection.db.collection("thiet_bi").insertOne(newEq);
    return res.json({ message: "Thêm thiết bị thành công!", record: newEq });
  } catch (err) {
    return res.status(500).json({ message: "Lỗi thêm thiết bị: " + err.message });
  }
});

app.put("/api/equipment/:id", async (req, res) => {
  const { id } = req.params;
  const { tenThietBi, maTaiSan, loaiThietBi, viTri, ngayMua, trangThai } = req.body || {};
  try {
    const update = {};
    if (tenThietBi) update.tenThietBi = tenThietBi;
    if (maTaiSan) update.maTaiSan = maTaiSan;
    if (loaiThietBi) update.loaiThietBi = loaiThietBi;
    if (viTri) update.viTri = viTri;
    if (ngayMua) update.ngayMua = new Date(ngayMua);
    if (trangThai) update.trangThai = trangThai;

    await mongoose.connection.db
      .collection("thiet_bi")
      .updateOne({ _id: id }, { $set: update });
    return res.json({ message: "Cập nhật thiết bị thành công!" });
  } catch (err) {
    return res.status(500).json({ message: "Lỗi cập nhật thiết bị: " + err.message });
  }
});

// 7. Maintenance
app.post("/api/maintenance", async (req, res) => {
  const { thietBi, ngayDuKien, noiDung, chiPhi, trangThai, currentUserId = "QL001" } = req.body || {};
  try {
    const nextId = await getNextId("bao_tri_thiet_bi", "BT");
    // Find device by name or ID
    const eq = await mongoose.connection.db.collection("thiet_bi").findOne({
      $or: [{ _id: thietBi }, { tenThietBi: thietBi }],
    });
    const thietBiId = eq ? eq._id : "TB001";
    const statusVal = trangThai || "DU_KIEN";

    const newMaint = {
      _id: nextId,
      thietBiId,
      nguoiLapId: currentUserId,
      ngayDuKien: ngayDuKien ? new Date(ngayDuKien) : new Date(),
      ngayHoanThanh: statusVal === "HOAN_THANH" ? new Date() : null,
      noiDung: noiDung || "Bảo dưỡng định kỳ",
      chiPhi: Number(chiPhi || 0),
      trangThai: statusVal,
    };
    await mongoose.connection.db.collection("bao_tri_thiet_bi").insertOne(newMaint);
    return res.json({ message: "Tạo lịch bảo trì thành công!", record: newMaint });
  } catch (err) {
    return res.status(500).json({ message: "Lỗi tạo lịch bảo trì: " + err.message });
  }
});

app.put("/api/maintenance/:id", async (req, res) => {
  const { id } = req.params;
  const { ngayDuKien, noiDung, chiPhi, trangThai } = req.body || {};
  try {
    const update = {};
    if (ngayDuKien) update.ngayDuKien = new Date(ngayDuKien);
    if (noiDung) update.noiDung = noiDung;
    if (chiPhi !== undefined) update.chiPhi = Number(chiPhi);
    if (trangThai) {
      update.trangThai = trangThai;
      update.ngayHoanThanh = trangThai === "HOAN_THANH" ? new Date() : null;
    }

    await mongoose.connection.db
      .collection("bao_tri_thiet_bi")
      .updateOne({ _id: id }, { $set: update });
    return res.json({ message: "Cập nhật bảo trì thành công!" });
  } catch (err) {
    return res.status(500).json({ message: "Lỗi cập nhật bảo trì: " + err.message });
  }
});

// 8. Members
app.post("/api/members", allowRoles("ADMIN", "NHAN_VIEN", "QUAN_LY_CHI_NHANH"), async (req, res) => {
  const { hoTen, email, soDienThoai, chiNhanhId = req.actor.chiNhanhId } = req.body || {};
  try {
    await validateTrainerBranch(mongoose.connection.db, chiNhanhId);
    if (req.actor.vaiTro !== "ADMIN" && chiNhanhId !== req.actor.chiNhanhId) {
      throw httpError(403, "Chỉ được thêm hội viên vào chi nhánh bạn phụ trách.");
    }
    const nextId = await getNextId("nguoi_dung", "ND");
    const newUser = {
      _id: nextId,
      hoTen: hoTen || "Hội viên mới",
      email: email || `${nextId.toLowerCase()}@example.com`,
      tenDangNhap: nextId.toLowerCase(),
      matKhauHash: hashPassword("123"),
      soDienThoai: soDienThoai || "0900000000",
      vaiTro: "KHACH",
      chiNhanhId,
      trangThai: "HOAT_DONG",
      ngayTao: new Date(),
      version: 0,
    };
    await mongoose.connection.db.collection("nguoi_dung").insertOne(newUser);
    return res.json({ message: "Thêm hồ sơ hội viên thành công!", record: newUser });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: "Lỗi thêm hội viên: " + err.message });
  }
});

app.put("/api/members/:id", allowRoles("ADMIN", "NHAN_VIEN", "QUAN_LY_CHI_NHANH"), async (req, res) => {
  const { id } = req.params;
  const { hoTen, email, soDienThoai, trangThai } = req.body || {};
  try {
    const member = await mongoose.connection.db.collection("nguoi_dung").findOne({ _id: id, vaiTro: "KHACH" });
    if (!member) throw httpError(404, "Không tìm thấy hội viên.");
    if (req.actor.vaiTro !== "ADMIN" && member.chiNhanhId !== req.actor.chiNhanhId) {
      throw httpError(403, "Hội viên không thuộc chi nhánh bạn phụ trách.");
    }
    const update = {};
    if (hoTen) update.hoTen = hoTen.trim();
    if (email) update.email = email.trim();
    if (soDienThoai) update.soDienThoai = soDienThoai.trim();
    if (trangThai) {
      update.trangThai =
        trangThai === "DANG_SU_DUNG" || trangThai === "HOAT_DONG"
          ? "HOAT_DONG"
          : "KHOA";
    }

    await mongoose.connection.db
      .collection("nguoi_dung")
      .updateOne({ _id: id }, { $set: update });
    return res.json({ message: "Cập nhật hội viên thành công!" });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: "Lỗi cập nhật hội viên: " + err.message });
  }
});

// Chức năng Cấp lại mật khẩu cho hội viên về 1 (dành cho Nhân viên)
app.post("/api/members/:id/reset-password", allowRoles("ADMIN", "NHAN_VIEN", "QUAN_LY_CHI_NHANH"), async (req, res) => {
  const { id } = req.params;
  try {
    const db = mongoose.connection.db;
    let member = await db.collection("nguoi_dung").findOne({ _id: id });
    if (!member) {
      member = await db.collection("nguoi_dung").findOne({
        $or: [
          { tenDangNhap: id },
          { email: id },
          { hoTen: id },
        ],
      });
    }

    if (!member || member.vaiTro !== "KHACH") {
      return res.status(404).json({ message: "Không tìm thấy hội viên có mã: " + id });
    }
    if (req.actor.vaiTro !== "ADMIN" && member.chiNhanhId !== req.actor.chiNhanhId) {
      throw httpError(403, "Hội viên không thuộc chi nhánh bạn phụ trách.");
    }

    const newHash = hashPassword("1");
    await db.collection("nguoi_dung").updateOne(
      { _id: member._id },
      {
        $set: { matKhauHash: newHash },
      }
    );

    return res.json({
      message: `Đã cấp lại mật khẩu cho hội viên "${member.hoTen}" thành công! Mật khẩu mới là 1.`,
      member: {
        id: member._id,
        name: member.hoTen,
        username: member.tenDangNhap,
      },
    });
  } catch (err) {
    console.error("Lỗi cấp lại mật khẩu:", err);
    return res.status(err.statusCode || 500).json({ message: "Lỗi hệ thống khi cấp lại mật khẩu: " + err.message });
  }
});

// 9. Shifts
app.post("/api/shifts", async (req, res) => {
  const { trainer, ngayTap, gioBatDau, gioKetThuc, trangThai, chiNhanhId = "CN001" } = req.body || {};
  try {
    const nextId = await getNextId("lich_lam_viec_pt", "LL");
    let ptId = null;
    if (trainer) {
      const ptUser = await mongoose.connection.db.collection("nguoi_dung").findOne({
        $or: [{ hoTen: trainer }, { tenDangNhap: trainer }, { _id: trainer }],
      });
      if (ptUser) {
        let ptDoc = await mongoose.connection.db.collection("huan_luyen_vien").findOne({ nguoiDungId: ptUser._id });
        if (!ptDoc) {
          const nextPtId = await getNextId("huan_luyen_vien", "PT");
          ptDoc = {
            _id: nextPtId,
            nguoiDungId: ptUser._id,
            chiNhanhId: ptUser.chiNhanhId || chiNhanhId,
            chuyenMon: "Sức mạnh & thể hình",
            moTa: "Huấn luyện viên cá nhân chuyên nghiệp",
            trangThai: "DANG_LAM",
          };
          await mongoose.connection.db.collection("huan_luyen_vien").insertOne(ptDoc);
        }
        ptId = ptDoc._id;
      } else {
        const ptDoc = await mongoose.connection.db.collection("huan_luyen_vien").findOne({
          $or: [{ _id: trainer }, { hoTen: trainer }],
        });
        if (ptDoc) ptId = ptDoc._id;
      }
    }
    if (!ptId) {
      const ptFirst = await mongoose.connection.db.collection("huan_luyen_vien").findOne({});
      ptId = ptFirst ? ptFirst._id : "PT001";
    }

    const dateStr = ngayTap || "2026-10-15";
    const startStr = gioBatDau || "08:00";
    const endStr = gioKetThuc || "09:00";

    const newShift = {
      _id: nextId,
      ptId,
      chiNhanhId,
      batDauLuc: new Date(`${dateStr}T${startStr}:00.000Z`),
      ketThucLuc: new Date(`${dateStr}T${endStr}:00.000Z`),
      trangThai: trangThai || "SAN_SANG",
      version: 0,
    };
    await mongoose.connection.db.collection("lich_lam_viec_pt").insertOne(newShift);
    return res.json({ message: "Thêm ca làm việc thành công!", record: newShift });
  } catch (err) {
    return res.status(500).json({ message: "Lỗi thêm ca làm việc: " + err.message });
  }
});

app.put("/api/shifts/:id", async (req, res) => {
  const { id } = req.params;
  const { ngayTap, gioBatDau, gioKetThuc, trangThai } = req.body || {};
  try {
    const update = {};
    if (trangThai) update.trangThai = trangThai;
    if (ngayTap && gioBatDau && gioKetThuc) {
      update.batDauLuc = new Date(`${ngayTap}T${gioBatDau}:00.000Z`);
      update.ketThucLuc = new Date(`${ngayTap}T${gioKetThuc}:00.000Z`);
    }
    await mongoose.connection.db
      .collection("lich_lam_viec_pt")
      .updateOne({ _id: id }, { $set: update });
    return res.json({ message: "Cập nhật ca làm việc thành công!" });
  } catch (err) {
    return res.status(500).json({ message: "Lỗi cập nhật ca làm việc: " + err.message });
  }
});

// 10. Appointments / Bookings
app.post("/api/appointments", allowRoles("KHACH", "NHAN_VIEN", "QUAN_LY_CHI_NHANH", "ADMIN"), async (req, res) => {
  const { trainerId, trainer, ngayTap, gioBatDau, gioKetThuc, loaiBuoi, hoiVienIds, ghiChu } = req.body || {};
  try {
    const db = mongoose.connection.db;
    const actor = req.actor;
    const users = await db.collection("nguoi_dung").find({}).toArray();
    const userMap = new Map(users.map((user) => [user._id, user]));
    const profiles = await db.collection("huan_luyen_vien").find({}).toArray();
    const available = profiles.filter((profile) => {
      const user = userMap.get(profile.nguoiDungId);
      return user?.vaiTro === "HUAN_LUYEN_VIEN" && user.trangThai !== "KHOA" && profile.trangThai !== "NGHI_VIEC";
    });
    let pt = available.find((profile) => profile._id === (trainerId || trainer));
    if (!pt && !trainerId && trainer) {
      const matches = available.filter((profile) => {
        const user = userMap.get(profile.nguoiDungId);
        return (actor.vaiTro === "ADMIN" || profile.chiNhanhId === actor.chiNhanhId) &&
          [user.hoTen, user.tenDangNhap, user._id].includes(trainer);
      });
      if (matches.length === 1) pt = matches[0];
    }
    if (!pt) throw httpError(400, "Vui lòng chọn mã PT hợp lệ trong danh sách.");
    if (actor.vaiTro !== "ADMIN" && (!actor.chiNhanhId || pt.chiNhanhId !== actor.chiNhanhId || userMap.get(pt.nguoiDungId)?.chiNhanhId !== actor.chiNhanhId)) {
      throw httpError(403, "Chỉ được đặt PT thuộc chi nhánh đã được phân công.");
    }
    let memberArr = Array.isArray(hoiVienIds) ? hoiVienIds : typeof hoiVienIds === "string" ? hoiVienIds.split(",").map((id) => id.trim()).filter(Boolean) : [];
    if (actor.vaiTro === "KHACH") {
      if (memberArr.some((id) => id !== actor._id)) throw httpError(403, "Hội viên chỉ được đặt lịch cho chính mình.");
      memberArr = [actor._id];
    } else {
      if (!memberArr.length) throw httpError(400, "Vui lòng chọn hội viên tham gia.");
      for (const id of memberArr) {
        const member = userMap.get(id);
        if (!member || member.vaiTro !== "KHACH" || member.chiNhanhId !== pt.chiNhanhId) throw httpError(403, "Hội viên và PT phải cùng chi nhánh được phân công.");
      }
    }
    const nextId = await getNextId("lich_dat_pt", "LDP");
    const dateStr = ngayTap || "2026-10-15";
    const startStr = gioBatDau || "08:00";
    const endStr = gioKetThuc || "09:00";
    const record = {
      _id: nextId, lichLamViecId: "LL001", ptId: pt._id, chiNhanhId: pt.chiNhanhId,
      hoiVienIds: memberArr, loaiBuoi: memberArr.length > 1 ? "NHOM_NHO" : loaiBuoi || "CA_NHAN", soNguoi: memberArr.length,
      batDauLuc: new Date(dateStr + "T" + startStr + ":00.000Z"), ketThucLuc: new Date(dateStr + "T" + endStr + ":00.000Z"),
      trangThai: "CHO_XAC_NHAN", ghiChu: ghiChu || "", nguoiDatId: actor._id, ngayTao: new Date(), version: 0,
    };
    await db.collection("lich_dat_pt").insertOne(record);
    return res.json({ message: "Đặt lịch PT thành công!", record });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
});

app.put("/api/appointments/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};
  try {
    await mongoose.connection.db
      .collection("lich_dat_pt")
      .updateOne({ _id: id }, { $set: { trangThai: status } });
    return res.json({ message: `Đã cập nhật trạng thái lịch hẹn: ${status}!` });
  } catch (err) {
    return res.status(500).json({ message: "Lỗi cập nhật lịch hẹn: " + err.message });
  }
});

// 11. Packages (Gói tập)
app.get("/api/goi-tap", async (req, res) => {
  try {
    const list = await mongoose.connection.db
      .collection("goi_tap")
      .find({})
      .toArray();
    return res.json(list);
  } catch (err) {
    return res.status(500).json({ message: "Lỗi tải gói tập" });
  }
});

app.post("/api/goi-tap", async (req, res) => {
  const { tenGoi, loaiGoi, gia, thoiHanNgay, chiNhanhId, trangThai } = req.body || {};
  try {
    const nextId = await getNextId("goi_tap", "GT");
    const newPkg = {
      _id: nextId,
      tenGoi: tenGoi || "Gói tập mới",
      chiNhanhId: chiNhanhId || "CN001",
      loaiGoi: loaiGoi || "GYM",
      thoiHanNgay: Number(thoiHanNgay || 30),
      gia: Number(gia || 290000),
      quyenLoi: [
        "Sử dụng phòng gym tại chi nhánh",
        "Tập luyện cùng huấn luyện viên theo lịch",
      ],
      moTa: `Gói tập ${tenGoi || nextId}`,
      trangThai: trangThai || "DANG_BAN",
    };
    await mongoose.connection.db.collection("goi_tap").insertOne(newPkg);
    return res.json({ message: "Thêm gói tập thành công!", record: newPkg });
  } catch (err) {
    return res.status(500).json({ message: "Lỗi thêm gói tập: " + err.message });
  }
});

app.put("/api/goi-tap/:id", async (req, res) => {
  const { id } = req.params;
  const { tenGoi, loaiGoi, gia, thoiHanNgay, chiNhanhId, trangThai } = req.body || {};
  try {
    const update = {};
    if (tenGoi) update.tenGoi = tenGoi;
    if (loaiGoi) update.loaiGoi = loaiGoi;
    if (gia !== undefined) update.gia = Number(gia);
    if (thoiHanNgay !== undefined) update.thoiHanNgay = Number(thoiHanNgay);
    if (chiNhanhId) update.chiNhanhId = chiNhanhId;
    if (trangThai) update.trangThai = trangThai;

    await mongoose.connection.db
      .collection("goi_tap")
      .updateOne({ _id: id }, { $set: update });
    return res.json({ message: "Cập nhật gói tập thành công!" });
  } catch (err) {
    return res.status(500).json({ message: "Lỗi cập nhật gói tập: " + err.message });
  }
});

// 12. Orders & Payments
app.get("/api/orders", async (req, res) => {
  try {
    const list = await mongoose.connection.db
      .collection("don_hang")
      .find({})
      .sort({ ngayTao: -1 })
      .toArray();
    return res.json(list);
  } catch (err) {
    return res.status(500).json({ message: "Lỗi tải đơn hàng" });
  }
});

app.post("/api/orders", async (req, res) => {
  const { pkgId, memberId, startDate, isRenew, currentUserId } = req.body || {};
  try {
    let pkg = null;
    if (pkgId) {
      pkg = await mongoose.connection.db.collection("goi_tap").findOne({ _id: pkgId });
    }
    if (!pkg) {
      pkg = await mongoose.connection.db.collection("goi_tap").findOne({});
    }

    const nextId = await getNextId("don_hang", "DH");
    const price = Number(pkg ? pkg.gia : 290000);
    const days = Number(pkg ? pkg.thoiHanNgay : 30);
    const buyerId = memberId || currentUserId || "";

    const newOrder = {
      _id: nextId,
      nguoiDungId: buyerId,
      chiNhanhId: pkg ? pkg.chiNhanhId : "CN001",
      goiTapId: pkg ? pkg._id : "GT001",
      loaiDon: isRenew ? "GIA_HAN" : "DANG_KY",
      tenGoiLucMua: pkg ? pkg.tenGoi : "Gym cơ bản",
      thoiHanNgayLucMua: days,
      giaLucMua: price,
      giamGia: 0,
      tongTien: price,
      trangThai: "CHO_THANH_TOAN",
      ngayTao: new Date(),
      nguoiLapId: currentUserId || buyerId,
      version: 0,
    };

    await mongoose.connection.db.collection("don_hang").insertOne(newOrder);
    return res.json({ message: "Đã tạo đơn hàng thành công!", order: newOrder });
  } catch (err) {
    return res.status(500).json({ message: "Lỗi tạo đơn hàng: " + err.message });
  }
});

// 12.1 Member requests payment approval (Chuyển khoản QR)
app.post("/api/payments/request", async (req, res) => {
  const { orderId, method = "CHUYEN_KHOAN", currentUserId } = req.body || {};
  try {
    const order = await mongoose.connection.db
      .collection("don_hang")
      .findOne({ _id: orderId });
    if (!order) return res.status(404).json({ message: "Không tìm thấy đơn hàng" });

    await mongoose.connection.db.collection("yeu_cau_thanh_toan").updateOne(
      { donHangId: orderId },
      {
        $set: {
          donHangId: orderId,
          hoiVienId: order.nguoiDungId,
          phuongThuc: method,
          soTien: order.tongTien,
          trangThai: "CHO_DUYET",
          ngayYeuCau: new Date(),
          thongBao: {
            trangThai: "CHO_DUYET",
            noiDung: `Đơn hàng ${orderId} đang chờ nhân viên kiểm tra và xác nhận chuyển khoản.`,
            ngayTao: new Date(),
          },
        },
      },
      { upsert: true },
    );

    return res.json({
      message: "Đã gửi yêu cầu thanh toán chuyển khoản! Đang chờ nhân viên đối soát.",
      orderId,
    });
  } catch (err) {
    return res.status(500).json({ message: "Lỗi gửi yêu cầu thanh toán: " + err.message });
  }
});

// 12.2 Staff confirms payment approval ("Có" / "Không")
app.post("/api/payments/confirm", async (req, res) => {
  const { orderId, approved, currentUserId, reason } = req.body || {};
  try {
    const order = await mongoose.connection.db
      .collection("don_hang")
      .findOne({ _id: orderId });
    if (!order) return res.status(404).json({ message: "Không tìm thấy đơn hàng" });

    if (approved) {
      // 1. Update Order in don_hang to DA_THANH_TOAN
      await mongoose.connection.db.collection("don_hang").updateOne(
        { _id: orderId },
        { $set: { trangThai: "DA_THANH_TOAN" } },
      );

      // 2. Update yeu_cau_thanh_toan
      await mongoose.connection.db.collection("yeu_cau_thanh_toan").updateOne(
        { donHangId: orderId },
        {
          $set: {
            trangThai: "DA_DUYET",
            daDuyetLuc: new Date(),
            nguoiDuyetId: currentUserId || "NV001",
            thongBao: {
              trangThai: "DA_DUYET",
              noiDung: `Đơn hàng ${orderId} (${order.tenGoiLucMua || "Gói tập"}) của bạn đã được nhân viên DUYỆT THÀNH CÔNG! Gói tập đã được kích hoạt.`,
              ngayTao: new Date(),
              daXem: false,
            },
          },
        },
        { upsert: true },
      );

      // 3. Insert Payment record
      const nextPayId = await getNextId("thanh_toan", "TT");
      const paymentRecord = {
        _id: nextPayId,
        donHangId: order._id,
        soTien: order.tongTien,
        phuongThuc: "CHUYEN_KHOAN",
        maGiaoDich: `MB-${Date.now().toString().slice(-6)}`,
        nguoiGhiNhanId: currentUserId || "NV001",
        ngayThanhToan: new Date(),
        trangThai: "THANH_CONG",
      };
      await mongoose.connection.db.collection("thanh_toan").insertOne(paymentRecord);

      // 4. Create / activate registered membership package
      const nextDkgId = await getNextId("dang_ky_goi", "DKG");
      const start = new Date();
      const end = new Date(start.getTime() + (order.thoiHanNgayLucMua || 30) * 86400000);
      const newDkg = {
        _id: nextDkgId,
        hoiVienId: order.nguoiDungId,
        goiTapId: order.goiTapId,
        donHangId: order._id,
        chiNhanhId: order.chiNhanhId,
        ngayBatDau: start,
        ngayKetThuc: end,
        giaLucMua: order.giaLucMua,
        trangThai: "DANG_SU_DUNG",
      };
      await mongoose.connection.db.collection("dang_ky_goi").insertOne(newDkg);

      return res.json({
        message: "Đã duyệt thanh toán thành công! Gói tập của hội viên đã được kích hoạt.",
        approved: true,
      });
    } else {
      // Staff selected "Không" (Chưa nhận được tiền)
      await mongoose.connection.db.collection("yeu_cau_thanh_toan").updateOne(
        { donHangId: orderId },
        {
          $set: {
            trangThai: "TU_CHOI",
            daDuyetLuc: new Date(),
            nguoiDuyetId: currentUserId || "NV001",
            lyDoTuChoi: reason || "Nhân viên chưa nhận được tiền chuyển khoản",
            thongBao: {
              trangThai: "TU_CHOI",
              noiDung: `Đơn hàng ${orderId} (${order.tenGoiLucMua || "Gói tập"}) CHƯA ĐƯỢC DUYỆT (Nhân viên chưa nhận được tiền chuyển khoản).`,
              ngayTao: new Date(),
              daXem: false,
            },
          },
        },
        { upsert: true },
      );

      return res.json({
        message: "Đã ghi nhận không nhận được tiền. Đơn hàng chuyển sang trạng thái Chưa duyệt.",
        approved: false,
      });
    }
  } catch (err) {
    return res.status(500).json({ message: "Lỗi duyệt thanh toán: " + err.message });
  }
});

app.post("/api/payments", async (req, res) => {
  const { orderId, method = "CHUYEN_KHOAN", txCode, currentUserId, approved, isRequest } = req.body || {};
  try {
    const order = await mongoose.connection.db
      .collection("don_hang")
      .findOne({ _id: orderId });
    if (!order) return res.status(404).json({ message: "Không tìm thấy đơn hàng" });

    if (isRequest) {
      await mongoose.connection.db.collection("yeu_cau_thanh_toan").updateOne(
        { donHangId: orderId },
        {
          $set: {
            donHangId: orderId,
            hoiVienId: order.nguoiDungId,
            phuongThuc: method,
            soTien: order.tongTien,
            trangThai: "CHO_DUYET",
            ngayYeuCau: new Date(),
            thongBao: {
              trangThai: "CHO_DUYET",
              noiDung: `Đơn hàng ${orderId} đang chờ nhân viên kiểm tra và xác nhận chuyển khoản.`,
              ngayTao: new Date(),
            },
          },
        },
        { upsert: true },
      );
      return res.json({ message: "Đã gửi yêu cầu thanh toán thành công! Chờ duyệt." });
    }

    if (approved === false) {
      await mongoose.connection.db.collection("yeu_cau_thanh_toan").updateOne(
        { donHangId: orderId },
        {
          $set: {
            trangThai: "TU_CHOI",
            daDuyetLuc: new Date(),
            nguoiDuyetId: currentUserId || "NV001",
            thongBao: {
              trangThai: "TU_CHOI",
              noiDung: `Đơn hàng ${orderId} CHƯA ĐƯỢC DUYỆT (Nhân viên chưa nhận được thanh toán).`,
              ngayTao: new Date(),
              daXem: false,
            },
          },
        },
        { upsert: true },
      );
      return res.json({ message: "Đã xác nhận không nhận được tiền.", approved: false });
    }

    // Update Order to DA_THANH_TOAN
    await mongoose.connection.db
      .collection("don_hang")
      .updateOne({ _id: orderId }, { $set: { trangThai: "DA_THANH_TOAN" } });

    await mongoose.connection.db.collection("yeu_cau_thanh_toan").updateOne(
      { donHangId: orderId },
      {
        $set: {
          trangThai: "DA_DUYET",
          daDuyetLuc: new Date(),
          nguoiDuyetId: currentUserId || "NV001",
          thongBao: {
            trangThai: "DA_DUYET",
            noiDung: `Đơn hàng ${orderId} đã được nhân viên DUYỆT THÀNH CÔNG! Gói tập đã kích hoạt.`,
            ngayTao: new Date(),
            daXem: false,
          },
        },
      },
      { upsert: true },
    );

    // Insert Payment record
    const nextPayId = await getNextId("thanh_toan", "TT");
    const paymentRecord = {
      _id: nextPayId,
      donHangId: order._id,
      soTien: order.tongTien,
      phuongThuc: method === "TIEN_MAT" ? "TIEN_MAT" : "CHUYEN_KHOAN",
      maGiaoDich: txCode || `TX-${Date.now()}`,
      nguoiGhiNhanId: currentUserId || "NV001",
      ngayThanhToan: new Date(),
      trangThai: "THANH_CONG",
    };
    await mongoose.connection.db.collection("thanh_toan").insertOne(paymentRecord);

    // Create / activate registered membership package
    const nextDkgId = await getNextId("dang_ky_goi", "DKG");
    const start = new Date();
    const end = new Date(start.getTime() + (order.thoiHanNgayLucMua || 30) * 86400000);
    const newDkg = {
      _id: nextDkgId,
      hoiVienId: order.nguoiDungId,
      goiTapId: order.goiTapId,
      donHangId: order._id,
      chiNhanhId: order.chiNhanhId,
      ngayBatDau: start,
      ngayKetThuc: end,
      giaLucMua: order.giaLucMua,
      trangThai: "DANG_SU_DUNG",
    };
    await mongoose.connection.db.collection("dang_ky_goi").insertOne(newDkg);

    return res.json({
      message: "Thanh toán thành công! Gói tập đã được kích hoạt trong MongoDB.",
      payment: paymentRecord,
    });
  } catch (err) {
    return res.status(500).json({ message: "Lỗi thanh toán: " + err.message });
  }
});

// 13. Check-in / Check-out
app.post("/api/checkin", async (req, res) => {
  const { memberId, memberName, packageId, branch = "CN001", currentUserId } = req.body || {};
  try {
    let resolvedMemberId = memberId;
    if (!resolvedMemberId && memberName) {
      const u = await mongoose.connection.db.collection("nguoi_dung").findOne({ hoTen: memberName });
      if (u) resolvedMemberId = u._id;
    }
    const nextId = await getNextId("luot_checkin", "CI");
    const newVisit = {
      _id: nextId,
      hoiVienId: resolvedMemberId || currentUserId || "",
      chiNhanhId: branch,
      dangKyGoiId: packageId || "DKG001",
      vaoLuc: new Date(),
      raLuc: null,
      trangThai: "DANG_TAP",
      nguoiGhiNhanId: currentUserId || "NV001",
    };
    await mongoose.connection.db.collection("luot_checkin").insertOne(newVisit);
    return res.json({ message: "Check-in thành công!", visit: newVisit });
  } catch (err) {
    return res.status(500).json({ message: "Lỗi check-in: " + err.message });
  }
});

app.post("/api/checkout/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await mongoose.connection.db
      .collection("luot_checkin")
      .updateOne(
        { _id: id },
        { $set: { raLuc: new Date(), trangThai: "DA_CHECKOUT" } },
      );
    return res.json({ message: "Check-out thành công!" });
  } catch (err) {
    return res.status(500).json({ message: "Lỗi check-out: " + err.message });
  }
});

// --- Initial Seed Data Helper ---
async function ensureInitialData() {
  try {
    const db = mongoose.connection.db;

    // Only seed an empty database. Never change existing account passwords on restart.
    const usersCount = await db.collection("nguoi_dung").countDocuments();
    if (usersCount === 0) {
      console.log("Khoi tao tai khoan Admin he thong tren MongoDB Atlas...");
      const defaultAdmin = {
        _id: "ND001",
        hoTen: "Admin Hệ Thống",
        email: "admin@gymstation.vn",
        tenDangNhap: "admin",
        matKhauHash: hashPassword("12345"),
        soDienThoai: "0909000005",
        vaiTro: "ADMIN",
        chiNhanhId: null,
        trangThai: "HOAT_DONG",
        ngayTao: new Date(),
        version: 0,
      };
      await db.collection("nguoi_dung").insertOne(defaultAdmin);

      // Branches are created by Admin; never add sample branch records.
      console.log("Khoi tao du lieu ban dau thanh cong!");
    }

    const trainerSync = await syncTrainerProfiles(db);
    console.log(`Dong bo ho so HLV: tao ${trainerSync.created}, da co ${trainerSync.existing}, loi ${trainerSync.errors.length}.`);
    for (const failure of trainerSync.errors) console.warn(`Khong the dong bo HLV ${failure.userId}: ${failure.message}`);
    // Keep staff synchronization independent from PT synchronization failures.
    const allUsers = await db.collection("nguoi_dung").find({}).toArray();
    for (const u of allUsers) {
      if (u.vaiTro === "NHAN_VIEN") {
        const staffExists = await db.collection("nhan_vien").findOne({ nguoiDungId: u._id });
        if (!staffExists) {
          const nextStaffId = await getNextId("nhan_vien", "NS");
          await db.collection("nhan_vien").insertOne({
            _id: nextStaffId,
            nguoiDungId: u._id,
            chiNhanhId: u.chiNhanhId || "CN001",
            chucDanh: "Lễ tân & CSKH",
            ngayVaoLam: new Date(),
            trangThai: u.trangThai === "HOAT_DONG" ? "DANG_LAM" : "NGHI_VIEC",
          });
          console.log(`Dong bo Nhan vien cho ${u.hoTen} (${u._id}) -> ${nextStaffId}`);
        }
      }
    }
  } catch (err) {
    console.warn("Loi khoi tao du lieu mau:", err.message);
  }
}

// --- Server Startup ---
async function startServer() {
  try {
    if (process.env.MONGO_URI) {
      await mongoose.connect(process.env.MONGO_URI);
      mongoReady = true;
      console.log("Ket noi MongoDB Atlas thanh cong (GymManagement)!");
      await ensureInitialData();
      await ensureTransferIndexes(mongoose.connection.db);
    } else {
      console.warn("MONGO_URI chua duoc cau hinh.");
    }

    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(`Server Gym dang chay tai cong ${PORT}`);
    });
  } catch (error) {
    console.error("Loi khoi dong server:", error.message);
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(`Server khoi dong lai tai cong ${PORT}`);
    });
  }
}

if (require.main === module) startServer();

module.exports = { app };
