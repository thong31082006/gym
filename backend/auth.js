const crypto = require("crypto");
const { httpError } = require("./trainer-accounts");

const sessions = new Map();
const SESSION_TTL = 12 * 60 * 60 * 1000;

function issueAuthToken(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { userId, expiresAt: Date.now() + SESSION_TTL });
  return token;
}

async function authenticatedActor(req, db) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const session = sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(token);
    throw httpError(401, "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
  }
  const actor = session.userId === "ADMIN_FIXED"
    ? { _id: "ADMIN_FIXED", vaiTro: "ADMIN", chiNhanhId: null, trangThai: "HOAT_DONG" }
    : await db.collection("nguoi_dung").findOne({ _id: session.userId });
  if (!actor || actor.trangThai !== "HOAT_DONG") throw httpError(403, "Tài khoản không còn hoạt động.");
  if (req.body?.currentUserId && req.body.currentUserId !== actor._id) {
    throw httpError(403, "Tài khoản thao tác không khớp với phiên đăng nhập.");
  }
  return actor;
}

function allowRoles(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.actor?.vaiTro)) return res.status(403).json({ message: "Tài khoản không có quyền thực hiện thao tác này." });
    next();
  };
}

module.exports = { issueAuthToken, authenticatedActor, allowRoles };
