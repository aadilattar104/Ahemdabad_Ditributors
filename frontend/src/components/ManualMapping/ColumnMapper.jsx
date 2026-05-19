// ColumnMapper lets the user tell the system which column in the file
// corresponds to each required field: shop_name, qty, revenue.
//
// Props:
//   columns  — string[] of column names detected in the file
//   mapping  — { shop_name?: string, qty?: string, revenue?: string }
//   onChange — (field, columnName) => void

const REQUIRED_FIELDS = [
  { key: "shop_name", label: "Shop name", description: "The column containing the name of each shop or party" },
  { key: "qty",       label: "Quantity",  description: "The column with units sold (integer)" },
  { key: "revenue",   label: "Revenue",   description: "Pre-GST product amount — NOT the bill amount with GST" },
];

export default function ColumnMapper({ columns, mapping, onChange }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-secondary)" }}>
        Map each required field to a column in the file. Revenue must be the pre-GST product amount only.
      </p>

      {REQUIRED_FIELDS.map(({ key, label, description }) => (
        <div key={key}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
            <label style={{ fontWeight: 500, fontSize: 14 }}>
              {label}
              <span style={{ color: "var(--color-text-danger)", marginLeft: 3 }}>*</span>
            </label>
            <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>{description}</span>
          </div>
          <select
            value={mapping[key] || ""}
            onChange={(e) => onChange(key, e.target.value)}
            style={{ width: "100%" }}
          >
            <option value="">— select a column —</option>
            {columns.map((col) => (
              <option key={col} value={col}>{col}</option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}