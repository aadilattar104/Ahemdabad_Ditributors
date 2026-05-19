import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LabelList } from "recharts";

const SKU_COLORS = ["#1D9E75", "#378ADD", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#14B8A6", "#F97316"];

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div style={{
      background: "var(--color-background-primary)",
      border: "0.5px solid var(--color-border-secondary)",
      borderRadius: "var(--border-radius-md)",
      padding: "8px 12px",
      fontSize: 13,
      minWidth: 160,
    }}>
      <p style={{ margin: "0 0 6px", fontWeight: 500 }}>{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ margin: "2px 0", color: "var(--color-text-secondary)", display: "flex", justifyContent: "space-between", gap: 16 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: p.fill, display: "inline-block" }} />
            {p.name}
          </span>
          <span>{p.value?.toLocaleString()} units</span>
        </p>
      ))}
      <p style={{ margin: "6px 0 0", borderTop: "0.5px solid var(--color-border-tertiary)", paddingTop: 5, fontWeight: 500, display: "flex", justifyContent: "space-between" }}>
        <span>Total</span><span>{total?.toLocaleString()} units</span>
      </p>
    </div>
  );
}

function TopLabel({ x, y, width, value }) {
  if (!value) return null;
  return (
    <text x={x + width / 2} y={y - 5} textAnchor="middle" fontSize={13} fontWeight={600} fill="var(--color-text-primary)">
      {Number(value).toLocaleString()}
    </text>
  );
}

export default function TopShopsByQtyChart({ data = [], skuData = [], loading = false }) {
  if (loading) {
    return (
      <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "1.25rem 1.5rem", height: 320 }}>
        <div style={{ height: 14, width: 180, background: "var(--color-border-tertiary)", borderRadius: 4, marginBottom: 16 }} />
        <div style={{ height: 240, background: "var(--color-background-secondary)", borderRadius: 8 }} />
      </div>
    );
  }

  const skuNames = skuData.length
    ? [...new Set(skuData.map((r) => r.sku_name))].sort()
    : [];

  const top10 = data.slice(0, 10);

  const chartData = top10.map((d) => {
    const shortName = d.shop_name.length > 14 ? d.shop_name.slice(0, 14) + "…" : d.shop_name;
    const row = { shop_name: d.shop_name, shortName, _total: d.qty };

    if (skuNames.length) {
      const shopRows = skuData.filter((r) => r.shop_name.toUpperCase().trim() === d.shop_name.toUpperCase().trim());
      skuNames.forEach((sku) => {
        const match = shopRows.find((r) => r.sku_name === sku);
        row[sku] = match ? match.qty : 0;
      });
    } else {
      row["Qty"] = d.qty;
    }

    return row;
  });

  const bars = skuNames.length ? skuNames : ["Qty"];

  return (
    <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "1.25rem 1.5rem" }}>
      <p style={{ margin: "0 0 1rem", fontWeight: 500, fontSize: 14 }}>Top shops by qty</p>

      {skuNames.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 12px", marginBottom: 10 }}>
          {skuNames.map((sku, i) => (
            <span key={sku} style={{ fontSize: 11, color: "var(--color-text-secondary)", display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: SKU_COLORS[i % SKU_COLORS.length], display: "inline-block" }} />
              {sku}
            </span>
          ))}
        </div>
      )}

      {chartData.length === 0
        ? <p style={{ textAlign: "center", color: "var(--color-text-tertiary)", padding: "2rem 0", margin: 0 }}>No data</p>
        : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} margin={{ top: 20, right: 8, left: 0, bottom: 60 }}>
              <CartesianGrid vertical={false} stroke="var(--color-border-tertiary)" strokeDasharray="4 4" />
              <XAxis
                dataKey="shortName"
                tick={{ fontSize: 11, fill: "var(--color-text-tertiary)" }}
                axisLine={false}
                tickLine={false}
                angle={-40}
                textAnchor="end"
                interval={0}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--color-text-tertiary)" }}
                axisLine={false}
                tickLine={false}
                width={40}
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
                  barSize={22}
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