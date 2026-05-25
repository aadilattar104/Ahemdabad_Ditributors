// DistributorMoMChart — grouped bar chart showing revenue + qty per distributor per month.
// One group per month, one bar per distributor, side by side.
// Data labels on top of each bar. Full revenue + qty visible on hover.
// Reacts to all dashboard filters passed via props.
//
// Props:
//   data    — [{ month, year, distributor_name, revenue, qty }]
//   loading — boolean

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LabelList, Legend,
} from "recharts";

const DIST_COLORS = ["#378ADD", "#1D9E75", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899"];

function fmtRev(val) {
  if (val >= 100000) return `₹${(val / 100000).toFixed(1)}L`;
  if (val >= 1000)   return `₹${(val / 1000).toFixed(0)}k`;
  return `₹${val}`;
}

function fmtQty(val) {
  if (val >= 1000) return `${(val / 1000).toFixed(1)}k`;
  return `${val}`;
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "var(--color-background-primary)",
      border: "0.5px solid var(--color-border-secondary)",
      borderRadius: "var(--border-radius-md)",
      padding: "10px 14px",
      fontSize: 13,
      minWidth: 180,
    }}>
      <p style={{ margin: "0 0 8px", fontWeight: 600, color: "var(--color-text-primary)" }}>{label}</p>
      {payload.map((p) => {
        // each bar dataKey is like "SYNERGY__rev" or "SYNERGY__qty"
        const [distName, metric] = p.dataKey.split("__");
        if (metric !== "rev") return null; // show once per distributor
        const qtyKey = `${distName}__qty`;
        const qty = p.payload[qtyKey] ?? 0;
        return (
          <div key={distName} style={{ marginBottom: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: p.fill, display: "inline-block", flexShrink: 0 }} />
              <span style={{ fontWeight: 500, color: "var(--color-text-primary)" }}>{distName}</span>
            </div>
            <div style={{ paddingLeft: 14, color: "var(--color-text-secondary)", display: "flex", flexDirection: "column", gap: 1 }}>
              <span>Revenue: <strong style={{ color: "var(--color-text-primary)" }}>{fmtRev(p.value)}</strong></span>
              <span>Qty sold: <strong style={{ color: "var(--color-text-primary)" }}>{qty.toLocaleString()} units</strong></span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DataLabel({ x, y, width, value }) {
  if (!value) return null;
  return (
    <text
      x={x + width / 2}
      y={y - 4}
      textAnchor="middle"
      fontSize={11}
      fontWeight={600}
      fill="var(--color-text-secondary)"
    >
      {fmtRev(value)}
    </text>
  );
}

export default function DistributorMoMChart({ data = [], loading = false }) {
  if (loading) {
    return (
      <div style={cardStyle}>
        <div style={{ height: 14, width: 200, background: "var(--color-border-tertiary)", borderRadius: 4, marginBottom: 16 }} />
        <div style={{ height: 280, background: "var(--color-background-secondary)", borderRadius: 8 }} />
      </div>
    );
  }

  if (!data.length) {
    return (
      <div style={cardStyle}>
        <p style={{ margin: "0 0 1rem", fontWeight: 600, fontSize: 16 }}>Month-on-Month by Distributor</p>
        <p style={{ textAlign: "center", color: "var(--color-text-tertiary)", padding: "2rem 0", margin: 0 }}>No data</p>
      </div>
    );
  }

  // Get unique distributors + unique month-year keys (sorted chronologically)
  const MONTH_ORDER = ["January","February","March","April","May","June",
    "July","August","September","October","November","December"];

  const distributors = [...new Set(data.map(r => r.distributor_name))].sort();

  // Build pivot: { monthLabel → { dist__rev, dist__qty, ... } }
  const pivotMap = {};
  data.forEach(r => {
    const label = `${r.month?.slice(0, 3)} ${String(r.year).slice(2)}`;
    const sortKey = (r.year ?? 0) * 100 + (MONTH_ORDER.indexOf(r.month) + 1);
    if (!pivotMap[label]) pivotMap[label] = { label, _sort: sortKey };
    pivotMap[label][`${r.distributor_name}__rev`] = (pivotMap[label][`${r.distributor_name}__rev`] || 0) + r.revenue;
    pivotMap[label][`${r.distributor_name}__qty`] = (pivotMap[label][`${r.distributor_name}__qty`] || 0) + r.qty;
  });

  const chartData = Object.values(pivotMap).sort((a, b) => a._sort - b._sort);

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem", flexWrap: "wrap", gap: 8 }}>
        <p style={{ margin: 0, fontWeight: 600, fontSize: 16 }}>Month-on-Month by Distributor</p>
        {/* Legend */}
        <div style={{ display: "flex", gap: 14 }}>
          {distributors.map((d, i) => (
            <span key={d} style={{ fontSize: 13, color: "var(--color-text-secondary)", display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: DIST_COLORS[i % DIST_COLORS.length], display: "inline-block" }} />
              {d}
            </span>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={320}>
        <BarChart data={chartData} margin={{ top: 24, right: 12, left: 0, bottom: 8 }} barCategoryGap="25%" barGap={4}>
          <CartesianGrid vertical={false} stroke="var(--color-border-tertiary)" strokeDasharray="4 4" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 12, fill: "var(--color-text-tertiary)" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 12, fill: "var(--color-text-tertiary)" }}
            axisLine={false}
            tickLine={false}
            width={52}
            tickFormatter={fmtRev}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "var(--color-background-secondary)" }} />
          {distributors.map((dist, i) => (
            <Bar
              key={dist}
              dataKey={`${dist}__rev`}
              name={dist}
              fill={DIST_COLORS[i % DIST_COLORS.length]}
              fillOpacity={0.9}
              radius={[4, 4, 0, 0]}
              barSize={28}
            >
              <LabelList dataKey={`${dist}__rev`} content={<DataLabel />} />
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const cardStyle = {
  border: "0.5px solid var(--color-border-tertiary)",
  borderRadius: "var(--border-radius-lg)",
  padding: "1.5rem 2rem",
};