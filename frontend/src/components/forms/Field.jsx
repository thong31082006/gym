// Một ô nhập dùng chung cho các biểu mẫu.
export default function Field({ name, label, ...props }) {
  return (
    <label>
      {label}
      <input id={name} name={name} required {...props} />
    </label>
  );
}
