import Field from "./Field";

function readForm(event) {
  event.preventDefault();
  return Object.fromEntries(new FormData(event.currentTarget));
}

export default function BookingForm({ item, notify, demo }) {
  function handleSubmit(event) {
    const values = readForm(event);
    if (values.gioKetThuc <= values.gioBatDau) {
      notify("Giờ kết thúc phải sau giờ bắt đầu.");
      return;
    }
    demo("Đã kiểm tra các trường đặt PT");
  }

  return (
    <form id="bookingForm" onSubmit={handleSubmit}>
      <label>
        Huấn luyện viên
        <select id="trainerSelect" name="ptId">
          <option value={item._id}>{item.hoTen}</option>
        </select>
      </label>
      <input type="hidden" name="chiNhanhId" value={item.chiNhanhId} />
      <Field name="ngayTap" label="Ngày tập" type="date" />
      <div className="form-row">
        <Field name="gioBatDau" label="Giờ bắt đầu" type="time" />
        <Field name="gioKetThuc" label="Giờ kết thúc" type="time" />
      </div>
      <p className="subnote">
        Backend sẽ kiểm tra lịch trống, gói hợp lệ và điều kiện PT. Chưa giữ chỗ
        khi bấm nút dưới.
      </p>
      <button className="btn full" type="submit">
        Kiểm tra biểu mẫu đặt PT
      </button>
    </form>
  );
}
