const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const { app } = require("./server");

const salt = Buffer.alloc(16, 11);
const testHash = `scrypt$16384$8$1$${salt.toString("hex")}$${crypto.scryptSync("transfer-password", salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex")}`;
const user = (_id, hoTen, vaiTro, chiNhanhId) => ({ _id, hoTen, tenDangNhap: _id.toLowerCase(), vaiTro, chiNhanhId, trangThai: "HOAT_DONG", matKhauHash: testHash });
const profile = (_id, nguoiDungId, chiNhanhId) => ({ _id, nguoiDungId, chiNhanhId, chuyenMon: "Thể lực", moTa: "Hồ sơ PT", trangThai: "DANG_LAM" });
const transfer = (_id, nguoiDungId, ptId, fromBranchId, toBranchId) => ({
  _id, nguoiDungId, ptId, fromBranchId, toBranchId, status: "PENDING",
  requestedAt: new Date("2026-11-11T10:00:00.000Z"), reviewedBy: null, reviewedAt: null,
});

function memoryDb() {
  const data = {
    nguoi_dung: [
      user("ND011", "Anh", "HUAN_LUYEN_VIEN", "CN001"),
      user("ND012", "Siu", "HUAN_LUYEN_VIEN", "CN002"),
      user("ND020", "Hội viên 1", "KHACH", "CN001"),
      user("ND021", "Hội viên 2", "KHACH", "CN002"),
      user("QM001", "Quản lý nguồn", "QUAN_LY_CHI_NHANH", "CN001"),
      user("QM002", "Quản lý đích", "QUAN_LY_CHI_NHANH", "CN002"),
      user("QM003", "Quản lý khác", "QUAN_LY_CHI_NHANH", "CN003"),
      user("NV001", "Nhân viên", "NHAN_VIEN", "CN001"),
    ],
    huan_luyen_vien: [profile("PT001", "ND011", "CN001"), profile("PT002", "ND012", "CN002")],
    nhan_vien: [],
    chi_nhanh: ["CN001", "CN002", "CN003"].map((_id) => ({ _id, tenChiNhanh: _id, trangThai: "HOAT_DONG" })),
    goi_tap: [
      { _id: "GT001", tenGoi: "Gym 1", chiNhanhId: "CN001", gia: 300000, thoiHanNgay: 30, trangThai: "DANG_BAN" },
      { _id: "GT002", tenGoi: "Gym 2", chiNhanhId: "CN002", gia: 400000, thoiHanNgay: 30, trangThai: "DANG_BAN" },
    ],
    lich_dat_pt: [
      { _id: "LDP001", ptId: "PT001", chiNhanhId: "CN001", hoiVienIds: ["ND020"], batDauLuc: new Date("2026-11-20T09:00:00.000Z"), ketThucLuc: new Date("2026-11-20T10:00:00.000Z"), trangThai: "CHO_XAC_NHAN" },
      { _id: "LDP002", ptId: "PT002", chiNhanhId: "CN002", hoiVienIds: ["ND020"], batDauLuc: new Date("2026-11-20T09:00:00.000Z"), ketThucLuc: new Date("2026-11-20T10:00:00.000Z"), trangThai: "CHO_XAC_NHAN" },
    ],
    yeu_cau_chuyen_chi_nhanh: [],
  };
  const writes = [];
  let externalWinner = null;
  const checkSession = (options = {}, reading = false) => {
    if (options.session?.aborted) {
      if (reading) db.failedSessionReads += 1;
      throw Object.assign(new Error("Transaction has been aborted"), { code: 251 });
    }
  };
  const matches = (row, query) => Object.entries(query).every(([key, value]) => {
    if (key === "$or") return value.some((clause) => matches(row, clause));
    if (key === "$and") return value.every((clause) => matches(row, clause));
    if (value instanceof RegExp) return value.test(row[key]);
    if (value && typeof value === "object") {
      if ("$in" in value) return value.$in.includes(row[key]);
      if ("$ne" in value) return row[key] !== value.$ne;
      if ("$exists" in value) return Object.prototype.hasOwnProperty.call(row, key) === value.$exists;
    }
    return row[key] === value;
  });
  const db = {
    data, writes, failProfileUpdates: false,
    pendingInsertConflicts: 0, publishConflictWinner: true, failedSessionReads: 0, transactionStarts: 0,
    client: {
      startSession() {
        const session = {
          aborted: false,
          async withTransaction(fn) {
            db.transactionStarts += 1;
            session.aborted = false;
            const snapshot = structuredClone(data);
            try {
              const result = await fn();
              checkSession({ session });
              return result;
            } catch (error) {
              for (const name of new Set([...Object.keys(data), ...Object.keys(snapshot)])) {
                if (snapshot[name]) data[name].splice(0, data[name].length, ...structuredClone(snapshot[name]));
                else delete data[name];
              }
              // A competing transaction's committed record survives our rollback.
              if (externalWinner) {
                data.yeu_cau_chuyen_chi_nhanh.push(externalWinner);
                externalWinner = null;
              }
              throw error;
            } finally {
              session.aborted = false;
            }
          },
          async endSession() {},
        };
        return session;
      },
    },
    collection(name) {
      const rows = data[name] ||= [];
      return {
        async createIndex() { return "unique_pending_trainer_transfer"; },
        find(query = {}, options = {}) {
          checkSession(options, true);
          const cursor = { sort: () => cursor, toArray: async () => {
            checkSession(options, true);
            return structuredClone(rows.filter((row) => matches(row, query)));
          } };
          return cursor;
        },
        async findOne(query = {}, options = {}) {
          checkSession(options, true);
          return structuredClone(rows.find((row) => matches(row, query)) || null);
        },
        async countDocuments(query = {}, options = {}) {
          checkSession(options, true);
          return rows.filter((row) => matches(row, query)).length;
        },
        async insertOne(row, options = {}) {
          checkSession(options);
          if (name === "yeu_cau_chuyen_chi_nhanh" && db.pendingInsertConflicts > 0) {
            assert.ok(options.session, "Pending inserts must participate in the profile transaction");
            db.pendingInsertConflicts -= 1;
            options.session.aborted = true;
            if (db.publishConflictWinner) externalWinner = { ...structuredClone(row), _id: "YCCN_CONCURRENT" };
            throw Object.assign(new Error("Duplicate pending transfer"), { code: 11000 });
          }
          if (rows.some((existing) => existing._id === row._id)) throw Object.assign(new Error("Duplicate _id"), { code: 11000 });
          rows.push(structuredClone(row));
          writes.push({ name, type: "insert", id: row._id });
          return { insertedId: row._id, acknowledged: true };
        },
        async updateOne(query, update, options = {}) {
          checkSession(options);
          if (name === "huan_luyen_vien" && db.failProfileUpdates) throw new Error("PT update unavailable");
          let row = rows.find((item) => matches(item, query));
          let upsertedId = null;
          if (!row && options.upsert) {
            row = { ...query, ...structuredClone(update.$setOnInsert || {}) };
            rows.push(row);
            upsertedId = row._id;
          }
          if (!row) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
          Object.assign(row, structuredClone(update.$set || {}));
          for (const key of Object.keys(update.$unset || {})) delete row[key];
          for (const [key, amount] of Object.entries(update.$inc || {})) row[key] = (row[key] || 0) + amount;
          writes.push({ name, type: "update", id: row._id });
          return { matchedCount: upsertedId ? 0 : 1, modifiedCount: 1, upsertedCount: upsertedId ? 1 : 0, upsertedId };
        },
        async deleteOne(query, options = {}) {
          checkSession(options);
          const index = rows.findIndex((row) => matches(row, query));
          if (index < 0) return { deletedCount: 0 };
          rows.splice(index, 1);
          writes.push({ name, type: "delete" });
          return { deletedCount: 1 };
        },
      };
    },
  };
  return db;
}

const originalDb = mongoose.connection.db;
let db;
let server;
let baseUrl;
let tokens;
before(async () => {
  server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => { db = memoryDb(); mongoose.connection.db = db; tokens = new Map(); });
after(async () => {
  mongoose.connection.db = originalDb;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});
async function tokenFor(actor) {
  if (!actor) return null;
  if (actor === "UNKNOWN") return "invalid-session-token";
  if (tokens.has(actor)) return tokens.get(actor);
  const account = db.data.nguoi_dung.find((row) => row._id === actor);
  const credentials = actor === "ADMIN_FIXED"
    ? { email: "admin", password: "12345", role: "ADMIN" }
    : { email: account.tenDangNhap, password: "transfer-password", role: account.vaiTro };
  const response = await fetch(`${baseUrl}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(credentials) });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.ok(result.token);
  tokens.set(actor, result.token);
  return result.token;
}

async function request(path, method, body, options = {}) {
  const actor = Object.prototype.hasOwnProperty.call(options, "actor") ? options.actor : body?.currentUserId || "ADMIN_FIXED";
  const token = await tokenFor(actor);
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
const memberCatalog = (id, branch = "CN002", role = "KHACH") => request(`/api/data-all?memberId=${id}&branch=${branch}&role=${role}`, "GET", undefined, { actor: id });
const requestTransfer = (toBranchId = "CN002", actor = "ND011") => request("/api/profile/ND011", "PUT", { currentUserId: actor, chiNhanhId: toBranchId });
const decide = (id, currentUserId, decision, actor = currentUserId) => request(`/api/trainer-transfers/${id}/decision`, "PUT", { currentUserId, decision }, { actor: actor || null });
const currentUser = () => db.data.nguoi_dung.find((row) => row._id === "ND011");
const currentProfile = () => db.data.huan_luyen_vien.find((row) => row._id === "PT001");
async function pendingRequest() {
  const response = await requestTransfer();
  assert.equal(response.status, 200);
  return response.body.branchTransfer;
}

test("member catalogs use the stored branch for PTs, packages, and booking tables despite spoofed queries", async () => {
  for (const role of ["KHACH", "ADMIN"]) {
    const response = await memberCatalog("ND020", "CN002", role);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.records.trainers.map((row) => row._id), ["PT001"]);
    assert.ok(response.body.records.accounts.every((row) => row._id !== "ND012"));
    assert.deepEqual(response.body.data.trainers.map((row) => row[0]), ["Anh"]);
    assert.deepEqual(response.body.packages.map((row) => row._id), ["GT001"]);
    assert.deepEqual(response.body.bookings.map((row) => row._id), ["LDP001"]);
    assert.deepEqual(response.body.records.appointments.map((row) => row._id), ["LDP001"]);
    assert.equal(response.body.data.appointments.length, 1);
  }
  const otherIdentityQuery = await request("/api/data-all?memberId=ND021&branch=CN002&role=ADMIN", "GET", undefined, { actor: "ND020" });
  assert.equal(otherIdentityQuery.status, 200);
  assert.deepEqual(otherIdentityQuery.body.records.trainers.map((row) => row._id), ["PT001"]);
  assert.deepEqual(otherIdentityQuery.body.packages.map((row) => row._id), ["GT001"]);
});

test("catalog requests require a real session instead of trusting query identities", async () => {
  const response = await request("/api/data-all?memberId=QM001&role=ADMIN", "GET", undefined, { actor: null });
  assert.equal(response.status, 401);
});

test("a member branch without PTs or packages returns empty real-data lists", async () => {
  db.data.nguoi_dung.find((row) => row._id === "ND020").chiNhanhId = "CN003";

  const response = await memberCatalog("ND020", "CN001");

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.records.trainers, []);
  assert.deepEqual(response.body.data.trainers, []);
  assert.deepEqual(response.body.packages, []);
  assert.deepEqual(response.body.bookings, []);
});

test("appointment creation rejects a member's other-branch PT and allows their own-branch PT", async () => {
  const count = db.data.lich_dat_pt.length;
  const denied = await request("/api/appointments", "POST", { currentUserId: "ND020", trainerId: "PT002", trainer: "Siu", branch: "CN002", role: "NHAN_VIEN" });
  assert.equal(denied.status, 403);
  assert.equal(db.data.lich_dat_pt.length, count);

  const allowed = await request("/api/appointments", "POST", { currentUserId: "ND020", trainerId: "PT001", trainer: "Anh", branch: "CN002" });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.record.ptId, "PT001");
  assert.equal(allowed.body.record.chiNhanhId, "CN001");
});

test("a PT branch selection records a complete pending request without moving either branch", async () => {
  const beforeUser = structuredClone(currentUser());
  const beforeProfile = structuredClone(currentProfile());

  const response = await requestTransfer();

  assert.equal(response.status, 200);
  assert.equal(response.body.account.branch, "CN001");
  assert.deepEqual(currentUser(), beforeUser);
  assert.deepEqual(currentProfile(), beforeProfile);
  const pending = response.body.branchTransfer;
  assert.match(pending._id, /^YCCN/);
  assert.equal(pending.nguoiDungId, "ND011");
  assert.equal(pending.ptId, "PT001");
  assert.equal(pending.fromBranchId, "CN001");
  assert.equal(pending.toBranchId, "CN002");
  assert.equal(pending.status, "PENDING");
  assert.ok(pending.requestedAt);
  assert.equal(pending.reviewedBy, null);
  assert.equal(pending.reviewedAt, null);
  assert.equal(db.data.yeu_cau_chuyen_chi_nhanh.length, 1);
});

test("saving the current PT branch and ordinary profile details creates no transfer", async () => {
  const response = await request("/api/profile/ND011", "PUT", { currentUserId: "ND011", chiNhanhId: "CN001", chuyenMon: "Chuyên môn mới" });

  assert.equal(response.status, 200);
  assert.equal(response.body.account.branch, "CN001");
  assert.equal(currentProfile().chuyenMon, "Chuyên môn mới");
  assert.deepEqual(db.data.yeu_cau_chuyen_chi_nhanh, []);
});

test("repeated requests for the same destination reuse the pending request and different destinations conflict", async () => {
  const first = await pendingRequest();
  const repeated = await requestTransfer();
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.branchTransfer._id, first._id);
  assert.equal(db.data.yeu_cau_chuyen_chi_nhanh.length, 1);

  const different = await requestTransfer("CN003");
  assert.equal(different.status, 409);
  assert.equal(db.data.yeu_cau_chuyen_chi_nhanh.length, 1);
  assert.equal(db.data.yeu_cau_chuyen_chi_nhanh[0].toBranchId, "CN002");
  assert.equal(currentUser().chiNhanhId, "CN001");
  assert.equal(currentProfile().chiNhanhId, "CN001");
});

test("a pending insert collision restarts the aborted transaction and reuses the concurrent winner", async () => {
  db.pendingInsertConflicts = 1;

  const response = await requestTransfer();

  assert.equal(response.status, 200);
  assert.equal(response.body.branchTransfer._id, "YCCN_CONCURRENT");
  assert.equal(db.data.yeu_cau_chuyen_chi_nhanh.length, 1);
  assert.equal(db.data.yeu_cau_chuyen_chi_nhanh[0]._id, "YCCN_CONCURRENT");
  assert.equal(db.failedSessionReads, 0);
  assert.equal(db.transactionStarts, 2);
  assert.equal(currentUser().chiNhanhId, "CN001");
  assert.equal(currentProfile().chiNhanhId, "CN001");
});

test("successive pending insert races stop after a bounded retry with a conflict response", async () => {
  db.pendingInsertConflicts = 2;
  // Competing requests have already been resolved before each fresh snapshot.
  db.publishConflictWinner = false;

  const response = await requestTransfer();

  assert.equal(response.status, 409);
  assert.equal(db.transactionStarts, 2);
  assert.equal(db.failedSessionReads, 0);
  assert.deepEqual(db.data.yeu_cau_chuyen_chi_nhanh, []);
  assert.equal(currentUser().chiNhanhId, "CN001");
  assert.equal(currentProfile().chiNhanhId, "CN001");
});

test("requesting a PT branch change requires that same PT's actual identity", async () => {
  for (const actor of ["UNKNOWN", "ND012", "ND020", "QM001", "ADMIN_FIXED"]) {
    const response = await request("/api/profile/ND011", "PUT", { currentUserId: actor, chiNhanhId: "CN002" }, { actor });
    assert.equal(response.status, actor === "UNKNOWN" ? 401 : actor === "ADMIN_FIXED" ? 409 : 403);
  }
  assert.equal((await request("/api/profile/ND011", "PUT", { chiNhanhId: "CN002" }, { actor: null })).status, 401);
  assert.equal((await request("/api/profile/ND011", "PUT", { currentUserId: "QM001", chiNhanhId: "CN002" }, { actor: "ND011" })).status, 403);
  assert.deepEqual(db.data.yeu_cau_chuyen_chi_nhanh, []);
  assert.equal(currentUser().chiNhanhId, "CN001");
  assert.equal(currentProfile().chiNhanhId, "CN001");
});

test("a PT's authenticated session can request a transfer without a body identity", async () => {
  const response = await request("/api/profile/ND011", "PUT", { chiNhanhId: "CN002" }, { actor: "ND011" });
  assert.equal(response.status, 200);
  assert.equal(response.body.branchTransfer.nguoiDungId, "ND011");
  assert.equal(currentUser().chiNhanhId, "CN001");
});

test("members cannot move their own assigned branch and managers can assign members only to their own branch", async () => {
  const memberChange = await request("/api/profile/ND020", "PUT", { chiNhanhId: "CN002" }, { actor: "ND020" });
  assert.equal(memberChange.status, 403);
  assert.equal(db.data.nguoi_dung.find((row) => row._id === "ND020").chiNhanhId, "CN001");

  const managerAssignment = await request("/api/profile/ND021", "PUT", { chiNhanhId: "CN001" }, { actor: "QM001" });
  assert.equal(managerAssignment.status, 200);
  assert.equal(db.data.nguoi_dung.find((row) => row._id === "ND021").chiNhanhId, "CN001");

  const wrongDestination = await request("/api/profile/ND020", "PUT", { chiNhanhId: "CN003" }, { actor: "QM002" });
  assert.equal(wrongDestination.status, 403);
  assert.equal(db.data.nguoi_dung.find((row) => row._id === "ND020").chiNhanhId, "CN001");
});

test("only the current origin-branch manager can approve or reject a pending request", async () => {
  const pending = await pendingRequest();
  const before = structuredClone(db.data.yeu_cau_chuyen_chi_nhanh);
  for (const actor of ["QM002", "QM003", "ND020", "ND011", "NV001"]) {
    assert.equal((await decide(pending._id, actor, "APPROVED")).status, 403);
  }
  assert.equal((await decide(pending._id, undefined, "APPROVED")).status, 401);
  assert.equal((await decide(pending._id, "QM001", "APPROVED", "ND011")).status, 403);
  const forgedBranch = await request(`/api/trainer-transfers/${pending._id}/decision?branch=CN001&role=QUAN_LY_CHI_NHANH`, "PUT", {
    currentUserId: "QM002", chiNhanhId: "CN001", fromBranchId: "CN001", decision: "APPROVED",
  }, { actor: "QM002" });
  assert.equal(forgedBranch.status, 403);
  assert.deepEqual(db.data.yeu_cau_chuyen_chi_nhanh, before);
  assert.equal(currentUser().chiNhanhId, "CN001");
  assert.equal(currentProfile().chiNhanhId, "CN001");
});

test("a manager's existing session loses approval authority after reassignment, role removal, or account locking", async () => {
  const pending = await pendingRequest();
  await tokenFor("QM001");
  const manager = db.data.nguoi_dung.find((row) => row._id === "QM001");
  const original = structuredClone(manager);
  for (const change of [
    { chiNhanhId: "CN002" },
    { vaiTro: "NHAN_VIEN" },
    { trangThai: "KHOA" },
  ]) {
    Object.assign(manager, original, change);
    assert.equal((await decide(pending._id, "QM001", "APPROVED")).status, 403);
    assert.equal(currentUser().chiNhanhId, "CN001");
    assert.equal(currentProfile().chiNhanhId, "CN001");
    assert.equal(db.data.yeu_cau_chuyen_chi_nhanh[0].status, "PENDING");
  }
});

test("deleted or inactive source branches cannot expose or decide pending transfers", async () => {
  const pending = await pendingRequest();
  const branches = structuredClone(db.data.chi_nhanh);
  for (const state of ["inactive", "deleted"]) {
    db.data.chi_nhanh.splice(0, db.data.chi_nhanh.length, ...structuredClone(branches));
    const index = db.data.chi_nhanh.findIndex((branch) => branch._id === "CN001");
    if (state === "deleted") db.data.chi_nhanh.splice(index, 1);
    else db.data.chi_nhanh[index].trangThai = "NGUNG_HOAT_DONG";
    const catalog = await memberCatalog("QM001", "CN002", "ADMIN");
    assert.equal(catalog.status, 200);
    assert.deepEqual(catalog.body.trainerTransfers, []);
    for (const decision of ["APPROVED", "REJECTED"]) {
      assert.equal((await decide(pending._id, "QM001", decision)).status, 409);
      assert.equal(currentUser().chiNhanhId, "CN001");
      assert.equal(currentProfile().chiNhanhId, "CN001");
      assert.equal(db.data.yeu_cau_chuyen_chi_nhanh[0].status, "PENDING");
    }
  }
});

test("approval rechecks that the saved destination branch still exists and is active", async () => {
  const pending = await pendingRequest();
  const branches = structuredClone(db.data.chi_nhanh);
  for (const state of ["inactive", "deleted"]) {
    db.data.chi_nhanh.splice(0, db.data.chi_nhanh.length, ...structuredClone(branches));
    const index = db.data.chi_nhanh.findIndex((branch) => branch._id === "CN002");
    if (state === "deleted") db.data.chi_nhanh.splice(index, 1);
    else db.data.chi_nhanh[index].trangThai = "NGUNG_HOAT_DONG";
    assert.equal((await decide(pending._id, "QM001", "APPROVED")).status, 409);
    assert.equal(currentUser().chiNhanhId, "CN001");
    assert.equal(currentProfile().chiNhanhId, "CN001");
    assert.equal(db.data.yeu_cau_chuyen_chi_nhanh[0].status, "PENDING");
  }
});

test("approval moves the linked account and PT profile together and records the manager decision", async () => {
  const pending = await pendingRequest();
  const previousProfile = structuredClone(currentProfile());

  const response = await decide(pending._id, "QM001", "APPROVED");

  assert.equal(response.status, 200);
  assert.equal(currentUser().chiNhanhId, "CN002");
  assert.deepEqual(currentProfile(), { ...previousProfile, chiNhanhId: "CN002" });
  const approved = db.data.yeu_cau_chuyen_chi_nhanh[0];
  assert.equal(approved.status, "APPROVED");
  assert.equal(approved.reviewedBy, "QM001");
  assert.ok(approved.reviewedAt);
});

test("rejection records the decision while leaving both PT branches unchanged", async () => {
  const pending = await pendingRequest();
  const beforeUser = structuredClone(currentUser());
  const beforeProfile = structuredClone(currentProfile());

  const response = await decide(pending._id, "QM001", "REJECTED");

  assert.equal(response.status, 200);
  assert.deepEqual(currentUser(), beforeUser);
  assert.deepEqual(currentProfile(), beforeProfile);
  assert.equal(db.data.yeu_cau_chuyen_chi_nhanh[0].status, "REJECTED");
  assert.equal(db.data.yeu_cau_chuyen_chi_nhanh[0].reviewedBy, "QM001");
});

test("repeating a completed decision is idempotent and changing it afterwards conflicts", async () => {
  const pending = await pendingRequest();
  assert.equal((await decide(pending._id, "QM001", "APPROVED")).status, 200);
  const approved = structuredClone(db.data.yeu_cau_chuyen_chi_nhanh[0]);

  assert.equal((await decide(pending._id, "QM001", "APPROVED")).status, 200);
  assert.deepEqual(db.data.yeu_cau_chuyen_chi_nhanh[0], approved);
  assert.equal((await decide(pending._id, "QM001", "REJECTED")).status, 409);
  assert.deepEqual(db.data.yeu_cau_chuyen_chi_nhanh[0], approved);
  assert.equal(currentUser().chiNhanhId, "CN002");
  assert.equal(currentProfile().chiNhanhId, "CN002");
});

test("approval refuses stale requests whose PT no longer belongs to the recorded origin branch", async () => {
  const pending = await pendingRequest();
  currentUser().chiNhanhId = "CN003";
  currentProfile().chiNhanhId = "CN003";

  const response = await decide(pending._id, "QM001", "APPROVED");

  assert.equal(response.status, 409);
  assert.equal(currentUser().chiNhanhId, "CN003");
  assert.equal(currentProfile().chiNhanhId, "CN003");
  assert.equal(db.data.yeu_cau_chuyen_chi_nhanh[0].status, "PENDING");
});

test("an approval write failure does not leave half-moved branches or an approved request", async () => {
  const pending = await pendingRequest();
  db.failProfileUpdates = true;

  const response = await decide(pending._id, "QM001", "APPROVED");

  assert.equal(response.status, 500);
  assert.equal(currentUser().chiNhanhId, "CN001");
  assert.equal(currentProfile().chiNhanhId, "CN001");
  assert.equal(db.data.yeu_cau_chuyen_chi_nhanh[0].status, "PENDING");
});

test("unknown requests and unsupported decisions return errors without changing any branch", async () => {
  const pending = await pendingRequest();
  assert.equal((await decide("UNKNOWN", "QM001", "APPROVED")).status, 404);
  assert.equal((await decide(pending._id, "QM001", "INVALID")).status, 400);
  assert.equal(currentUser().chiNhanhId, "CN001");
  assert.equal(currentProfile().chiNhanhId, "CN001");
  assert.equal(db.data.yeu_cau_chuyen_chi_nhanh[0].status, "PENDING");
});

test("data-all transfer lists use actual manager and PT identities and expose none to members", async () => {
  db.data.yeu_cau_chuyen_chi_nhanh.push(
    transfer("YCCN001", "ND011", "PT001", "CN001", "CN002"),
    transfer("YCCN002", "ND012", "PT002", "CN002", "CN001"),
  );

  const manager = await memberCatalog("QM001", "CN002", "ADMIN");
  assert.equal(manager.status, 200);
  assert.deepEqual(manager.body.trainerTransfers.map((row) => row._id), ["YCCN001"]);
  const destinationManager = await memberCatalog("QM002", "CN001", "ADMIN");
  assert.deepEqual(destinationManager.body.trainerTransfers.map((row) => row._id), ["YCCN002"]);
  const own = await memberCatalog("ND011", "CN002", "ADMIN");
  assert.deepEqual(own.body.trainerTransfers.map((row) => row._id), ["YCCN001"]);
  const member = await memberCatalog("ND020", "CN002", "ADMIN");
  assert.deepEqual(member.body.trainerTransfers, []);
});

test("staff member endpoints cannot reset or edit manager and PT accounts", async () => {
  const beforeUsers = structuredClone(db.data.nguoi_dung);

  for (const id of ["QM001", "qm001", "ND011"]) {
    const reset = await request(`/api/members/${id}/reset-password`, "POST", { currentUserId: "NV001" });
    assert.equal(reset.status, 404);
  }
  for (const id of ["QM001", "ND011"]) {
    const edited = await request(`/api/members/${id}`, "PUT", { currentUserId: "NV001", hoTen: "Không được thay đổi", trangThai: "KHOA" });
    assert.equal(edited.status, 404);
  }
  assert.deepEqual(db.data.nguoi_dung, beforeUsers);
});

test("staff can reset their own branch's member but cannot manage members in another branch", async () => {
  const otherMember = structuredClone(db.data.nguoi_dung.find((row) => row._id === "ND021"));
  const crossBranchCreate = await request("/api/members", "POST", { currentUserId: "NV001", hoTen: "Không được thêm", chiNhanhId: "CN002" });
  assert.equal(crossBranchCreate.status, 403);
  assert.equal(db.data.nguoi_dung.length, 8);
  assert.equal((await request("/api/members/ND021", "PUT", { currentUserId: "NV001", hoTen: "Không được thay đổi" })).status, 403);
  assert.equal((await request("/api/members/ND021/reset-password", "POST", { currentUserId: "NV001" })).status, 403);
  assert.deepEqual(db.data.nguoi_dung.find((row) => row._id === "ND021"), otherMember);

  const ownReset = await request("/api/members/ND020/reset-password", "POST", { currentUserId: "NV001" });
  assert.equal(ownReset.status, 200);
  const signedIn = await request("/api/login", "POST", { email: "nd020", password: "1", role: "KHACH" }, { actor: null });
  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.body.account.id, "ND020");
});
