// SkuMappingRow.jsx
// Single raw → canonical mapping row with delete button.
// Props:
//   mapping  — { id, raw_sku, source_name, source_type }
//   onDelete — (mappingId) => void
//   saving   — boolean

export default function SkuMappingRow({ mapping, onDelete, saving }) {
  return (
    <div style={S.row}>
      <i className="ti ti-arrow-right" style={S.arrow} />
      <span style={S.rawSku}>{mapping.raw_sku}</span>
      <span style={S.sourceTag}>{mapping.source_name}</span>
      <button
        onClick={() => onDelete(mapping.id)}
        disabled={saving}
        title="Remove mapping"
        style={S.iconBtn}
      >
        <i className="ti ti-x" style={{ fontSize: 13 }} />
      </button>
    </div>
  );
}

const S = {
  row: {
    display: "flex", alignItems: "center", gap: 8,
    padding: "5px 0",
    borderBottom: "0.5px solid var(--color-border-tertiary)",
  },
  arrow: { fontSize: 11, color: "var(--color-text-tertiary)", flexShrink: 0 },
  rawSku: { fontSize: 12, color: "var(--color-text-primary)", flex: 1 },
  sourceTag: {
    fontSize: 10, padding: "1px 7px", borderRadius: 20, fontWeight: 500,
    background: "rgba(55,138,221,0.1)", color: "var(--color-text-info, #378ADD)",
    flexShrink: 0,
  },
  iconBtn: {
    background: "transparent", border: "none", cursor: "pointer",
    padding: "2px 4px", borderRadius: "var(--border-radius-sm)",
    color: "var(--color-text-danger)", display: "inline-flex", alignItems: "center",
  },
};