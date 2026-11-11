import Field from "./Field";

export default function AuthForm({ type, setDialog, demo }) {
  function handleSubmit(event) {
    event.preventDefault();
    demo("Đã kiểm tra các trường tài khoản");
  }

  return (
    <form
      id={type === "login" ? "loginForm" : "registerForm"}
      onSubmit={handleSubmit}
    >
      {type === "register" && (
        <>
          <Field name="hoTen" label="Họ và tên" autoComplete="name" />
          <Field
            name="soDienThoai"
            label="Số điện thoại"
            type="tel"
            autoComplete="tel"
            pattern="[0-9+ ()-]{9,15}"
          />
        </>
      )}
      <Field name="email" label="Email" type="email" autoComplete="email" />
      <Field
        name="matKhau"
        label="Mật khẩu"
        type="password"
        minLength="6"
        autoComplete={type === "login" ? "current-password" : "new-password"}
      />
      <button className="btn full" type="submit">
        {type === "login" ? "Kiểm tra form đăng nhập" : "Kiểm tra form đăng ký"}
      </button>
      <button
        type="button"
        className="text-button"
        onClick={() =>
          setDialog({ type: type === "login" ? "register" : "login" })
        }
      >
        {type === "login"
          ? "Chưa có tài khoản? Xem form đăng ký"
          : "Đã có tài khoản? Xem form đăng nhập"}
      </button>
    </form>
  );
}
