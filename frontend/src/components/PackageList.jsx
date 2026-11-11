import * as mock from "../data/mock-data";
import { Icon, Badge, Empty } from "./UI";
import { money } from "../data/format";

export default function PackageList({
  packages,
  loading,
  error,
  onRetry,
  setDialog,
}) {
  return loading ? (
    <div className="empty" role="status">
      Đang tải gói tập…
    </div>
  ) : error ? (
    <div className="empty" role="alert">
      <p>{error}</p>
      <button className="btn" onClick={onRetry}>
        Thử lại
      </button>
    </div>
  ) : packages.length === 0 ? (
    <Empty text="Chưa có gói tập đang bán." />
  ) : (
    <div className="package-grid">
      {packages.map((p, i) => (
        <article
          className={`package-card ${i === 1 ? "featured" : ""}`}
          key={p._id}
          data-package-id={p._id}
        >
          <div className="card-top">
            <span className="small-label">
              {Number(p.thoiHanNgay) === 90
                ? "DUY TRÌ THÓI QUEN"
                : "BẮT ĐẦU TẬP LUYỆN"}
            </span>
            {i === 1 && <Badge tone="lime">Lựa chọn dài hạn</Badge>}
          </div>
          <h3>{p.tenGoi}</h3>
          <p>{p.moTa}</p>
          <div className="price">
            {money(p.gia)}
            <span> / {p.thoiHanNgay} ngày</span>
          </div>
          <div className="rule" />
          <ul className="benefits">
            <li>
              <Icon name="check" />
              Sử dụng phòng gym trong {p.thoiHanNgay} ngày
            </li>
            <li>
              <Icon name="check" />
              Áp dụng tại{" "}
              {mock.branches.find((b) => b._id === p.chiNhanhId)?.tenChiNhanh ||
                "chi nhánh theo gói"}
            </li>
            <li>
              <Icon name="check" />
              Theo dõi thời hạn trong tài khoản
            </li>
          </ul>
          <button
            className="btn full"
            data-action="register-package"
            onClick={() => setDialog({ type: "buy", item: p })}
          >
            Chọn gói này <Icon name="arrow" />
          </button>
        </article>
      ))}
    </div>
  );
}
