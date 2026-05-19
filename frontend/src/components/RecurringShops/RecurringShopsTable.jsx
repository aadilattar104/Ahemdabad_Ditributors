import { useState } from "react";

export default function RecurringShopsTable({ rows = [], loading = false }) {
  const [search, setSearch] = useState("");
  const inr = (n) => Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const fmtDate = (d) => {
    if (!d) return "—";
    const dt = new Date(d);
    return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  };

  const filteredRows = rows.filter((r) =>
    r.shop_name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: "0.5px solid var(--color-border-tertiary)", background: "var(--color-background-secondary)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <p style={{ margin: 0, fontWeight: 500, fontSize: 14 }}>Recurring shops</p>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--color-text-secondary)" }}>
            Shops that placed orders on multiple dates in the selected period
          </p>
        </div>
        <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
          {new Set(filteredRows.map(r => r.shop_name?.toUpperCase())).size} shops
        </span>
      </div>

      <div style={{ padding: "10px 16px", borderBottom: "0.5px solid var(--color-border-tertiary)", background: "var(--color-background-secondary)" }}>
        <div style={{ position: "relative" }}>
          <i className="ti ti-search" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: "var(--color-text-tertiary)", pointerEvents: "none" }} aria-hidden />
          <input
            type="text"
            placeholder="Search shops…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "100%", paddingLeft: 34, boxSizing: "border-box" }}
          />
        </div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "var(--color-background-secondary)" }}>
            {["Shop name", "Distributor", "SKU", "Bill date", "Bill no", "Qty", "Revenue (₹)"].map((h, i) => (
              <th key={h} style={{
                padding: "10px 14px",
                textAlign: i >= 5 ? "right" : "left",
                fontWeight: 500,
                borderBottom: "0.5px solid var(--color-border-tertiary)",
                whiteSpace: "nowrap",
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} style={{ padding: "10px 14px" }}>
                      <div style={{ height: 13, width: "70%", background: "var(--color-border-tertiary)", borderRadius: 4 }} />
                    </td>
                  ))}
                </tr>
              ))
            : filteredRows.length === 0
            ? <tr><td colSpan={7} style={{ padding: "2rem", textAlign: "center", color: "var(--color-text-tertiary)" }}>No recurring shops found for this period</td></tr>
            : filteredRows.map((r, i) => {
                const isNewShop = i === 0 || filteredRows[i - 1].shop_name?.toUpperCase() !== r.shop_name?.toUpperCase();
                return (
                  <tr key={i} style={{
                    borderBottom: i < filteredRows.length - 1 ? "0.5px solid var(--color-border-tertiary)" : "none",
                    background: isNewShop && i !== 0 ? "var(--color-background-secondary)" : "transparent",
                  }}>
                    <td style={{ padding: "10px 14px", fontWeight: isNewShop ? 500 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>
                      {isNewShop ? r.shop_name : ""}
                    </td>
                    <td style={{ padding: "10px 14px", color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>{isNewShop ? r.distributor_name : ""}</td>
                    <td style={{ padding: "10px 14px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>{r.sku_name}</td>
                    <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>{fmtDate(r.bill_date)}</td>
                    <td style={{ padding: "10px 14px", color: "var(--color-text-secondary)" }}>{r.bill_no || "—"}</td>
                    <td style={{ padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.qty?.toLocaleString()}</td>
                    <td style={{ padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{inr(r.revenue)}</td>
                  </tr>
                );
              })}
        </tbody>
      </table>
    </div>
  );
}