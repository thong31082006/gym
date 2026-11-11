export function Icon({ name, ...props }) {
  const paths = {
    barbell: (
      <>
        <path d="M6 12h12M3 7v10M6 5v14M18 5v14M21 7v10" />
      </>
    ),
    arrow: (
      <>
        <path d="M5 12h14m-5-5 5 5-5 5" />
      </>
    ),
    pin: (
      <>
        <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z" />
        <circle cx="12" cy="10" r="2" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="3" />
        <path d="M7 3v4m10-4v4M3 11h18" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
      </>
    ),
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  };
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name] || paths.barbell}
    </svg>
  );
}
export function Badge({ children, tone = "green" }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Empty({ text = "Chưa có dữ liệu để hiển thị." }) {
  return (
    <div className="empty">
      <Icon name="grid" />
      <p>{text}</p>
    </div>
  );
}
export function Table({ headers, rows }) {
  return rows.length ? (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty />
  );
}
export function GymArt() {
  return (
    <svg
      viewBox="0 0 600 480"
      className="gym-art"
      role="img"
      aria-label="Minh họa khu vực tập tạ"
    >
      <defs>
        <linearGradient id="floor" x2="0" y2="1">
          <stop stopColor="#253b36" />
          <stop offset="1" stopColor="#101c19" />
        </linearGradient>
      </defs>
      <path fill="url(#floor)" d="M0 320 300 210 600 320 300 480Z" />
      <path
        stroke="#344e45"
        fill="none"
        d="m0 375 300-110 300 110M150 425l300-110M150 265l300 160"
      />
      <g fill="none" stroke="#8caaa0" strokeWidth="13" strokeLinejoin="round">
        <path d="M155 345V140l155-55 145 55v205M155 140l145 55 155-55M300 195v205" />
        <path
          stroke="#4e6c61"
          strokeWidth="8"
          d="m195 322 190-65M195 170v150M405 170v150"
        />
      </g>
      <path stroke="#c2d9cc" strokeWidth="9" d="m115 225 315-110" />
      <g fill="#d1ee7b" stroke="#9dbf4c" strokeWidth="3">
        <path d="m125 198 22-8v57l-22 8zM150 186l24-8v64l-24 8zM383 108l24-8v64l-24 8zM410 102l22-8v57l-22 8z" />
      </g>
      <path fill="#d1ee7b" d="m212 309 112-39 74 28-112 39z" />
      <path stroke="#66877a" strokeWidth="10" d="M237 325v39m125-57v43" />
      <circle
        cx="488"
        cy="337"
        r="28"
        fill="#293e34"
        stroke="#9dbf4c"
        strokeWidth="7"
      />
      <circle
        cx="105"
        cy="363"
        r="23"
        fill="#293e34"
        stroke="#9dbf4c"
        strokeWidth="7"
      />
      <path d="m463 377 64-22" stroke="#b6ccb9" strokeWidth="8" />
    </svg>
  );
}
