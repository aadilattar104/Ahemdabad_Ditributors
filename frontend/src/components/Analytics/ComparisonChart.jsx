// ComparisonChart shows a grouped bar chart comparing distributors by revenue for a given month.
// Uses recharts. Props:
//   data    — [{ month, year, ...distributorName: revenue }]
//   distributors — string[] list of distributor names to compare
//   loading — boolean

import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from "recharts";

const COLORS = ["#378ADD", "#1D9E75", "#D85A30", "#D4537E", "#BA7517", "#7F77DD"];

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload || !payload.length) return null;
  const total = payload.reduce((sum, p) => sum + (p.value || 0), 0);
  return (
    <div style={{
      background: "var(--color-background-primary)",
      border: "0.5px solid var(--color-border-secondary)",
      borderRadius: "var(--border-radius-md)",
      fontSize: 13,
      padding: "0.5rem 0.75rem",
      maxWidth: 320,
    }}>
      <p style={{ margin: "0 0 0.5rem", fontWeight: 600, wordBreak: "break-word" }}>{label}</p>
      {payload.map((p) => (
        <div key={p.name} style={{ display: "flex", justifyContent: "space-between", gap: 24 }}>
          <span style={{ color: p.fill }}>● {p.name}</span>
          <span>₹{Number(p.value).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
        </div>
      ))}
      <div style={{
        borderTop: "0.5px solid var(--color-border-tertiary)",
        marginTop: 6,
        paddingTop: 6,
        display: "flex",
        justifyContent: "space-between",
      }}>
        <span style={{ fontWeight: 500 }}>Total</span>
        <span style={{ fontWeight: 500 }}>₹{total.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
      </div>
    </div>
  );
};

export default function ComparisonChart({ data = [], distributors = [], loading = false }) {
  if (loading) {
    return (
      <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "1.25rem 1.5rem", height: 220 }}>
        <div style={{ height: 14, width: 200, background: "var(--color-border-tertiary)", borderRadius: 4, marginBottom: 16 }} />
        <div style={{ height: 140, background: "var(--color-background-secondary)", borderRadius: 8 }} />
      </div>
    );
  }

  return (
    <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "1.25rem 1.5rem" }}>
      <p style={{ margin: "0 0 1rem", fontWeight: 500, fontSize: 14 }}>Distributor comparison</p>
      {data.length === 0 || distributors.length === 0 ? (
        <p style={{ textAlign: "center", color: "var(--color-text-tertiary)", padding: "2rem 0", margin: 0 }}>No data</p>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
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
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {distributors.map((dist, i) => (
              <Bar key={dist} dataKey={dist} fill={COLORS[i % COLORS.length]} radius={[3, 3, 0, 0]} barSize={16} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}