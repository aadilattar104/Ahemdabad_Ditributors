import { useState } from "react";

// ShopTable shows shop-level revenue and qty, with search and sort.
// Props:
//   rows    — [{ shop_name, distributor_name, qty, revenue, shop_type }]
//   loading — boolean

export default function ShopTable({ rows = [], loading = false }) {
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState("revenue");
  const [sortDir, setSortDir] = useState("desc");

  const inr = (n) =>
    Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortCol(col); setSortDir("desc"); }
  };

  const filtered = rows
    .filter((r) => r.shop_name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => sortDir === "desc" ? b[sortCol] - a[sortCol] : a[sortCol] - b[sortCol]);

  const SortIcon = ({ col }) => (
    <i
      className={`ti ti-chevron-${sortCol === col ? (sortDir === "desc" ? "down" : "up") : "selector"}`}
      style={{ fontSize: 13, marginLeft: 3, opacity: sortCol === col ? 1 : 0.3 }}
      aria-hidden
    />
  );

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1 }}>
          <i className="ti ti-search" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: "var(--color-text-tertiary)", pointerEvents: "none" }} aria-hidden />
          <input
            type="text"
            placeholder="Search shops…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "100%", paddingLeft: 34, boxSizing: "border-box" }}
          />
        </div>
        <span style={{ fontSize: 13, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
          {filtered.length} shops
        </span>
      </div>

      <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: 13 }}>
          <colgroup>
            <col style={{ width: "30%" }} />
            <col style={{ width: "18%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "6%" }} />
          </colgroup>
          <thead>
            <tr style={{ background: "var(--color-background-secondary)" }}>
              <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 500, borderBottom: "0.5px solid var(--color-border-tertiary)" }}>Shop name</th>
              <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 500, borderBottom: "0.5px solid var(--color-border-tertiary)" }}>Distributor</th>
              <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 500, borderBottom: "0.5px solid var(--color-border-tertiary)" }}>Month</th>
              <th onClick={() => toggleSort("invoice_count")} style={{ padding: "10px 14px", textAlign: "right", fontWeight: 500, cursor: "pointer", borderBottom: "0.5px solid var(--color-border-tertiary)", userSelect: "none" }}>
                Invoices <SortIcon col="invoice_count" />
              </th>
              <th onClick={() => toggleSort("qty")} style={{ padding: "10px 14px", textAlign: "right", fontWeight: 500, cursor: "pointer", borderBottom: "0.5px solid var(--color-border-tertiary)", userSelect: "none" }}>
                Qty <SortIcon col="qty" />
              </th>
              <th onClick={() => toggleSort("revenue")} style={{ padding: "10px 14px", textAlign: "right", fontWeight: 500, cursor: "pointer", borderBottom: "0.5px solid var(--color-border-tertiary)", userSelect: "none" }}>
                Revenue (₹) <SortIcon col="revenue" />
              </th>
              <th style={{ padding: "10px 14px", textAlign: "center", fontWeight: 500, borderBottom: "0.5px solid var(--color-border-tertiary)" }}>Type</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} style={{ padding: "10px 14px" }}>
                        <div style={{ height: 13, width: j === 6 ? "50%" : "70%", background: "var(--color-border-tertiary)", borderRadius: 4, marginLeft: j > 2 ? "auto" : 0 }} />
                      </td>
                    ))}
                  </tr>
                ))
              : filtered.length === 0
              ? <tr><td colSpan={7} style={{ padding: "2rem", textAlign: "center", color: "var(--color-text-tertiary)" }}>No shops match your search</td></tr>
              : filtered.map((row, i) => (
                  <tr key={i} style={{ borderBottom: i < filtered.length - 1 ? "0.5px solid var(--color-border-tertiary)" : "none" }}>
                    <td style={{ padding: "10px 14px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.shop_name}>{row.shop_name}</td>
                    <td style={{ padding: "10px 14px", color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.distributor_name}</td>
                    <td style={{ padding: "10px 14px", color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>{row.month || "—"}</td>
                    <td style={{ padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{row.invoice_count ?? "—"}</td>
                    <td style={{ padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{row.qty?.toLocaleString()}</td>
                    <td style={{ padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{inr(row.revenue)}</td>
                    <td style={{ padding: "10px 14px", textAlign: "center" }}>
                      {row.shop_type === "CASH_SALE" && (
                        <span style={{ fontSize: 11, padding: "2px 8px", background: "var(--color-background-warning)", color: "var(--color-text-warning)", borderRadius: "var(--border-radius-md)", fontWeight: 500 }}>
                          Cash
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}