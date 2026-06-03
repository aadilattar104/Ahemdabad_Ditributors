// ModernTradeAnalytics.jsx
// Dashboard page — imports all chart components as separate files.
// Charts: StackedRevenueChart, StackedQtyChart, SohChart

import { useState, useEffect, useCallback } from "react";
import StackedRevenueChart from "../components/Analytics/StackedRevenueChart";
import StackedQtyChart from "../components/Analytics/StackedQtyChart";
import SohChart from "../components/Analytics/SohChart";

const BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:8000";

async function api(path) {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function qs(params = {}) {
  const p = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== "")
  );
  const s = new URLSearchParams(p).toString();
  return s ? "?" + s : "";
}

function shortSku(name) {
  return name.replace(/SVASTHYAA\s*/i, "").trim();
}

function friendlyStore(store) {
  return (store.store_name || store.store_code || "Unknown Store").trim();
}

// ── KPI strip ─────────────────────────────────────────────────────────────────
function KpiStrip({ revenueData, qtyData, sohData, loading, activeStore }) {
  const totalRev = revenueData.reduce((s, r) => s + (r.total_revenue || 0), 0);
  const totalQty = qtyData.reduce((s, r) => s + (r.total_qty || 0), 0);
  const totalSoh = sohData.reduce((s, r) => s + (r.soh_qty || 0), 0);
  const kpis = [
    { label: "Total Revenue",  value: `₹${(totalRev / 1000).toFixed(1)}K`, icon: "ti-currency-rupee" },
    { label: "Units Sold",     value: totalQty.toLocaleString(),            icon: "ti-package" },
    { label: "Units in Stock", value: totalSoh.toLocaleString(),            icon: "ti-stack" },
  ];
  return (
    <div style={{ marginBottom: "1rem" }}>
      {/* Show which store is active so user can confirm filter is applied */}
      {activeStore && (
        <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--color-text-tertiary)" }}>
          <i className="ti ti-filter" style={{ fontSize: 11, marginRight: 4 }} aria-hidden />
          Filtered by: <strong style={{ color: "var(--color-text-secondary)" }}>{activeStore}</strong>
        </p>
      )}
      <div style={styles.kpiRow}>
        {kpis.map((k) => (
          <div key={k.label} style={{ ...styles.kpiCard, opacity: loading ? 0.45 : 1, transition: "opacity 0.2s" }}>
            <i className={`ti ${k.icon}`} style={styles.kpiIcon} aria-hidden />
            <p style={styles.kpiValue}>{loading ? "…" : k.value}</p>
            <p style={styles.kpiLabel}>{k.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ModernTradeAnalytics() {
  const [chains, setChains] = useState([]);
  const [stores, setStores] = useState([]);
  const [months, setMonths] = useState([]);
  const [skus,   setSkus]   = useState([]);

  const [selChain, setSelChain] = useState("");
  const [selStore, setSelStore] = useState("");
  const [selMonth, setSelMonth] = useState("");
  const [selYear,  setSelYear]  = useState("");
  const [selSku,      setSelSku]      = useState("");
  const [selCategory, setSelCategory] = useState("");

  const [revenueData, setRevenueData] = useState([]);
  const [qtyData,     setQtyData]     = useState([]);
  const [sohData,     setSohData]     = useState([]);

  const [loadingChains, setLoadingChains] = useState(true);
  const [loadingCharts, setLoadingCharts] = useState(false);

  // Load chains once
  useEffect(() => {
    api("/mt/chains")
      .then(setChains)
      .catch(console.error)
      .finally(() => setLoadingChains(false));
  }, []);

  // Canonical SKUs from normalisation (MT tab) — [{ id, name, category, family }]
  const [canonicalSkus, setCanonicalSkus] = useState([]);

  // SKU names in selected category — used to filter chart data client-side
  const categorySkuNames = selCategory
    ? new Set(canonicalSkus.filter(s => s.category === selCategory).map(s => s.name))
    : null;

  // Filter chart data by category when no specific SKU is selected
  const filteredRevenue = categorySkuNames && !selSku
    ? revenueData.filter(r => categorySkuNames.has(r.sku_name))
    : revenueData;
  const filteredQty = categorySkuNames && !selSku
    ? qtyData.filter(r => categorySkuNames.has(r.sku_name))
    : qtyData;
  const filteredSoh = categorySkuNames && !selSku
    ? sohData.filter(r => categorySkuNames.has(r.sku_name))
    : sohData;

  // Unified SKU list across filtered datasets — same order = same colours
  const allSkus = [...new Set([
    ...filteredRevenue.map((r) => r.sku_name),
    ...filteredQty.map((r) => r.sku_name),
    ...filteredSoh.map((r) => r.sku_name),
  ])].sort();

  // Load stores / months / canonical SKUs when chain changes
  useEffect(() => {
    if (!selChain) {
      setStores([]); setMonths([]); setSkus([]); setCanonicalSkus([]);
      setSelStore(""); setSelMonth(""); setSelYear(""); setSelSku(""); setSelCategory("");
      return;
    }
    Promise.all([
      api(`/mt/analytics/stores${qs({ chain: selChain })}`),
      api(`/mt/analytics/months${qs({ chain: selChain })}`),
      // Change 1: use canonical SKUs instead of raw SKUs from mt_sales_records
      fetch(`${BASE_URL}/sku/canonical?source_type=MT`).then(r => r.json()),
    ]).then(([s, m, k]) => {
      setStores(s);
      setMonths(m);
      setCanonicalSkus(Array.isArray(k) ? k : []);
      setSkus(Array.isArray(k) ? k : []);
      setSelStore(""); setSelMonth(""); setSelYear(""); setSelSku(""); setSelCategory("");
    }).catch(console.error);
  }, [selChain]);

  // Load chart data when any filter changes
  const loadCharts = useCallback(() => {
    // If a category is selected but no specific SKU, we need to make multiple
    // per-SKU requests and merge — OR pass no sku filter and filter client-side.
    // We filter client-side after fetch: fetch all, then filter by category in render.
    const params = {
      chain: selChain || undefined,
      store: selStore || undefined,
      month: selMonth || undefined,
      year:  selYear  || undefined,
      sku:   selSku   || undefined,  // only set when a specific SKU is chosen
    };
    setLoadingCharts(true);
    Promise.all([
      api(`/mt/analytics/revenue${qs(params)}`),
      api(`/mt/analytics/qty${qs(params)}`),
      api(`/mt/analytics/soh${qs({ chain: params.chain, store: params.store, sku: params.sku })}`),
    ]).then(([rev, qty, soh]) => {
      setRevenueData(rev); setQtyData(qty); setSohData(soh);
    }).catch(console.error)
      .finally(() => setLoadingCharts(false));
  }, [selChain, selStore, selMonth, selYear, selSku]);

  useEffect(() => { loadCharts(); }, [loadCharts]);

  const years          = [...new Set(months.map((m) => m.year))].sort();
  const monthsFiltered = selYear ? months.filter((m) => String(m.year) === String(selYear)) : months;
  const visibleStores  = stores;
  const hasData        = revenueData.length > 0 || sohData.length > 0;

  if (loadingChains) {
    return (
      <div style={styles.page}>
        <p style={{ color: "var(--color-text-tertiary)", fontSize: 14 }}>Loading…</p>
      </div>
    );
  }

  return (
    <div style={styles.page}>

      {/* Header */}
      <div style={styles.header}>
        <p style={styles.h1}>Modern Trade Analytics</p>
        <p style={styles.subtitle}>
          {selChain
            ? `${selChain} · ${visibleStores.length} store${visibleStores.length !== 1 ? "s" : ""}`
            : "Select a chain to begin"}
        </p>
      </div>

      {/* Filter bar */}
      <div style={styles.filterBar}>
        {[
          {
            label: "Chain", value: selChain,
            onChange: (e) => setSelChain(e.target.value),
            disabled: false,
            options: chains.map((c) => ({ value: c.chain_name, label: c.chain_name })),
            placeholder: "All Chains",
          },
          {
            label: "Store", value: selStore,
            // FIX: sync dropdown → selStore using store_code
            onChange: (e) => setSelStore(e.target.value),
            disabled: !selChain,
            // FIX: value is always store_code so chips + dropdown stay in sync
            options: visibleStores.map((s) => ({ value: s.store_code, label: friendlyStore(s) })),
            placeholder: "All Stores",
          },
          {
            label: "Year", value: selYear,
            onChange: (e) => { setSelYear(e.target.value); setSelMonth(""); },
            disabled: !selChain,
            options: years.map((y) => ({ value: y, label: y })),
            placeholder: "All Years",
          },
          {
            label: "Month", value: selMonth,
            onChange: (e) => setSelMonth(e.target.value),
            disabled: !selChain,
            options: monthsFiltered.map((m) => ({ value: m.month, label: `${m.month} ${m.year}` })),
            placeholder: "All Months",
          },
          {
            label: "Category", value: selCategory,
            onChange: (e) => { setSelCategory(e.target.value); setSelSku(""); },  // clearing SKU triggers loadCharts re-run via selSku dep
            disabled: !selChain,
            // Distinct categories from canonical SKU list
            options: [...new Set(canonicalSkus.map(s => s.category).filter(Boolean))].sort()
              .map((c) => ({ value: c, label: c })),
            placeholder: "All Categories",
          },
          {
            label: "SKU", value: selSku,
            onChange: (e) => setSelSku(e.target.value),
            disabled: !selChain,
            // Change 2: filter canonical SKUs by selected category; show canonical name
            options: (selCategory
              ? canonicalSkus.filter(s => s.category === selCategory)
              : canonicalSkus
            ).map((s) => ({ value: s.name, label: shortSku(s.name) })),
            placeholder: "All SKUs",
          },
        ].map((f) => (
          <div key={f.label} style={styles.filterGroup}>
            <label style={styles.filterLabel}>{f.label}</label>
            <select
              style={{ ...styles.select, opacity: f.disabled ? 0.45 : 1 }}
              value={f.value}
              onChange={f.onChange}
              disabled={f.disabled}
            >
              <option value="">{f.placeholder}</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        ))}

        {(selChain || selStore || selMonth || selYear || selSku || selCategory) && (
          <button
            style={styles.resetBtn}
            onClick={() => { setSelChain(""); setSelStore(""); setSelMonth(""); setSelYear(""); setSelSku(""); setSelCategory(""); }}
          >
            <i className="ti ti-x" style={{ fontSize: 12 }} /> Reset
          </button>
        )}
      </div>

      {/* Store chips */}
      {selChain && visibleStores.length > 1 && (
        <div style={styles.chipRow}>
          <span style={styles.chipRowLabel}>Stores:</span>
          {visibleStores.map((s) => (
            <button
              key={s.store_code}
              style={{ ...styles.chip, ...(selStore === s.store_code ? styles.chipActive : {}) }}
              onClick={() => setSelStore(selStore === s.store_code ? "" : s.store_code)}
            >
              {friendlyStore(s)}
            </button>
          ))}
        </div>
      )}

      {/* KPIs — always show when chain selected; dims while loading */}
      {selChain && (
        <KpiStrip
          revenueData={filteredRevenue}
          qtyData={filteredQty}
          sohData={filteredSoh}
          loading={loadingCharts}
          activeStore={selStore
            ? friendlyStore(visibleStores.find(s => s.store_code === selStore) || {})
            : ""}
        />
      )}

      {/* Charts — key forces fresh mount when store filter changes */}
      <div style={styles.charts}>
        <StackedRevenueChart
          key={`rev-${selStore}-${selCategory}`}
          data={filteredRevenue}
          skuList={allSkus}
          isLoading={loadingCharts}
        />
        <StackedQtyChart
          key={`qty-${selStore}-${selCategory}`}
          data={filteredQty}
          skuList={allSkus}
          isLoading={loadingCharts}
        />
        <SohChart
          key={`soh-${selStore}-${selCategory}`}
          data={filteredSoh}
          skuList={allSkus}
          isLoading={loadingCharts}
        />
      </div>

      {/* Empty state */}
      {!loadingCharts && chains.length === 0 && (
        <div style={styles.emptyPage}>
          <i className="ti ti-building-store" style={{ fontSize: 40, color: "var(--color-text-tertiary)" }} />
          <p style={{ color: "var(--color-text-tertiary)", marginTop: 12, fontSize: 14 }}>
            No Modern Trade data yet. Upload an MT Excel file to get started.
          </p>
        </div>
      )}

    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = {
  page: {
    padding: "1.5rem",
    minHeight: "100vh",
    background: "var(--color-background-tertiary)",
  },
  header: {
    marginBottom: "1.25rem",
  },
  h1: {
    margin: 0,
    fontSize: 15,
    fontWeight: 500,
    color: "var(--color-text-primary)",
  },
  subtitle: {
    margin: "2px 0 0",
    fontSize: 13,
    color: "var(--color-text-tertiary)",
  },

  // Filter bar
  filterBar: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    alignItems: "flex-end",
    marginBottom: "1rem",
    padding: "12px 14px",
    background: "var(--color-background-primary)",
    border: "0.5px solid var(--color-border-tertiary)",
    borderRadius: "var(--border-radius-lg)",
  },
  filterGroup: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    minWidth: 140,
  },
  filterLabel: {
    fontSize: 11,
    fontWeight: 500,
    color: "var(--color-text-tertiary)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  select: {
    padding: "5px 8px",
    borderRadius: "var(--border-radius-md)",
    border: "0.5px solid var(--color-border-secondary)",
    background: "var(--color-background-primary)",
    color: "var(--color-text-primary)",
    fontSize: 13,
    cursor: "pointer",
    outline: "none",
  },
  resetBtn: {
    alignSelf: "flex-end",
    padding: "5px 10px",
    borderRadius: "var(--border-radius-md)",
    border: "0.5px solid var(--color-border-secondary)",
    background: "transparent",
    color: "var(--color-text-tertiary)",
    fontSize: 12,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 4,
  },

  // Store chips
  chipRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    alignItems: "center",
    marginBottom: "1rem",
  },
  chipRowLabel: {
    fontSize: 12,
    color: "var(--color-text-tertiary)",
    fontWeight: 500,
  },
  chip: {
    padding: "3px 10px",
    borderRadius: 20,
    border: "0.5px solid var(--color-border-secondary)",
    background: "var(--color-background-primary)",
    color: "var(--color-text-secondary)",
    fontSize: 12,
    cursor: "pointer",
  },
  chipActive: {
    background: "var(--color-text-info, #378ADD)",
    borderColor: "var(--color-text-info, #378ADD)",
    color: "#fff",
  },

  // KPI row
  kpiRow: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 10,
    marginBottom: "1rem",
  },
  kpiCard: {
    padding: "14px 16px",
    background: "var(--color-background-primary)",
    border: "0.5px solid var(--color-border-tertiary)",
    borderRadius: "var(--border-radius-lg)",
  },
  kpiIcon: {
    fontSize: 16,
    color: "var(--color-text-info, #378ADD)",
    display: "block",
    marginBottom: 6,
  },
  kpiValue: {
    margin: 0,
    fontSize: 20,
    fontWeight: 500,
    color: "var(--color-text-primary)",
    lineHeight: 1.2,
  },
  kpiLabel: {
    margin: "2px 0 0",
    fontSize: 12,
    color: "var(--color-text-tertiary)",
  },

  // Chart layout
  charts: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },

  emptyPage: {
    textAlign: "center",
    paddingTop: 80,
  },
};