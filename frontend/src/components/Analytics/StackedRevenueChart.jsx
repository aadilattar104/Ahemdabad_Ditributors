// StackedRevenueChart.jsx
// Stacked bar chart — Revenue by SKU, X axis = month-year
// Props:
//   data      — [{ month, year, sku_name, total_revenue }]
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

function fmtRev(val) {
  if (val >= 100000) return `₹${(val / 100000).toFixed(1)}L`;
  if (val >= 1000)   return `₹${(val / 1000).toFixed(1)}k`;
  return `₹${val}`;
}

const MONTH_ORDER = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function monthLabel(month, year) {
  const idx = MONTH_ORDER.indexOf(month);
  return idx >= 0 ? `${MONTHS_SHORT[idx]} '${String(year).slice(2)}` : `${month} ${year}`;
}

// ── Tooltip ──────────────────────────────────────────────────────────────────
// FIX: filter out internal keys (_total, _sort, label) so only SKU rows appear
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
      <p style={{ margin: "0 0 6px", fontWeight: 500, color: "var(--color-text-primary)" }}>{label}</p>
      {skuRows.map((p) => (
        <p key={p.dataKey} style={{ margin: "2px 0", color: "var(--color-text-secondary)", display: "flex", justifyContent: "space-between", gap: 16 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: p.fill, display: "inline-block" }} />
            {shortSku(p.dataKey)}
          </span>
          <span>{fmtRev(p.value)}</span>
        </p>
      ))}
      <p style={{ margin: "6px 0 0", borderTop: "0.5px solid var(--color-border-tertiary)", paddingTop: 5, fontWeight: 500, color: "var(--color-text-primary)", display: "flex", justifyContent: "space-between" }}>
        <span>Total</span><span>{fmtRev(total)}</span>
      </p>
    </div>
  );
}

// FIX: defined at module level — stable reference, no re-render flicker
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
      {fmtRev(value)}
    </text>
  );
}

function Skeleton() {
  return <div style={{ height: 220, background: "var(--color-background-secondary)", borderRadius: 8 }} />;
}

export default function StackedRevenueChart({ data = [], skuList = [], isLoading = false }) {
  // Pivot: one row per month-year, columns = SKUs
  // FIX: _total stored separately — NOT as a Bar dataKey, only used by LabelList
  const pivotMap = {};
  data.forEach((r) => {
    const key = `${r.month} ${r.year}`;
    if (!pivotMap[key]) {
      pivotMap[key] = {
        label: monthLabel(r.month, r.year),
        _sort: r.year * 100 + (MONTH_ORDER.indexOf(r.month) + 1),
        _total: 0,
      };
    }
    pivotMap[key][r.sku_name] = (pivotMap[key][r.sku_name] || 0) + (r.total_revenue || 0);
    pivotMap[key]._total = (pivotMap[key]._total || 0) + (r.total_revenue || 0);
  });
  const chartData = Object.values(pivotMap).sort((a, b) => a._sort - b._sort);

  return (
    <div style={{
      padding: "1.25rem 1.5rem",
      background: "var(--color-background-primary)",
      border: "0.5px solid var(--color-border-tertiary)",
      borderRadius: "var(--border-radius-lg)",
    }}>
      <p style={{ margin: "0 0 4px", fontWeight: 600, fontSize: 16, color: "var(--color-text-primary)" }}>
        Revenue by SKU
      </p>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--color-text-tertiary)" }}>
        Monthly revenue breakdown per SKU
      </p>

      {/* SKU legend — shortSku strips the SVASTHYAA prefix */}
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
          No data for selected filters
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartData} margin={{ top: 28, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--color-border-tertiary)" strokeDasharray="4 4" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 12, fill: "var(--color-text-tertiary)" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 12, fill: "var(--color-text-tertiary)" }}
              tickFormatter={fmtRev}
              axisLine={false}
              tickLine={false}
              width={52}
            />
            {/* FIX: isAnimationActive=false stops the flicker on LabelList */}
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
                  maxBarSize={40}
                  isAnimationActive={false}
                >
                  {/* FIX: LabelList only on last bar, uses stable TopLabel ref */}
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