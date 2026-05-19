// TopShopsChart renders a vertical stacked bar chart of top N shops by revenue.
// Each bar is stacked by SKU contribution.
// Data labels (₹28k style) shown above each bar.
// Props:
//   data    — [{ shop_name, revenue }] sorted desc by revenue  (unchanged)
//   skuData — [{ shop_name, sku_name, revenue, qty }]          (new, for stacking)
//   loading — boolean

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid, LabelList } from "recharts";

// SKU colour palette — up to 8 SKUs
const SKU_COLORS = ["#378ADD", "#1D9E75", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#14B8A6", "#F97316"];

function fmtRevLabel(val) {
  if (val >= 100000) return `₹${(val / 100000).toFixed(1)}L`;
  if (val >= 1000)   return `₹${(val / 1000).toFixed(0)}k`;
  return `₹${val}`;
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div style={{
      background: "var(--color-background-primary)",
      border: "0.5px solid var(--color-border-secondary)",
      borderRadius: "var(--border-radius-md)",
      padding: "8px 14px",
      fontSize: 14,
      minWidth: 160,
    }}>
      <p style={{ margin: "0 0 6px", fontWeight: 500 }}>{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ margin: "2px 0", color: "var(--color-text-secondary)", display: "flex", justifyContent: "space-between", gap: 16 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: p.fill, display: "inline-block" }} />
            {p.name}
          </span>
          <span>{fmtRevLabel(p.value)}</span>
        </p>
      ))}
      <p style={{ margin: "6px 0 0", borderTop: "0.5px solid var(--color-border-tertiary)", paddingTop: 5, fontWeight: 500, display: "flex", justifyContent: "space-between" }}>
        <span>Total</span><span>{fmtRevLabel(total)}</span>
      </p>
    </div>
  );
}

// Top label rendered above the full stacked bar
function TopLabel({ x, y, width, value }) {
  if (!value) return null;
  return (
    <text x={x + width / 2} y={y - 5} textAnchor="middle" fontSize={13} fontWeight={600} fill="var(--color-text-primary)">
      {fmtRevLabel(value)}
    </text>
  );
}

export default function TopShopsChart({ data = [], skuData = [], loading = false }) {
  if (loading) {
    return (
      <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "1.5rem 2rem", height: 420 }}>
        <div style={{ height: 14, width: 140, background: "var(--color-border-tertiary)", borderRadius: 4, marginBottom: 16 }} />
        <div style={{ height: 240, background: "var(--color-background-secondary)", borderRadius: 8 }} />
      </div>
    );
  }

  // Derive SKU list from skuData; fall back to single-bar if no skuData
  const skuNames = skuData.length
    ? [...new Set(skuData.map((r) => r.sku_name))].sort()
    : [];

  // Build chart rows: one per shop, keyed by shortName
  const top10 = data.slice(0, 10);

  const chartData = top10.map((d) => {
    const shortName = d.shop_name.length > 14 ? d.shop_name.slice(0, 14) + "…" : d.shop_name;
    const row = { shop_name: d.shop_name, shortName, _total: d.revenue };

    if (skuNames.length) {
      // Fill SKU values for this shop
      const shopRows = skuData.filter((r) => r.shop_name.toUpperCase().trim() === d.shop_name.toUpperCase().trim());
      skuNames.forEach((sku) => {
        const match = shopRows.find((r) => r.sku_name === sku);
        row[sku] = match ? match.revenue : 0;
      });
    } else {
      row["Revenue"] = d.revenue;
    }

    return row;
  });

  const bars = skuNames.length ? skuNames : ["Revenue"];

  return (
    <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "1.5rem 2rem" }}>
      <p style={{ margin: "0 0 1rem", fontWeight: 600, fontSize: 16 }}>Top shops by revenue</p>

      {/* SKU legend */}
      {skuNames.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginBottom: 12 }}>
          {skuNames.map((sku, i) => (
            <span key={sku} style={{ fontSize: 13, color: "var(--color-text-secondary)", display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: SKU_COLORS[i % SKU_COLORS.length], display: "inline-block" }} />
              {sku}
            </span>
          ))}
        </div>
      )}

      {chartData.length === 0
        ? <p style={{ textAlign: "center", color: "var(--color-text-tertiary)", padding: "2rem 0", margin: 0 }}>No data</p>
        : (
          <ResponsiveContainer width="100%" height={380}>
            <BarChart data={chartData} margin={{ top: 24, right: 12, left: 0, bottom: 70 }}>
              <CartesianGrid vertical={false} stroke="var(--color-border-tertiary)" strokeDasharray="4 4" />
              <XAxis
                dataKey="shortName"
                tick={{ fontSize: 13, fill: "var(--color-text-tertiary)" }}
                axisLine={false}
                tickLine={false}
                angle={-40}
                textAnchor="end"
                interval={0}
              />
              <YAxis
                tick={{ fontSize: 13, fill: "var(--color-text-tertiary)" }}
                axisLine={false}
                tickLine={false}
                width={52}
                tickFormatter={fmtRevLabel}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "var(--color-background-secondary)" }} />
              {bars.map((sku, i) => (
                <Bar
                  key={sku}
                  dataKey={sku}
                  stackId="a"
                  fill={SKU_COLORS[i % SKU_COLORS.length]}
                  fillOpacity={0.9}
                  radius={i === bars.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                  barSize={28}
                >
                  {i === bars.length - 1 && (
                    <LabelList dataKey="_total" content={<TopLabel />} />
                  )}
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
    </div>
  );
}