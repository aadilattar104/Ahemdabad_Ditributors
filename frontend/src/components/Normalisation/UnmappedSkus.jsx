// UnmappedSkus.jsx
// Shows raw SKUs not yet mapped to any canonical.
// Each chip shows source distributor tag + raw SKU name.
// Multiple chips can be selected at once → pick one canonical → map all in one shot.
// Props:
//   unmapped    — [{ raw_sku, sources: string[] }]
//   canonicals  — [{ id, category, family, name }]
//   tab         — "DISTRIBUTOR" | "MT"
//   saving      — boolean
//   onMap       — ({ canonicalId, rawSku, sourceName }) => void  (called once per selection)

import { useState } from "react";

export default function UnmappedSkus({ unmapped = [], canonicals = [], tab, saving, onMap }) {
  // selected: Set of "raw_sku||source" keys
  const [selected, setSelected]     = useState(new Set());
  const [canonicalId, setCanonicalId] = useState("");

  if (unmapped.length === 0) {
    return (
      <div style={S.allMapped}>
        <i className="ti ti-circle-check" style={{ fontSize: 15, color: "#10B981" }} />
        <span style={{ fontSize: 13, color: "#10B981", fontWeight: 500 }}>
          All SKUs are mapped to a canonical name.
        </span>
      </div>
    );
  }

  const toggleChip = (raw_sku, src) => {
    const key = `${raw_sku}||${src}`;
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const selectAll = () => {
    const all = new Set();
    unmapped.forEach((u) => u.sources.forEach((src) => all.add(`${u.raw_sku}||${src}`)));
    setSelected(all);
  };

  const clearSelection = () => { setSelected(new Set()); setCanonicalId(""); };

  const handleMapAll = async () => {
    if (!canonicalId || selected.size === 0) return;
    for (const key of selected) {
      const [rawSku, sourceName] = key.split("||");
      await onMap({ canonicalId, rawSku, sourceName });
    }
    setSelected(new Set());
    setCanonicalId("");
  };

  const selectedCount = selected.size;

  return (
    <div style={S.card}>
      {/* Header */}
      <div style={S.header}>
        <i className="ti ti-alert-triangle" style={{ fontSize: 15, color: "#F59E0B" }} />
        <span style={S.title}>Unmapped SKUs</span>
        <span style={S.count}>
          {unmapped.length} raw SKU{unmapped.length !== 1 ? "s" : ""} not yet assigned
        </span>
        {/* Select all / clear */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={selectAll} style={S.btnGhost}>Select all</button>
          {selectedCount > 0 && (
            <button onClick={clearSelection} style={S.btnGhost}>Clear</button>
          )}
        </div>
      </div>

      {/* Chips — multi-select */}
      <div style={S.chipGrid}>
        {unmapped.map((u) =>
          u.sources.map((src) => {
            const key      = `${u.raw_sku}||${src}`;
            const isActive = selected.has(key);
            return (
              <div
                key={key}
                onClick={() => toggleChip(u.raw_sku, src)}
                title="Click to select"
                style={{ ...S.chip, ...(isActive ? S.chipActive : {}) }}
              >
                {isActive && (
                  <i className="ti ti-check" style={{ fontSize: 11, color: "var(--color-text-info, #378ADD)", flexShrink: 0 }} />
                )}
                <span style={S.srcTag}>{src}</span>
                <span style={S.chipText}>{u.raw_sku}</span>
              </div>
            );
          })
        )}
      </div>

      {/* Bulk-map panel — shown when ≥1 chip selected */}
      {selectedCount > 0 && (
        <div style={S.mapPanel}>
          <p style={S.mapLabel}>
            Map <strong style={{ color: "var(--color-text-info, #378ADD)" }}>{selectedCount} SKU{selectedCount !== 1 ? "s" : ""}</strong> to:
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select
              value={canonicalId}
              onChange={(e) => setCanonicalId(e.target.value)}
              style={S.select}
            >
              <option value="">Select canonical SKU…</option>
              {canonicals.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.category} › {c.family} › {c.name}
                </option>
              ))}
            </select>
            <button
              onClick={handleMapAll}
              disabled={saving || !canonicalId}
              style={S.btnPrimary}
            >
              {saving ? "Saving…" : `Map ${selectedCount} SKU${selectedCount !== 1 ? "s" : ""}`}
            </button>
            <button onClick={clearSelection} style={S.btnGhost}>Cancel</button>
          </div>

          {/* Preview of selected */}
          <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 4 }}>
            {[...selected].map((key) => {
              const [rawSku, src] = key.split("||");
              return (
                <div key={key} style={S.previewChip}>
                  <span style={S.srcTag}>{src}</span>
                  <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{rawSku}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleChip(rawSku, src); }}
                    style={S.removeBtn}
                    title="Remove from selection"
                  >
                    <i className="ti ti-x" style={{ fontSize: 10 }} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const S = {
  card: {
    background: "var(--color-background-primary)",
    border: "0.5px solid var(--color-border-tertiary)",
    borderRadius: "var(--border-radius-lg)",
    padding: "14px 16px", marginTop: 20,
  },
  header: { display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" },
  title:  { fontWeight: 600, fontSize: 14, color: "var(--color-text-primary)" },
  count:  { fontSize: 12, color: "var(--color-text-tertiary)" },
  chipGrid: { display: "flex", flexWrap: "wrap", gap: 6 },
  chip: {
    display: "inline-flex", alignItems: "center", gap: 5,
    padding: "4px 10px",
    background: "var(--color-background-secondary)",
    border: "0.5px solid var(--color-border-tertiary)",
    borderRadius: 20, cursor: "pointer",
    transition: "border-color 0.1s, background 0.1s",
  },
  chipActive: {
    border: "0.5px solid var(--color-text-info, #378ADD)",
    background: "rgba(55,138,221,0.08)",
  },
  srcTag: {
    fontSize: 10, padding: "1px 6px", borderRadius: 20, fontWeight: 600,
    background: "rgba(245,158,11,0.12)", color: "#F59E0B", flexShrink: 0,
  },
  chipText: {
    fontSize: 12, color: "var(--color-text-secondary)",
    maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  mapPanel: {
    marginTop: 14, padding: "12px 14px",
    background: "var(--color-background-secondary)",
    border: "0.5px solid var(--color-border-tertiary)",
    borderRadius: "var(--border-radius-md)",
  },
  mapLabel: { margin: "0 0 10px", fontSize: 13, color: "var(--color-text-primary)" },
  previewChip: {
    display: "inline-flex", alignItems: "center", gap: 4,
    padding: "2px 6px",
    background: "var(--color-background-primary)",
    border: "0.5px solid var(--color-border-secondary)",
    borderRadius: 20,
  },
  removeBtn: {
    background: "transparent", border: "none", cursor: "pointer",
    padding: "1px 2px", color: "var(--color-text-danger)",
    display: "inline-flex", alignItems: "center",
  },
  select: {
    fontSize: 13, padding: "5px 8px", borderRadius: "var(--border-radius-md)",
    border: "0.5px solid var(--color-border-secondary)",
    background: "var(--color-background-primary)",
    color: "var(--color-text-primary)", minWidth: 240,
  },
  btnPrimary: {
    fontSize: 12, padding: "6px 14px", borderRadius: "var(--border-radius-md)",
    border: "none", cursor: "pointer",
    background: "var(--color-text-info, #378ADD)", color: "#fff",
  },
  btnGhost: {
    fontSize: 12, padding: "5px 12px", borderRadius: "var(--border-radius-md)",
    background: "transparent", cursor: "pointer",
    border: "0.5px solid var(--color-border-secondary)", color: "var(--color-text-secondary)",
  },
  allMapped: {
    marginTop: 20, padding: "12px 16px",
    background: "rgba(16,185,129,0.08)",
    border: "0.5px solid rgba(16,185,129,0.3)",
    borderRadius: "var(--border-radius-md)",
    display: "flex", alignItems: "center", gap: 8,
  },
};