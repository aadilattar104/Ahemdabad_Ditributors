// ProjectionOverviewCards — 4 KPI cards for the Projections page.
// Projection uses a blended weighted-average growth rate (not a fixed 10%).
// MoM % badge is suppressed when the previous month has sparse data (returns
// null from the backend), keeping the UI clean and accurate.
// Blue left-border on all 4 cards. Matches OverviewCards.jsx style exactly.
//
// Props:
//   data    — projection response from /analytics/projection
//   loading — boolean

function PctBadge({ pct }) {
  if (pct === null || pct === undefined) return null;
  const sign = pct >= 0 ? "+" : "";
  const icon = pct >= 0 ? "ti-trending-up" : "ti-trending-down";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 3,
      fontSize: 12, fontWeight: 500, marginTop: 4,
      color: pct >= 0
        ? "var(--color-text-success, #1D9E75)"
        : "var(--color-text-danger, #EF4444)",
    }}>
      <i className={`ti ${icon}`} style={{ fontSize: 12 }} aria-hidden />
      {sign}{pct}% vs prev month
    </span>
  );
}

function Card({ label, value, pct, icon, loading }) {
  return (
    <div style={{
      background: "var(--color-background-secondary)",
      borderRadius: "var(--border-radius-md)",
      padding: "1.4rem 1.5rem",
      flex: 1,
      minWidth: 160,
      borderLeft: "3px solid var(--color-border-info, #378ADD)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
        <i className={`ti ti-${icon}`} style={{ fontSize: 18, color: "var(--color-text-secondary)" }} aria-hidden />
        <p style={{ margin: 0, fontSize: 14, color: "var(--color-text-secondary)" }}>{label}</p>
      </div>
      {loading ? (
        <>
          <div style={{ height: 34, width: "60%", background: "var(--color-border-tertiary)", borderRadius: 4 }} />
          <div style={{ height: 14, width: "40%", background: "var(--color-border-tertiary)", borderRadius: 4, marginTop: 8 }} />
        </>
      ) : (
        <>
          <p style={{ margin: 0, fontSize: 28, fontWeight: 600 }}>{value ?? "—"}</p>
          {pct !== undefined && <PctBadge pct={pct} />}
        </>
      )}
    </div>
  );
}

export default function ProjectionOverviewCards({ data, loading = false }) {
  if (!data && !loading) return null;

  const fmtRev = (n) =>
    n !== undefined && n !== null
      ? `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
      : "—";

  const cur  = data?.current_month;
  const proj = data?.proj_next;

  const curLabel  = cur  ? `${cur.month?.slice(0, 3)} ${cur.year}`  : "—";
  const nextLabel = proj ? `${proj.month?.slice(0, 3)} ${proj.year}` : "—";

  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      {/* Card 1 — Current month revenue */}
      <Card
        label={`Revenue — ${curLabel}`}
        value={fmtRev(cur?.revenue)}
        pct={data?.mom_rev_pct}
        icon="currency-rupee"
        loading={loading}
      />

      {/* Card 2 — Current month qty */}
      <Card
        label={`Qty Sold — ${curLabel}`}
        value={cur?.qty?.toLocaleString() ?? "—"}
        pct={data?.mom_qty_pct}
        icon="package"
        loading={loading}
      />

      {/* Card 3 — Projected next month revenue */}
      <Card
        label={`Projected Revenue — ${nextLabel}`}
        value={fmtRev(proj?.revenue)}
        icon="chart-line"
        loading={loading}
      />

      {/* Card 4 — Projected next month qty */}
      <Card
        label={`Projected Qty — ${nextLabel}`}
        value={proj?.qty?.toLocaleString() ?? "—"}
        icon="trending-up"
        loading={loading}
      />
    </div>
  );
}