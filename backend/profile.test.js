const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const { app } = require("./server");
const testSalt = Buffer.alloc(16, 9);
const testHash = `scrypt$16384$8$1$${testSalt.toString("hex")}$${crypto.scryptSync("profile-password", testSalt, 64, { N: 16384, r: 8, p: 1 }).toString("hex")}`;

function memoryDb() {
  const data = {
    nguoi_dung: [
      { _id: "ND011", hoTen: "Anh", tenDangNhap: "anh", vaiTro: "HUAN_LUYEN_VIEN", chiNhanhId: "CN001", trangThai: "HOAT_DONG" },
      { _id: "ND012", hoTen: "Siu", vaiTro: "HUAN_LUYEN_VIEN", chiNhanhId: "CN001", trangThai: "HOAT_DONG" },
      { _id: "ND020", hoTen: "Hội viên", vaiTro: "KHACH", chiNhanhId: "CN002", trangThai: "HOAT_DONG" },
      { _id: "ND021", hoTen: "Nhân viên", vaiTro: "NHAN_VIEN", chiNhanhId: "CN001", trangThai: "HOAT_DONG" },
    ],
    huan_luyen_vien: [
      { _id: "PT010", nguoiDungId: "ND011", chiNhanhId: "CN001", chuyenMon: "Phục hồi vận động", moTa: "Hồ sơ đang sử dụng", trangThai: "NGHI_VIEC" },
    ],
    nhan_vien: [{ _id: "NS001", nguoiDungId: "ND021", chiNhanhId: "CN001", chucDanh: "Lễ tân" }],
    chi_nhanh: [
      { _id: "CN001", tenChiNhanh: "Chi nhánh 1" },
      { _id: "CN002", tenChiNhanh: "Chi nhánh 2" },
    ],
    yeu_cau_chuyen_chi_nhanh: [],
  };
  for (const user of data.nguoi_dung) user.matKhauHash = testHash;
  const writes = [];
  const matches = (row, query) => Object.entries(query).every(([key, value]) =>
    key === "$or" ? value.some((clause) => matches(row, clause)) : row[key] === value);
  const db = {
    data, writes,
    client: {
      startSession() {
        return {
          async withTransaction(fn) {
            const snapshot = structuredClone(data);
            try { return await fn(); } catch (error) {
              for (const name of new Set([...Object.keys(data), ...Object.keys(snapshot)])) {
                if (snapshot[name]) data[name].splice(0, data[name].length, ...structuredClone(snapshot[name]));
                else delete data[name];
              }
              throw error;
            }
          },
          async endSession() {},
        };
      },
    },
    collection(name) {
      const rows = data[name] ||= [];
      return {
        find(query = {}) {
          const cursor = { sort: () => cursor, toArray: async () => structuredClone(rows.filter((row) => matches(row, query))) };
          return cursor;
        },
        async findOne(query = {}) { return structuredClone(rows.find((row) => matches(row, query)) || null); },
        async insertOne(row) {
          writes.push({ name, type: "insert", row: structuredClone(row) });
          rows.push(structuredClone(row));
          return { insertedId: row._id };
        },
        async updateOne(query, update) {
          writes.push({ name, type: "update", query: structuredClone(query) });
          const row = rows.find((item) => matches(item, query));
          if (!row) return { matchedCount: 0 };
          Object.assign(row, structuredClone(update.$set || {}));
          return { matchedCount: 1, modifiedCount: 1 };
        },
      };
    },
  };
  return db;
}

const originalDb = mongoose.connection.db;
let server;
let baseUrl;
let db;
let tokens;

before(async () => {
  server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  db = memoryDb();
  mongoose.connection.db = db;
  tokens = new Map();
});

after(async () => {
  mongoose.connection.db = originalDb;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function tokenFor(actor) {
  if (tokens.has(actor)) return tokens.get(actor);
  const user = db.data.nguoi_dung.find((row) => row._id === actor);
  const credentials = actor === "ADMIN_FIXED"
    ? { email: "admin", password: "12345", role: "ADMIN" }
    : { email: user.tenDangNhap || user.hoTen, password: "profile-password", role: user.vaiTro };
  const response = await fetch(`${baseUrl}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(credentials) });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.ok(result.token);
  tokens.set(actor, result.token);
  return result.token;
}

async function editProfile(id, body, actor = "ADMIN_FIXED") {
  const token = await tokenFor(actor);
  const response = await fetch(`${baseUrl}/api/profile/${id}`, {
    method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test("saving a member's selected existing branch persists it and returns the saved branch", async () => {
  const response = await editProfile("ND020", { chiNhanhId: "CN001", hoTen: "Hội viên đổi chi nhánh" });

  assert.equal(response.status, 200);
  assert.equal(response.body.account.branch, "CN001");
  assert.equal(db.data.nguoi_dung.find((user) => user._id === "ND020").chiNhanhId, "CN001");
  assert.equal(db.data.nguoi_dung.find((user) => user._id === "ND020").hoTen, "Hội viên đổi chi nhánh");
});

test("ordinary profile edits preserve the stored branch when no branch is supplied", async () => {
  const response = await editProfile("ND020", { hoTen: "Tên mới", soDienThoai: "0901234567" });

  assert.equal(response.status, 200);
  assert.equal(response.body.account.branch, "CN002");
  assert.equal(db.data.nguoi_dung.find((user) => user._id === "ND020").chiNhanhId, "CN002");
  assert.equal(db.data.huan_luyen_vien.length, 1);
});

test("invalid supplied branch IDs are rejected before any account or PT write", async () => {
  const snapshot = structuredClone(db.data);

  for (const chiNhanhId of ["CN999", "", "   ", null, 42, {}, []]) {
    const response = await editProfile("ND011", {
      chiNhanhId, currentUserId: "ND011", hoTen: "Tên không được lưu", chuyenMon: "Chuyên môn không được lưu", password: "changed",
    }, "ND011");
    assert.equal(response.status, 400);
    assert.deepEqual(db.data, snapshot);
    assert.deepEqual(db.writes, []);
  }
});

test("a PT's branch selection creates a pending transfer while preserving the current account and PT branch", async () => {
  db.data.huan_luyen_vien[0].trangThai = "DANG_LAM";
  const previousProfile = structuredClone(db.data.huan_luyen_vien[0]);

  const response = await editProfile("ND011", { chiNhanhId: "CN002", currentUserId: "ND011" }, "ND011");

  assert.equal(response.status, 200);
  assert.equal(response.body.account.branch, "CN001");
  assert.equal(db.data.nguoi_dung.find((user) => user._id === "ND011").chiNhanhId, "CN001");
  assert.deepEqual(db.data.huan_luyen_vien, [previousProfile]);
  assert.equal(response.body.branchTransfer.status, "PENDING");
  assert.equal(response.body.branchTransfer.fromBranchId, "CN001");
  assert.equal(response.body.branchTransfer.toBranchId, "CN002");
});

test("saving the PT's current branch does not duplicate its existing profile", async () => {
  const previousProfile = structuredClone(db.data.huan_luyen_vien[0]);

  for (let i = 0; i < 2; i += 1) {
    assert.equal((await editProfile("ND011", { chiNhanhId: "CN001", currentUserId: "ND011" }, "ND011")).status, 200);
  }

  assert.deepEqual(db.data.huan_luyen_vien, [previousProfile]);
  assert.deepEqual(db.data.yeu_cau_chuyen_chi_nhanh, []);
});

test("branch-only PT requests create a missing profile in the current branch while waiting for approval", async () => {
  const response = await editProfile("ND012", { chiNhanhId: "CN002", currentUserId: "ND012" }, "ND012");

  assert.equal(response.status, 200);
  assert.equal(response.body.account.branch, "CN001");
  const created = db.data.huan_luyen_vien.find((trainer) => trainer.nguoiDungId === "ND012");
  assert.equal(created._id, "PT011");
  assert.equal(created.chiNhanhId, "CN001");
  assert.equal(created.chuyenMon, "Sức mạnh & thể hình");
  assert.ok(created.moTa);
  assert.equal(created.trangThai, "DANG_LAM");
  assert.equal(response.body.branchTransfer.ptId, created._id);
  assert.equal(response.body.branchTransfer.toBranchId, "CN002");
});

test("existing PT profile IDs remain valid aliases for requesting the linked account's branch transfer", async () => {
  db.data.huan_luyen_vien[0].trangThai = "DANG_LAM";
  const response = await editProfile("PT010", { chiNhanhId: "CN002", currentUserId: "ND011" }, "ND011");

  assert.equal(response.status, 200);
  assert.equal(response.body.account.id, "ND011");
  assert.equal(response.body.account.branch, "CN001");
  assert.equal(db.data.huan_luyen_vien[0].chiNhanhId, "CN001");
  assert.equal(response.body.branchTransfer.ptId, "PT010");
  assert.equal(response.body.branchTransfer.toBranchId, "CN002");
});

test("a spoofed profile role cannot create staff or PT records for a member", async () => {
  const previousProfiles = structuredClone(db.data.huan_luyen_vien);
  const previousStaff = structuredClone(db.data.nhan_vien);

  for (const role of ["HUAN_LUYEN_VIEN", "NHAN_VIEN"]) {
    const response = await editProfile("ND020", {
      role, chuyenMon: "Hồ sơ giả", moTa: "Không tạo hồ sơ", chucDanh: "Nhân viên giả",
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.account.role, "KHACH");
    assert.deepEqual(db.data.huan_luyen_vien, previousProfiles);
    assert.deepEqual(db.data.nhan_vien, previousStaff);
  }
});

test("PT expertise updates continue to work without changing the stored branch", async () => {
  const response = await editProfile("ND011", { chuyenMon: "Giảm mỡ", moTa: "Hướng dẫn mới" });

  assert.equal(response.status, 200);
  assert.equal(response.body.account.branch, "CN001");
  assert.equal(response.body.account.specialty, "Giảm mỡ");
  assert.equal(db.data.huan_luyen_vien[0].moTa, "Hướng dẫn mới");
  assert.equal(db.data.huan_luyen_vien[0].trangThai, "NGHI_VIEC");
});

test("unknown profile IDs cannot use a spoofed role to edit another PT", async () => {
  const snapshot = structuredClone(db.data);
  const response = await editProfile("UNKNOWN", { role: "HUAN_LUYEN_VIEN", chiNhanhId: "CN002", hoTen: "Không được lưu" });

  assert.equal(response.status, 404);
  assert.deepEqual(db.data, snapshot);
  assert.deepEqual(db.writes, []);
});
