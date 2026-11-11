const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const serverModule = require("./server");
const { app } = serverModule;
const { syncTrainerProfiles } = require("./trainer-accounts");

function passwordHash(password) {
  const salt = Buffer.alloc(16, 7);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString("hex")}$${hash.toString("hex")}`;
}
const existingPasswordHash = passwordHash("custom-existing");

function memoryDb() {
  const data = {
    nguoi_dung: [
      { _id: "ND010", hoTen: "Hội viên Minh", tenDangNhap: "minh", email: "minh@example.com", vaiTro: "KHACH", chiNhanhId: "CN001", trangThai: "HOAT_DONG", matKhau: "old-secret" },
      { _id: "ND020", hoTen: "HLV cũ", tenDangNhap: "oldcoach", email: "oldcoach@example.com", vaiTro: "HUAN_LUYEN_VIEN", chiNhanhId: "CN001", trangThai: "HOAT_DONG", matKhauHash: existingPasswordHash },
      { _id: "ND030", hoTen: "Quản lý", tenDangNhap: "manager", email: "manager@example.com", vaiTro: "QUAN_LY_CHI_NHANH", chiNhanhId: "CN001", trangThai: "HOAT_DONG", matKhauHash: existingPasswordHash },
    ],
    huan_luyen_vien: [
      { _id: "PT007", nguoiDungId: "ND020", chiNhanhId: "CN001", chuyenMon: "Phục hồi vận động", moTa: "Hồ sơ đã chỉnh sửa", trangThai: "DANG_LAM" },
    ],
    nhan_vien: [],
    chi_nhanh: [
      { _id: "CN001", tenChiNhanh: "Chi nhánh của quản lý", trangThai: "HOAT_DONG" },
      { _id: "CN002", tenChiNhanh: "Chi nhánh được chọn", trangThai: "HOAT_DONG" },
    ],
  };
  const writes = [];
  const matches = (row, query) => Object.entries(query).every(([key, value]) => {
    if (key === "$or") return value.some((clause) => matches(row, clause));
    if (value instanceof RegExp) return value.test(row[key]);
    if (value && typeof value === "object") {
      if ("$in" in value) return value.$in.includes(row[key]);
      if ("$ne" in value) return row[key] !== value.$ne;
      if ("$exists" in value) return Object.prototype.hasOwnProperty.call(row, key) === value.$exists;
    }
    return row[key] === value;
  });
  const db = {
    data, writes, failProfileWrites: false, failUserUpdates: false, failProfileDeletes: false,
    collection(name) {
      const rows = data[name] ||= [];
      const checkWrite = () => {
        if (name === "huan_luyen_vien" && db.failProfileWrites) throw new Error("PT storage unavailable");
      };
      const duplicateId = (id) => {
        if (rows.some((row) => row._id === id)) throw Object.assign(new Error("Duplicate _id"), { code: 11000 });
      };
      return {
        find(query = {}) {
          const cursor = {
            sort: () => cursor,
            toArray: async () => structuredClone(rows.filter((row) => matches(row, query))),
          };
          return cursor;
        },
        async findOne(query = {}) { return structuredClone(rows.find((row) => matches(row, query)) || null); },
        async countDocuments(query = {}) { return rows.filter((row) => matches(row, query)).length; },
        async insertOne(row) {
          checkWrite();
          duplicateId(row._id);
          if (name === "nguoi_dung" && row.email && rows.some((other) => other.email === row.email)) {
            throw Object.assign(new Error("Duplicate email"), { code: 11000 });
          }
          rows.push(structuredClone(row));
          writes.push({ name, type: "insert", id: row._id });
          return { insertedId: row._id, acknowledged: true };
        },
        async updateOne(query, update, options = {}) {
          checkWrite();
          if (name === "nguoi_dung" && db.failUserUpdates) throw new Error("User storage unavailable");
          let row = rows.find((item) => matches(item, query));
          let upsertedId = null;
          if (!row && options.upsert) {
            row = { ...query, ...structuredClone(update.$setOnInsert || {}) };
            duplicateId(row._id);
            rows.push(row);
            upsertedId = row._id;
          }
          if (!row) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
          Object.assign(row, structuredClone(update.$set || {}));
          for (const key of Object.keys(update.$unset || {})) delete row[key];
          writes.push({ name, type: "update", id: row._id });
          return { matchedCount: upsertedId ? 0 : 1, modifiedCount: 1, upsertedCount: upsertedId ? 1 : 0, upsertedId };
        },
        async deleteOne(query) {
          if (name === "huan_luyen_vien" && db.failProfileDeletes) throw new Error("PT cleanup unavailable");
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

let server;
let baseUrl;
let db;
let tokens;
const originalDb = mongoose.connection.db;

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
    : { email: user.email || user.tenDangNhap, password: actor === "ND010" ? "old-secret" : "custom-existing", role: user.vaiTro };
  const response = await fetch(`${baseUrl}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(credentials) });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.ok(result.token);
  tokens.set(actor, result.token);
  return result.token;
}

async function request(path, method, body, actor = "ADMIN_FIXED") {
  const headers = { "Content-Type": "application/json" };
  if (path !== "/api/login") headers.Authorization = `Bearer ${await tokenFor(actor)}`;
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
const login = (email, password) => request("/api/login", "POST", { email, password, role: "HUAN_LUYEN_VIEN" });
const userById = (id) => db.data.nguoi_dung.find((user) => user._id === id);
const profileByUser = (id) => db.data.huan_luyen_vien.find((profile) => profile.nguoiDungId === id);

const creationRoutes = [
  { path: "/api/trainers", name: "trainer creation", payload: { hoTen: "HLV mới", email: "newcoach@example.com", chuyenMon: "Thể lực", moTa: "Chuyên môn mới", trangThai: "DANG_LAM" } },
  { path: "/api/accounts", name: "HLV account creation", payload: { hoTen: "HLV tài khoản", email: "accountcoach@example.com", tenDangNhap: "accountcoach", vaiTro: "HUAN_LUYEN_VIEN", trangThai: "HOAT_DONG" } },
];

for (const route of creationRoutes) {
  test(`${route.name} saves the selected branch and a linked login account with password 1`, async () => {
    const response = await request(route.path, "POST", { ...route.payload, chiNhanhId: "CN002" });
    assert.equal(response.status, 200);
    const user = db.data.nguoi_dung.find((item) => item.email === route.payload.email);
    assert.ok(user);
    assert.equal(user.vaiTro, "HUAN_LUYEN_VIEN");
    assert.equal(user.chiNhanhId, "CN002");
    assert.ok(user.tenDangNhap);
    if (route.payload.tenDangNhap) assert.equal(user.tenDangNhap, route.payload.tenDangNhap);
    assert.match(user.matKhauHash, /^scrypt\$/);
    const profile = profileByUser(user._id);
    assert.ok(profile);
    assert.equal(profile.chiNhanhId, "CN002");
    assert.equal(profile.trangThai, "DANG_LAM");

    for (const identifier of [user.email, user.tenDangNhap]) {
      const signedIn = await login(identifier, "1");
      assert.equal(signedIn.status, 200);
      assert.equal(signedIn.body.account.id, user._id);
      assert.equal(signedIn.body.account.role, "HUAN_LUYEN_VIEN");
      assert.equal(signedIn.body.account.branch, "CN002");
      assert.equal(signedIn.body.account.specialty, profile.chuyenMon);
    }
    assert.equal((await login(user.email, "123")).status, 401);
  });

  test(`${route.name} rejects invalid selected branches before creating an orphan account`, async () => {
    const before = structuredClone(db.data);
    for (const chiNhanhId of ["CN999", "", null, 42]) {
      const response = await request(route.path, "POST", { ...route.payload, chiNhanhId });
      assert.equal(response.status, 400);
      assert.deepEqual(db.data, before);
      assert.deepEqual(db.writes, []);
    }
  });

  test(`${route.name} rolls back the new account if saving the PT profile fails`, async () => {
    const beforeUsers = structuredClone(db.data.nguoi_dung);
    const beforeProfiles = structuredClone(db.data.huan_luyen_vien);
    db.failProfileWrites = true;

    const response = await request(route.path, "POST", { ...route.payload, chiNhanhId: "CN002" });

    assert.equal(response.status, 500);
    assert.deepEqual(db.data.nguoi_dung, beforeUsers);
    assert.deepEqual(db.data.huan_luyen_vien, beforeProfiles);
  });

  test(`${route.name} rejects duplicate emails without creating a user or PT profile`, async () => {
    const before = structuredClone(db.data);

    const response = await request(route.path, "POST", { ...route.payload, email: "oldcoach@example.com", chiNhanhId: "CN002" });

    assert.equal(response.status, 409);
    assert.deepEqual(db.data, before);
    assert.deepEqual(db.writes, []);
  });

  test(`${route.name} removes the new account even when PT write and PT cleanup both fail`, async () => {
    const beforeUsers = structuredClone(db.data.nguoi_dung);
    const beforeProfiles = structuredClone(db.data.huan_luyen_vien);
    db.failProfileWrites = true;
    db.failProfileDeletes = true;

    const response = await request(route.path, "POST", { ...route.payload, chiNhanhId: "CN002" });

    assert.equal(response.status, 500);
    assert.match(response.body.message, /PT storage unavailable/);
    assert.deepEqual(db.data.nguoi_dung, beforeUsers);
    assert.deepEqual(db.data.huan_luyen_vien, beforeProfiles);
  });

  test(`${route.name} rejects email and username case variants before writing either record`, async () => {
    userById("ND020").email = "OLDCOACH@Example.COM";
    const beforeEmailConflict = structuredClone(db.data);

    const emailConflict = await request(route.path, "POST", { ...route.payload, email: "oldcoach@example.com", chiNhanhId: "CN002" });
    assert.equal(emailConflict.status, 409);
    assert.deepEqual(db.data, beforeEmailConflict);
    assert.deepEqual(db.writes, []);

    userById("ND020").email = "oldcoach@example.com";
    userById("ND020").tenDangNhap = route.payload.tenDangNhap ? route.payload.tenDangNhap.toUpperCase() : "ND031";
    const beforeUsernameConflict = structuredClone(db.data);

    const usernameConflict = await request(route.path, "POST", { ...route.payload, chiNhanhId: "CN002" });
    assert.equal(usernameConflict.status, 409);
    assert.deepEqual(db.data, beforeUsernameConflict);
    assert.deepEqual(db.writes, []);
  });
}

const roleRoutes = [
  { name: "admin role change", path: (id) => "/api/admin/change-role", body: (id, role, branch) => ({ userId: id, newRole: role, ...(branch ? { chiNhanhId: branch } : {}) }) },
  { name: "permissions update", path: (id) => `/api/permissions/${id}`, body: (id, role, branch) => ({ vaiTro: role, ...(branch ? { chiNhanhId: branch } : {}) }) },
];

for (const route of roleRoutes) {
  test(`${route.name} promotes to a real PT profile and resets password to 1 only on transition`, async () => {
    const response = await request(route.path("ND010"), "PUT", route.body("ND010", "HUAN_LUYEN_VIEN", "CN002"));
    assert.equal(response.status, 200);
    assert.equal(userById("ND010").vaiTro, "HUAN_LUYEN_VIEN");
    assert.equal(userById("ND010").chiNhanhId, "CN002");
    const created = profileByUser("ND010");
    assert.ok(created);
    assert.equal(created.chiNhanhId, "CN002");
    assert.equal((await login("minh", "1")).status, 200);
    assert.equal((await login("minh", "old-secret")).status, 401);

    created.chuyenMon = "Chuyên môn đã chỉnh sửa";
    created.moTa = "Mô tả đã chỉnh sửa";
    const savedId = created._id;
    userById("ND010").matKhauHash = passwordHash("my-new-password");
    delete userById("ND010").matKhau;
    userById("ND010").daCapLaiMatKhau = false;
    const customHash = userById("ND010").matKhauHash;

    const repeated = await request(route.path("ND010"), "PUT", route.body("ND010", "HUAN_LUYEN_VIEN", "CN002"));
    assert.equal(repeated.status, 200);
    assert.equal(userById("ND010").matKhauHash, customHash);
    assert.equal(profileByUser("ND010")._id, savedId);
    assert.equal(profileByUser("ND010").chuyenMon, "Chuyên môn đã chỉnh sửa");
    assert.equal(profileByUser("ND010").moTa, "Mô tả đã chỉnh sửa");
    assert.equal(profileByUser("ND010").chiNhanhId, "CN002");
    assert.equal(db.data.huan_luyen_vien.filter((item) => item.nguoiDungId === "ND010").length, 1);
    assert.equal((await login("minh", "my-new-password")).status, 200);
    assert.equal((await login("minh", "1")).status, 401);

    const bypassTransfer = await request(route.path("ND010"), "PUT", route.body("ND010", "HUAN_LUYEN_VIEN", "CN001"));
    assert.equal(bypassTransfer.status, 409);
    assert.equal(userById("ND010").chiNhanhId, "CN002");
    assert.equal(profileByUser("ND010").chiNhanhId, "CN002");
    assert.equal(userById("ND010").matKhauHash, customHash);
  });

  test(`${route.name} preserves existing profile details and ID after demotion and promotion`, async () => {
    const existingProfile = structuredClone(profileByUser("ND020"));
    assert.equal((await request(route.path("ND020"), "PUT", route.body("ND020", "KHACH"))).status, 200);
    assert.equal((await request(route.path("ND020"), "PUT", route.body("ND020", "HUAN_LUYEN_VIEN", "CN002"))).status, 200);

    const promoted = profileByUser("ND020");
    assert.equal(promoted._id, existingProfile._id);
    assert.equal(promoted.chuyenMon, existingProfile.chuyenMon);
    assert.equal(promoted.moTa, existingProfile.moTa);
    assert.equal(promoted.chiNhanhId, "CN002");
    assert.equal(db.data.huan_luyen_vien.filter((item) => item.nguoiDungId === "ND020").length, 1);
    assert.equal((await login("oldcoach", "1")).status, 200);
  });

  test(`${route.name} rejects unknown users and invalid branches without orphan profiles or password changes`, async () => {
    const before = structuredClone(db.data);
    const missing = await request(route.path("UNKNOWN"), "PUT", route.body("UNKNOWN", "HUAN_LUYEN_VIEN", "CN002"));
    assert.equal(missing.status, 404);
    const invalidBranch = await request(route.path("ND010"), "PUT", route.body("ND010", "HUAN_LUYEN_VIEN", "CN999"));
    assert.equal(invalidBranch.status, 400);
    assert.deepEqual(db.data, before);
    assert.deepEqual(db.writes, []);
  });

  test(`${route.name} leaves the old role and password intact if PT profile creation fails`, async () => {
    const beforeUsers = structuredClone(db.data.nguoi_dung);
    const beforeProfiles = structuredClone(db.data.huan_luyen_vien);
    db.failProfileWrites = true;

    const response = await request(route.path("ND010"), "PUT", route.body("ND010", "HUAN_LUYEN_VIEN", "CN002"));

    assert.equal(response.status, 500);
    assert.deepEqual(db.data.nguoi_dung, beforeUsers);
    assert.deepEqual(db.data.huan_luyen_vien, beforeProfiles);
  });

  test(`${route.name} rolls back a new PT profile if updating the account fails`, async () => {
    const beforeUsers = structuredClone(db.data.nguoi_dung);
    const beforeProfiles = structuredClone(db.data.huan_luyen_vien);
    db.failUserUpdates = true;

    const response = await request(route.path("ND010"), "PUT", route.body("ND010", "HUAN_LUYEN_VIEN", "CN002"));

    assert.equal(response.status, 500);
    assert.deepEqual(db.data.nguoi_dung, beforeUsers);
    assert.deepEqual(db.data.huan_luyen_vien, beforeProfiles);
  });
}

test("reassigning an existing HLV without a branch keeps its stored branch and custom password", async () => {
  userById("ND020").chiNhanhId = "CN002";
  profileByUser("ND020").chiNhanhId = "CN002";

  const response = await request("/api/permissions/ND020", "PUT", { vaiTro: "HUAN_LUYEN_VIEN" });

  assert.equal(response.status, 200);
  assert.equal(userById("ND020").chiNhanhId, "CN002");
  assert.equal(profileByUser("ND020").chiNhanhId, "CN002");
  assert.equal(userById("ND020").matKhauHash, existingPasswordHash);
  const signedIn = await login("oldcoach@example.com", "custom-existing");
  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.body.account.branch, "CN002");
});

test("backfilling missing HLV profiles is idempotent and preserves existing passwords", async () => {
  db.data.nguoi_dung.push({
    _id: "ND040", hoTen: "HLV thiếu hồ sơ", tenDangNhap: "missingcoach", email: "missingcoach@example.com",
    vaiTro: "HUAN_LUYEN_VIEN", chiNhanhId: "CN002", trangThai: "HOAT_DONG", matKhauHash: existingPasswordHash,
  });
  const beforeUsers = structuredClone(db.data.nguoi_dung);
  const existingProfile = structuredClone(profileByUser("ND020"));

  await syncTrainerProfiles(db);
  const repaired = structuredClone(db.data.huan_luyen_vien);
  await syncTrainerProfiles(db);

  assert.deepEqual(db.data.nguoi_dung, beforeUsers);
  assert.deepEqual(profileByUser("ND020"), existingProfile);
  assert.deepEqual(db.data.huan_luyen_vien, repaired);
  assert.equal(profileByUser("ND040").chiNhanhId, "CN002");
  assert.equal(db.data.huan_luyen_vien.filter((item) => item.nguoiDungId === "ND040").length, 1);
  assert.equal((await login("missingcoach", "custom-existing")).status, 200);
  assert.equal((await login("missingcoach", "1")).status, 401);
});

test("new accounts skip user IDs already referenced by orphan PT profiles", async () => {
  db.data.nguoi_dung.splice(0, db.data.nguoi_dung.length, {
    _id: "ND014", hoTen: "Hội viên", vaiTro: "KHACH", chiNhanhId: "CN001", trangThai: "HOAT_DONG",
  });
  db.data.huan_luyen_vien.splice(0, db.data.huan_luyen_vien.length, {
    _id: "PT001", nguoiDungId: "ND015", chiNhanhId: "CN001", chuyenMon: "Hồ sơ cũ không có tài khoản", trangThai: "DANG_LAM",
  });

  const response = await request("/api/trainers", "POST", { hoTen: "HLV đúng", email: "reserved@example.com", chiNhanhId: "CN002" });

  assert.equal(response.status, 200);
  const user = db.data.nguoi_dung.find((row) => row.email === "reserved@example.com");
  assert.equal(user._id, "ND016");
  assert.equal(profileByUser("ND016").chiNhanhId, "CN002");
  assert.equal(profileByUser("ND015")._id, "PT001");
  assert.equal(db.data.huan_luyen_vien.length, 2);
});

test("an exact alias-like username logs into that account rather than an earlier HLV alias", async () => {
  db.data.nguoi_dung.push({
    _id: "ND040", hoTen: "HLV có tên đăng nhập pt1", tenDangNhap: "pt1", email: "exact@example.com",
    vaiTro: "HUAN_LUYEN_VIEN", chiNhanhId: "CN002", trangThai: "HOAT_DONG", matKhauHash: passwordHash("exact-password"),
  });
  db.data.huan_luyen_vien.push({ _id: "PT008", nguoiDungId: "ND040", chiNhanhId: "CN002", chuyenMon: "Thể lực", trangThai: "DANG_LAM" });

  const response = await login("pt1", "exact-password");

  assert.equal(response.status, 200);
  assert.equal(response.body.account.id, "ND040");
  assert.equal(response.body.account.branch, "CN002");
  assert.equal((await login("pt1", "custom-existing")).status, 401);
});

test("ambiguous full names require an exact username or email", async () => {
  db.data.nguoi_dung.push({
    _id: "ND040", hoTen: "HLV cũ", tenDangNhap: "othercoach", email: "othercoach@example.com",
    vaiTro: "HUAN_LUYEN_VIEN", chiNhanhId: "CN002", trangThai: "HOAT_DONG", matKhauHash: existingPasswordHash,
  });
  db.data.huan_luyen_vien.push({ _id: "PT008", nguoiDungId: "ND040", chiNhanhId: "CN002", chuyenMon: "Thể lực", trangThai: "DANG_LAM" });

  assert.equal((await login("HLV cũ", "custom-existing")).status, 400);
  const exact = await login("othercoach@example.com", "custom-existing");
  assert.equal(exact.status, 200);
  assert.equal(exact.body.account.id, "ND040");
});

test("data-all only displays real PT profiles linked to actual HLV accounts", async () => {
  db.data.huan_luyen_vien.push(
    { _id: "PT008", nguoiDungId: "MISSING", chiNhanhId: "CN001", chuyenMon: "Hồ sơ mồ côi", trangThai: "DANG_LAM" },
    { _id: "PT009", nguoiDungId: "ND010", chiNhanhId: "CN001", chuyenMon: "Tài khoản không còn quyền PT", trangThai: "DANG_LAM" },
  );
  db.data.nguoi_dung.push({ _id: "ND040", hoTen: "HLV chưa có hồ sơ", tenDangNhap: "missingprofile", vaiTro: "HUAN_LUYEN_VIEN", chiNhanhId: "CN001", trangThai: "HOAT_DONG" });

  const response = await request("/api/data-all?role=ADMIN&memberId=ND030&branch=CN001", "GET");

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.records.trainers.map((row) => row._id), ["PT007"]);
  assert.deepEqual(response.body.data.trainers.map((row) => row[0]), ["HLV cũ"]);
  assert.ok(response.body.records.trainers.every((row) => row.nguoiDungId === "ND020"));
});

test("editing a PT's branch through the trainer endpoint requires transfer approval and keeps its password", async () => {
  const previousProfile = structuredClone(profileByUser("ND020"));
  const response = await request("/api/trainers/PT007", "PUT", { chiNhanhId: "CN002" });

  assert.equal(response.status, 409);
  assert.equal(userById("ND020").chiNhanhId, "CN001");
  assert.equal(userById("ND020").matKhauHash, existingPasswordHash);
  assert.deepEqual(profileByUser("ND020"), previousProfile);
  const signedIn = await login("oldcoach", "custom-existing");
  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.body.account.branch, "CN001");
  assert.equal((await login("oldcoach", "1")).status, 401);
});

test("a manager can create a new HLV in a selected saved branch using their real session", async () => {
  const response = await request("/api/trainers", "POST", {
    hoTen: "HLV do quản lý tạo", email: "manager-created@example.com", chiNhanhId: "CN002", currentUserId: "ND030",
  }, "ND030");

  assert.equal(response.status, 200);
  const created = db.data.nguoi_dung.find((row) => row.email === "manager-created@example.com");
  assert.equal(created.chiNhanhId, "CN002");
  assert.equal(profileByUser(created._id).chiNhanhId, "CN002");
  assert.equal((await login(created.email, "1")).status, 200);
});
