// SohChart.jsx
// Stacked bar chart — Stock on Hand by store, X axis = store name
// Props:
//   data      — [{ store_name, store_code, sku_name, soh_qty }]
//   skuList   — string[]  (ordered SKU names, shared across charts)
//   isLoading — boolean

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, LabelList,
} from "recharts";

const SKU_COLORS = [
  "#378ADD", "#F97316", "#10B981", "#8B5CF6",
  "#F59E0B", "#EC4899", "#06B6D4", "#84CC16",
  "#EF4444", "#A78BFA", "#34D399", "#FCD34D",
];

function skuColor(sku, skuList) {
  return SKU_COLORS[skuList.indexOf(sku) % SKU_COLORS.length];
}

function shortSku(name) {
  return name.replace(/SVASTHYAA\s*/i, "").trim();
}

function friendlyStore(store) {
  return (store.store_name || store.store_code || "Unknown Store").trim();
}

function fmtQty(val) {
  if (val >= 1000) return `${(val / 1000).toFixed(1)}k`;
  return `${val}`;
}

// FIX: filter out internal keys so only SKU rows show in tooltip
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const skuRows = payload.filter((p) => !p.dataKey.startsWith("_"));
  const total = skuRows.reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div style={{
      background: "var(--color-background-primary)",
      border: "0.5px solid var(--color-border-secondary)",
      borderRadius: "var(--border-radius-md)",
      padding: "8px 14px",
      fontSize: 13,
      minWidth: 170,
      maxWidth: 300,
    }}>
      <p style={{ margin: "0 0 6px", fontWeight: 500, color: "var(--color-text-primary)", wordBreak: "break-word" }}>{label}</p>
      {skuRows.map((p) => (
        <p key={p.dataKey} style={{ margin: "2px 0", color: "var(--color-text-secondary)", display: "flex", justifyContent: "space-between", gap: 16 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: p.fill, display: "inline-block" }} />
            {shortSku(p.dataKey)}
          </span>
          <span>{fmtQty(p.value)} units</span>
        </p>
      ))}
      <p style={{ margin: "6px 0 0", borderTop: "0.5px solid var(--color-border-tertiary)", paddingTop: 5, fontWeight: 500, color: "var(--color-text-primary)", display: "flex", justifyContent: "space-between" }}>
        <span>Total</span><span>{fmtQty(total)} units</span>
      </p>
    </div>
  );
}

// FIX: module-level stable reference — no flicker
function TopLabel({ x, y, width, value }) {
  if (!value) return null;
  return (
    <text
      x={x + width / 2}
      y={y - 5}
      textAnchor="middle"
      fontSize={12}
      fontWeight={600}
      fill="var(--color-text-primary)"
    >
      {fmtQty(value)}
    </text>
  );
}

function Skeleton() {
  return <div style={{ height: 220, background: "var(--color-background-secondary)", borderRadius: 8 }} />;
}

export default function SohChart({ data = [], skuList = [], isLoading = false }) {
  const pivotMap = {};
  data.forEach((r) => {
    const key = friendlyStore(r);
    if (!pivotMap[key]) pivotMap[key] = { store: key, _total: 0 };
    pivotMap[key][r.sku_name] = (pivotMap[key][r.sku_name] || 0) + (r.soh_qty || 0);
    pivotMap[key]._total = (pivotMap[key]._total || 0) + (r.soh_qty || 0);
  });
  const chartData = Object.values(pivotMap);

  const truncate = (name) => name.length > 14 ? name.slice(0, 14) + "…" : name;

  return (
    <div style={{
      padding: "1.25rem 1.5rem",
      background: "var(--color-background-primary)",
      border: "0.5px solid var(--color-border-tertiary)",
      borderRadius: "var(--border-radius-lg)",
    }}>
      <p style={{ margin: "0 0 4px", fontWeight: 600, fontSize: 16, color: "var(--color-text-primary)" }}>
        Stock on Hand
      </p>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--color-text-tertiary)" }}>
        Current units per store — latest upload
      </p>

      {skuList.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginBottom: 12 }}>
          {skuList.map((sku) => (
            <span key={sku} style={{ fontSize: 13, color: "var(--color-text-secondary)", display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: skuColor(sku, skuList), display: "inline-block" }} />
              {shortSku(sku)}
            </span>
          ))}
        </div>
      )}

      {isLoading ? <Skeleton /> : chartData.length === 0 ? (
        <p style={{ textAlign: "center", color: "var(--color-text-tertiary)", padding: "2rem 0", margin: 0, fontSize: 13 }}>
          No SOH data available
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart
            data={chartData}
            margin={{ top: 28, right: 12, left: 0, bottom: chartData.length > 4 ? 50 : 0 }}
          >
            <CartesianGrid vertical={false} stroke="var(--color-border-tertiary)" strokeDasharray="4 4" />
            <XAxis
              dataKey="store"
              tick={{ fontSize: 12, fill: "var(--color-text-tertiary)" }}
              tickFormatter={truncate}
              axisLine={false}
              tickLine={false}
              angle={chartData.length > 4 ? -35 : 0}
              textAnchor={chartData.length > 4 ? "end" : "middle"}
              interval={0}
            />
            <YAxis
              tick={{ fontSize: 12, fill: "var(--color-text-tertiary)" }}
              axisLine={false}
              tickLine={false}
              width={44}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "var(--color-background-secondary)", opacity: 0.5 }} />
            {skuList.map((sku, i) => {
              const isLast = i === skuList.length - 1;
              return (
                <Bar
                  key={sku}
                  dataKey={sku}
                  stackId="a"
                  fill={skuColor(sku, skuList)}
                  fillOpacity={0.9}
                  radius={isLast ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                  maxBarSize={60}
                  isAnimationActive={false}
                >
                  {isLast && <LabelList dataKey="_total" content={TopLabel} />}
                </Bar>
              );
            })}
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}