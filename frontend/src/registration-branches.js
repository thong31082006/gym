export function getRegistrationBranchChoices(branches = []) {
  const seen = new Set();
  return branches.flatMap((branch) => {
    if (typeof branch?._id !== "string" || !branch._id.trim() ||
        typeof branch.tenChiNhanh !== "string" || !branch.tenChiNhanh.trim() || seen.has(branch._id)) return [];
    seen.add(branch._id);
    const address = typeof branch.diaChi === "string" ? branch.diaChi.trim() : "";
    return [{
      value: branch._id,
      label: `${branch.tenChiNhanh.trim()}${address ? ` - ${address}` : ""}`,
    }];
  });
}

export function retainRegistrationBranch(branchId, choices = []) {
  return choices.some((choice) => choice.value === branchId) ? branchId : "";
}
