// SkuTree.jsx
// Renders the full Category → Family → Canonical SKU tree.
// Props:
//   canonicals  — full list from API (each has .mappings[])
//   catFilter   — "" | "Namkeen" | "Khakhara" | custom
//   tab         — "DISTRIBUTOR" | "MT"
//   saving      — boolean
//   onEditSave  — (id, field, value) => void
//   onDelete    — (id, name) => void
//   onAddMapping— (canonicalId, rawSku, sourceName) => void
//   onDelMapping— (mappingId) => void

import { useState } from "react";
import SkuCanonicalRow from "./SkuCanonicalRow";

const CAT_STYLE = {
  Namkeen:  { bg: "rgba(16,185,129,0.1)",  color: "#10B981" },
  Khakhara: { bg: "rgba(245,158,11,0.1)",  color: "#F59E0B" },
};

function CategoryBadge({ category }) {
  const s = CAT_STYLE[category] || { bg: "rgba(100,116,139,0.1)", color: "#64748B" };
  return (
    <span style={{
      fontSize: 11, padding: "2px 8px", borderRadius: 20,
      fontWeight: 500, background: s.bg, color: s.color,
    }}>
      {category}
    </span>
  );
}

export default function SkuTree({
  canonicals, catFilter, tab, saving,
  onEditSave, onDelete, onAddMapping, onDelMapping,
}) {
  const [collapsed, setCollapsed]         = useState({});
  const [editingFamily, setEditingFamily] = useState(null);
  const [familyDraft, setFamilyDraft]     = useState("");

  const toggle = (key) => {
    if (editingFamily === key) return;
    setCollapsed((p) => ({ ...p, [key]: !p[key] }));
  };

  const startRenameFamily = (e, key, currentName) => {
    e.stopPropagation();
    setEditingFamily(key);
    setFamilyDraft(currentName);
  };

  const commitRenameFamily = (group) => {
    const trimmed = familyDraft.trim();
    if (trimmed && trimmed !== group.family) {
      group.items.forEach((c) => onEditSave(c.id, "family", trimmed));
    }
    setEditingFamily(null);
    setFamilyDraft("");
  };

  // Group into { "Category||Family": { category, family, items[] } }
  const groups = {};
  canonicals
    .filter((c) => !catFilter || c.category === catFilter)
    .forEach((c) => {
      const key = `${c.category}||${c.family}`;
      if (!groups[key]) groups[key] = { category: c.category, family: c.family, items: [] };
      groups[key].items.push(c);
    });

  if (Object.keys(groups).length === 0) {
    return (
      <div style={S.empty}>
        No canonical SKUs yet{catFilter ? ` in "${catFilter}"` : ""}. Add one above.
      </div>
    );
  }

  return (
    <>
      {Object.entries(groups).map(([key, group]) => {
        const isCollapsed = collapsed[key];
        return (
          <div key={key} style={S.familyCard}>
            {/* Family header */}
            <div
              style={S.familyHeader}
              onClick={() => toggle(key)}
            >
              <i
                className={`ti ti-chevron-${isCollapsed ? "right" : "down"}`}
                style={S.chevron}
              />
              <CategoryBadge category={group.category} />

              {editingFamily === key ? (
                <input
                  autoFocus
                  value={familyDraft}
                  onChange={(e) => setFamilyDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter")  commitRenameFamily(group);
                    if (e.key === "Escape") { setEditingFamily(null); setFamilyDraft(""); }
                  }}
                  onBlur={() => commitRenameFamily(group)}
                  onClick={(e) => e.stopPropagation()}
                  style={S.familyInput}
                />
              ) : (
                <span style={S.familyName}>{group.family}</span>
              )}

              <span style={S.variantCount}>
                {group.items.length} size variant{group.items.length !== 1 ? "s" : ""}
              </span>

              {/* Rename family button */}
              {editingFamily !== key && (
                <button
                  onClick={(e) => startRenameFamily(e, key, group.family)}
                  style={S.iconBtn}
                  title="Rename family"
                  disabled={saving}
                >
                  <i className="ti ti-pencil" style={{ fontSize: 12 }} />
                </button>
              )}
            </div>

            {/* Canonical SKU rows */}
            {!isCollapsed && (
              <div style={S.variantList}>
                {group.items.map((canonical) => (
                  <SkuCanonicalRow
                    key={canonical.id}
                    canonical={canonical}
                    tab={tab}
                    saving={saving}
                    onEditSave={onEditSave}
                    onDelete={onDelete}
                    onAddMapping={onAddMapping}
                    onDelMapping={onDelMapping}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

const S = {
  familyCard: {
    background: "var(--color-background-primary)",
    border: "0.5px solid var(--color-border-tertiary)",
    borderRadius: "var(--border-radius-lg)",
    padding: "12px 14px", marginBottom: 12,
  },
  familyHeader: {
    display: "flex", alignItems: "center", gap: 10,
    cursor: "pointer", userSelect: "none",
  },
  chevron: { fontSize: 13, color: "var(--color-text-tertiary)" },
  familyName:   { fontWeight: 600, fontSize: 14, color: "var(--color-text-primary)", flex: 1 },
  variantCount: { fontSize: 12, color: "var(--color-text-tertiary)" },
  variantList:  { marginTop: 12 },
  familyInput: {
    fontSize: 14, fontWeight: 600, padding: "2px 8px",
    borderRadius: "var(--border-radius-md)",
    border: "0.5px solid var(--color-border-secondary)",
    background: "var(--color-background-primary)",
    color: "var(--color-text-primary)", outline: "none",
    flex: 1, minWidth: 120,
  },
  iconBtn: {
    background: "transparent", border: "none", cursor: "pointer",
    padding: "2px 4px", borderRadius: "var(--border-radius-sm)",
    color: "var(--color-text-secondary)", display: "inline-flex", alignItems: "center",
  },
  empty: {
    background: "var(--color-background-primary)",
    border: "0.5px solid var(--color-border-tertiary)",
    borderRadius: "var(--border-radius-lg)",
    padding: "2rem", textAlign: "center",
    fontSize: 13, color: "var(--color-text-tertiary)",
  },
};