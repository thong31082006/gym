export function getBranchChoices(branches = []) {
  return branches.flatMap((branch) => branch._id ? [{
    value: branch._id,
    label: `${branch.tenChiNhanh || "Chi nhánh chưa có tên"}${branch.diaChi ? ` - ${branch.diaChi}` : ""}`,
  }] : []);
}

export function getBranchName(branches = [], branchId) {
  if (!branchId) return "";
  return branches.find((branch) => branch._id === branchId)?.tenChiNhanh || "Chưa xác định chi nhánh";
}

const profileFields = ["Họ tên", "Email", "Số điện thoại", "Chuyên môn", "Mô tả", "Chi nhánh"];
const profileNote = "Cập nhật thông tin huấn luyện viên. Chọn chi nhánh khác để gửi yêu cầu chuyển; chi nhánh hiện tại chỉ đổi sau khi quản lý duyệt.";

export function syncTrainerProfileModal(modal, user, role, branches = []) {
  if (modal?.meta?.type !== "profile") return modal;
  if (modal.meta.role !== role || (modal.meta.profileUserId && modal.meta.profileUserId !== user?.id)) return null;
  if (role !== "HUAN_LUYEN_VIEN") return modal;

  const branchChoices = getBranchChoices(branches);
  const profileBranch = user?.branch || "";
  if (
    modal.meta.profileSchemaVersion === 2 &&
    modal.meta.profileUserId === user?.id &&
    modal.meta.profileBranch === profileBranch &&
    JSON.stringify(modal.fields) === JSON.stringify(profileFields) &&
    JSON.stringify(modal.meta.branchChoices) === JSON.stringify(branchChoices)
  ) return modal;

  const defaults = [user?.name || "", user?.email || "", user?.phone || "", user?.specialty || "", user?.bio || ""];
  const values = profileFields.slice(0, 5).map((field, index) => {
    const previousIndex = modal.fields.indexOf(field);
    return previousIndex < 0 ? defaults[index] : modal.values?.[previousIndex] ?? defaults[index];
  });
  return {
    ...modal,
    fields: [...profileFields],
    values: [...values, profileBranch],
    note: profileNote,
    meta: { ...modal.meta, branchChoices, profileBranch, profileUserId: user?.id, profileSchemaVersion: 2 },
  };
}
