import { useState } from "react";
import { saveMargin } from "../../services/api";

// ShopTable shows shop-level revenue and qty, with search and sort.
// Margin % column shows existing margin, inline +Add for missing, pencil to edit.
// Saves directly to Supabase via POST /margins/save on confirm.
// Props:
//   rows           — [{ shop_name, distributor_name, qty, revenue, shop_type }]
//   margins        — [{ shop_name, distributor_name, margin_pct }]
//   loading        — boolean
//   onMarginsChange — () => void  called after a margin is saved so parent re-fetches

export default function ShopTable({ rows = [], margins = [], loading = false, onMarginsChange }) {
  const [search, setSearch]   = useState("");
  const [sortCol, setSortCol] = useState("revenue");
  const [sortDir, setSortDir] = useState("desc");

  const [showMissingOnly, setShowMissingOnly] = useState(false);

  // editing: { shopName, distributorName, value, saving, error }
  const [editing, setEditing] = useState(null);

  const inr = (n) =>
    Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Normalize: strip city suffix (everything after 2+ spaces) then uppercase
  const normShop = (name) => (name || "").replace(/\s{2,}.*$/, "").trim().toUpperCase();

  // Build lookup: "SHOP_NAME_NORMALIZED" → margin_pct
  const marginMap = {};
  for (const m of margins) {
    const key = normShop(m.shop_name);
    marginMap[key] = m.margin_pct;
  }
  const getMarginPct = (row) => {
    const key = normShop(row.shop_name);
    return marginMap[key] ?? null;
  };

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortCol(col); setSortDir("desc"); }
  };

  const filtered = rows
    .filter((r) => r.shop_name.toLowerCase().includes(search.toLowerCase()))
    .filter((r) => !showMissingOnly || getMarginPct(r) === null)
    .sort((a, b) => sortDir === "desc" ? b[sortCol] - a[sortCol] : a[sortCol] - b[sortCol]);

  // ── Margin edit handlers ───────────────────────────────────────────────────
  const openEdit = (row, currentPct) => {
    setEditing({
      shopName:        row.shop_name,
      distributorName: row.distributor_name,
      value:           currentPct !== null ? String(currentPct) : "",
      saving:          false,
      error:           "",
    });
  };

  const cancelEdit = () => setEditing(null);

  const confirmEdit = async () => {
    const pct = parseFloat(editing.value);
    if (isNaN(pct) || pct < 0 || pct > 100) {
      setEditing((e) => ({ ...e, error: "Enter a valid % between 0 and 100" }));
      return;
    }
    setEditing((e) => ({ ...e, saving: true, error: "" }));
    try {
      await saveMargin(editing.shopName, editing.distributorName, pct);
      setEditing(null);
      onMarginsChange?.();   // re-fetch margins in parent
    } catch (err) {
      setEditing((e) => ({ ...e, saving: false, error: err.message || "Save failed" }));
    }
  };

  const SortIcon = ({ col }) => (
    <i
      className={`ti ti-chevron-${sortCol === col ? (sortDir === "desc" ? "down" : "up") : "selector"}`}
      style={{ fontSize: 13, marginLeft: 3, opacity: sortCol === col ? 1 : 0.3 }}
      aria-hidden
    />
  );

  // ── Margin cell renderer ───────────────────────────────────────────────────
  const MarginCell = ({ row }) => {
    const pct = getMarginPct(row);
    const isEditing = editing?.shopName === row.shop_name &&
                      editing?.distributorName === row.distributor_name;

    if (isEditing) {
      return (
        <td style={{ padding: "6px 10px", textAlign: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "center" }}>
            <input
              autoFocus
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={editing.value}
              onChange={(e) => setEditing((ed) => ({ ...ed, value: e.target.value, error: "" }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmEdit();
                if (e.key === "Escape") cancelEdit();
              }}
              style={{
                width: 56, padding: "3px 6px", fontSize: 12,
                border: editing.error
                  ? "1px solid var(--color-border-danger)"
                  : "1px solid var(--color-border-secondary)",
                borderRadius: "var(--border-radius-sm)",
                textAlign: "right",
              }}
              disabled={editing.saving}
            />
            <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>%</span>
            <button
              onClick={confirmEdit}
              disabled={editing.saving}
              title="Save"
              style={{
                padding: "3px 6px", fontSize: 11, background: "var(--color-background-success)",
                color: "var(--color-text-success)", border: "0.5px solid var(--color-border-success)",
                borderRadius: "var(--border-radius-sm)", cursor: "pointer",
              }}
            >
              {editing.saving ? "…" : "✓"}
            </button>
            <button
              onClick={cancelEdit}
              disabled={editing.saving}
              title="Cancel"
              style={{
                padding: "3px 6px", fontSize: 11, background: "transparent",
                color: "var(--color-text-secondary)", border: "0.5px solid var(--color-border-secondary)",
                borderRadius: "var(--border-radius-sm)", cursor: "pointer",
              }}
            >
              ✕
            </button>
          </div>
          {editing.error && (
            <div style={{ fontSize: 10, color: "var(--color-text-danger)", marginTop: 2 }}>
              {editing.error}
            </div>
          )}
        </td>
      );
    }

    if (pct === null) {
      return (
        <td style={{ padding: "10px 14px", textAlign: "center" }}>
          <button
            onClick={() => openEdit(row, null)}
            style={{
              fontSize: 11, padding: "2px 8px", cursor: "pointer",
              background: "transparent", border: "0.5px dashed var(--color-border-secondary)",
              borderRadius: "var(--border-radius-md)", color: "var(--color-text-tertiary)",
              display: "inline-flex", alignItems: "center", gap: 3,
            }}
          >
            <i className="ti ti-plus" style={{ fontSize: 11 }} aria-hidden /> Add
          </button>
        </td>
      );
    }

    return (
      <td style={{ padding: "10px 14px", textAlign: "center" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span style={{
            fontSize: 12, padding: "2px 8px",
            background: "var(--color-background-info, rgba(55,138,221,0.1))",
            color: "var(--color-text-info, #378ADD)",
            borderRadius: "var(--border-radius-md)",
            fontWeight: 500, fontVariantNumeric: "tabular-nums",
          }}>
            {pct}%
          </span>
          <button
            onClick={() => openEdit(row, pct)}
            title="Edit margin"
            style={{
              background: "transparent", border: "none", cursor: "pointer",
              padding: "2px 3px", color: "var(--color-text-tertiary)", fontSize: 12,
              display: "inline-flex", alignItems: "center",
            }}
          >
            <i className="ti ti-pencil" aria-hidden />
          </button>
        </div>
      </td>
    );
  };

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
        <button
          onClick={() => setShowMissingOnly((v) => !v)}
          style={{
            fontSize: 12, padding: "5px 10px", cursor: "pointer", whiteSpace: "nowrap",
            borderRadius: "var(--border-radius-md)",
            border: showMissingOnly
              ? "0.5px solid var(--color-border-warning)"
              : "0.5px solid var(--color-border-secondary)",
            background: showMissingOnly
              ? "var(--color-background-warning)"
              : "transparent",
            color: showMissingOnly
              ? "var(--color-text-warning)"
              : "var(--color-text-secondary)",
            display: "flex", alignItems: "center", gap: 5,
          }}
        >
          <i className="ti ti-filter" style={{ fontSize: 13 }} aria-hidden />
          {showMissingOnly ? "Showing missing margins" : "Missing margins"}
          {!showMissingOnly && (
            <span style={{
              background: "var(--color-background-warning)",
              color: "var(--color-text-warning)",
              borderRadius: 10, fontSize: 11, padding: "0 6px", fontWeight: 600,
            }}>
              {rows.filter((r) => getMarginPct(r) === null).length}
            </span>
          )}
        </button>
        <span style={{ fontSize: 13, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
          {filtered.length} shops
        </span>
      </div>

      <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: 13 }}>
          <colgroup>
            <col style={{ width: "28%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "11%" }} />
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
              <th style={{ padding: "10px 14px", textAlign: "center", fontWeight: 500, borderBottom: "0.5px solid var(--color-border-tertiary)" }}>Margin %</th>
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
                    <MarginCell row={row} />
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}