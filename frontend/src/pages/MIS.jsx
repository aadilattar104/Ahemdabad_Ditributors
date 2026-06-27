// MIS.jsx — Primary Sales MIS
// Table 1: Segment × Month pivot (8 fixed segment rows)
// Table 2: Customer × Month pivot (paginated)
// Style matches ShopActivityMatrix.jsx

import { useState, useEffect, useCallback, useRef } from "react";

const BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:8000";

// ── Indian number formatter ────────────────────────────────────────────────────
function fmt(n) {
  if (!n && n !== 0) return "—";
  if (n === 0)       return "—";
  if (n >= 100000)   return "₹" + (n / 100000).toFixed(1) + "L";
  if (n >= 1000)     return "₹" + (n / 1000).toFixed(1) + "k";
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

function fmtFull(n) {
  if (!n && n !== 0) return "—";
  if (n === 0)       return "—";
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

// ── Segment row accent colours ─────────────────────────────────────────────────
const SEG_COLORS = {
  "Sampling":       "#8B5CF6",
  "D2C":            "#378ADD",
  "Amazon":         "#F59E0B",
  "Quickcommerce":  "#EF4444",
  "Retail-MT":      "#1D9E75",
  "Retail-GT":      "#06B6D4",
  "Institutional":  "#F97316",
  "Gifting":        "#EC4899",
};

// ── Retail-GT POS sub-filter buttons ───────────────────────────────────────────
const GT_POS_BUTTONS = ["All", "Mumbai GT", "Non Mumbai GT", "Ahmedabad GT"];

// Namkeen grammage groups — exact grm column values from mis_transactions
const GRAMMAGE_GRM_VALUES = {
  "72":      ["72 gms"],
  "200_185": ["200 gms", "185 gms", "220 gms", "190 gms", "210 gms", "210g"],
};

// Return grm values for the selected grammage key
function gramGrmValues(grammage) {
  if (!grammage) return [];
  return GRAMMAGE_GRM_VALUES[grammage] || [];
}

// Merge two segment-table API responses into one
function mergeSegmentData(responses) {
  const monthSet = new Set();
  responses.forEach(d => (d.months || []).forEach(m => monthSet.add(m)));
  const allMonths = Array.from(monthSet).sort();
  const segMap = {};
  responses.forEach(d => {
    (d.rows || []).forEach(row => {
      if (!segMap[row.segment]) segMap[row.segment] = { segment: row.segment, cells: {}, total_revenue: 0, total_qty: 0 };
      Object.entries(row.cells || {}).forEach(([m, c]) => {
        if (!segMap[row.segment].cells[m]) segMap[row.segment].cells[m] = { revenue: 0, qty: 0, orders: 0 };
        segMap[row.segment].cells[m].revenue += c.revenue || 0;
        segMap[row.segment].cells[m].qty     += c.qty     || 0;
      });
      segMap[row.segment].total_revenue += row.total_revenue || 0;
      segMap[row.segment].total_qty     += row.total_qty     || 0;
    });
  });
  const grandRev = Object.values(segMap).reduce((s, r) => s + r.total_revenue, 0);
  return { months: allMonths, rows: Object.values(segMap), grand_total_revenue: grandRev };
}

// Merge two customer-table API responses into one
function mergeCustomerData(responses) {
  const monthSet = new Set();
  responses.forEach(d => (d.months || []).forEach(m => monthSet.add(m)));
  const allMonths = Array.from(monthSet).sort();
  const custMap = {};
  responses.forEach(d => {
    (d.rows || []).forEach(row => {
      const k = row.customer_name;
      if (!custMap[k]) custMap[k] = { customer_name: k, segment: row.segment, cells: {}, total_revenue: 0, total_qty: 0 };
      Object.entries(row.cells || {}).forEach(([m, c]) => {
        if (!custMap[k].cells[m]) custMap[k].cells[m] = { revenue: 0, qty: 0 };
        custMap[k].cells[m].revenue += c.revenue || 0;
        custMap[k].cells[m].qty     += c.qty     || 0;
      });
      custMap[k].total_revenue += row.total_revenue || 0;
      custMap[k].total_qty     += row.total_qty     || 0;
    });
  });
  const mergedRows = Object.values(custMap).sort((a, b) => b.total_revenue - a.total_revenue);
  // Rebuild grand totals
  const grandRev = mergedRows.reduce((s, r) => s + r.total_revenue, 0);
  const grandQty = mergedRows.reduce((s, r) => s + r.total_qty, 0);
  const grandByMonth = {};
  allMonths.forEach(m => {
    grandByMonth[m] = {
      revenue: mergedRows.reduce((s, r) => s + (r.cells[m]?.revenue || 0), 0),
      qty:     mergedRows.reduce((s, r) => s + (r.cells[m]?.qty     || 0), 0),
    };
  });
  const base = responses[0] || {};
  return {
    months: allMonths, rows: mergedRows,
    total_count: mergedRows.length, shop_count: mergedRows.length,
    page: 1, page_size: mergedRows.length, total_pages: 1,
    grand_total_revenue: grandRev, grand_total_qty: grandQty, grand_total_by_month: grandByMonth,
  };
}


// ── MultiSelect dropdown — same style as FilterBar.jsx ────────────────────────
function MultiSelect({ label, header, options, selected = [], onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const toggle = (val) => {
    const next = selected.includes(val)
      ? selected.filter(v => v !== val)
      : [...selected, val];
    onChange(next);
  };

  const isActive = selected.length > 0;

  return (
    <div style={S.filterGroup}>
      <label style={S.filterLabel}>{header || label}</label>
      <div ref={ref} style={{ position: "relative" }}>
        <button
          onClick={() => setOpen(o => !o)}
          style={{
            fontSize: 13, padding: "5px 10px",
            borderRadius: "var(--border-radius-md)",
            border: isActive
              ? "0.5px solid var(--color-text-info, #378ADD)"
              : "0.5px solid var(--color-border-secondary)",
            background: isActive
              ? "rgba(55,138,221,0.07)"
              : "var(--color-background-primary)",
            color: isActive
              ? "var(--color-text-info, #378ADD)"
              : "var(--color-text-secondary)",
            cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
            whiteSpace: "nowrap", minWidth: 130,
          }}
        >
          {isActive ? `${label}: ${selected.length}` : `All ${label}`}
          <i className="ti ti-chevron-down" style={{ fontSize: 11 }} aria-hidden />
        </button>

        {open && (
          <div style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 200,
            background: "var(--color-background-primary)",
            border: "0.5px solid var(--color-border-secondary)",
            borderRadius: "var(--border-radius-md)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.10)",
            minWidth: 180, maxHeight: 260, overflowY: "auto",
            padding: "4px 0",
          }}>
            {options.map(opt => {
              const sel = selected.includes(opt);
              return (
                <div
                  key={opt}
                  onClick={() => toggle(opt)}
                  style={{
                    padding: "7px 12px", fontSize: 13, cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 8,
                    background: sel ? "rgba(55,138,221,0.06)" : "transparent",
                    color: sel ? "var(--color-text-info, #378ADD)" : "var(--color-text-primary)",
                  }}
                >
                  <span style={{
                    width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                    border: sel
                      ? "1.5px solid var(--color-text-info, #378ADD)"
                      : "1.5px solid var(--color-border-secondary)",
                    background: sel ? "var(--color-text-info, #378ADD)" : "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {sel && <i className="ti ti-check" style={{ fontSize: 9, color: "#fff" }} />}
                  </span>
                  {opt}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Single-select ──────────────────────────────────────────────────────────────
function FilterSelect({ label, value, onChange, options, placeholder = "All" }) {
  return (
    <div style={S.filterGroup}>
      <label style={S.filterLabel}>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} style={S.select}>
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

// ── Skeleton row ───────────────────────────────────────────────────────────────
function SkeletonRow({ cols }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} style={{ padding: "10px 12px" }}>
          <div style={{ height: 13, width: i === 0 ? "70%" : "55%", background: "var(--color-border-tertiary)", borderRadius: 4 }} />
        </td>
      ))}
    </tr>
  );
}

// ── Table 1: Segment × Month ───────────────────────────────────────────────────
function SegmentTable({ financialYear, filters, allSkus }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");
  const [selSeg,  setSelSeg]  = useState("");  // highlight filter

  const load = useCallback(() => {
    setLoading(true); setError("");

    const baseParams = () => {
      const p = new URLSearchParams();
      if (financialYear)            p.set("financial_year", financialYear);
      (filters.months || (filters.month ? [filters.month] : [])).forEach(m => p.append("month", m));
      (filters.segmentCategories || (filters.segmentCategory ? [filters.segmentCategory] : [])).forEach(s => p.append("segment_category", s));
      (filters.categories || (filters.category ? [filters.category] : [])).forEach(c => p.append("category", c));
      return p;
    };

    const p = baseParams();
    if (filters.sku) p.set("sku", filters.sku);
    const grmVals = filters.grammage ? gramGrmValues(filters.grammage) : [];
    grmVals.forEach(g => p.append("grm_filter", g));
    fetch(`${BASE_URL}/mis/segment-table?${p}`)
      .then(r => r.json())
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [financialYear, JSON.stringify(filters.months), JSON.stringify(filters.segmentCategories), JSON.stringify(filters.categories), filters.sku, filters.grammage, allSkus]);

  useEffect(() => { load(); }, [load]);

  const exportUrl = () => {
    const p = new URLSearchParams({ table: "segment" });
    if (financialYear) p.set("financial_year", financialYear);
    (filters.months || (filters.month ? [filters.month] : [])).forEach(m => p.append("month", m));
    (filters.segmentCategories || (filters.segmentCategory ? [filters.segmentCategory] : [])).forEach(s => p.append("segment_category", s));
    (filters.categories || (filters.category ? [filters.category] : [])).forEach(c => p.append("category", c));
    if (filters.sku) p.set("sku", filters.sku);
    // Pass grm_filter so the exported Excel matches the grammage-filtered dashboard
    const grmVals = filters.grammage ? gramGrmValues(filters.grammage) : [];
    grmVals.forEach(g => p.append("grm_filter", g));
    return `${BASE_URL}/mis/export/excel?${p}`;
  };

  const months = data?.months || [];
  const rows   = data?.rows   || [];
  const cols   = months.length + 2; // segment + months + total

  return (
    <div style={S.card}>
      {/* Header */}
      <div style={S.cardHeader}>
        <div>
          <p style={S.cardTitle}>Segment Revenue</p>
          <p style={S.cardSubtitle}>Revenue by segment across months</p>
        </div>
        <a href={exportUrl()} download style={{ textDecoration: "none" }}>
          <button style={S.exportBtn}>
            <i className="ti ti-download" style={{ fontSize: 13 }} /> Export Excel
          </button>
        </a>
      </div>

      {error && <p style={S.errorText}>{error}</p>}

      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={{ ...S.th, ...S.stickyCol, minWidth: 160, textAlign: "left" }}>Segment</th>
              {months.map(m => (
                <th key={m} style={{ ...S.th, minWidth: 110 }}>{m}</th>
              ))}
              <th style={{ ...S.th, minWidth: 120, background: "var(--color-background-secondary)" }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} cols={cols} />)
              : rows.length === 0
              ? <tr><td colSpan={cols} style={S.emptyCell}>No data for selected filters</td></tr>
              : rows.map((row, ri) => {
                  const accent  = SEG_COLORS[row.segment] || "var(--color-text-secondary)";
                  const isHigh  = selSeg === row.segment;
                  return (
                    <tr
                      key={row.segment}
                      style={{
                        background: isHigh ? "rgba(55,138,221,0.05)" : ri % 2 === 0 ? "transparent" : "var(--color-background-secondary)",
                        cursor: "pointer",
                      }}
                      onClick={() => setSelSeg(selSeg === row.segment ? "" : row.segment)}
                    >
                      <td style={{ ...S.td, ...S.stickyCol, fontWeight: 500 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ width: 3, height: 16, borderRadius: 2, background: accent, display: "inline-block", flexShrink: 0 }} />
                          {row.segment}
                        </div>
                      </td>
                      {months.map(m => {
                        const rev = row.cells[m]?.revenue || 0;
                        const qty = row.cells[m]?.qty || 0;
                        return (
                          <td key={m} style={{ ...S.td, textAlign: "right", color: rev > 0 ? "var(--color-text-primary)" : "var(--color-text-tertiary)" }}>
                            {rev > 0 ? <><div>{fmt(rev)}</div><div style={{ fontSize: 11, color: "var(--color-text-tertiary)", fontWeight: 400 }}>{qty.toLocaleString("en-IN")} qty</div></> : "—"}
                          </td>
                        );
                      })}
                      <td style={{ ...S.td, textAlign: "right", fontWeight: 600, background: "var(--color-background-secondary)" }}>
                        <div>{fmt(row.total_revenue)}</div>
                        <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", fontWeight: 400 }}>{(row.total_qty||0).toLocaleString("en-IN")} qty</div>
                      </td>
                    </tr>
                  );
                })}

            {/* Grand total row */}
            {!loading && data && (
              <tr style={{ borderTop: "2px solid var(--color-border-secondary)" }}>
                <td style={{ ...S.td, ...S.stickyCol, fontWeight: 700, fontSize: 13 }}>Grand Total</td>
                {months.map(m => {
                  const colTotal = rows.reduce((s, r) => s + (r.cells[m]?.revenue || 0), 0);
                  const qtyTotal = rows.reduce((s, r) => s + (r.cells[m]?.qty || 0), 0);
                  return (
                    <td key={m} style={{ ...S.td, textAlign: "right", fontWeight: 600 }}>
                      {colTotal > 0 ? <><div>{fmt(colTotal)}</div><div style={{ fontSize: 11, color: "var(--color-text-tertiary)", fontWeight: 400 }}>{qtyTotal.toLocaleString("en-IN")} qty</div></> : "—"}
                    </td>
                  );
                })}
                <td style={{ ...S.td, textAlign: "right", fontWeight: 700, background: "var(--color-background-secondary)", fontSize: 13 }}>
                  <div>{fmt(data.grand_total_revenue)}</div>
                  <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", fontWeight: 400 }}>
                    {(data.grand_total_qty ?? rows.reduce((s,r)=>s+(r.total_qty||0),0)).toLocaleString("en-IN")} qty
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Table 2: Customer × Month ──────────────────────────────────────────────────
function CustomerTable({ financialYear, filters, pos, onPosChange, allSkus }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");
  const [search,  setSearch]  = useState("");
  const [page,    setPage]    = useState(1);
  const searchRef = useRef();

  const load = useCallback((pg = 1, q = search) => {
    setLoading(true); setError("");

    const baseParams = (pg2 = 1) => {
      const p = new URLSearchParams({ page: pg2, page_size: 1000 });
      if (financialYear) p.set("financial_year", financialYear);
      // Multi-select: send repeated params for arrays
      (filters.months || []).forEach(m => p.append("month", m));
      (filters.segmentCategories || []).forEach(s => p.append("segment_category", s));
      (filters.categories || []).forEach(c => p.append("category", c));
      if (q)                        p.set("customer_search", q);
      if (pos && pos !== "All")     p.set("pos", pos);
      return p;
    };

    const p = baseParams(pg);
    p.set("page_size", 50);
    if (filters.sku) p.set("sku", filters.sku);
    const grmVals = filters.grammage ? gramGrmValues(filters.grammage) : [];
    grmVals.forEach(g => p.append("grm_filter", g));
    fetch(`${BASE_URL}/mis/customer-table?${p}`)
      .then(r => r.json())
      .then(d => { setData(d); setPage(pg); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [financialYear, filters.months, filters.segmentCategories, filters.categories, filters.sku, filters.grammage, allSkus, pos]);

  useEffect(() => { load(1, ""); setSearch(""); }, [load]);

  const exportUrl = () => {
    const p = new URLSearchParams({ table: "customer" });
    if (financialYear)           p.set("financial_year", financialYear);
    if (filters.month)           p.set("month", filters.month);
    if (filters.segmentCategory) p.set("segment_category", filters.segmentCategory);
    if (filters.category)        p.set("category", filters.category);
    if (filters.sku)             p.set("sku", filters.sku);
    if (search)                  p.set("customer_search", search);
    if (pos && pos !== "All")    p.set("pos", pos);
    // Pass grm_filter so the exported Excel matches the grammage-filtered dashboard
    const grmVals = filters.grammage ? gramGrmValues(filters.grammage) : [];
    grmVals.forEach(g => p.append("grm_filter", g));
    return `${BASE_URL}/mis/export/excel?${p}`;
  };

  const isRetailGT = (filters.segmentCategories || []).includes("Retail - GT") || filters.segmentCategory === "Retail - GT";
  const months = data?.months || [];
  const rows   = data?.rows   || [];
  const cols   = months.length + 3; // customer + segment + months + total

  const handleSearch = (e) => {
    const v = e.target.value;
    setSearch(v);
    clearTimeout(searchRef._t);
    searchRef._t = setTimeout(() => load(1, v), 400);
  };

  return (
    <div style={S.card}>
      {/* Header */}
      <div style={S.cardHeader}>
        <div>
          <p style={S.cardTitle}>Customer Revenue</p>
          <p style={S.cardSubtitle}>
            {data ? `${data.total_count} customers` : ""} sorted by total revenue
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* Search */}
          <div style={{ position: "relative" }}>
            <i className="ti ti-search" style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: "var(--color-text-tertiary)", pointerEvents: "none" }} />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search customer…"
              value={search}
              onChange={handleSearch}
              style={{ ...S.select, paddingLeft: 30, minWidth: 180 }}
            />
          </div>
          <a href={exportUrl()} download style={{ textDecoration: "none" }}>
            <button style={S.exportBtn}>
              <i className="ti ti-download" style={{ fontSize: 13 }} /> Export Excel
            </button>
          </a>
        </div>
      </div>

      {/* Retail-GT POS sub-filter buttons + Shops served */}
      {isRetailGT && (
        <div style={S.gtPosBlock}>
          <div style={S.gtPosRow}>
            {GT_POS_BUTTONS.map(p => (
              <button
                key={p}
                onClick={() => onPosChange(p)}
                style={pos === p || (!pos && p === "All") ? S.posBtnActive : S.posBtn}
              >
                {p}
              </button>
            ))}
          </div>
          <p style={S.shopsServed}>
            Shops served: <strong>{loading ? "…" : (data?.shop_count ?? 0)}</strong>
          </p>
        </div>
      )}

      {error && <p style={S.errorText}>{error}</p>}

      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={{ ...S.th, ...S.stickyCol, minWidth: 200, textAlign: "left" }}>Customer</th>
              <th style={{ ...S.th, minWidth: 110, textAlign: "left" }}>Segment</th>
              {months.map(m => (
                <th key={m} style={{ ...S.th, minWidth: 110 }}>{m}</th>
              ))}
              <th style={{ ...S.th, minWidth: 120, background: "var(--color-background-secondary)" }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {/* Grand Total row — pinned at top. Uses API totals (all pages, not just current page) */}
            {!loading && data && rows.length > 0 && (
              <tr style={{ borderBottom: "2px solid var(--color-border-secondary)", background: "var(--color-background-secondary)" }}>
                <td style={{ ...S.td, ...S.stickyCol, fontWeight: 700, fontSize: 13, background: "var(--color-background-secondary)" }}>Grand Total</td>
                <td style={{ ...S.td, background: "var(--color-background-secondary)" }} />
                {months.map(m => {
                  const colTotal = data.grand_total_by_month?.[m]?.revenue ?? rows.reduce((s, r) => s + (r.cells[m]?.revenue || 0), 0);
                  const qtyTotal = data.grand_total_by_month?.[m]?.qty     ?? rows.reduce((s, r) => s + (r.cells[m]?.qty    || 0), 0);
                  return (
                    <td key={m} style={{ ...S.td, textAlign: "right", fontWeight: 600, background: "var(--color-background-secondary)" }}>
                      {colTotal > 0 ? <><div>{fmt(colTotal)}</div><div style={{ fontSize: 11, color: "var(--color-text-tertiary)", fontWeight: 400 }}>{qtyTotal.toLocaleString("en-IN")} qty</div></> : "—"}
                    </td>
                  );
                })}
                <td style={{ ...S.td, textAlign: "right", fontWeight: 700, background: "var(--color-background-secondary)", fontSize: 13 }}>
                  <div>{fmt(data.grand_total_revenue ?? rows.reduce((s,r)=>s+(r.total_revenue||0),0))}</div>
                  <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", fontWeight: 400 }}>
                    {(data.grand_total_qty ?? rows.reduce((s,r)=>s+(r.total_qty||0),0)).toLocaleString("en-IN")} qty
                  </div>
                </td>
              </tr>
            )}
            {loading
              ? Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} cols={cols} />)
              : rows.length === 0
              ? <tr><td colSpan={cols} style={S.emptyCell}>No customers found</td></tr>
              : rows.map((row, ri) => {
                  const accent = SEG_COLORS[row.segment] || "var(--color-text-secondary)";
                  return (
                    <tr key={row.customer_name} style={{ background: ri % 2 === 0 ? "transparent" : "var(--color-background-secondary)" }}>
                      <td style={{ ...S.td, ...S.stickyCol, fontWeight: 500, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.customer_name}>
                        {row.customer_name}
                      </td>
                      <td style={{ ...S.td }}>
                        <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 20, background: `${accent}18`, color: accent, fontWeight: 500, whiteSpace: "nowrap" }}>
                          {row.segment || "—"}
                        </span>
                      </td>
                      {months.map(m => {
                        const rev = row.cells[m]?.revenue || 0;
                        const qty = row.cells[m]?.qty || 0;
                        return (
                          <td key={m} style={{ ...S.td, textAlign: "right", color: rev > 0 ? "var(--color-text-primary)" : "var(--color-text-tertiary)" }}>
                            {rev > 0 ? <><div>{fmt(rev)}</div><div style={{ fontSize: 11, color: "var(--color-text-tertiary)", fontWeight: 400 }}>{qty.toLocaleString("en-IN")} qty</div></> : "—"}
                          </td>
                        );
                      })}
                      <td style={{ ...S.td, textAlign: "right", fontWeight: 600, background: "var(--color-background-secondary)" }}>
                        <div>{fmt(row.total_revenue)}</div>
                        <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", fontWeight: 400 }}>{(row.total_qty||0).toLocaleString("en-IN")} qty</div>
                      </td>
                    </tr>
                  );
                })}

          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data && data.total_pages > 1 && (
        <div style={S.pagination}>
          <button
            style={S.pageBtn}
            disabled={page <= 1}
            onClick={() => load(page - 1)}
          >
            <i className="ti ti-chevron-left" style={{ fontSize: 13 }} />
          </button>
          <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
            Page {page} of {data.total_pages} — {data.total_count} customers
          </span>
          <button
            style={S.pageBtn}
            disabled={page >= data.total_pages}
            onClick={() => load(page + 1)}
          >
            <i className="ti ti-chevron-right" style={{ fontSize: 13 }} />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main MIS page ──────────────────────────────────────────────────────────────
export default function MIS() {
  const [filterOptions,   setFilterOptions]   = useState({ financial_years: [], months: [], segment_categories: [], categories: [], skus: [] });
  const [financialYear,   setFinancialYear]   = useState("");
  const [syncing,         setSyncing]         = useState(false);
  const [syncStatus,      setSyncStatus]      = useState(null);  // last sync info

  // Table 1 own filters — arrays for multi-select
  const [t1Month,   setT1Month]   = useState([]);
  const [t1Seg,     setT1Seg]     = useState([]);
  const [t1Cat,     setT1Cat]     = useState([]);

  // Table 2 own filters — arrays for multi-select
  const [t2Month,   setT2Month]   = useState([]);
  const [t2Seg,     setT2Seg]     = useState([]);
  const [t2Cat,     setT2Cat]     = useState([]);
  const [t2Pos,     setT2Pos]     = useState("");

  // Independent SKU filters per table
  const [t1Sku,     setT1Sku]     = useState("");
  const [t2Sku,     setT2Sku]     = useState("");

  // Namkeen grammage buttons ("72" | "200_185" | "")
  const [t1Grammage, setT1Grammage] = useState("");
  const [t2Grammage, setT2Grammage] = useState("");

  // Reset pos selection whenever Table 2's segment changes away from Retail-GT
  useEffect(() => {
    if (!t2Seg.includes("Retail - GT")) setT2Pos("");
  }, [t2Seg]);

  // Reset grammage when category changes away from Namkeen
  useEffect(() => { if (!t1Cat.includes("Namkeen")) setT1Grammage(""); }, [t1Cat]);
  useEffect(() => { if (!t2Cat.includes("Namkeen")) setT2Grammage(""); }, [t2Cat]);


  const loadSyncStatus = () => {
    fetch(`${BASE_URL}/mis/sync/status`)
      .then(r => r.json())
      .then(setSyncStatus)
      .catch(() => {});
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`${BASE_URL}/mis/sync`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Sync failed");
      // Poll status after a short delay for the views to refresh
      setTimeout(() => { loadSyncStatus(); window.location.reload(); }, 4000);
    } catch (e) {
      alert("Sync failed: " + e.message);
      setSyncing(false);
    }
  };

  // Load filter options on mount
  useEffect(() => {
    loadSyncStatus();
    fetch(`${BASE_URL}/mis/filters`)
      .then(r => r.json())
      .then(d => {
        setFilterOptions(d);
        if (d.financial_years?.length) setFinancialYear(d.financial_years[0]);
      })
      .catch(console.error);
  }, []);

  const t1Filters = { months: t1Month, segmentCategories: t1Seg, categories: t1Cat, sku: t1Sku, grammage: t1Grammage };
  const t2Filters = { months: t2Month, segmentCategories: t2Seg, categories: t2Cat, sku: t2Sku, grammage: t2Grammage };

  return (
    <div style={{ padding: "2rem 2.5rem" }}>

      {/* Page header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "1.5rem", flexWrap: "wrap", gap: 12 }}>
        <div>
          <p style={{ margin: 0, fontWeight: 600, fontSize: 24, color: "var(--color-text-primary)" }}>
            Primary Sales MIS
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "var(--color-text-secondary)" }}>
            Revenue by segment and customer — synced from Google Sheets
          </p>
          {syncStatus && syncStatus.status !== "never_synced" && (
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--color-text-tertiary)", display: "flex", alignItems: "center", gap: 5 }}>
              <i className={`ti ti-${syncStatus.status === "success" ? "circle-check" : syncStatus.status === "error" ? "circle-x" : "loader"}`}
                style={{ fontSize: 12, color: syncStatus.status === "success" ? "var(--color-text-success)" : syncStatus.status === "error" ? "var(--color-text-danger)" : "var(--color-text-tertiary)" }} />
              Last sync: {syncStatus.completed_at ? new Date(syncStatus.completed_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "running…"}
              {syncStatus.status === "success" && ` · ${syncStatus.rows_inserted} rows inserted`}
              {syncStatus.status === "error" && ` · ${syncStatus.error_message}`}
            </p>
          )}
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "8px 16px", fontSize: 13, cursor: syncing ? "not-allowed" : "pointer",
            borderRadius: "var(--border-radius-md)",
            border: "0.5px solid var(--color-border-secondary)",
            background: syncing ? "var(--color-background-secondary)" : "var(--color-background-primary)",
            color: "var(--color-text-secondary)",
            opacity: syncing ? 0.7 : 1,
          }}
        >
          <i className={`ti ti-${syncing ? "loader-2" : "refresh"}`}
            style={{ fontSize: 14, animation: syncing ? "spin 1s linear infinite" : "none" }} />
          {syncing ? "Syncing…" : "Refresh Data"}
        </button>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* Shared: Financial Year */}
      <div style={S.sharedFilter}>
        <FilterSelect
          label="Financial Year"
          value={financialYear}
          onChange={setFinancialYear}
          options={filterOptions.financial_years}
          placeholder="All years"
        />
      </div>

      {/* ── Table 1 ── */}
      <div style={S.section}>
        <p style={S.sectionLabel}>Table 1 — Filters</p>
        <div style={S.filterRow}>
          <MultiSelect label="months"    header="Month"    options={filterOptions.months}              selected={t1Month} onChange={setT1Month} />
          <MultiSelect label="segments"  header="Segment"  options={filterOptions.segment_categories}  selected={t1Seg}   onChange={setT1Seg}   />
          <MultiSelect label="categories" header="Category" options={filterOptions.categories}          selected={t1Cat}   onChange={setT1Cat}   />
          <FilterSelect label="SKU"     value={t1Sku}   onChange={setT1Sku}   options={filterOptions.skus || []}           placeholder="All" />
          {t1Cat.includes("Namkeen") && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={S.filterLabel}>Grammage</span>
              <div style={{ display: "flex", gap: 6 }}>
                {[["72", "72g"], ["200_185", "200/185g"]].map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setT1Grammage(t1Grammage === val ? "" : val)}
                    style={t1Grammage === val ? S.posBtnActive : S.posBtn}
                  >{label}</button>
                ))}
              </div>
            </div>
          )}
          {(t1Month.length || t1Seg.length || t1Cat.length || t1Sku || t1Grammage) && (
            <button style={S.clearBtn} onClick={() => { setT1Month([]); setT1Seg([]); setT1Cat([]); setT1Sku(""); setT1Grammage(""); }}>
              <i className="ti ti-x" style={{ fontSize: 12 }} /> Clear
            </button>
          )}
        </div>
        <SegmentTable financialYear={financialYear} filters={t1Filters} allSkus={filterOptions.skus || []} />
      </div>

      {/* ── Table 2 ── */}
      <div style={S.section}>
        <p style={S.sectionLabel}>Table 2 — Filters</p>
        <div style={S.filterRow}>
          <MultiSelect label="months"    header="Month"    options={filterOptions.months}              selected={t2Month} onChange={setT2Month} />
          <MultiSelect label="segments"  header="Segment"  options={filterOptions.segment_categories}  selected={t2Seg}   onChange={setT2Seg}   />
          <MultiSelect label="categories" header="Category" options={filterOptions.categories}          selected={t2Cat}   onChange={setT2Cat}   />
          <FilterSelect label="SKU"     value={t2Sku}   onChange={setT2Sku}   options={filterOptions.skus || []}           placeholder="All" />
          {t2Cat.includes("Namkeen") && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={S.filterLabel}>Grammage</span>
              <div style={{ display: "flex", gap: 6 }}>
                {[["72", "72g"], ["200_185", "200/185g"]].map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setT2Grammage(t2Grammage === val ? "" : val)}
                    style={t2Grammage === val ? S.posBtnActive : S.posBtn}
                  >{label}</button>
                ))}
              </div>
            </div>
          )}
          {(t2Month.length || t2Seg.length || t2Cat.length || t2Sku || t2Grammage) ? (
            <button style={S.clearBtn} onClick={() => { setT2Month([]); setT2Seg([]); setT2Cat([]); setT2Sku(""); setT2Grammage(""); }}>
              <i className="ti ti-x" style={{ fontSize: 12 }} /> Clear
            </button>
          ) : null}
        </div>
        <CustomerTable
          financialYear={financialYear}
          filters={t2Filters}
          pos={t2Pos}
          onPosChange={(p) => setT2Pos(prev => (p === "All" ? "" : (prev === p ? "" : p)))}
          allSkus={filterOptions.skus || []}
        />
      </div>
    </div>
  );
}

// ── Styles — matching ShopActivityMatrix / dashboard CSS vars ─────────────────
const S = {
  sharedFilter: {
    display: "flex", gap: 10, alignItems: "flex-end",
    padding: "12px 16px", marginBottom: "1.5rem",
    background: "var(--color-background-primary)",
    border: "0.5px solid var(--color-border-tertiary)",
    borderRadius: "var(--border-radius-lg)",
  },
  section: { marginBottom: "2rem" },
  sectionLabel: {
    margin: "0 0 8px", fontSize: 11, fontWeight: 600,
    color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em",
  },
  filterRow: {
    display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end",
    padding: "10px 14px", marginBottom: 12,
    background: "var(--color-background-primary)",
    border: "0.5px solid var(--color-border-tertiary)",
    borderRadius: "var(--border-radius-md)",
  },
  filterGroup: { display: "flex", flexDirection: "column", gap: 4 },
  filterLabel: {
    fontSize: 10, fontWeight: 600, color: "var(--color-text-tertiary)",
    textTransform: "uppercase", letterSpacing: "0.05em",
  },
  select: {
    fontSize: 13, padding: "5px 8px",
    borderRadius: "var(--border-radius-md)",
    border: "0.5px solid var(--color-border-secondary)",
    background: "var(--color-background-primary)",
    color: "var(--color-text-primary)", outline: "none",
    minWidth: 130,
  },
  clearBtn: {
    alignSelf: "flex-end", fontSize: 12, padding: "5px 10px",
    borderRadius: "var(--border-radius-md)",
    border: "0.5px solid var(--color-border-secondary)",
    background: "transparent", color: "var(--color-text-tertiary)",
    cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
  },
  card: {
    background: "var(--color-background-primary)",
    border: "0.5px solid var(--color-border-tertiary)",
    borderRadius: "var(--border-radius-lg)",
    overflow: "hidden",
  },
  cardHeader: {
    display: "flex", alignItems: "flex-start", justifyContent: "space-between",
    padding: "14px 16px 10px",
    borderBottom: "0.5px solid var(--color-border-tertiary)",
  },
  cardTitle:    { margin: 0, fontWeight: 600, fontSize: 15, color: "var(--color-text-primary)" },
  cardSubtitle: { margin: "2px 0 0", fontSize: 12, color: "var(--color-text-tertiary)" },
  exportBtn: {
    display: "flex", alignItems: "center", gap: 5,
    fontSize: 12, padding: "5px 12px",
    borderRadius: "var(--border-radius-md)",
    border: "0.5px solid var(--color-border-secondary)",
    background: "transparent", color: "var(--color-text-secondary)",
    cursor: "pointer",
  },
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: {
    padding: "10px 12px", textAlign: "right", fontWeight: 600,
    background: "var(--color-background-secondary)",
    borderBottom: "0.5px solid var(--color-border-tertiary)",
    whiteSpace: "nowrap", color: "var(--color-text-secondary)",
    position: "sticky", top: 0, zIndex: 1,
  },
  td: {
    padding: "9px 12px", fontSize: 13,
    borderBottom: "0.5px solid var(--color-border-tertiary)",
    color: "var(--color-text-primary)",
    whiteSpace: "nowrap",
  },
  stickyCol: {
    position: "sticky", left: 0, zIndex: 2,
    background: "var(--color-background-primary)",
    borderRight: "0.5px solid var(--color-border-tertiary)",
  },
  emptyCell: {
    padding: "2rem", textAlign: "center",
    color: "var(--color-text-tertiary)", fontSize: 13,
  },
  errorText: { margin: "8px 16px", fontSize: 13, color: "var(--color-text-danger)" },
  pagination: {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
    padding: "12px 16px", borderTop: "0.5px solid var(--color-border-tertiary)",
  },
  pageBtn: {
    width: 28, height: 28, borderRadius: "var(--border-radius-md)",
    border: "0.5px solid var(--color-border-secondary)",
    background: "transparent", cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
    color: "var(--color-text-secondary)",
  },
  gtPosBlock: {
    padding: "10px 16px 4px",
    borderBottom: "0.5px solid var(--color-border-tertiary)",
  },
  gtPosRow: {
    display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8,
  },
  posBtn: {
    fontSize: 12, padding: "4px 14px", borderRadius: 20,
    cursor: "pointer",
    border: "0.5px solid var(--color-border-secondary)",
    background: "transparent",
    color: "var(--color-text-secondary)",
    fontWeight: 400,
  },
  posBtnActive: {
    fontSize: 12, padding: "4px 14px", borderRadius: 20,
    cursor: "pointer",
    border: "0.5px solid var(--color-text-info, #378ADD)",
    background: "rgba(55,138,221,0.08)",
    color: "var(--color-text-info, #378ADD)",
    fontWeight: 500,
  },
  shopsServed: {
    margin: "0 0 8px", fontSize: 13, color: "var(--color-text-secondary)",
  },
};