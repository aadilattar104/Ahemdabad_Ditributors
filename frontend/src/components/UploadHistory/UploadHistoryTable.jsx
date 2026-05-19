// UploadHistoryTable shows a log of all past file uploads.
// Props:
//   rows    — [{ id, filename, distributor_name, month, year, status, shop_count, record_count, uploaded_at }]
//   loading — boolean
//   onView  — (uploadId) => void

const STATUS_STYLES = {
  success: { background: "var(--color-background-success)", color: "var(--color-text-success)" },
  error:   { background: "var(--color-background-danger)",  color: "var(--color-text-danger)" },
  pending: { background: "var(--color-background-warning)", color: "var(--color-text-warning)" },
};

function StatusBadge({ status }) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.pending;
  return (
    <span style={{ fontSize: 11, padding: "2px 9px", borderRadius: "var(--border-radius-md)", fontWeight: 500, ...style }}>
      {status}
    </span>
  );
}

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function UploadHistoryTable({ rows = [], loading = false, onView }) {
  return (
    <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "var(--color-background-secondary)" }}>
            {["File", "Distributor", "Period", "Records", "Status", "Uploaded", ""].map((h, i) => (
              <th key={i} style={{ padding: "10px 14px", textAlign: i >= 3 ? "center" : "left", fontWeight: 500, borderBottom: "0.5px solid var(--color-border-tertiary)", whiteSpace: "nowrap" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} style={{ padding: "10px 14px" }}>
                      <div style={{ height: 13, width: "60%", background: "var(--color-border-tertiary)", borderRadius: 4 }} />
                    </td>
                  ))}
                </tr>
              ))
            : rows.length === 0
            ? <tr><td colSpan={7} style={{ padding: "2rem", textAlign: "center", color: "var(--color-text-tertiary)" }}>No uploads yet</td></tr>
            : rows.map((row, i) => (
                <tr key={row.id} style={{ borderBottom: i < rows.length - 1 ? "0.5px solid var(--color-border-tertiary)" : "none" }}>
                  <td style={{ padding: "10px 14px", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.filename}>
                    <i className="ti ti-file-spreadsheet" style={{ fontSize: 13, marginRight: 6, color: "var(--color-text-secondary)" }} aria-hidden />
                    {row.filename}
                  </td>
                  <td style={{ padding: "10px 14px", fontWeight: 500 }}>{row.distributor_name || "—"}</td>
                  <td style={{ padding: "10px 14px", color: "var(--color-text-secondary)" }}>
                    {row.month && row.year ? `${row.month} ${row.year}` : "—"}
                  </td>
                  <td style={{ padding: "10px 14px", textAlign: "center" }}>{row.record_count ?? "—"}</td>
                  <td style={{ padding: "10px 14px", textAlign: "center" }}><StatusBadge status={row.status} /></td>
                  <td style={{ padding: "10px 14px", textAlign: "center", color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>{fmtDate(row.uploaded_at)}</td>
                  <td style={{ padding: "10px 14px", textAlign: "center" }}>
                    {onView && (
                      <button onClick={() => onView(row.id)} style={{ fontSize: 12, padding: "4px 10px" }}>
                        View
                      </button>
                    )}
                  </td>
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}