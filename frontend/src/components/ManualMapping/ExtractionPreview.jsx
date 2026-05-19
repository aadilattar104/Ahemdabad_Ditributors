// ExtractionPreview shows the first N rows after applying the user's column mapping,
// so they can verify the extraction looks correct before confirming.
//
// Props:
//   mapping     — { shop_name, qty, revenue }
//   previewRows — array of raw row objects from the file
//   columns     — string[] of all column names

export default function ExtractionPreview({ mapping, previewRows, columns }) {
  const { shop_name, qty, revenue } = mapping;

  const extracted = previewRows
    .filter((row) => row[shop_name] && row[qty] !== undefined && row[revenue] !== undefined)
    .slice(0, 10)
    .map((row) => ({
      shop_name: String(row[shop_name] || "").trim(),
      qty: Number(row[qty]) || 0,
      revenue: parseFloat(Number(row[revenue]).toFixed(2)),
    }));

  if (extracted.length === 0) {
    return (
      <div style={{
        background: "var(--color-background-warning)",
        border: "0.5px solid var(--color-border-warning)",
        borderRadius: "var(--border-radius-md)",
        padding: "1rem",
        fontSize: 13,
        color: "var(--color-text-warning)",
      }}>
        <i className="ti ti-alert-triangle" style={{ fontSize: 14, marginRight: 6 }} aria-hidden />
        No rows matched with the current mapping. Go back and check your column selections.
      </div>
    );
  }

  return (
    <div>
      <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--color-text-secondary)" }}>
        Showing first {extracted.length} matched rows. Verify the data looks correct before confirming.
      </p>

      <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-md)", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--color-background-secondary)" }}>
              {["Shop name", "Qty", "Revenue (₹)"].map((h) => (
                <th key={h} style={{ padding: "8px 12px", textAlign: h === "Shop name" ? "left" : "right", fontWeight: 500, borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {extracted.map((row, i) => (
              <tr key={i} style={{ borderBottom: i < extracted.length - 1 ? "0.5px solid var(--color-border-tertiary)" : "none" }}>
                <td style={{ padding: "8px 12px" }}>{row.shop_name || <span style={{ color: "var(--color-text-tertiary)" }}>—</span>}</td>
                <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{row.qty.toLocaleString()}</td>
                <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {row.revenue.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}