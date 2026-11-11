export const money = (value) => `${Number(value).toLocaleString("vi-VN")}đ`;
export const date = (value) =>
  new Date(`${value}T12:00:00`).toLocaleDateString("vi-VN");
