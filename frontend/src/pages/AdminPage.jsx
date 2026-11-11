import { useState } from "react";
import * as mock from "../data/mock-data";
import { Icon, Badge, Table } from "../components/UI";
import { money, date } from "../data/format";
import BookingTable from "../components/BookingTable";
const adminTabs = [
  "Tổng quan",
  "Hội viên",
  "Gói tập",
  "Đơn hàng",
  "Thanh toán",
  "Lịch PT",
  "Lịch làm việc PT",
  "Check-in",
  "Thiết bị",
  "Bảo trì",
  "Chi nhánh",
  "Huấn luyện viên",
];

export default function AdminPage({ packages, packageContent }) {
  const [tab, setTab] = useState("Tổng quan");
  const [query, setQuery] = useState("");
  const [branch, setBranch] = useState("all");
  const selectedRows = (rows) =>
    rows.filter(
      (r) =>
        (branch === "all" || r.chiNhanhId === branch) &&
        JSON.stringify(r)
          .toLocaleLowerCase("vi")
          .includes(query.toLocaleLowerCase("vi")),
    );
  function adminContent() {
    if (tab === "Tổng quan")
      return (
        <>
          <div className="stats-grid">
            {[
              [
                "Hội viên",
                mock.members.filter((m) => m.vaiTro === "HOI_VIEN").length,
              ],
              ["Gói tập", packages.length],
              ["Chi nhánh", mock.branches.length],
              ["Đơn hàng mẫu", mock.orders.length],
            ].map(([label, value]) => (
              <div className="stat" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
                <small>Dữ liệu minh họa</small>
              </div>
            ))}
          </div>
          <div className="panel">
            <h3>Lịch PT sắp tới trong dữ liệu mẫu</h3>
            {<BookingTable rows={mock.bookings} />}
          </div>
        </>
      );
    if (tab === "Hội viên")
      return (
        <Table
          headers={["Mã", "Họ tên", "Email", "Vai trò", "Chi nhánh"]}
          rows={selectedRows(mock.members).map((m) => [
            m._id,
            m.hoTen,
            m.email,
            m.vaiTro,
            m.chiNhanhId,
          ])}
        />
      );
    if (tab === "Gói tập") return packageContent;
    if (tab === "Đơn hàng")
      return (
        <Table
          headers={[
            "Mã đơn",
            "Hội viên",
            "Gói",
            "Tổng tiền",
            "Ngày tạo",
            "Trạng thái",
          ]}
          rows={selectedRows(mock.orders).map((o) => [
            o._id,
            o.nguoiDungId,
            o.goiTapId,
            money(o.tongTien),
            date(o.ngayTao),
            <Badge key={o._id}>Đã thanh toán • mẫu</Badge>,
          ])}
        />
      );
    if (tab === "Thanh toán")
      return (
        <Table
          headers={["Mã", "Đơn hàng", "Số tiền", "Phương thức", "Trạng thái"]}
          rows={selectedRows(
            mock.payments.map((p) => ({
              ...p,
              chiNhanhId: mock.orders.find((o) => o._id === p.donHangId)
                ?.chiNhanhId,
            })),
          ).map((p) => [
            p._id,
            p.donHangId,
            money(p.soTien),
            "Chuyển khoản",
            <Badge key={p._id}>Thành công • mẫu</Badge>,
          ])}
        />
      );
    if (tab === "Lịch PT")
      return <BookingTable rows={selectedRows(mock.bookings)} />;
    if (tab === "Lịch làm việc PT")
      return (
        <Table
          headers={["PT", "Chi nhánh", "Ngày làm", "Thời gian", "Trạng thái"]}
          rows={selectedRows(mock.workSchedules).map((r) => [
            r.ptId,
            r.chiNhanhId,
            date(r.ngayLam),
            "08:00 – 12:00",
            <Badge key={r.ngayLam}>Sẵn sàng • mẫu</Badge>,
          ])}
        />
      );
    if (tab === "Check-in")
      return (
        <Table
          headers={["Mã", "Hội viên", "Ngày", "Giờ vào", "Giờ ra"]}
          rows={selectedRows(
            mock.checkins.map((c) => ({ ...c, chiNhanhId: "CN001" })),
          ).map((c) => [
            c._id,
            c.hoiVienId,
            date(c.ngayCheckin),
            c.gioVao,
            c.gioRa,
          ])}
        />
      );
    if (tab === "Thiết bị")
      return (
        <Table
          headers={["Mã", "Thiết bị", "Chi nhánh", "Số lượng", "Tình trạng"]}
          rows={selectedRows(mock.equipment).map((e) => [
            e._id,
            e.tenThietBi,
            e.chiNhanhId,
            e.soLuong,
            <Badge key={e._id}>Tốt</Badge>,
          ])}
        />
      );
    if (tab === "Bảo trì")
      return (
        <Table
          headers={["Mã", "Thiết bị", "Ngày", "Nội dung", "Chi phí"]}
          rows={selectedRows(
            mock.maintenance.map((m) => ({ ...m, chiNhanhId: "CN001" })),
          ).map((m) => [
            m._id,
            m.thietBiId,
            date(m.ngayBaoTri),
            m.noiDung,
            money(m.chiPhi),
          ])}
        />
      );
    if (tab === "Chi nhánh")
      return (
        <Table
          headers={["Mã", "Chi nhánh", "Địa chỉ", "Giờ hoạt động"]}
          rows={selectedRows(
            mock.branches.map((b) => ({ ...b, chiNhanhId: b._id })),
          ).map((b) => [
            b._id,
            b.tenChiNhanh,
            b.diaChi,
            `${b.gioMoCua} – ${b.gioDongCua}`,
          ])}
        />
      );
    return (
      <Table
        headers={["Mã", "PT", "Chuyên môn", "Kinh nghiệm", "Giá một buổi"]}
        rows={selectedRows(mock.trainers).map((t) => [
          t._id,
          t.hoTen,
          t.chuyenMon,
          `${t.kinhNghiemNam} năm`,
          money(t.giaMoiBuoi),
        ])}
      />
    );
  }

  return (
    <section className="admin-layout">
      <aside className="sidebar">
        <div className="sidebar-title">
          <Icon name="grid" />
          <strong>Không gian quản lý</strong>
        </div>
        <p>Bản xem trước • không phân quyền thật</p>
        {adminTabs.map((t) => (
          <button
            className={t === tab ? "active" : ""}
            key={t}
            onClick={() => {
              setTab(t);
              setQuery("");
            }}
          >
            {t}
            <span>›</span>
          </button>
        ))}
      </aside>
      <div className="admin-main">
        <div className="section-head">
          <div>
            <span className="eyebrow dark">VẬN HÀNH PHÒNG GYM</span>
            <h2>{tab}</h2>
          </div>
          <Badge tone="gray">Chế độ demo</Badge>
        </div>
        <div className="toolbar">
          <label className="search-label">
            <span className="sr-only">Tìm trong dữ liệu mẫu</span>
            <input
              id="adminSearch"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm mã, tên hoặc email…"
            />
          </label>
          <label>
            <span className="sr-only">Lọc chi nhánh</span>
            <select
              id="adminBranchFilter"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
            >
              <option value="all">Tất cả chi nhánh</option>
              {mock.branches.map((b) => (
                <option key={b._id} value={b._id}>
                  {b.tenChiNhanh}
                </option>
              ))}
            </select>
          </label>
        </div>
        {tab === "Tổng quan" && (
          <p className="subnote">
            Tổng quan toàn bộ dữ liệu mẫu; bộ lọc áp dụng ở các danh sách.
          </p>
        )}
        {tab === "Gói tập" && (
          <p className="subnote">
            Danh mục 2 gói dùng chung; bộ lọc không áp dụng tại mục này.
          </p>
        )}
        {adminContent()}
      </div>
    </section>
  );
}
