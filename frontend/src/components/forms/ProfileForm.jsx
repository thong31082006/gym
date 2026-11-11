import Field from "./Field";

export default function ProfileForm({ demo }) {
  function handleSubmit(event) {
    event.preventDefault();
    demo("Đã kiểm tra thông tin cá nhân");
  }

  return (
    <form id="profileForm" onSubmit={handleSubmit}>
      <Field name="hoTen" label="Họ và tên" defaultValue="Nguyễn Văn A" />
      <Field
        name="email"
        label="Email"
        type="email"
        defaultValue="nguyenvana@example.com"
      />
      <Field
        name="soDienThoai"
        label="Số điện thoại"
        type="tel"
        defaultValue="0912345678"
      />
      <button className="btn full" type="submit">
        Kiểm tra thông tin cập nhật
      </button>
    </form>
  );
}
