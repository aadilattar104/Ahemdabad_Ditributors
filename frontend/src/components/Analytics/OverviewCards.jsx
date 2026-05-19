// OverviewCards shows top-level metrics: total revenue, total qty, shop count, distributor count.
// Props:
//   data — { totalRevenue, totalQty, shopCount, distributorCount } (from /analytics/overview)
//   loading — boolean

function Card({ label, value, icon, loading }) {
  return (
    <div style={{
      background: "var(--color-background-secondary)",
      borderRadius: "var(--border-radius-md)",
      padding: "1.4rem 1.5rem",
      flex: 1,
      minWidth: 160,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
        <i className={`ti ti-${icon}`} style={{ fontSize: 18, color: "var(--color-text-secondary)" }} aria-hidden />
        <p style={{ margin: 0, fontSize: 14, color: "var(--color-text-secondary)" }}>{label}</p>
      </div>
      {loading ? (
        <div style={{ height: 34, width: "60%", background: "var(--color-border-tertiary)", borderRadius: 4 }} />
      ) : (
        <p style={{ margin: 0, fontSize: 28, fontWeight: 600 }}>{value ?? "—"}</p>
      )}
    </div>
  );
}

export default function OverviewCards({ data, loading = false }) {
  const fmt = (n) =>
    n !== undefined
      ? `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
      : "—";

  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      <Card label="Total revenue" value={fmt(data?.totalRevenue)} icon="currency-rupee" loading={loading} />
      <Card label="Total qty sold" value={data?.totalQty?.toLocaleString() ?? "—"} icon="package" loading={loading} />
      <Card label="Shops" value={data?.shopCount?.toLocaleString() ?? "—"} icon="building-store" loading={loading} />
      <Card label="Distributors" value={data?.distributorCount?.toLocaleString() ?? "—"} icon="truck" loading={loading} />
    </div>
  );
}