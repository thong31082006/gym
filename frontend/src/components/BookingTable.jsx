import { Badge, Table } from "./UI";
import { date } from "../data/format";

export default function BookingTable({ rows }) {
  return (
    <Table
      headers={[
        "Mã lịch",
        "PT",
        "Chi nhánh",
        "Ngày tập",
        "Thời gian",
        "Trạng thái",
      ]}
      rows={rows.map((b) => [
        b._id,
        b.ptId,
        b.chiNhanhId,
        date(b.ngayTap),
        `${b.gioBatDau} – ${b.gioKetThuc}`,
        <Badge key={b._id}>Đã xác nhận • mẫu</Badge>,
      ])}
    />
  );
}
