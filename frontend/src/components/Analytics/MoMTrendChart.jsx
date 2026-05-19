// MoMTrendChart shows month-on-month revenue trend.
// Data is always aggregated to one point per month (all distributors combined).
// Props:
//   data    — [{ month, year, revenue, qty }] ordered by date
//   loading — boolean

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function monthLabel(month, year) {
  const idx = MONTHS_SHORT.findIndex((m) => month?.toLowerCase().startsWith(m.toLowerCase()));
  return idx >= 0 ? `${MONTHS_SHORT[idx]} ${String(year).slice(2)}` : `${month} ${year}`;
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{
      background: "var(--color-background-primary)",
      border: "0.5px solid var(--color-border-secondary)",
      borderRadius: "var(--border-radius-md)",
      padding: "8px 12px",
      fontSize: 13,
    }}>
      <p style={{ margin: "0 0 4px", fontWeight: 500 }}>{label}</p>
      <p style={{ margin: "0 0 2px", color: "var(--color-text-secondary)" }}>
        ₹{Number(d.revenue).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
      </p>
      <p style={{ margin: 0, color: "var(--color-text-tertiary)", fontSize: 12 }}>
        {Number(d.qty).toLocaleString()} units
      </p>
    </div>
  );
}

export default function MoMTrendChart({ data = [], loading = false }) {
  // Collapse to one point per (year, month) on the frontend too as a safety net
  const collapsed = {};
  for (const d of data) {
    const key = `${d.year}-${d.month}`;
    if (!collapsed[key]) {
      collapsed[key] = { ...d, revenue: 0, qty: 0 };
    }
    collapsed[key].revenue += d.revenue;
    collapsed[key].qty     += d.qty;
  }

  const chartData = Object.values(collapsed)
    .sort((a, b) => {
      if (a.year !== b.year) return (a.year || 0) - (b.year || 0);
      const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
      return MONTHS.indexOf(a.month) - MONTHS.indexOf(b.month);
    })
    .map((d) => ({
      ...d,
      revenue: Math.round(d.revenue * 100) / 100,
      label: monthLabel(d.month, d.year),
    }));

  if (loading) {
    return (
      <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "1.25rem 1.5rem", height: 220 }}>
        <div style={{ height: 14, width: 180, background: "var(--color-border-tertiary)", borderRadius: 4, marginBottom: 16 }} />
        <div style={{ height: 140, background: "var(--color-background-secondary)", borderRadius: 8 }} />
      </div>
    );
  }

  return (
    <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "1.25rem 1.5rem" }}>
      <p style={{ margin: "0 0 1rem", fontWeight: 500, fontSize: 14 }}>Month-on-month revenue</p>
      {chartData.length === 0 ? (
        <p style={{ textAlign: "center", color: "var(--color-text-tertiary)", padding: "2rem 0", margin: 0 }}>No data</p>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--color-border-tertiary)" strokeDasharray="4 4" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "var(--color-text-tertiary)" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "var(--color-text-tertiary)" }}
              tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
              axisLine={false}
              tickLine={false}
              width={48}
            />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="monotone"
              dataKey="revenue"
              stroke="#378ADD"
              strokeWidth={2}
              dot={{ r: 3, fill: "#378ADD", strokeWidth: 0 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}