import { Component } from "react";
import Icon from "./StaffIcon.jsx";

export default class StaffLoadBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="staff-workspace">
        <section className="sw-loading-state" role="alert">
          <Icon name="alert" size={40} />
          <h2>Không thể mở không gian Nhân viên</h2>
          <p>Vui lòng tải lại trang để thử lại. Dữ liệu đã lưu trong trình duyệt được giữ nguyên.</p>
          <button className="sw-primary" onClick={() => window.location.reload()}>Tải lại trang</button>
        </section>
      </div>
    );
  }
}
