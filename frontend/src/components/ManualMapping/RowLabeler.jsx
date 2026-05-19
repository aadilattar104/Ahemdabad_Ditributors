// RowLabeler lets the user tag each row in the raw preview as:
//   "header" — column header row
//   "data"   — actual data rows
//   "skip"   — rows to ignore (totals, blank separators, company headers)
//
// Props:
//   rows       — array of raw row objects from the file (first N rows)
//   labels     — { [rowIndex]: "header"|"data"|"skip" }
//   onChange   — (rowIndex, label) => void

const LABEL_STYLES = {
  header: {
    background: "var(--color-background-info)",
    color: "var(--color-text-info)",
    border: "0.5px solid var(--color-border-info)",
  },
  data: {
    background: "var(--color-background-success)",
    color: "var(--color-text-success)",
    border: "0.5px solid var(--color-border-success)",
  },
  skip: {
    background: "var(--color-background-secondary)",
    color: "var(--color-text-tertiary)",
    border: "0.5px solid var(--color-border-tertiary)",
  },
};

export default function RowLabeler({ rows, labels, onChange }) {
  const allCols = rows.length > 0 ? Object.keys(rows[0]) : [];
  const previewCols = allCols.slice(0, 6);

  return (
    <div>
      <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--color-text-secondary)" }}>
        Click a label to tag each row. Mark the column header row, the data rows, and any rows to skip.
      </p>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "var(--color-background-secondary)" }}>
              <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 500, borderBottom: "0.5px solid var(--color-border-tertiary)", whiteSpace: "nowrap" }}>
                Row
              </th>
              <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 500, borderBottom: "0.5px solid var(--color-border-tertiary)", whiteSpace: "nowrap" }}>
                Label
              </th>
              {previewCols.map((col) => (
                <th key={col} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 500, borderBottom: "0.5px solid var(--color-border-tertiary)", whiteSpace: "nowrap", maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const label = labels[idx] || "skip";
              const style = LABEL_STYLES[label];
              return (
                <tr key={idx} style={{ borderBottom: "0.5px solid var(--color-border-tertiary)", opacity: label === "skip" ? 0.5 : 1 }}>
                  <td style={{ padding: "8px 10px", color: "var(--color-text-tertiary)" }}>{idx + 1}</td>
                  <td style={{ padding: "8px 10px" }}>
                    <div style={{ display: "flex", gap: 4 }}>
                      {["header", "data", "skip"].map((lbl) => (
                        <button
                          key={lbl}
                          onClick={() => onChange(idx, lbl)}
                          style={{
                            fontSize: 11, padding: "2px 8px",
                            borderRadius: "var(--border-radius-md)",
                            ...(label === lbl ? style : {}),
                          }}
                        >
                          {lbl}
                        </button>
                      ))}
                    </div>
                  </td>
                  {previewCols.map((col) => (
                    <td key={col} style={{ padding: "8px 10px", color: "var(--color-text-secondary)", maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {row[col] !== undefined && row[col] !== "" ? String(row[col]) : <span style={{ color: "var(--color-text-tertiary)" }}>—</span>}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}