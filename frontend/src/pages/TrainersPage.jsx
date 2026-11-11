import * as mock from "../data/mock-data";
import { Icon, Badge } from "../components/UI";
import { money } from "../data/format";
import PageHeading from "../components/PageHeading";

export default function TrainersPage({ setDialog }) {
  return (
    <section className="section">
      <PageHeading
        label="HUẤN LUYỆN VIÊN"
        title="Tập luyện có người đồng hành."
        text="Tìm hiểu chuyên môn và xem trước biểu mẫu đặt lịch PT."
      />
      <div className="trainer-grid">
        {mock.trainers.map((t) => (
          <article className="trainer-card" key={t._id}>
            <div className="trainer-avatar">
              <Icon name="user" width="100" height="100" />
              <span>PT / {t._id}</span>
            </div>
            <div>
              <Badge>Hồ sơ mẫu</Badge>
              <h3>{t.hoTen}</h3>
              <p>{t.chuyenMon}</p>
              <div className="trainer-details">
                <span>{t.kinhNghiemNam} năm kinh nghiệm</span>
                <span>Gym Quận 3</span>
              </div>
              <strong className="trainer-price">
                {money(t.giaMoiBuoi)} <small>/ buổi</small>
              </strong>
              <button
                className="btn"
                data-action="open-booking"
                onClick={() => setDialog({ type: "booking", item: t })}
              >
                Xem biểu mẫu đặt lịch <Icon name="calendar" />
              </button>
            </div>
          </article>
        ))}
      </div>
      <p className="subnote">
        Giờ trống, điều kiện đặt lịch và quyền sử dụng PT sẽ do backend kiểm tra
        khi tích hợp.
      </p>
    </section>
  );
}
