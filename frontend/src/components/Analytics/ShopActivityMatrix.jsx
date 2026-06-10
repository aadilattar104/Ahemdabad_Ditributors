import { useState, useEffect } from "react";

const BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:8000";

async function fetchMatrix(distributor, city, year) {
  const params = new URLSearchParams({ distributor });
  if (city) params.set("city", city);
  if (year) params.set("year", year);
  const res = await fetch(`${BASE_URL}/shop-activity-matrix?${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const MONTH_NUM = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};

function monthSortKey(label) {
  // "April 2026" → sortable number
  const [m, y] = label.split(" ");
  return (parseInt(y, 10) || 0) * 100 + (MONTH_NUM[m] || 0);
}

function fmt(n) {
  if (!n) return "—";
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

// ── Status cell colours using dashboard CSS vars ──────────────────────────────
const STATUS = {
  ACTIVE: {
    bg:     "var(--color-background-success)",
    border: "var(--color-border-success, var(--color-background-success))",
    text:   "var(--color-text-success)",
    dot:    "var(--color-text-success)",
  },
  GAP: {
    bg:     "var(--color-background-danger)",
    border: "var(--color-border-danger, var(--color-background-danger))",
    text:   "var(--color-text-danger)",
    dot:    "var(--color-text-danger)",
  },
  INACTIVE: {
    bg:     "transparent",
    border: "transparent",
    text:   "var(--color-text-tertiary)",
    dot:    "transparent",
  },
};

const FILTERS = ["All", "Has Gaps", "Consistent", "New"];

function classifyShop(shop) {
  if (shop.is_new)              return "New";
  if (shop.gap_months > 0)      return "Has Gaps";
  if (shop.active_months >= 3)  return "Consistent";
  return null; // All only
}

// ── Skeleton loader ───────────────────────────────────────────────────────────
function Skeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {[80, 65, 72, 58].map((w, i) => (
        <div key={i} style={{ height: 36, borderRadius: "var(--border-radius-sm)", background: "var(--color-border-tertiary)", width: `${w}%`, opacity: 0.6 }} />
      ))}
    </div>
  );
}

export default function ShopActivityMatrix({ distributors = [], city, year }) {
  const [data,         setData]         = useState(null);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState("");
  const [filter,       setFilter]       = useState("All");
  const [hovered,      setHovered]      = useState(null);
  const [expanded,     setExpanded]     = useState(false);  // collapsed by default
  const [distributor,  setDistributor]  = useState("");     // own internal selection

  useEffect(() => {
    if (!distributor) { setData(null); return; }
    setLoading(true); setError("");
    fetchMatrix(distributor, city, year)
      .then(setData)
      .catch(e => setError(e.message || "Failed to load matrix"))
      .finally(() => setLoading(false));
  }, [distributor, city, year]);

  // Sort months defensively
  const months = data ? [...data.months].sort((a, b) => monthSortKey(a) - monthSortKey(b)) : [];

  // Filter shops
  const visibleShops = data
    ? data.shops.filter(shop => {
        if (filter === "All") return true;
        return classifyShop(shop) === filter;
      })
    : [];

  // Badge counts
  const counts = data
    ? FILTERS.reduce((acc, f) => {
        acc[f] = f === "All"
          ? data.shops.length
          : data.shops.filter(s => classifyShop(s) === f).length;
        return acc;
      }, {})
    : {};

  return (
    <div style={S.card}>

      {/* ── Header — always visible ──────────────────────────────────────── */}
      <div style={{ ...S.cardHeader, cursor: "pointer" }} onClick={() => setExpanded(v => !v)}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <i className={`ti ti-chevron-${expanded ? "up" : "right"}`} style={{ fontSize: 13, color: "var(--color-text-tertiary)" }} aria-hidden />
          <span style={S.title}>Shop Activity Matrix</span>
          {data && expanded && (
            <span style={S.subLabel}>{data.shops.length} shops · {months.length} months</span>
          )}
        </div>

        {/* Legend — only when expanded and has data */}
        {expanded && data && (
          <div style={{ display: "flex", alignItems: "center", gap: 16 }} onClick={e => e.stopPropagation()}>
            {[
              { label: "Active",   s: "ACTIVE"   },
              { label: "Gap",      s: "GAP"      },
              { label: "Inactive", s: "INACTIVE" },
            ].map(({ label, s }) => (
              <div key={s} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--color-text-secondary)" }}>
                <span style={{
                  width: 10, height: 10, borderRadius: 2,
                  background: s === "INACTIVE" ? "var(--color-border-tertiary)" : STATUS[s].bg,
                  border: `1px solid ${s === "INACTIVE" ? "var(--color-border-secondary)" : STATUS[s].border}`,
                  display: "inline-block",
                }} />
                {label}
              </div>
            ))}
          </div>
        )}
      </div>

      {!expanded ? null : (
        <>
          {/* ── Distributor selector ────────────────────────────────────── */}
          <div style={{ padding: "10px 18px", borderBottom: "0.5px solid var(--color-border-tertiary)", display: "flex", alignItems: "center", gap: 10 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>
              Distributor
            </label>
            <select
              value={distributor}
              onChange={e => { setDistributor(e.target.value); setFilter("All"); setData(null); }}
              style={S.select}
            >
              <option value="">Select distributor…</option>
              {distributors.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            {distributor && (
              <button
                onClick={() => { setDistributor(""); setData(null); }}
                style={{ ...S.iconBtn, fontSize: 12, color: "var(--color-text-tertiary)" }}
                title="Clear"
              >
                <i className="ti ti-x" aria-hidden />
              </button>
            )}
          </div>

          {/* ── Filter bar — only when data loaded ──────────────────────── */}
          {data && (
            <div style={S.filterRow}>
              {FILTERS.map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  style={{ ...S.filterBtn, ...(filter === f ? S.filterBtnActive : {}) }}
                >
                  {f}
                  {counts[f] != null && (
                    <span style={{
                      ...S.badge,
                      background: filter === f ? "var(--color-text-info, #378ADD)" : "var(--color-border-secondary)",
                      color:      filter === f ? "#fff" : "var(--color-text-secondary)",
                    }}>
                      {counts[f]}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* ── No distributor selected yet ──────────────────────────────── */}
          {!distributor && (
            <div style={S.placeholder}>
              <i className="ti ti-layout-grid" style={{ fontSize: 28, color: "var(--color-text-tertiary)", marginBottom: 8 }} aria-hidden />
              <p style={{ margin: 0, fontSize: 14, color: "var(--color-text-tertiary)" }}>
                Select a distributor to view shop activity
              </p>
            </div>
          )}

          {/* ── States ──────────────────────────────────────────────────── */}
          {loading && (
            <div style={{ padding: "1.5rem" }}><Skeleton /></div>
          )}

          {error && !loading && (
            <div style={{ padding: "1rem 1.5rem", fontSize: 13, color: "var(--color-text-danger)" }}>
              <i className="ti ti-circle-x" style={{ marginRight: 6 }} aria-hidden />{error}
            </div>
          )}

          {!loading && !error && data && visibleShops.length === 0 && (
            <div style={S.placeholder}>
              <p style={{ margin: 0, fontSize: 14, color: "var(--color-text-tertiary)" }}>
                No shops match this filter.
              </p>
            </div>
          )}

          {/* ── Matrix table ─────────────────────────────────────────────── */}
          {!loading && !error && data && visibleShops.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={S.table}>
                <thead>
                  <tr style={{ background: "var(--color-background-secondary)" }}>
                    {/* Shop name col */}
                    <th style={{ ...S.th, ...S.stickyCol, textAlign: "left", minWidth: 180 }}>
                      Shop
                    </th>
                    {/* Month cols */}
                    {months.map(m => (
                      <th key={m} style={{ ...S.th, minWidth: 90, whiteSpace: "nowrap" }}>
                        {m}
                      </th>
                    ))}
                    {/* Summary cols */}
                    <th style={{ ...S.th, minWidth: 80 }}>Total Rev</th>
                    <th style={{ ...S.th, minWidth: 56 }}>Active</th>
                    <th style={{ ...S.th, minWidth: 48 }}>Gaps</th>
                    <th style={{ ...S.th, minWidth: 80 }}>Status</th>
                  </tr>
                </thead>

                <tbody>
                  {visibleShops.map((shop, si) => {
                    const cls = classifyShop(shop);
                    // Build a cell map for O(1) lookup
                    const cellMap = Object.fromEntries(shop.cells.map(c => [c.month, c]));

                    return (
                      <tr
                        key={shop.shop_name}
                        style={{
                          borderBottom: si < visibleShops.length - 1
                            ? "0.5px solid var(--color-border-tertiary)"
                            : "none",
                          background: si % 2 === 0
                            ? "transparent"
                            : "var(--color-background-secondary)",
                        }}
                      >
                        {/* Shop name */}
                        <td style={{ ...S.td, ...S.stickyCol, fontWeight: 500, fontSize: 13 }}
                            title={shop.shop_name}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            {/* Tiny classification dot */}
                            {cls && (
                              <span style={{
                                width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                                background: cls === "New"       ? "var(--color-text-secondary)"
                                          : cls === "Has Gaps"  ? STATUS.GAP.dot
                                          : cls === "Consistent"? STATUS.ACTIVE.dot
                                          : "transparent",
                              }} />
                            )}
                            <span style={{
                              overflow: "hidden", textOverflow: "ellipsis",
                              whiteSpace: "nowrap", maxWidth: 160,
                              display: "block",
                            }}>
                              {shop.shop_name}
                            </span>
                          </div>
                        </td>

                        {/* Month cells */}
                        {months.map(m => {
                          const cell     = cellMap[m];
                          const status   = cell?.status || "INACTIVE";
                          const isHov    = hovered?.shopIdx === si && hovered?.monthLabel === m;
                          const sty      = STATUS[status];

                          return (
                            <td
                              key={m}
                              style={{ ...S.td, padding: "6px 4px", textAlign: "center" }}
                              onMouseEnter={() => setHovered({ shopIdx: si, monthLabel: m })}
                              onMouseLeave={() => setHovered(null)}
                            >
                              <div
                                style={{
                                  position: "relative",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  minWidth: 72,
                                  padding: "3px 8px",
                                  borderRadius: "var(--border-radius-sm)",
                                  background: isHov && status !== "INACTIVE"
                                    ? sty.bg : status === "ACTIVE" || status === "GAP"
                                    ? sty.bg : "transparent",
                                  border: `0.5px solid ${status !== "INACTIVE" ? sty.border : "transparent"}`,
                                  fontSize: 12,
                                  color: sty.text,
                                  cursor: status !== "INACTIVE" ? "default" : "default",
                                  transition: "opacity 0.1s",
                                }}
                                title={
                                  status === "ACTIVE"   ? `Active — ${fmt(cell?.revenue)}`
                                : status === "GAP"      ? "Gap — no order this month"
                                : "Inactive"
                                }
                              >
                                {status === "ACTIVE"   ? fmt(cell?.revenue)
                               : status === "GAP"      ? "GAP"
                               : <span style={{ color: "var(--color-border-secondary)" }}>—</span>}
                              </div>
                            </td>
                          );
                        })}

                        {/* Summary */}
                        <td style={{ ...S.td, textAlign: "right", fontWeight: 500, fontSize: 12, paddingRight: 14 }}>
                          {fmt(shop.total_revenue)}
                        </td>
                        <td style={{ ...S.td, textAlign: "center", fontSize: 12 }}>
                          <span style={{ color: STATUS.ACTIVE.text, fontWeight: 600 }}>
                            {shop.active_months}
                          </span>
                        </td>
                        <td style={{ ...S.td, textAlign: "center", fontSize: 12 }}>
                          {shop.gap_months > 0
                            ? <span style={{ color: STATUS.GAP.text, fontWeight: 600 }}>{shop.gap_months}</span>
                            : <span style={{ color: "var(--color-text-tertiary)" }}>0</span>
                          }
                        </td>
                        <td style={{ ...S.td, textAlign: "center" }}>
                          {cls ? (
                            <span style={{
                              fontSize: 11, padding: "2px 8px",
                              borderRadius: "var(--border-radius-md)",
                              fontWeight: 500,
                              background: cls === "New"        ? "var(--color-background-secondary)"
                                        : cls === "Has Gaps"   ? STATUS.GAP.bg
                                        : cls === "Consistent" ? STATUS.ACTIVE.bg
                                        : "transparent",
                              color:      cls === "New"        ? "var(--color-text-secondary)"
                                        : cls === "Has Gaps"   ? STATUS.GAP.text
                                        : cls === "Consistent" ? STATUS.ACTIVE.text
                                        : "transparent",
                              border: "0.5px solid transparent",
                            }}>
                              {cls}
                            </span>
                          ) : (
                            <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  card: {
    border: "0.5px solid var(--color-border-tertiary)",
    borderRadius: "var(--border-radius-lg)",
    overflow: "hidden",
    background: "var(--color-background-primary, #fff)",
  },
  cardHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 18px",
    borderBottom: "0.5px solid var(--color-border-tertiary)",
    background: "var(--color-background-primary, #fff)",
    flexWrap: "wrap",
    gap: 8,
  },
  title: {
    fontWeight: 600,
    fontSize: 15,
    color: "var(--color-text-primary)",
  },
  subLabel: {
    fontSize: 12,
    color: "var(--color-text-tertiary)",
    fontWeight: 400,
  },
  filterRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "10px 18px",
    borderBottom: "0.5px solid var(--color-border-tertiary)",
    flexWrap: "wrap",
  },
  filterBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "4px 12px",
    borderRadius: "var(--border-radius-md)",
    border: "0.5px solid var(--color-border-secondary)",
    background: "transparent",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 500,
    color: "var(--color-text-secondary)",
    transition: "background 0.12s, color 0.12s",
  },
  filterBtnActive: {
    background: "var(--color-background-secondary)",
    color: "var(--color-text-primary)",
    border: "0.5px solid var(--color-border-primary)",
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    fontSize: 11,
    fontWeight: 600,
    padding: "0 5px",
  },
  iconBtn: {
    background: "transparent",
    border: "none",
    cursor: "pointer",
    padding: "4px 6px",
    borderRadius: "var(--border-radius-sm)",
    color: "var(--color-text-secondary)",
    fontSize: 15,
    lineHeight: 1,
    display: "inline-flex",
    alignItems: "center",
  },
  placeholder: {
    padding: "3rem 2rem",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
  },
  th: {
    padding: "9px 8px",
    textAlign: "center",
    fontWeight: 500,
    fontSize: 12,
    borderBottom: "0.5px solid var(--color-border-tertiary)",
    color: "var(--color-text-secondary)",
    whiteSpace: "nowrap",
  },
  td: {
    padding: "8px 8px",
    verticalAlign: "middle",
  },
  select: {
    fontSize: 13, padding: "5px 8px",
    borderRadius: "var(--border-radius-md)",
    border: "0.5px solid var(--color-border-secondary)",
    background: "var(--color-background-primary)",
    color: "var(--color-text-primary)",
    minWidth: 180,
  },
  stickyCol: {
    position: "sticky",
    left: 0,
    zIndex: 1,
    background: "var(--color-background-primary, #fff)",
    boxShadow: "1px 0 0 var(--color-border-tertiary)",
    paddingLeft: 14,
    paddingRight: 12,
  },
};