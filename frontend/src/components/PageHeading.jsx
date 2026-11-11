export default function PageHeading({ label, title, text }) {
  return (
    <div className="page-heading">
      <span className="eyebrow dark">{label}</span>
      <h1>{title}</h1>
      <p>{text}</p>
    </div>
  );
}
