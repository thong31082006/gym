export const transferStatusLabels = { PENDING: "Chờ duyệt", APPROVED: "Đã duyệt", REJECTED: "Đã từ chối" };

export function getBranchTrainerRoster(roster = [], role, savedBranch) {
  if (role !== "KHACH") return roster;
  return savedBranch ? roster.filter((trainer) => trainer.branch === savedBranch) : [];
}

export function getBranchBookingRows(bookings = [], appointments = [], roster = [], role, savedBranch) {
  if (role !== "KHACH") return bookings;
  if (!savedBranch) return [];
  const trainers = new Set(roster.filter((trainer) => trainer.branch === savedBranch).map((trainer) => trainer.id));
  const rawAppointments = new Map(appointments.map((appointment) => [appointment._id, appointment]));
  return bookings.filter((booking) => {
    const appointment = rawAppointments.get(booking._id);
    return appointment?.chiNhanhId === savedBranch && trainers.has(appointment.ptId);
  });
}

function transferUserId(transfer, records = {}) {
  return transfer.trainerUserId || transfer.nguoiDungId || (records.trainers || []).find((trainer) => trainer._id === (transfer.trainerId || transfer.ptId))?.nguoiDungId;
}

export function getOwnTrainerTransfer(transfers = [], userId, records = {}) {
  if (!userId) return undefined;
  const ownTransfers = transfers.filter((transfer) => transferUserId(transfer, records) === userId);
  return ownTransfers.find((transfer) => transfer.status === "PENDING") || ownTransfers[0];
}

export function getManagerPendingTransfers(transfers = [], role, savedBranch) {
  if (role !== "QUAN_LY_CHI_NHANH" || !savedBranch) return [];
  return transfers.filter((transfer) => transfer.status === "PENDING" && transfer.fromBranchId === savedBranch);
}

export function getTransferTrainerName(transfer, records = {}) {
  const account = (records.accounts || []).find((item) => item._id === transferUserId(transfer, records));
  return account?.hoTen || transfer.trainerName || "Huấn luyện viên";
}

export function getProfileUpdateAccount(response) {
  return response.account && response.branchTransfer ? { ...response.account, branchTransfer: response.branchTransfer } : response.account;
}
