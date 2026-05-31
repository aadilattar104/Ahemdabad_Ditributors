// SkuCanonicalRow.jsx
// Single canonical SKU row — shows name, edit/delete buttons, mappings list,
// and an "Add mapping" inline form.
// Props:
//   canonical   — { id, name, category, family, mappings: [] }
//   tab         — "DISTRIBUTOR" | "MT"
//   saving      — boolean
//   onEditSave  — (id, field, value) => void
//   onDelete    — (id, name) => void
//   onAddMapping— (canonicalId, rawSku, sourceName) => void
//   onDelMapping— (mappingId) => void

import { useState } from "react";
import SkuMappingRow from "./SkuMappingRow";

function InlineEdit({ value, onSave, onCancel }) {
  const [val, setVal] = useState(value);
  return (
    <input
      autoFocus
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter")  onSave(val.trim());
        if (e.key === "Escape") onCancel();
      }}
      onBlur={() => onSave(val.trim())}
      style={S.inlineInput}
    />
  );
}

export default function SkuCanonicalRow({
  canonical, tab, saving,
  onEditSave, onDelete, onAddMapping, onDelMapping,
}) {
  const [editing, setEditing]       = useState(false);
  const [showAddMap, setShowAddMap] = useState(false);
  const [mapRaw, setMapRaw]         = useState("");
  const [mapSrc, setMapSrc]         = useState("");

  const handleAddMap = () => {
    if (!mapRaw.trim() || !mapSrc.trim()) return;
    onAddMapping(canonical.id, mapRaw.trim(), mapSrc.trim());
    setMapRaw(""); setMapSrc(""); setShowAddMap(false);
  };

  return (
    <div style={S.canonicalRow}>
      {/* Name row */}
      <div style={S.nameRow}>
        <i className="ti ti-tag" style={S.tagIcon} />
        {editing ? (
          <InlineEdit
            value={canonical.name}
            onSave={(v) => { onEditSave(canonical.id, "name", v); setEditing(false); }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <span style={S.name}>{canonical.name}</span>
        )}
        <button onClick={() => setEditing(true)} style={S.iconBtn} title="Edit name" disabled={saving}>
          <i className="ti ti-pencil" style={{ fontSize: 13 }} />
        </button>
        <button
          onClick={() => onDelete(canonical.id, canonical.name)}
          style={{ ...S.iconBtn, color: "var(--color-text-danger)" }}
          title="Delete" disabled={saving}
        >
          <i className="ti ti-trash" style={{ fontSize: 13 }} />
        </button>
      </div>

      {/* Mappings */}
      <div style={S.mappings}>
        {canonical.mappings.length === 0 ? (
          <p style={S.muted}>No raw SKUs mapped yet</p>
        ) : (
          canonical.mappings.map((m) => (
            <SkuMappingRow key={m.id} mapping={m} onDelete={onDelMapping} saving={saving} />
          ))
        )}

        {/* Add mapping form */}
        {showAddMap ? (
          <div style={S.addMapForm}>
            <input
              value={mapRaw}
              onChange={(e) => setMapRaw(e.target.value)}
              placeholder="Raw SKU name from file"
              style={{ ...S.input, flex: 1, minWidth: 180 }}
              autoFocus
            />
            <input
              value={mapSrc}
              onChange={(e) => setMapSrc(e.target.value)}
              placeholder={tab === "MT" ? "Chain (e.g. RELIANCE)" : "Distributor (e.g. SYNERGY)"}
              style={{ ...S.input, minWidth: 130 }}
            />
            <button
              onClick={handleAddMap}
              disabled={saving || !mapRaw.trim() || !mapSrc.trim()}
              style={S.btnPrimary}
            >
              {saving ? "…" : "Add"}
            </button>
            <button
              onClick={() => { setShowAddMap(false); setMapRaw(""); setMapSrc(""); }}
              style={S.btnGhost}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button onClick={() => setShowAddMap(true)} style={S.addMappingBtn}>
            <i className="ti ti-plus" style={{ fontSize: 12 }} /> Add mapping
          </button>
        )}
      </div>
    </div>
  );
}

const S = {
  canonicalRow: {
    padding: "10px 12px",
    background: "var(--color-background-secondary)",
    border: "0.5px solid var(--color-border-tertiary)",
    borderRadius: "var(--border-radius-md)",
    marginBottom: 8,
  },
  nameRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 },
  tagIcon: { fontSize: 13, color: "var(--color-text-tertiary)", flexShrink: 0 },
  name:    { fontWeight: 500, fontSize: 13, color: "var(--color-text-primary)", flex: 1 },
  mappings: { marginLeft: 22 },
  muted:   { fontSize: 12, color: "var(--color-text-tertiary)", margin: "0 0 6px" },
  addMapForm: {
    display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center",
  },
  addMappingBtn: {
    marginTop: 6, display: "inline-flex", alignItems: "center", gap: 4,
    fontSize: 12, padding: "4px 10px", borderRadius: "var(--border-radius-md)",
    background: "transparent", border: "0.5px solid var(--color-border-secondary)",
    color: "var(--color-text-secondary)", cursor: "pointer",
  },
  inlineInput: {
    fontSize: 13, padding: "3px 8px", borderRadius: "var(--border-radius-md)",
    border: "0.5px solid var(--color-border-secondary)",
    background: "var(--color-background-primary)",
    color: "var(--color-text-primary)", outline: "none", minWidth: 180, flex: 1,
  },
  input: {
    fontSize: 13, padding: "5px 8px", borderRadius: "var(--border-radius-md)",
    border: "0.5px solid var(--color-border-secondary)",
    background: "var(--color-background-primary)",
    color: "var(--color-text-primary)", outline: "none",
  },
  iconBtn: {
    background: "transparent", border: "none", cursor: "pointer",
    padding: "2px 4px", borderRadius: "var(--border-radius-sm)",
    color: "var(--color-text-secondary)", display: "inline-flex", alignItems: "center",
  },
  btnPrimary: {
    fontSize: 12, padding: "5px 12px", borderRadius: "var(--border-radius-md)",
    border: "none", cursor: "pointer",
    background: "var(--color-text-info, #378ADD)", color: "#fff",
  },
  btnGhost: {
    fontSize: 12, padding: "5px 10px", borderRadius: "var(--border-radius-md)",
    background: "transparent", cursor: "pointer",
    border: "0.5px solid var(--color-border-secondary)", color: "var(--color-text-secondary)",
  },
};