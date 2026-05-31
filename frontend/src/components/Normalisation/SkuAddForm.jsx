// SkuAddForm.jsx
// Form to add a new canonical SKU.
// Supports selecting an existing category OR typing a new one.
// Props:
//   existingCategories — string[]  all categories already in DB
//   onSave  — ({ category, family, name }) => void
//   onCancel— () => void
//   saving  — boolean

import { useState } from "react";

export default function SkuAddForm({ existingCategories = [], onSave, onCancel, saving }) {
  const PRESET = ["Namkeen", "Khakhara"];
  // Merge preset + existing DB categories, deduped
  const allCategories = [...new Set([...PRESET, ...existingCategories])].sort();

  const [category, setCategory]     = useState(allCategories[0] || "Namkeen");
  const [customCat, setCustomCat]   = useState("");
  const [isNewCat, setIsNewCat]     = useState(false);
  const [family, setFamily]         = useState("");
  const [name, setName]             = useState("");

  const finalCategory = isNewCat ? customCat.trim() : category;

  const handleSave = () => {
    if (!finalCategory || !family.trim() || !name.trim()) return;
    onSave({ category: finalCategory, family: family.trim(), name: name.trim() });
  };

  return (
    <div style={S.card}>
      <p style={S.title}>Add Canonical SKU</p>
      <div style={S.row}>
        {/* Category */}
        <div style={S.group}>
          <label style={S.label}>Category</label>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {isNewCat ? (
              <input
                autoFocus
                value={customCat}
                onChange={(e) => setCustomCat(e.target.value)}
                placeholder="New category name"
                style={S.input}
              />
            ) : (
              <select value={category} onChange={(e) => setCategory(e.target.value)} style={S.select}>
                {allCategories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            <button
              onClick={() => { setIsNewCat(!isNewCat); setCustomCat(""); }}
              style={S.toggleBtn}
              title={isNewCat ? "Pick existing" : "Add new category"}
            >
              <i className={`ti ti-${isNewCat ? "list" : "plus"}`} style={{ fontSize: 13 }} />
              {isNewCat ? "Pick existing" : "New category"}
            </button>
          </div>
        </div>

        {/* Family */}
        <div style={S.group}>
          <label style={S.label}>Family <span style={S.hint}>(e.g. "Chana Jor")</span></label>
          <input
            value={family}
            onChange={(e) => setFamily(e.target.value)}
            placeholder="Chana Jor"
            style={S.input}
          />
        </div>

        {/* Canonical name */}
        <div style={S.group}>
          <label style={S.label}>Canonical name <span style={S.hint}>(e.g. "Chana Jor 72g")</span></label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") onCancel(); }}
            placeholder="Chana Jor 72g"
            style={S.input}
          />
        </div>

        {/* Actions */}
        <div style={S.actions}>
          <button
            onClick={handleSave}
            disabled={saving || !finalCategory || !family.trim() || !name.trim()}
            style={S.btnPrimary}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button onClick={onCancel} style={S.btnGhost}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

const S = {
  card: {
    background: "var(--color-background-primary)",
    border: "0.5px solid var(--color-border-tertiary)",
    borderRadius: "var(--border-radius-lg)",
    padding: "14px 16px", marginBottom: 16,
  },
  title: { margin: "0 0 12px", fontWeight: 600, fontSize: 14, color: "var(--color-text-primary)" },
  row:   { display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" },
  group: { display: "flex", flexDirection: "column", gap: 4 },
  label: { fontSize: 11, fontWeight: 500, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.04em" },
  hint:  { fontWeight: 400, textTransform: "none", fontSize: 10, letterSpacing: 0 },
  input: {
    fontSize: 13, padding: "5px 8px", borderRadius: "var(--border-radius-md)",
    border: "0.5px solid var(--color-border-secondary)",
    background: "var(--color-background-primary)",
    color: "var(--color-text-primary)", outline: "none", minWidth: 160,
  },
  select: {
    fontSize: 13, padding: "5px 8px", borderRadius: "var(--border-radius-md)",
    border: "0.5px solid var(--color-border-secondary)",
    background: "var(--color-background-primary)",
    color: "var(--color-text-primary)",
  },
  toggleBtn: {
    fontSize: 12, padding: "4px 8px", borderRadius: "var(--border-radius-md)",
    background: "transparent", border: "0.5px solid var(--color-border-secondary)",
    color: "var(--color-text-secondary)", cursor: "pointer",
    display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap",
  },
  actions: { display: "flex", gap: 6, alignItems: "center" },
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
};