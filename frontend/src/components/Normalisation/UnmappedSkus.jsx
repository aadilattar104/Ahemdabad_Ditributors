// UnmappedSkus.jsx
// Shows raw SKUs not yet mapped to any canonical.
// Each chip shows the raw SKU name + source distributor/chain tags.
// Clicking the arrow icon pre-fills the mapping form on a chosen canonical.
// Props:
//   unmapped    — [{ raw_sku, sources: string[] }]
//   canonicals  — [{ id, category, family, name }]
//   tab         — "DISTRIBUTOR" | "MT"
//   saving      — boolean
//   onMap       — ({ canonicalId, rawSku, sourceName }) => void

import { useState } from "react";

export default function UnmappedSkus({ unmapped = [], canonicals = [], tab, saving, onMap }) {
  const [selected, setSelected] = useState(null); // { raw_sku, source }
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

  const handleQuickMap = () => {
    if (!selected || !canonicalId) return;
    onMap({ canonicalId, rawSku: selected.raw_sku, sourceName: selected.source });
    setSelected(null); setCanonicalId("");
  };

  return (
    <div style={S.card}>
      {/* Header */}
      <div style={S.header}>
        <i className="ti ti-alert-triangle" style={{ fontSize: 15, color: "#F59E0B" }} />
        <span style={S.title}>Unmapped SKUs</span>
        <span style={S.count}>
          {unmapped.length} raw SKU{unmapped.length !== 1 ? "s" : ""} not yet assigned
        </span>
      </div>

      {/* Chips */}
      <div style={S.chipGrid}>
        {unmapped.map((u) =>
          u.sources.map((src) => {
            const isActive = selected?.raw_sku === u.raw_sku && selected?.source === src;
            return (
              <div
                key={`${u.raw_sku}||${src}`}
                style={{ ...S.chip, ...(isActive ? S.chipActive : {}) }}
              >
                {/* Source tag */}
                <span style={S.srcTag}>{src}</span>
                {/* Raw SKU name */}
                <span style={S.chipText}>{u.raw_sku}</span>
                {/* Quick-map arrow */}
                <button
                  title="Map this to a canonical SKU"
                  onClick={() => {
                    setSelected(isActive ? null : { raw_sku: u.raw_sku, source: src });
                    setCanonicalId("");
                  }}
                  style={S.mapBtn}
                >
                  <i className="ti ti-corner-up-left" style={{ fontSize: 12 }} />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Quick-map panel — shown when a chip is selected */}
      {selected && (
        <div style={S.mapPanel}>
          <p style={S.mapLabel}>
            Mapping: <strong style={{ color: "var(--color-text-info, #378ADD)" }}>{selected.raw_sku}</strong>
            <span style={S.srcTag2}>{selected.source}</span>
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
              onClick={handleQuickMap}
              disabled={saving || !canonicalId}
              style={S.btnPrimary}
            >
              {saving ? "Saving…" : "Map"}
            </button>
            <button
              onClick={() => { setSelected(null); setCanonicalId(""); }}
              style={S.btnGhost}
            >
              Cancel
            </button>
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
  header: { display: "flex", alignItems: "center", gap: 8, marginBottom: 12 },
  title: { fontWeight: 600, fontSize: 14, color: "var(--color-text-primary)" },
  count: { fontSize: 12, color: "var(--color-text-tertiary)" },
  chipGrid: { display: "flex", flexWrap: "wrap", gap: 6 },
  chip: {
    display: "inline-flex", alignItems: "center", gap: 5,
    padding: "4px 8px",
    background: "var(--color-background-secondary)",
    border: "0.5px solid var(--color-border-tertiary)",
    borderRadius: 20, cursor: "default",
  },
  chipActive: {
    border: "0.5px solid var(--color-text-info, #378ADD)",
    background: "rgba(55,138,221,0.07)",
  },
  srcTag: {
    fontSize: 10, padding: "1px 6px", borderRadius: 20, fontWeight: 600,
    background: "rgba(245,158,11,0.12)", color: "#F59E0B", flexShrink: 0,
  },
  srcTag2: {
    fontSize: 10, padding: "1px 6px", borderRadius: 20, fontWeight: 600,
    background: "rgba(245,158,11,0.12)", color: "#F59E0B",
    marginLeft: 8, display: "inline-block",
  },
  chipText: { fontSize: 12, color: "var(--color-text-secondary)", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  mapBtn: {
    background: "transparent", border: "none", cursor: "pointer",
    padding: "1px 3px", color: "var(--color-text-info, #378ADD)",
    display: "inline-flex", alignItems: "center",
  },
  mapPanel: {
    marginTop: 14, padding: "12px 14px",
    background: "var(--color-background-secondary)",
    border: "0.5px solid var(--color-border-tertiary)",
    borderRadius: "var(--border-radius-md)",
  },
  mapLabel: { margin: "0 0 10px", fontSize: 13, color: "var(--color-text-primary)", display: "flex", alignItems: "center" },
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