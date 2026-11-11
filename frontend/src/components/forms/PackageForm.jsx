import Field from "./Field";
import * as mock from "../../data/mock-data";
import { money } from "../../data/format";

export default function PackageForm({ item, demo }) {
  function handleSubmit(event) {
    event.preventDefault();
    demo(`Đã chọn ${item.tenGoi}`);
  }

  return (
    <form id="packageRegistrationForm" onSubmit={handleSubmit}>
      <div className="purchase-summary">
        <strong>{item.tenGoi}</strong>
        <b>{money(item.gia)}</b>
        <span>
          {item.thoiHanNgay} ngày • {item._id}
        </span>
      </div>
      <input type="hidden" name="goiTapId" value={item._id} />
      <label>
        Chi nhánh áp dụng
        <select
          id="branchSelect"
          name="chiNhanhId"
          defaultValue={item.chiNhanhId}
        >
          <option value={item.chiNhanhId}>
            {mock.branches.find((b) => b._id === item.chiNhanhId)
              ?.tenChiNhanh || item.chiNhanhId}
          </option>
        </select>
      </label>
      <Field name="ngayBatDau" label="Ngày bắt đầu" type="date" />
      <label>
        Phương thức thanh toán
        <select name="phuongThuc">
          <option value="chuyen_khoan">Chuyển khoản</option>
          <option value="tai_quay">Thanh toán tại quầy</option>
        </select>
      </label>
      <p className="subnote">
        Không tạo giao dịch hoặc kích hoạt gói trong bản demo.
      </p>
      <button className="btn full" id="btnRegisterPackage" type="submit">
        Kiểm tra thông tin đăng ký
      </button>
    </form>
  );
}
