// ProjectionTable — SKU-level actual vs projected table.
// Shows last 3 months actuals + projected next 2 months per SKU.
// Matches ShopTable visual style.
//
// Props:
//   data    — projection response from /analytics/projection
//   loading — boolean

import { Fragment } from "react";

function fmtRev(n) {
  if (!n && n !== 0) return "—";
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000)   return `₹${(n / 1000).toFixed(1)}k`;
  return `₹${n}`;
}

function ProjectedBadge({ value }) {
  return (
    <span style={{
      fontSize: 11, padding: "1px 7px",
      background: "var(--color-background-info, rgba(55,138,221,0.1))",
      color: "var(--color-text-info, #378ADD)",
      borderRadius: "var(--border-radius-md)",
      fontWeight: 500,
    }}>
      {value}
    </span>
  );
}

export default function ProjectionTable({ data, loading = false }) {
  const rows = data?.by_sku || [];

  // Column labels come from first row (all rows share same labels)
  const first = rows[0] || {};
  const m2Label        = first.m2_label        || "M-2";
  const m1Label        = first.m1_label        || "M-1";
  const m0Label        = first.m0_label        || "Current";
  const projNextLabel  = first.proj_next_label  || "Proj Next";
  const projAfterLabel = first.proj_after_label || "Proj After";

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <p style={{ margin: 0, fontWeight: 600, fontSize: 16 }}>SKU-level Projection</p>
      </div>

      <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 860 }}>
          <thead>
            <tr style={{ background: "var(--color-background-secondary)" }}>
              {/* SKU */}
              <th style={thStyle("left", "22%")}>SKU</th>

              {/* M-2 */}
              <th colSpan={2} style={{
                ...thStyle("center", "13%", true),
                ...(m2Label === "—" ? { color: "var(--color-text-tertiary)", fontStyle: "italic" } : {}),
              }}>{m2Label === "—" ? "— (Actual)" : `${m2Label} (Actual)`}</th>

              {/* M-1 */}
              <th colSpan={2} style={thStyle("center", "13%", true)}>{m1Label} (Actual)</th>

              {/* M0 current */}
              <th colSpan={2} style={thStyle("center", "14%", true)}>{m0Label} (Actual)</th>

              {/* Proj next */}
              <th colSpan={2} style={{ ...thStyle("center", "14%", true), color: "var(--color-text-info, #378ADD)" }}>
                {projNextLabel} (Proj)
              </th>

              {/* Proj after */}
              <th colSpan={2} style={{ ...thStyle("center", "14%", true), color: "var(--color-text-info, #378ADD)" }}>
                {projAfterLabel} (Proj)
              </th>
            </tr>

            {/* Sub-header: Rev / Qty */}
            <tr style={{ background: "var(--color-background-secondary)", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
              <th style={subThStyle("left")} />
              {["m2","m1","m0","proj_next","proj_after"].map((k) => (
                <Fragment key={k}>
                  <th style={subThStyle("right")}>Rev</th>
                  <th style={subThStyle("right")}>Qty</th>
                </Fragment>
              ))}
            </tr>
          </thead>

          <tbody>
            {loading
              ? Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 11 }).map((_, j) => (
                      <td key={j} style={{ padding: "10px 14px" }}>
                        <div style={{ height: 13, width: "70%", background: "var(--color-border-tertiary)", borderRadius: 4, marginLeft: j > 0 ? "auto" : 0 }} />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.length === 0
              ? <tr><td colSpan={11} style={{ padding: "2rem", textAlign: "center", color: "var(--color-text-tertiary)" }}>No data</td></tr>
              : rows.map((row, i) => (
                  <tr key={i} style={{ borderBottom: i < rows.length - 1 ? "0.5px solid var(--color-border-tertiary)" : "none" }}>
                    <td style={{ padding: "10px 14px", fontWeight: 500, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.sku_name}>
                      {row.sku_name}
                    </td>

                    {/* M-2 actual */}
                    <td style={tdNum}>{fmtRev(row.m2_revenue)}</td>
                    <td style={tdNum}>{row.m2_qty?.toLocaleString()}</td>

                    {/* M-1 actual */}
                    <td style={tdNum}>{fmtRev(row.m1_revenue)}</td>
                    <td style={tdNum}>{row.m1_qty?.toLocaleString()}</td>

                    {/* M0 actual */}
                    <td style={tdNum}>{fmtRev(row.m0_revenue)}</td>
                    <td style={tdNum}>{row.m0_qty?.toLocaleString()}</td>

                    {/* Proj next */}
                    <td style={tdNum}><ProjectedBadge value={fmtRev(row.proj_next_revenue)} /></td>
                    <td style={tdNum}><ProjectedBadge value={row.proj_next_qty?.toLocaleString()} /></td>

                    {/* Proj after */}
                    <td style={tdNum}><ProjectedBadge value={fmtRev(row.proj_after_revenue)} /></td>
                    <td style={tdNum}><ProjectedBadge value={row.proj_after_qty?.toLocaleString()} /></td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const thStyle = (align, width, noBorderRight = false) => ({
  padding: "10px 14px",
  textAlign: align,
  fontWeight: 500,
  borderBottom: "0.5px solid var(--color-border-tertiary)",
  whiteSpace: "nowrap",
  width,
});

const subThStyle = (align) => ({
  padding: "6px 14px",
  textAlign: align,
  fontWeight: 400,
  fontSize: 11,
  color: "var(--color-text-secondary)",
  borderBottom: "0.5px solid var(--color-border-tertiary)",
  whiteSpace: "nowrap",
});

const tdNum = {
  padding: "10px 14px",
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};