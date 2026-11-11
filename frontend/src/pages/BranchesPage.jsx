import * as mock from "../data/mock-data";
import { Icon } from "../components/UI";
import PageHeading from "../components/PageHeading";

export default function BranchesPage({ navigate, notify }) {
  return (
    <section className="section">
      <PageHeading
        label="CHI NHÁNH"
        title="Tìm nơi tập gần bạn."
        text="Thông tin chi nhánh đang hiển thị theo dữ liệu mẫu của nhóm."
      />
      <div className="branch-grid">
        {mock.branches.map((b, i) => (
          <article className="branch-card" key={b._id}>
            <div className="branch-art">
              <div className="street-lines" />
              <Icon name="pin" width="58" height="58" />
              <span>0{i + 1} / HỒ CHÍ MINH</span>
            </div>
            <div className="branch-body">
              <h3>{b.tenChiNhanh}</h3>
              <p>
                <Icon name="pin" />
                {b.diaChi}
              </p>
              <p>
                <Icon name="calendar" />
                {b.gioMoCua} – {b.gioDongCua} mỗi ngày
              </p>
              <p>Điện thoại: {b.soDienThoai}</p>
              <button
                className="btn secondary full"
                onClick={() => {
                  navigate("packages");
                  notify(
                    b._id === "CN001"
                      ? "Các gói mẫu hiện áp dụng tại Gym Quận 3."
                      : "Chưa có gói mẫu áp dụng tại Gym Quận 10.",
                  );
                }}
              >
                Xem gói áp dụng <Icon name="arrow" />
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
