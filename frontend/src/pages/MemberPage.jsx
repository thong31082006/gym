import { useState } from "react";
import * as mock from "../data/mock-data";
import { Badge, Table } from "../components/UI";
import { date } from "../data/format";
import PageHeading from "../components/PageHeading";
import BookingTable from "../components/BookingTable";

export default function MemberPage({ packages, setDialog }) {
  const [memberTab, setMemberTab] = useState("Gói của tôi");
  return (
    <section className="section">
      <PageHeading
        label="KHÔNG GIAN HỘI VIÊN"
        title="Theo dõi hành trình tập luyện."
        text="Bạn đang xem tài khoản minh họa Nguyễn Văn A; chưa có phiên đăng nhập thật."
      />
      <div className="member-layout">
        <aside className="profile-card">
          <div className="avatar">NA</div>
          <h3>Nguyễn Văn A</h3>
          <p>ND001 • Hội viên mẫu</p>
          <div className="profile-data">
            <span>Email</span>
            <b>nguyenvana@example.com</b>
            <span>Chi nhánh</span>
            <b>Gym Quận 3</b>
          </div>
          <button
            className="btn secondary full"
            onClick={() => setDialog({ type: "profile" })}
          >
            Xem form cập nhật
          </button>
        </aside>
        <div>
          <div className="tabs" role="group" aria-label="Thông tin hội viên">
            {["Gói của tôi", "Lịch PT", "Đơn hàng", "Lịch sử tập"].map((t) => (
              <button
                className={t === memberTab ? "active" : ""}
                key={t}
                onClick={() => setMemberTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="panel">
            {memberTab === "Gói của tôi" ? (
              <>
                <div className="section-head compact">
                  <h3>Gói tập 1 tháng</h3>
                  <Badge>Đang sử dụng • mẫu</Badge>
                </div>
                <div className="membership-progress">
                  <span>30 ngày tập luyện</span>
                  <strong>10/10/2026 → 09/11/2026</strong>
                  <div className="progress-track">
                    <span />
                  </div>
                  <small>Thanh tiến độ chỉ dùng minh họa bố cục</small>
                </div>
                <p>Chi nhánh áp dụng: Gym Quận 3</p>
                <button
                  className="btn"
                  onClick={() =>
                    setDialog({
                      type: "buy",
                      item:
                        packages.find((p) => Number(p.thoiHanNgay) === 30) ||
                        mock.packages[0],
                    })
                  }
                >
                  Xem form gia hạn
                </button>
              </>
            ) : memberTab === "Lịch PT" ? (
              <BookingTable
                rows={mock.bookings.filter((b) =>
                  b.hoiVienIds.includes("ND001"),
                )}
              />
            ) : memberTab === "Đơn hàng" ? (
              <Table
                headers={["Mã đơn", "Gói", "Tổng tiền", "Trạng thái"]}
                rows={mock.orders.map((o) => [
                  o._id,
                  o.goiTapId,
                  money(o.tongTien),
                  <Badge key={o._id}>Đã thanh toán • mẫu</Badge>,
                ])}
              />
            ) : (
              <Table
                headers={["Ngày tập", "Giờ vào", "Giờ ra"]}
                rows={mock.checkins.map((c) => [
                  date(c.ngayCheckin),
                  c.gioVao,
                  c.gioRa,
                ])}
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
