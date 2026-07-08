import { useState, useEffect, useRef, useCallback } from "react";

const BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:8000";

async function fetchMatrix(distributor, city, year, category, sku, grammage) {
  const params = new URLSearchParams({ distributor });
  if (city)     params.set("city", city);
  if (year)     params.set("year", year);
  if (category) params.set("category", category);
  if (sku)      params.set("sku", sku);
  if (grammage) params.set("grammage", grammage);
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
  if (shop.is_new)                                           return "New";
  if (shop.gap_months > 0)                                   return "Has Gaps";
  if (!shop.is_lapsed && shop.active_months >= 3)            return "Consistent";
  // Lapsed shops (stopped ordering) fall under All only — not Consistent
  return null;
}

// ── PDF export via print window ───────────────────────────────────────────────
function exportToPdf(distributor, filter, months, visibleShops, monthlySummary, beats = {}) {
  const statusColor = {
    ACTIVE:   { bg: "#dcfce7", text: "#166534", border: "#bbf7d0" },
    GAP:      { bg: "#fee2e2", text: "#991b1b", border: "#fecaca" },
    INACTIVE: { bg: "transparent", text: "#9ca3af", border: "transparent" },
  };

  const fmt = (n) => n ? "₹" + Math.round(n).toLocaleString("en-IN") : "—";

  const classifyShop = (shop) => {
    if (shop.is_new)                                    return "New";
    if (shop.gap_months > 0)                            return "Has Gaps";
    if (!shop.is_lapsed && shop.active_months >= 3)     return "Consistent";
    return null;
  };

  const headerCells = months.map(m =>
    `<th>${m.replace(" ", "<br/>")}</th>`
  ).join("");
  const beatHeaderCell = `<th>Beat</th>`;

  const rows = visibleShops.map(shop => {
    const cls = classifyShop(shop);
    const cellMap = {};
    (shop.cells || []).forEach(c => { cellMap[c.month] = c; });

    const dataCells = months.map(m => {
      const cell   = cellMap[m];
      const status = cell?.status || "INACTIVE";
      const sc     = statusColor[status];
      const label  = status === "ACTIVE" ? fmt(cell?.revenue)
                   : status === "GAP"    ? "GAP"
                   : "—";
      return `<td style="background:${sc.bg};color:${sc.text};border:0.5px solid ${sc.border};text-align:center;padding:4px 6px;font-size:11px;">${label}</td>`;
    }).join("");

    const clsBadge = cls ? `<span style="font-size:10px;padding:1px 6px;border-radius:4px;font-weight:500;
      background:${cls==="Has Gaps"?"#fee2e2":cls==="Consistent"?"#dcfce7":"#f3f4f6"};
      color:${cls==="Has Gaps"?"#991b1b":cls==="Consistent"?"#166534":"#6b7280"};">${cls}</span>` : "—";

    const beatVal = beats[shop.shop_name] || "—";
    return `<tr>
      <td style="font-size:11px;padding:5px 8px;font-weight:500;white-space:nowrap;">${shop.shop_name}</td>
      ${dataCells}
      <td style="text-align:right;font-size:11px;padding:5px 8px;font-weight:600;">${fmt(shop.total_revenue)}</td>
      <td style="text-align:center;font-size:11px;padding:5px 8px;color:#374151;">${beatVal}</td>
      <td style="text-align:center;font-size:11px;padding:5px 8px;color:#166534;font-weight:600;">${shop.active_months}</td>
      <td style="text-align:center;font-size:11px;padding:5px 8px;color:${shop.gap_months>0?"#991b1b":"#9ca3af"};font-weight:${shop.gap_months>0?600:400};">${shop.gap_months}</td>
      <td style="text-align:center;padding:5px 8px;">${clsBadge}</td>
    </tr>`;
  }).join("");

  // Monthly summary row for PDF
  const totalAllRevenue = visibleShops.reduce((s, sh) => s + (sh.total_revenue || 0), 0);
  const summaryDataCells = months.map(m => {
    const ms = monthlySummary[m] || { revenue: 0, shopsServed: 0 };
    return `<td style="background:#f9fafb;text-align:center;padding:5px 6px;border-bottom:1.5px solid #e5e7eb;">
      <div style="font-size:11px;font-weight:600;color:#111;">${ms.revenue > 0 ? fmt(ms.revenue) : "—"}</div>
      <div style="font-size:10px;color:#6b7280;">${ms.shopsServed > 0 ? `${ms.shopsServed} shop${ms.shopsServed !== 1 ? "s" : ""}` : "—"}</div>
    </td>`;
  }).join("");
  // AOV row for PDF — average order value per month (revenue / shops served)
  const aovDataCells = months.map(m => {
    const ms = monthlySummary[m] || { aov: 0 };
    return `<td style="background:#f9fafb;text-align:center;padding:5px 6px;border-bottom:0.5px solid #e5e7eb;">
      <div style="font-size:11px;font-weight:500;color:#374151;">${ms.aov > 0 ? fmt(ms.aov) : "—"}</div>
    </td>`;
  }).join("");
  const totalShopsActiveForAov = months.reduce((s, m) => s + (monthlySummary[m]?.shopsServed || 0), 0);
  const overallAov = totalShopsActiveForAov > 0 ? totalAllRevenue / totalShopsActiveForAov : 0;
  const aovRow = `<tr>
    <td style="background:#f9fafb;font-size:11px;font-weight:600;color:#374151;padding:5px 8px;border-bottom:0.5px solid #e5e7eb;white-space:nowrap;">AOV</td>
    ${aovDataCells}
    <td style="background:#f9fafb;text-align:right;font-size:11px;font-weight:500;padding:5px 8px;border-bottom:0.5px solid #e5e7eb;">${overallAov > 0 ? fmt(overallAov) : "—"}</td>
    <td colspan="4" style="background:#f9fafb;border-bottom:0.5px solid #e5e7eb;"></td>
  </tr>`;

  const summaryRow = `<tr>
    <td style="background:#f9fafb;font-size:11px;font-weight:600;color:#374151;padding:5px 8px;border-bottom:1.5px solid #e5e7eb;white-space:nowrap;">Monthly Summary</td>
    ${summaryDataCells}
    <td style="background:#f9fafb;text-align:right;font-size:11px;font-weight:600;padding:5px 8px;border-bottom:1.5px solid #e5e7eb;">${fmt(totalAllRevenue)}</td>
    <td colspan="4" style="background:#f9fafb;border-bottom:1.5px solid #e5e7eb;"></td>
  </tr>`;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Shop Activity Matrix — ${distributor}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 12px; color: #111; padding: 16px; }
    h2 { font-size: 15px; font-weight: 600; margin-bottom: 2px; }
    .meta { font-size: 11px; color: #6b7280; margin-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; table-layout: auto; }
    th { background: #f9fafb; font-size: 10px; font-weight: 600; color: #374151;
         padding: 5px 6px; border-bottom: 1px solid #e5e7eb; text-align: center;
         white-space: nowrap; }
    th.shop-col { text-align: left; padding-left: 8px; }
    td { border-bottom: 0.5px solid #f3f4f6; vertical-align: middle; }
    tr:last-child td { border-bottom: none; }
    .legend { display: flex; gap: 14px; margin-bottom: 8px; }
    .legend-item { display: flex; align-items: center; gap: 4px; font-size: 10px; color: #374151; }
    .dot { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
    @media print {
      body { padding: 8px; }
      @page { size: landscape; margin: 10mm; }
    }
  </style>
</head>
<body>
  <h2>Shop Activity Matrix — ${distributor}</h2>
  <p class="meta">Filter: ${filter} &nbsp;·&nbsp; ${visibleShops.length} shops &nbsp;·&nbsp; ${months.length} months &nbsp;·&nbsp; Generated ${new Date().toLocaleDateString("en-IN")}</p>
  <div class="legend">
    <div class="legend-item"><span class="dot" style="background:#dcfce7;border:1px solid #bbf7d0;"></span> Active</div>
    <div class="legend-item"><span class="dot" style="background:#fee2e2;border:1px solid #fecaca;"></span> Gap</div>
    <div class="legend-item"><span class="dot" style="background:#e5e7eb;border:1px solid #d1d5db;"></span> Inactive</div>
  </div>
  <table>
    <thead>
      <tr>
        <th class="shop-col">Shop</th>
        ${headerCells}
        <th>Total Revenue</th>
        <th>Beat</th>
        <th>Active</th>
        <th>Gaps</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${aovRow}
      ${summaryRow}
      ${rows}
    </tbody>
  </table>
</body>
</html>`;

  const win = window.open("", "_blank", "width=1100,height=700");
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 400);
}



// ── Beat MultiSelect — same UI as FilterBar MultiSelect ──────────────────────
function BeatMultiSelect({ options, selected = [], onChange }) {
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
          whiteSpace: "nowrap",
        }}
      >
        {isActive ? `beats: ${selected.length}` : "All beats"}
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
  );
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
  const [expanded,     setExpanded]     = useState(false);
  const [distributor,  setDistributor]  = useState("");
  const [category,     setCategory]     = useState("");
  const [selSku,       setSelSku]       = useState("");       // selected canonical SKU chip
  const [grammage,     setGrammage]     = useState("");       // selected grammage bucket
  const [canonicalSkus, setCanonicalSkus] = useState([]);    // canonical SKUs for current category
  const [beats,         setBeats]         = useState({});    // { shop_name: beat }
  const [beatFilter,    setBeatFilter]    = useState([]);     // selected beat values (multi)
  const [editingBeat,   setEditingBeat]   = useState(null);  // shop_name being edited
  const [beatDraft,     setBeatDraft]     = useState("");

  // Fetch canonical SKUs when category changes — for the SKU chip row
  useEffect(() => {
    setSelSku("");
    setFilter("All");  // reset subcategory filter when category/SKU selection changes
    if (!category) { setCanonicalSkus([]); return; }
    fetch(`${BASE_URL}/sku/canonical?source_type=DISTRIBUTOR`)
      .then(r => r.json())
      .then(rows => {
        const filtered = Array.isArray(rows)
          ? rows.filter(r => r.category === category)
          : [];
        setCanonicalSkus(filtered);
      })
      .catch(() => setCanonicalSkus([]));
  }, [category]);

  useEffect(() => {
    if (!distributor) { setBeats({}); setBeatFilter([]); return; }
    fetch(`${BASE_URL}/shop-beats?distributor=${encodeURIComponent(distributor)}`)
      .then(r => r.json())
      .then(rows => {
        const map = {};
        (rows || []).forEach(r => { map[r.shop_name] = r.beat; });
        setBeats(map);
      })
      .catch(() => setBeats({}));
  }, [distributor]);

  useEffect(() => {
    if (!distributor) { setData(null); return; }
    setLoading(true); setError("");
    // year intentionally not passed — matrix must show full cross-year shop history
    fetchMatrix(distributor, city, null, category, selSku, grammage)
      .then(setData)
      .catch(e => setError(e.message || "Failed to load matrix"))
      .finally(() => setLoading(false));
  }, [distributor, city, category, selSku, grammage]);

  // Sort months defensively
  const months = data ? [...data.months].sort((a, b) => monthSortKey(a) - monthSortKey(b)) : [];

  // Distinct beats for dropdown
  const distinctBeats = [...new Set(Object.values(beats))].filter(Boolean).sort();

  // Filter shops
  const visibleShops = data
    ? data.shops.filter(shop => {
        if (filter !== "All" && classifyShop(shop) !== filter) return false;
        if (beatFilter.length > 0 && !beatFilter.includes(beats[shop.shop_name])) return false;
        return true;
      })
    : [];

  // ── Monthly summary row — computed from visibleShops ──────────────────────
  // For each month: total revenue across active shops + count of shops served
  const monthlySummary = months.reduce((acc, m) => {
    let revenue = 0;
    let shopsServed = 0;
    visibleShops.forEach(shop => {
      const cell = (shop.cells || []).find(c => c.month === m);
      if (cell && cell.status === "ACTIVE") {
        revenue    += cell.revenue || 0;
        shopsServed += 1;
      }
    });
    // AOV = average order value = revenue / shops served for that month
    const aov = shopsServed > 0 ? revenue / shopsServed : 0;
    acc[m] = { revenue, shopsServed, aov };
    return acc;
  }, {});

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

        {/* Legend + PDF button — only when expanded and has data */}
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

            {/* PDF export button */}
            <button
              onClick={e => {
                e.stopPropagation();
                exportToPdf(distributor, filter, months, visibleShops, monthlySummary, beats);
              }}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                fontSize: 12, padding: "4px 10px",
                borderRadius: "var(--border-radius-md)",
                border: "0.5px solid var(--color-border-secondary)",
                background: "transparent",
                color: "var(--color-text-secondary)",
                cursor: "pointer",
              }}
              title="Export to PDF"
            >
              <i className="ti ti-file-type-pdf" style={{ fontSize: 13 }} aria-hidden />
              PDF
            </button>
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
              onChange={e => { setDistributor(e.target.value); setFilter("All"); setCategory(""); setGrammage(""); setData(null); }}
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

          {/* ── Category filter ─────────────────────────────────────────── */}
          {distributor && (
            <div style={{ padding: "8px 18px", borderBottom: "0.5px solid var(--color-border-tertiary)", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Category</span>
              {["", "Namkeen", "Khakhara"].map(cat => (
                <button
                  key={cat || "all"}
                  onClick={() => { setCategory(cat); setData(null); }}
                  style={{
                    fontSize: 12, padding: "3px 12px",
                    borderRadius: "var(--border-radius-md)",
                    border: "0.5px solid var(--color-border-secondary)",
                    background: category === cat ? "var(--color-background-secondary)" : "transparent",
                    color: category === cat ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                    fontWeight: category === cat ? 500 : 400,
                    cursor: "pointer",
                  }}
                >
                  {cat || "All"}
                </button>
              ))}
            </div>
          )}

          {/* ── SKU chip row — quick-filter to a specific product, shows Has Gaps shops ── */}
          {distributor && category && canonicalSkus.length > 0 && (
            <div style={{ padding: "8px 18px", borderBottom: "0.5px solid var(--color-border-tertiary)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>SKU</span>
              {canonicalSkus.map(s => (
                <button
                  key={s.id}
                  onClick={() => {
                    if (selSku === s.name) {
                      // Toggle off — clear SKU and reset filter
                      setSelSku("");
                      setFilter("All");
                    } else {
                      setSelSku(s.name);
                      setFilter("Has Gaps");
                      setGrammage(""); // SKU already implies a grammage — clear it to avoid conflict
                    }
                    setData(null);
                  }}
                  style={{
                    fontSize: 12, padding: "3px 12px",
                    borderRadius: "var(--border-radius-md)",
                    border: `0.5px solid ${selSku === s.name ? "var(--color-text-info, #378ADD)" : "var(--color-border-secondary)"}`,
                    background: selSku === s.name ? "rgba(55,138,221,0.08)" : "transparent",
                    color: selSku === s.name ? "var(--color-text-info, #378ADD)" : "var(--color-text-secondary)",
                    fontWeight: selSku === s.name ? 500 : 400,
                    cursor: "pointer",
                  }}
                  title={`Show shops that ordered ${s.name} — with gaps highlighted`}
                >
                  {s.name}
                </button>
              ))}
              {selSku && (
                <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
                  Showing shops with order history for "{selSku}"
                </span>
              )}
            </div>
          )}

          {/* ── Grammage filter ─────────────────────────────────────────── */}
          {distributor && (
            <div style={{ padding: "8px 18px", borderBottom: "0.5px solid var(--color-border-tertiary)", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Grammage</span>
              {[
                { key: "72g",  label: "72g" },
                { key: "200g", label: "200g / 185g" },
              ].map(g => (
                <button
                  key={g.key}
                  onClick={() => {
                    const next = grammage === g.key ? "" : g.key;
                    setGrammage(next);
                    if (next) setSelSku(""); // grammage is broader than a specific SKU — clear SKU chip
                    setData(null);
                  }}
                  style={{
                    fontSize: 12, padding: "3px 12px",
                    borderRadius: "var(--border-radius-md)",
                    border: `0.5px solid ${grammage === g.key ? "var(--color-text-info, #378ADD)" : "var(--color-border-secondary)"}`,
                    background: grammage === g.key ? "rgba(55,138,221,0.08)" : "transparent",
                    color: grammage === g.key ? "var(--color-text-info, #378ADD)" : "var(--color-text-secondary)",
                    fontWeight: grammage === g.key ? 500 : 400,
                    cursor: "pointer",
                  }}
                >
                  {g.label}
                </button>
              ))}
              {grammage && (
                <button
                  onClick={() => { setGrammage(""); setData(null); }}
                  style={{ fontSize: 11, color: "var(--color-text-tertiary)", background: "transparent", border: "none", cursor: "pointer" }}
                >
                  Clear
                </button>
              )}
            </div>
          )}

          {/* ── Beat filter multi-select ─────────────────────────────────── */}
          {data && distinctBeats.length > 0 && (
            <div style={{ padding: "8px 18px", borderBottom: "0.5px solid var(--color-border-tertiary)", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>Beat</span>
              <BeatMultiSelect
                options={distinctBeats}
                selected={beatFilter}
                onChange={setBeatFilter}
              />
            </div>
          )}

          {/* ── Filter bar — only when data loaded ──────────────────────── */}
          {data && (
            <div style={S.filterRow}>
              <span style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.04em", marginRight: 2 }}>Subcategory</span>
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
                  {f !== "New" && (
                    <span style={{ fontSize: 10, color: "var(--color-text-tertiary)", marginLeft: 2 }}>
                      Namkeen · Khakhara
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
                    <th style={{ ...S.th, minWidth: 100 }}>Beat</th>
                    <th style={{ ...S.th, minWidth: 56 }}>Active</th>
                    <th style={{ ...S.th, minWidth: 48 }}>Gaps</th>
                    <th style={{ ...S.th, minWidth: 80 }}>Status</th>
                  </tr>
                </thead>

                {/* ── AOV row — average order value per month (revenue / shops served) ── */}
                {visibleShops.length > 0 && (
                  <tbody>
                    <tr style={{ background: "var(--color-background-secondary)", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                      <td style={{ ...S.td, ...S.stickyCol, fontWeight: 600, fontSize: 12, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
                        AOV
                      </td>
                      {months.map(m => {
                        const ms = monthlySummary[m] || { aov: 0 };
                        return (
                          <td key={m} style={{ ...S.td, textAlign: "center", padding: "6px 4px" }}>
                            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-secondary)" }}>
                              {ms.aov > 0 ? fmt(ms.aov) : "—"}
                            </span>
                          </td>
                        );
                      })}
                      <td style={{ ...S.td, textAlign: "right", fontSize: 12, fontWeight: 500, paddingRight: 14, color: "var(--color-text-secondary)" }}>
                        {(() => {
                          const totalRev = visibleShops.reduce((s, sh) => s + (sh.total_revenue || 0), 0);
                          const totalShopsActive = months.reduce((s, m) => s + (monthlySummary[m]?.shopsServed || 0), 0);
                          return totalShopsActive > 0 ? fmt(totalRev / totalShopsActive) : "—";
                        })()}
                      </td>
                      <td colSpan={4} />
                    </tr>
                  </tbody>
                )}

                {/* ── Monthly summary row — shops served + revenue per month ── */}
                {visibleShops.length > 0 && (
                  <tbody>
                    <tr style={{ background: "var(--color-background-secondary)", borderBottom: "1.5px solid var(--color-border-secondary)" }}>
                      <td style={{ ...S.td, ...S.stickyCol, fontWeight: 600, fontSize: 12, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
                        Monthly Summary
                      </td>
                      {months.map(m => {
                        const ms = monthlySummary[m] || { revenue: 0, shopsServed: 0 };
                        return (
                          <td key={m} style={{ ...S.td, textAlign: "center", padding: "6px 4px" }}>
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-primary)" }}>
                                {ms.revenue > 0 ? fmt(ms.revenue) : "—"}
                              </span>
                              <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
                                {ms.shopsServed > 0 ? `${ms.shopsServed} shop${ms.shopsServed !== 1 ? "s" : ""}` : "—"}
                              </span>
                            </div>
                          </td>
                        );
                      })}
                      {/* Empty summary cols to match header */}
                      <td style={{ ...S.td, textAlign: "right", fontSize: 12, fontWeight: 600, paddingRight: 14, color: "var(--color-text-primary)" }}>
                        {fmt(visibleShops.reduce((s, sh) => s + (sh.total_revenue || 0), 0))}
                      </td>
                      <td colSpan={4} />
                    </tr>
                  </tbody>
                )}

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
                        {/* Shop name with serial number */}
                        <td style={{ ...S.td, ...S.stickyCol, fontWeight: 500, fontSize: 13 }}
                            title={shop.shop_name}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            {/* Serial number */}
                            <span style={{
                              fontSize: 11, fontWeight: 600, color: "var(--color-text-tertiary)",
                              minWidth: 20, flexShrink: 0, textAlign: "right",
                            }}>
                              {si + 1}.
                            </span>
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
                              whiteSpace: "nowrap", maxWidth: 148,
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

                        {/* Beat cell with inline edit */}
                        <td style={{ ...S.td, textAlign: "center", fontSize: 12, minWidth: 100 }}>
                          {editingBeat === shop.shop_name ? (
                            <input
                              autoFocus
                              value={beatDraft}
                              onChange={e => setBeatDraft(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Enter") {
                                  const trimmed = beatDraft.trim();
                                  if (trimmed) {
                                    setBeats(prev => ({ ...prev, [shop.shop_name]: trimmed }));
                                    fetch(`${BASE_URL}/shop-beats`, {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ shop_name: shop.shop_name, distributor_name: distributor, beat: trimmed }),
                                    }).catch(() => {});
                                  }
                                  setEditingBeat(null);
                                }
                                if (e.key === "Escape") setEditingBeat(null);
                              }}
                              onBlur={() => {
                                const trimmed = beatDraft.trim();
                                if (trimmed) {
                                  setBeats(prev => ({ ...prev, [shop.shop_name]: trimmed }));
                                  fetch(`${BASE_URL}/shop-beats`, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ shop_name: shop.shop_name, distributor_name: distributor, beat: trimmed }),
                                  }).catch(() => {});
                                }
                                setEditingBeat(null);
                              }}
                              style={{
                                fontSize: 12, padding: "2px 6px", width: 80,
                                borderRadius: "var(--border-radius-sm)",
                                border: "0.5px solid var(--color-border-secondary)",
                                background: "var(--color-background-primary)",
                                color: "var(--color-text-primary)", outline: "none",
                              }}
                            />
                          ) : (
                            <span
                              onClick={() => { setEditingBeat(shop.shop_name); setBeatDraft(beats[shop.shop_name] || ""); }}
                              title="Click to assign beat"
                              style={{
                                cursor: "pointer",
                                color: beats[shop.shop_name] ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
                                fontSize: beats[shop.shop_name] ? 12 : 11,
                                padding: "2px 6px",
                                borderRadius: "var(--border-radius-sm)",
                                border: "0.5px solid transparent",
                                display: "inline-block",
                              }}
                              onMouseEnter={e => e.currentTarget.style.border = "0.5px solid var(--color-border-secondary)"}
                              onMouseLeave={e => e.currentTarget.style.border = "0.5px solid transparent"}
                            >
                              {beats[shop.shop_name] || "+ Add"}
                            </span>
                          )}
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