import { Icon, GymArt } from "../components/UI";

export default function HomePage({ packageContent, navigate }) {
  return (
    <>
      <section className="hero">
        <div className="hero-inner">
          <div className="hero-copy">
            <span className="eyebrow">
              <i /> KHỞI ĐỘNG MỘT THÓI QUEN TỐT
            </span>
            <h1>
              Tập hôm nay.
              <br />
              <em>Khỏe mỗi ngày.</em>
            </h1>
            <p>
              Lựa chọn gói tập phù hợp, tìm chi nhánh và sắp xếp buổi tập của
              bạn. Một nơi để bắt đầu hành trình khỏe hơn.
            </p>
            <div className="actions">
              <button className="btn" onClick={() => navigate("packages")}>
                Khám phá gói tập <Icon name="arrow" />
              </button>
              <button
                className="btn outline-light"
                onClick={() => navigate("branches")}
              >
                Tìm chi nhánh
              </button>
            </div>
            <div className="hero-facts">
              <div>
                <strong>02</strong>
                <span>Gói tập rõ ràng</span>
              </div>
              <div>
                <strong>02</strong>
                <span>Chi nhánh mẫu</span>
              </div>
              <div>
                <strong>05:30–22:00</strong>
                <span>Giờ mở cửa theo mẫu</span>
              </div>
            </div>
          </div>
          <div className="hero-visual">
            <span className="orbit" />
            <GymArt />
            <div className="floating-note">
              <Icon name="barbell" />
              <div>
                <strong>Bắt đầu từ 320.000đ</strong>
                <span>Gói tập 30 ngày</span>
              </div>
            </div>
            <span className="visual-caption">MOVE BETTER / LIVE STRONGER</span>
          </div>
        </div>
      </section>
      <div className="trust-strip">
        <span>
          <Icon name="check" />
          Giá và thời hạn rõ ràng
        </span>
        <span>
          <Icon name="pin" />
          Chọn đúng chi nhánh
        </span>
        <span>
          <Icon name="calendar" />
          Sắp xếp lịch tập
        </span>
      </div>
      <section className="section">
        <div className="section-head">
          <div>
            <span className="eyebrow dark">GÓI TẬP CỦA BẠN</span>
            <h2>Bắt đầu nhỏ. Duy trì lâu.</h2>
          </div>
          <p>
            Hai lựa chọn, một mục tiêu:
            <br />
            tập luyện đều đặn hơn mỗi ngày.
          </p>
        </div>
        {packageContent}
      </section>
      <section className="section steps-section">
        <div>
          <span className="eyebrow dark">ĐƠN GIẢN TỪ BƯỚC ĐẦU</span>
          <h2>Sẵn sàng cho buổi tập?</h2>
          <p>Chọn gói phù hợp và theo dõi thông tin tập luyện ở một nơi.</p>
        </div>
        <div className="steps">
          {[
            ["01", "Chọn gói tập", "Xem giá, thời hạn và cơ sở áp dụng."],
            [
              "02",
              "Đăng ký và thanh toán",
              "Gói được kích hoạt sau khi khoản thu được xác nhận.",
            ],
            ["03", "Bắt đầu tập luyện", "Theo dõi gói và tìm hiểu dịch vụ PT."],
          ].map(([n, t, x]) => (
            <div key={n}>
              <b>{n}</b>
              <div>
                <h3>{t}</h3>
                <p>{x}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
