// Demo account storage only. A deployed system must authenticate on the server.
export function mergeAccounts(defaultAccounts, storedAccounts) {
  const saved = Array.isArray(storedAccounts)
    ? storedAccounts.filter((item) => item && typeof item.id === "string" && typeof item.role === "string")
    : [];
  const defaults = defaultAccounts.map((account) => {
    const found = saved.find((item) => item.id === account.id)
      || saved.find((item) => item.role === account.role && item.email === account.email);
    const merged = found ? { ...account, ...found } : { ...account };
    if (account.id === "acc-staff" && merged.email === "Nhi@") {
      merged.email = account.email;
    }
    return merged;
  });
  const ids = new Set(defaults.map((item) => item.id));
  return [...defaults, ...saved.filter((item) => !ids.has(item.id))];
}

export function updateStaffProfile(currentUser, accounts, values) {
  const account = accounts.find((item) => item.id === currentUser?.id);
  if (!account || account.role !== "NHAN_VIEN") {
    throw new Error("Vui lòng đăng nhập bằng tài khoản Nhân viên.");
  }
  const name = String(values.name || "").trim();
  const email = String(values.email || "").trim().toLowerCase();
  const phone = String(values.phone || "").replace(/\s/g, "");
  if (name.length < 2 || name.length > 80) throw new Error("Họ tên cần từ 2 đến 80 ký tự.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Email không hợp lệ.");
  if (!/^(?:0\d{9}|\+84\d{9})$/.test(phone)) throw new Error("Số điện thoại cần có 10 chữ số, bắt đầu bằng 0, hoặc dùng +84.");
  if (accounts.some((item) => item.id !== account.id && String(item.email).toLowerCase() === email)) {
    throw new Error("Email đã được sử dụng bởi tài khoản khác.");
  }
  const passwordRequested = Boolean(values.currentPassword || values.newPassword || values.confirmPassword);
  if (passwordRequested) {
    if (values.currentPassword !== account.password) throw new Error("Mật khẩu hiện tại không đúng.");
    if (String(values.newPassword || "").length < 6) throw new Error("Mật khẩu mới cần ít nhất 6 ký tự.");
    if (values.newPassword !== values.confirmPassword) throw new Error("Xác nhận mật khẩu mới không khớp.");
  }
  return {
    ...account,
    name,
    email,
    phone,
    password: passwordRequested ? values.newPassword : account.password,
  };
}
