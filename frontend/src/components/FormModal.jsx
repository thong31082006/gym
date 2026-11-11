import AuthForm from "./forms/AuthForm";
import PackageForm from "./forms/PackageForm";
import BookingForm from "./forms/BookingForm";
import ProfileForm from "./forms/ProfileForm";
import { Badge } from "./UI";

export default function FormModal({
  modalRef,
  dialog,
  setDialog,
  notify,
  demo,
}) {
  return (
    <dialog
      ref={modalRef}
      className="modal"
      onCancel={() => setDialog(null)}
      onClick={(e) => {
        if (e.target === e.currentTarget) setDialog(null);
      }}
      aria-labelledby="dialogTitle"
    >
      {dialog && (
        <>
          <button
            className="close-modal"
            aria-label="Đóng cửa sổ"
            onClick={() => setDialog(null)}
          >
            ×
          </button>
          <Badge tone="gray">Biểu mẫu demo</Badge>
          <h2 id="dialogTitle">
            {
              {
                login: "Chào mừng trở lại",
                register: "Bắt đầu cùng Gym Station",
                buy: "Đăng ký gói tập",
                booking: "Đặt lịch huấn luyện viên",
                profile: "Thông tin cá nhân",
              }[dialog.type]
            }
          </h2>
          <p className="modal-desc">
            Biểu mẫu phục vụ ghép chức năng. Thao tác hiện tại chưa lưu dữ liệu.
          </p>
          {["login", "register"].includes(dialog.type) && (
            <AuthForm type={dialog.type} setDialog={setDialog} demo={demo} />
          )}
          {dialog.type === "buy" && (
            <PackageForm item={dialog.item} demo={demo} />
          )}
          {dialog.type === "booking" && (
            <BookingForm item={dialog.item} notify={notify} demo={demo} />
          )}
          {dialog.type === "profile" && <ProfileForm demo={demo} />}
        </>
      )}
    </dialog>
  );
}
