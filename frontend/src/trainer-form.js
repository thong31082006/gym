export function buildTrainerModuleForm({ fields, values = [], rawRecord, currentBranch, branchChoices = [] }) {
  if (branchChoices.length === 0) throw new Error("Chưa tải được danh sách chi nhánh. Vui lòng thử lại.");
  return {
    fields: [...fields.slice(0, 5), "Chi nhánh"],
    values: [...fields.slice(0, 5).map((_, index) => values[index] || ""), rawRecord?.chiNhanhId || currentBranch || ""],
  };
}

export function validateTrainerBranch(values, branches = []) {
  const branchId = values[5];
  if (!branches.some((branch) => branch._id === branchId)) throw new Error("Vui lòng chọn chi nhánh trong danh sách hiện có.");
  return branchId;
}

export function buildTrainerModulePayload(values, currentUserId) {
  const [hoTen, email, chuyenMon, moTa, trangThai, chiNhanhId] = values;
  return { hoTen, email, chuyenMon, moTa, trangThai, chiNhanhId, currentUserId };
}

export function getRealTrainerRoster(records = {}, currentBranch) {
  const accounts = new Map((records.accounts || []).map((account) => [account._id, account]));
  const trainers = new Map();
  for (const profile of records.trainers || []) {
    const account = accounts.get(profile.nguoiDungId);
    if (!profile._id || String(profile._id).startsWith("PT_") || account?.vaiTro !== "HUAN_LUYEN_VIEN") continue;
    const name = account.hoTen || profile.hoTen || profile.tenHLV;
    if (!name) continue;
    trainers.set(profile._id, {
      id: profile._id,
      userId: profile.nguoiDungId,
      name,
      email: account.email || profile.email || "",
      phone: account.soDienThoai || profile.soDienThoai || "",
      specialty: profile.chuyenMon || "Sức mạnh & thể hình",
      bio: profile.moTa || "Huấn luyện viên cá nhân chuyên nghiệp",
      status: profile.trangThai || "DANG_LAM",
      branch: profile.chiNhanhId || account.chiNhanhId || currentBranch,
    });
  }
  return [...trainers.values()];
}
