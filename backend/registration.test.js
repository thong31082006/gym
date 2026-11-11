const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { app } = require("./server");

function memoryDb() {
  const branch = (_id, tenChiNhanh, trangThai = "HOAT_DONG") => ({ _id, tenChiNhanh, diaChi: `Địa chỉ ${_id}`, trangThai });
  const manager = (_id, chiNhanhId, trangThai = "HOAT_DONG", vaiTro = "QUAN_LY_CHI_NHANH") => ({
    _id, chiNhanhId, trangThai, vaiTro, hoTen: _id, email: `${_id.toLowerCase()}@private.test`, tenDangNhap: _id.toLowerCase(), matKhauHash: "private-hash",
  });
  const data = {
    chi_nhanh: [branch("CN001", "Gym Trung Tâm"), branch("CN002", "Gym Bắc"), branch("CN003", "Gym Đóng", "NGUNG_HOAT_DONG"),
      branch("CN004", "Gym Mới"), branch("CN005", "Gym Nhân Viên"), branch("CN006", "Gym A")],
    nguoi_dung: [manager("ND001", "CN001"), manager("ND002", "CN002", "KHOA"), manager("ND003", "CN003"),
      manager("ND004", "CN005", "HOAT_DONG", "NHAN_VIEN"), manager("ND005", "CN999"), manager("ND006", "CN006"), manager("ND007", "CN006")],
    huan_luyen_vien: [{ _id: "PT001", nguoiDungId: "ND015" }],
    nhan_vien: [],
  };
  const matches = (row, query) => Object.entries(query).every(([key, value]) => {
    if (key === "$or") return value.some((clause) => matches(row, clause));
    return row[key] === value;
  });
  const db = {
    data, calls: [], failReads: false, failMemberInsert: false, sessionEnds: 0,
    client: {
      startSession() {
        const session = {
          active: false,
          async withTransaction(fn) {
            const snapshot = structuredClone(data);
            session.active = true;
            try { return await fn(); } catch (error) {
              for (const name of Object.keys(data)) {
                if (snapshot[name]) data[name].splice(0, data[name].length, ...snapshot[name]);
                else delete data[name];
              }
              throw error;
            } finally { session.active = false; }
          },
          async endSession() { db.sessionEnds += 1; },
        };
        return session;
      },
    },
    collection(name) {
      const rows = data[name] ||= [];
      const record = (method, options) => {
        db.calls.push({ name, method, inTransaction: Boolean(options?.session?.active) });
      };
      return {
        find(query = {}, options = {}) {
          if (db.failReads) throw new Error("Database unavailable");
          record("find", options);
          const cursor = { sort: () => cursor, toArray: async () => structuredClone(rows.filter((row) => matches(row, query))) };
          return cursor;
        },
        async findOne(query = {}, options = {}) {
          if (db.failReads) throw new Error("Database unavailable");
          record("findOne", options);
          return structuredClone(rows.find((row) => matches(row, query)) || null);
        },
        async insertOne(row, options = {}) {
          record("insertOne", options);
          rows.push(structuredClone(row));
          if (row.vaiTro === "KHACH" && db.failMemberInsert) throw new Error("Storage interrupted");
          return { insertedId: row._id };
        },
        async updateOne(query, update, options = {}) {
          record("updateOne", options);
          const row = rows.find((candidate) => matches(candidate, query));
          if (!row) return { matchedCount: 0 };
          Object.assign(row, structuredClone(update.$set || {}));
          return { matchedCount: 1 };
        },
      };
    },
  };
  return db;
}

const originalDb = mongoose.connection.db;
let db, server, base, adminToken;
before(async () => {
  server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => { db = memoryDb(); mongoose.connection.db = db; adminToken = null; });
after(async () => {
  mongoose.connection.db = originalDb;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});
async function request(path, method = "GET", body, admin = false) {
  if (admin && !adminToken) {
    const login = await request("/api/login", "POST", { email: "admin", password: "12345", role: "ADMIN" });
    assert.equal(login.status, 200);
    adminToken = login.body.token;
  }
  const response = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(admin ? { Authorization: `Bearer ${adminToken}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
const signup = (branch, extra = {}) => request("/api/register", "POST", {
  name: "Hội viên mới", email: "member-new@test.vn", phone: "0900123456", password: "member-secret", branch, ...extra,
});
const sourceManager = () => db.data.nguoi_dung.find((user) => user._id === "ND001");

test("public choices contain saved active branches with active managers only and expose no manager data", async () => {
  const response = await request("/api/registration-branches?role=ADMIN&branch=CN999");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(response.body.branches.map((branch) => branch._id), ["CN006", "CN001"]);
  for (const branch of response.body.branches) assert.deepEqual(Object.keys(branch).sort(), ["_id", "diaChi", "tenChiNhanh"]);
  assert.equal(JSON.stringify(response.body).includes("private"), false);
});

test("the public branch list reflects admin names and manager changes without cached or sample options", async () => {
  const branch = db.data.chi_nhanh.find((row) => row._id === "CN001");
  branch.tenChiNhanh = "Tên Admin vừa đổi";
  sourceManager().chiNhanhId = "CN004";
  const response = await request("/api/registration-branches");
  assert.deepEqual(response.body.branches.map((row) => row._id), ["CN006", "CN004"]);
  sourceManager().chiNhanhId = "CN001";
  const renamed = await request("/api/registration-branches");
  assert.equal(renamed.body.branches.find((row) => row._id === "CN001").tenChiNhanh, "Tên Admin vừa đổi");
});

test("no eligible manager returns an empty real-data list and database failure returns503", async () => {
  db.data.nguoi_dung.forEach((row) => { row.trangThai = "KHOA"; });
  const empty = await request("/api/registration-branches");
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.branches, []);
  db.failReads = true;
  const failure = await request("/api/registration-branches");
  assert.equal(failure.status, 503);
  assert.equal(failure.headers.get("cache-control"), "no-store");
  assert.equal("branches" in failure.body, false);
});

test("registration saves the selected managed branch and ignores role spoofing, with all signup reads and insert in one transaction", async () => {
  const response = await signup("CN006", { vaiTro: "QUAN_LY_CHI_NHANH", role: "ADMIN" });
  assert.equal(response.status, 200);
  assert.ok(response.body.token);
  assert.equal(response.body.account.branch, "CN006");
  assert.equal(response.body.account.role, "KHACH");
  assert.equal(response.body.account.id, "ND016", "Historical PT references reserve their user IDs");
  const saved = db.data.nguoi_dung.find((row) => row._id === response.body.account.id);
  assert.equal(saved.chiNhanhId, "CN006");
  assert.match(saved.matKhauHash, /^scrypt\$/);
  assert.ok(db.calls.every((call) => call.inTransaction));
  assert.equal(db.sessionEnds, 1);
  const login = await request("/api/login", "POST", { email: "member-new@test.vn", password: "member-secret", role: "KHACH" });
  assert.equal(login.status, 200);
  assert.equal(login.body.account.branch, "CN006");
});

test("missing, unknown, inactive, locked-manager, and managerless branch selections are rejected without creating users", async () => {
  const before = structuredClone(db.data.nguoi_dung);
  for (const branch of [undefined, "", "CN999", "CN002", "CN003", "CN004", "CN005"]) {
    const response = await signup(branch);
    assert.equal(response.status, 400, `branch ${branch}`);
    assert.equal(response.body.code, "INVALID_REGISTRATION_BRANCH");
    assert.deepEqual(db.data.nguoi_dung, before);
  }
});

test("signup revalidates a previously displayed branch after the manager is locked, reassigned, or demoted", async () => {
  for (const mutate of [
    () => { sourceManager().trangThai = "KHOA"; },
    () => { sourceManager().chiNhanhId = "CN004"; },
    () => { sourceManager().vaiTro = "NHAN_VIEN"; },
    () => { db.data.chi_nhanh.splice(db.data.chi_nhanh.findIndex((row) => row._id === "CN001"), 1); },
  ]) {
    db = memoryDb(); mongoose.connection.db = db;
    assert.ok((await request("/api/registration-branches")).body.branches.some((row) => row._id === "CN001"));
    mutate();
    const count = db.data.nguoi_dung.length;
    const response = await signup("CN001");
    assert.equal(response.status, 400);
    assert.equal(response.body.code, "INVALID_REGISTRATION_BRANCH");
    assert.equal(db.data.nguoi_dung.length, count);
  }
});

test("failed account storage rolls back without a token or a partial member and duplicate identity adds no user", async () => {
  const before = structuredClone(db.data.nguoi_dung);
  db.failMemberInsert = true;
  const failed = await signup("CN001");
  assert.equal(failed.status, 500);
  assert.equal("token" in failed.body, false);
  assert.deepEqual(db.data.nguoi_dung, before);
  db.failMemberInsert = false;
  const duplicate = await signup("CN001", { email: "nd001@private.test" });
  assert.equal(duplicate.status, 400);
  assert.deepEqual(db.data.nguoi_dung, before);
});

test("admin manager creation requires an actual active branch before writing any account", async () => {
  const before = structuredClone(db.data.nguoi_dung);
  for (const chiNhanhId of ["CN999", "CN003"]) {
    const response = await request("/api/admin/create-manager", "POST", {
      hoTen: "Quản lý mới", email: "manager-new@test.vn", matKhau: "manager-secret", chiNhanhId,
    }, true);
    assert.equal(response.status, 400);
    assert.deepEqual(db.data.nguoi_dung, before);
  }
  const created = await request("/api/admin/create-manager", "POST", {
    hoTen: "Quản lý mới", email: "manager-new@test.vn", matKhau: "manager-secret", chiNhanhId: "CN004",
  }, true);
  assert.equal(created.status, 200);
  assert.ok((await request("/api/registration-branches")).body.branches.some((row) => row._id === "CN004"));
});

test("admin role and account creation cannot associate a manager with a missing or closed branch", async () => {
  const before = structuredClone(db.data.nguoi_dung);
  for (const chiNhanhId of ["CN999", "CN003"]) {
    const role = await request("/api/admin/change-role", "PUT", { userId: "ND004", newRole: "QUAN_LY_CHI_NHANH", chiNhanhId }, true);
    assert.equal(role.status, 400);
    const permissions = await request("/api/permissions/ND004", "PUT", { vaiTro: "QUAN_LY_CHI_NHANH", chiNhanhId }, true);
    assert.equal(permissions.status, 400);
    const account = await request("/api/accounts", "POST", { hoTen: "Quản lý", email: "new-manager@test.vn", vaiTro: "QUAN_LY_CHI_NHANH", chiNhanhId }, true);
    assert.equal(account.status, 400);
    const update = await request("/api/accounts/ND001", "PUT", { chiNhanhId }, true);
    assert.equal(update.status, 400);
    assert.deepEqual(db.data.nguoi_dung, before);
  }
  const assigned = await request("/api/permissions/ND004", "PUT", { vaiTro: "QUAN_LY_CHI_NHANH", chiNhanhId: "CN004" }, true);
  assert.equal(assigned.status, 200);
  assert.ok((await request("/api/registration-branches")).body.branches.some((row) => row._id === "CN004"));
});
