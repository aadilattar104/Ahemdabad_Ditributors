// DistributorTable shows each distributor's total revenue, qty, and shop count.
// Props:
//   rows    — [{ distributor_name, revenue, qty, shop_count }]
//   loading — boolean

export default function DistributorTable({ rows = [], loading = false }) {
  const inr = (n) =>
    Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: "0.5px solid var(--color-border-tertiary)", background: "var(--color-background-secondary)" }}>
        <p style={{ margin: 0, fontWeight: 500, fontSize: 14 }}>By distributor</p>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "var(--color-background-secondary)" }}>
            {["Distributor", "Shops", "Qty", "Revenue (₹)"].map((h, i) => (
              <th key={h} style={{ padding: "10px 16px", textAlign: i === 0 ? "left" : "right", fontWeight: 500, borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 3 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 4 }).map((_, j) => (
                    <td key={j} style={{ padding: "10px 16px" }}>
                      <div style={{ height: 14, width: j === 0 ? "70%" : "50%", background: "var(--color-border-tertiary)", borderRadius: 4, marginLeft: j > 0 ? "auto" : 0 }} />
                    </td>
                  ))}
                </tr>
              ))
            : rows.length === 0
            ? <tr><td colSpan={4} style={{ padding: "2rem", textAlign: "center", color: "var(--color-text-tertiary)" }}>No data</td></tr>
            : rows.map((row, i) => (
                <tr key={row.distributor_name} style={{ borderBottom: i < rows.length - 1 ? "0.5px solid var(--color-border-tertiary)" : "none" }}>
                  <td style={{ padding: "10px 16px", fontWeight: 500 }}>{row.distributor_name}</td>
                  <td style={{ padding: "10px 16px", textAlign: "right" }}>{row.shop_count?.toLocaleString() ?? "—"}</td>
                  <td style={{ padding: "10px 16px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{row.qty?.toLocaleString() ?? "—"}</td>
                  <td style={{ padding: "10px 16px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{inr(row.revenue)}</td>
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}