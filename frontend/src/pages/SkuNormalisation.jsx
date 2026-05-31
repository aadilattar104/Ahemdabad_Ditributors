// SkuNormalisation.jsx  (src/pages/SkuNormalisation.jsx)
// Main page — two tabs: Distributor | Modern Trade
// Imports all sub-components from src/components/Normalisation/

import { useState, useEffect, useCallback } from "react";
import SkuAddForm    from "../components/Normalisation/SkuAddForm";
import SkuTree       from "../components/Normalisation/SkuTree";
import UnmappedSkus  from "../components/Normalisation/UnmappedSkus";
import {
  getSkuCanonical, getSkuUnmapped,
  createSkuCanonical, updateSkuCanonical, deleteSkuCanonical,
  createSkuMapping, deleteSkuMapping,
} from "../services/api";

export default function SkuNormalisation() {
  const [tab, setTab]             = useState("DISTRIBUTOR");
  const [catFilter, setCatFilter] = useState("");
  const [canonicals, setCanonicals]   = useState([]);
  const [unmapped,   setUnmapped]     = useState([]);
  const [loading,    setLoading]      = useState(true);
  const [error,      setError]        = useState("");
  const [saving,     setSaving]       = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  const existingCategories = [...new Set(canonicals.map((c) => c.category))].sort();

  const load = useCallback(() => {
    setLoading(true); setError("");
    Promise.all([getSkuCanonical(tab), getSkuUnmapped(tab)])
      .then(([c, u]) => { setCanonicals(c); setUnmapped(u.unmapped || []); })
      .catch((e) => setError(e.message || "Failed to load"))
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const handleAddCanonical = async ({ category, family, name }) => {
    setSaving(true); setError("");
    try   { await createSkuCanonical({ category, family, name }); setShowAddForm(false); load(); }
    catch (e) { setError(e.message || "Failed to create"); }
    finally   { setSaving(false); }
  };

  const handleEditSave = async (id, field, value) => {
    if (!value) return;
    setSaving(true);
    try   { await updateSkuCanonical(id, { [field]: value }); load(); }
    catch (e) { setError(e.message || "Failed to update"); }
    finally   { setSaving(false); }
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Delete "${name}" and all its mappings?`)) return;
    setSaving(true);
    try   { await deleteSkuCanonical(id); load(); }
    catch (e) { setError(e.message || "Failed to delete"); }
    finally   { setSaving(false); }
  };

  const handleAddMapping = async (canonicalId, rawSku, sourceName) => {
    setSaving(true); setError("");
    try   { await createSkuMapping({ raw_sku: rawSku, canonical_id: canonicalId, source_type: tab, source_name: sourceName.toUpperCase() }); load(); }
    catch (e) { setError(e.message || "Failed to add mapping"); }
    finally   { setSaving(false); }
  };

  const handleDelMapping = async (mappingId) => {
    setSaving(true);
    try   { await deleteSkuMapping(mappingId); load(); }
    catch (e) { setError(e.message || "Failed to delete mapping"); }
    finally   { setSaving(false); }
  };

  return (
    <div style={{ padding: "2rem 2.5rem", maxWidth: 920 }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <p style={{ margin: 0, fontWeight: 600, fontSize: 24, color: "var(--color-text-primary)" }}>SKU Normalisation</p>
        <p style={{ margin: "4px 0 0", fontSize: 14, color: "var(--color-text-secondary)" }}>
          Map raw distributor / MT SKU names to canonical product names. Dashboard filters use only canonical names.
        </p>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.25rem", flexWrap: "wrap", gap: 10 }}>
        <div style={S.tabBar}>
          {["DISTRIBUTOR", "MT"].map((t) => (
            <button key={t} onClick={() => { setTab(t); setCatFilter(""); }}
              style={{ ...S.tabBtn, ...(tab === t ? S.tabActive : {}), borderRight: t === "DISTRIBUTOR" ? "0.5px solid var(--color-border-tertiary)" : "none" }}>
              {t === "DISTRIBUTOR" ? "Distributor" : "Modern Trade"}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} style={S.select}>
            <option value="">All categories</option>
            {existingCategories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button onClick={() => setShowAddForm(true)} style={S.btnPrimary}>
            <i className="ti ti-plus" style={{ fontSize: 14 }} /> Add Canonical SKU
          </button>
        </div>
      </div>

      {error && (
        <div style={S.errorBox}>
          <i className="ti ti-circle-x" style={{ fontSize: 13, marginRight: 5 }} />{error}
        </div>
      )}

      {showAddForm && (
        <SkuAddForm
          existingCategories={existingCategories}
          onSave={handleAddCanonical}
          onCancel={() => setShowAddForm(false)}
          saving={saving}
        />
      )}

      {loading ? (
        <div style={S.loadingCard}>Loading…</div>
      ) : (
        <SkuTree
          canonicals={canonicals}
          catFilter={catFilter}
          tab={tab}
          saving={saving}
          onEditSave={handleEditSave}
          onDelete={handleDelete}
          onAddMapping={handleAddMapping}
          onDelMapping={handleDelMapping}
        />
      )}

      {!loading && (
        <UnmappedSkus
          unmapped={unmapped}
          canonicals={canonicals}
          tab={tab}
          saving={saving}
          onMap={({ canonicalId, rawSku, sourceName }) => handleAddMapping(canonicalId, rawSku, sourceName)}
        />
      )}
    </div>
  );
}

const S = {
  tabBar: { display: "flex", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-md)", overflow: "hidden" },
  tabBtn: { padding: "7px 18px", fontSize: 13, border: "none", cursor: "pointer", background: "var(--color-background-primary)", color: "var(--color-text-secondary)", fontWeight: 400 },
  tabActive: { background: "var(--color-background-secondary)", color: "var(--color-text-primary)", fontWeight: 500 },
  select: { fontSize: 13, padding: "5px 8px", borderRadius: "var(--border-radius-md)", border: "0.5px solid var(--color-border-secondary)", background: "var(--color-background-primary)", color: "var(--color-text-primary)" },
  btnPrimary: { fontSize: 13, padding: "6px 14px", borderRadius: "var(--border-radius-md)", border: "none", cursor: "pointer", background: "var(--color-text-info, #378ADD)", color: "#fff", display: "inline-flex", alignItems: "center", gap: 5 },
  errorBox: { marginBottom: 12, padding: "8px 12px", fontSize: 12, background: "var(--color-background-danger)", color: "var(--color-text-danger)", border: "0.5px solid var(--color-border-danger)", borderRadius: "var(--border-radius-md)", display: "flex", alignItems: "center" },
  loadingCard: { background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "2rem", textAlign: "center", fontSize: 13, color: "var(--color-text-tertiary)" },
};