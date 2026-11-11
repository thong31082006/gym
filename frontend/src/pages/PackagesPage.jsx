import PageHeading from "../components/PageHeading";

export default function PackagesPage({ packageContent }) {
  return (
    <section className="section">
      <PageHeading
        label="GÓI TẬP"
        title="Chọn nhịp tập của bạn."
        text="Giá rõ ràng. Thời hạn cụ thể. Chỉ hai lựa chọn để dễ bắt đầu."
      />
      {packageContent}
      <p className="subnote">
        Giá gói không bao gồm dịch vụ PT. Phạm vi sử dụng hiển thị theo chi
        nhánh của từng gói.
      </p>
    </section>
  );
}
