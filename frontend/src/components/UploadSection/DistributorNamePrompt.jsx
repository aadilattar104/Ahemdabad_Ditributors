import { useState } from "react";

// Shown when the distributor name cannot be auto-detected from the filename.
// Calls onConfirm(distributorName) when the user submits.
export default function DistributorNamePrompt({ filename, onConfirm }) {
  const [value, setValue] = useState("");

  const handleSubmit = () => {
    const name = value.trim().toUpperCase();
    if (!name) return;
    onConfirm(name);
  };

  return (
    <div
      role="alert"
      style={{
        background: "var(--color-background-warning)",
        border: "0.5px solid var(--color-border-warning)",
        borderRadius: "var(--border-radius-lg)",
        padding: "1.25rem 1.5rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <i
          className="ti ti-alert-triangle"
          style={{ fontSize: 16, color: "var(--color-text-warning)" }}
          aria-hidden
        />
        <p style={{ margin: 0, fontWeight: 500, fontSize: 14, color: "var(--color-text-warning)" }}>
          Could not detect distributor name from filename
        </p>
      </div>

      <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--color-text-secondary)" }}>
        File: <strong>{filename}</strong>
      </p>

      <div style={{ display: "flex", gap: 8 }}>
        <input
          autoFocus
          type="text"
          placeholder="Enter distributor name…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          style={{ flex: 1 }}
        />
        <button onClick={handleSubmit}>Confirm &amp; extract</button>
      </div>
    </div>
  );
}