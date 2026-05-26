// ProjectionRemarksModal.jsx
// Global remarks modal for the Projections page.
// Remarks are free-text notes with a category tag.
// Props:  onClose — () => void

import { useState, useEffect, useRef } from "react";
import {
  getProjectionRemarks, createProjectionRemark,
  updateProjectionRemark, deleteProjectionRemark,
} from "../../services/api";

const CATEGORIES = ["Sales Drop", "Shop Closed", "Packaging Issue", "Distributor Issue", "Other"];

const CATEGORY_STYLE = {
  "Sales Drop":        { bg: "rgba(239,68,68,0.1)",   color: "#EF4444" },
  "Shop Closed":       { bg: "rgba(245,158,11,0.1)",  color: "#F59E0B" },
  "Packaging Issue":   { bg: "rgba(139,92,246,0.1)",  color: "#8B5CF6" },
  "Distributor Issue": { bg: "rgba(249,115,22,0.1)",  color: "#F97316" },
  "Other":             { bg: "rgba(100,116,139,0.1)", color: "#64748B" },
};

function CategoryBadge({ category }) {
  const s = CATEGORY_STYLE[category] || CATEGORY_STYLE["Other"];
  return (
    <span style={{
      fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 500,
      background: s.bg, color: s.color,
    }}>
      {category}
    </span>
  );
}

function fmtDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function ProjectionRemarksModal({ onClose }) {
  const [remarks, setRemarks]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState("");

  // Add form
  const [adding, setAdding]       = useState(false);
  const [newText, setNewText]     = useState("");
  const [newCat, setNewCat]       = useState("Other");
  const [saving, setSaving]       = useState(false);
  const inputRef = useRef();

  // Edit state
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText]   = useState("");
  const [editCat, setEditCat]     = useState("Other");
  const editRef = useRef();

  const load = () => {
    setLoading(true);
    getProjectionRemarks()
      .then(setRemarks)
      .catch(() => setRemarks([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { if (adding)    setTimeout(() => inputRef.current?.focus(), 50); }, [adding]);
  useEffect(() => { if (editingId) setTimeout(() => editRef.current?.focus(),  50); }, [editingId]);

  // ── Add ──────────────────────────────────────────────────────────────────
  const handleAdd = async () => {
    const text = newText.trim();
    if (!text) return;
    setSaving(true); setError("");
    try {
      await createProjectionRemark({ remark: text, category: newCat });
      setNewText(""); setNewCat("Other"); setAdding(false); load();
    } catch (e) { setError(e.message || "Failed to add"); }
    finally     { setSaving(false); }
  };

  // ── Edit save ─────────────────────────────────────────────────────────────
  const handleEditSave = async (id) => {
    const text = editText.trim();
    if (!text) return;
    setSaving(true); setError("");
    try {
      await updateProjectionRemark(id, { remark: text, category: editCat });
      setEditingId(null); load();
    } catch (e) { setError(e.message || "Failed to update"); }
    finally     { setSaving(false); }
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = async (id) => {
    setSaving(true); setError("");
    try   { await deleteProjectionRemark(id); load(); }
    catch (e) { setError(e.message || "Failed to delete"); }
    finally   { setSaving(false); }
  };

  return (
    <div style={S.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={S.modal}>

        {/* Header */}
        <div style={S.header}>
          <div>
            <p style={S.title}>Remarks</p>
            <p style={S.subtitle}>General notes — sales drops, shop closures, issues</p>
          </div>
          <button onClick={onClose} style={S.closeBtn}>
            <i className="ti ti-x" style={{ fontSize: 16 }} aria-hidden />
          </button>
        </div>

        {/* Error */}
        {error && (
          <div style={S.errorBox}>
            <i className="ti ti-circle-x" style={{ fontSize: 13, marginRight: 5 }} />
            {error}
          </div>
        )}

        {/* List */}
        <div style={S.list}>
          {loading ? (
            <p style={S.empty}>Loading…</p>
          ) : remarks.length === 0 && !adding ? (
            <p style={S.empty}>No remarks yet. Click "Add remark" to get started.</p>
          ) : (
            remarks.map((r) => (
              <div key={r.id} style={S.card}>
                {editingId === r.id ? (
                  // ── Edit mode ──
                  <div style={{ width: "100%" }}>
                    <select
                      value={editCat}
                      onChange={(e) => setEditCat(e.target.value)}
                      style={{ ...S.select, marginBottom: 8 }}
                      disabled={saving}
                    >
                      {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <textarea
                      ref={editRef}
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleEditSave(r.id); }
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      disabled={saving}
                      style={S.textarea}
                      rows={2}
                    />
                    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                      <button onClick={() => handleEditSave(r.id)} disabled={saving || !editText.trim()} style={S.btnPrimary}>
                        {saving ? "Saving…" : "Save"}
                      </button>
                      <button onClick={() => setEditingId(null)} disabled={saving} style={S.btnGhost}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  // ── View mode ──
                  <>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                        <CategoryBadge category={r.category} />
                        <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
                          {fmtDate(r.created_at)}
                          {r.updated_at !== r.created_at && " · edited"}
                        </span>
                      </div>
                      <p style={S.remarkText}>{r.remark}</p>
                    </div>
                    <div style={S.actions}>
                      <button
                        onClick={() => { setEditingId(r.id); setEditText(r.remark); setEditCat(r.category); }}
                        style={S.iconBtn} title="Edit" disabled={saving}
                      >
                        <i className="ti ti-pencil" style={{ fontSize: 14 }} />
                      </button>
                      <button
                        onClick={() => handleDelete(r.id)}
                        style={{ ...S.iconBtn, color: "var(--color-text-danger)" }}
                        title="Delete" disabled={saving}
                      >
                        <i className="ti ti-trash" style={{ fontSize: 14 }} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>

        {/* Add section */}
        <div style={S.addSection}>
          {adding ? (
            <>
              <select
                value={newCat}
                onChange={(e) => setNewCat(e.target.value)}
                style={{ ...S.select, marginBottom: 8, width: "100%" }}
                disabled={saving}
              >
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <textarea
                ref={inputRef}
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAdd(); }
                  if (e.key === "Escape") { setAdding(false); setNewText(""); setNewCat("Other"); }
                }}
                placeholder="Describe the issue… (Enter to save, Shift+Enter for new line)"
                disabled={saving}
                style={S.textarea}
                rows={3}
              />
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <button onClick={handleAdd} disabled={saving || !newText.trim()} style={S.btnPrimary}>
                  {saving ? "Saving…" : "Add remark"}
                </button>
                <button onClick={() => { setAdding(false); setNewText(""); setNewCat("Other"); }} disabled={saving} style={S.btnGhost}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <button onClick={() => setAdding(true)} style={S.addBtn}>
              <i className="ti ti-plus" style={{ fontSize: 14 }} /> Add remark
            </button>
          )}
        </div>

      </div>
    </div>
  );
}

const S = {
  overlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
  },
  modal: {
    background: "var(--color-background-primary)",
    border: "0.5px solid var(--color-border-primary)",
    borderRadius: "var(--border-radius-lg)",
    width: 500, maxWidth: "92vw", maxHeight: "80vh",
    display: "flex", flexDirection: "column",
    boxShadow: "0 20px 60px rgba(0,0,0,0.25)", overflow: "hidden",
  },
  header: {
    display: "flex", alignItems: "flex-start", justifyContent: "space-between",
    padding: "18px 20px 14px",
    borderBottom: "0.5px solid var(--color-border-tertiary)", flexShrink: 0,
  },
  title:    { margin: 0, fontWeight: 600, fontSize: 15, color: "var(--color-text-primary)" },
  subtitle: { margin: "2px 0 0", fontSize: 12, color: "var(--color-text-tertiary)" },
  closeBtn: {
    background: "transparent", border: "none", cursor: "pointer",
    padding: 4, color: "var(--color-text-tertiary)",
    display: "flex", alignItems: "center", borderRadius: "var(--border-radius-sm)",
  },
  errorBox: {
    margin: "10px 20px 0", padding: "8px 12px", fontSize: 12,
    background: "var(--color-background-danger)", color: "var(--color-text-danger)",
    border: "0.5px solid var(--color-border-danger)",
    borderRadius: "var(--border-radius-md)", display: "flex", alignItems: "center",
  },
  list: {
    flex: 1, overflowY: "auto", padding: "12px 20px",
    display: "flex", flexDirection: "column", gap: 8,
  },
  empty: { margin: "1.5rem 0", fontSize: 13, color: "var(--color-text-tertiary)", textAlign: "center" },
  card: {
    display: "flex", gap: 10, alignItems: "flex-start",
    padding: "12px 14px",
    background: "var(--color-background-secondary)",
    border: "0.5px solid var(--color-border-tertiary)",
    borderRadius: "var(--border-radius-md)",
  },
  remarkText: { margin: 0, fontSize: 13, color: "var(--color-text-primary)", lineHeight: 1.5, whiteSpace: "pre-wrap" },
  actions:    { display: "flex", gap: 2, flexShrink: 0 },
  iconBtn: {
    background: "transparent", border: "none", cursor: "pointer",
    padding: "3px 5px", borderRadius: "var(--border-radius-sm)",
    color: "var(--color-text-secondary)", display: "inline-flex", alignItems: "center",
  },
  addSection: {
    padding: "12px 20px 16px",
    borderTop: "0.5px solid var(--color-border-tertiary)", flexShrink: 0,
  },
  addBtn: {
    display: "flex", alignItems: "center", gap: 6, fontSize: 13, padding: "6px 12px",
    background: "transparent", border: "0.5px solid var(--color-border-secondary)",
    borderRadius: "var(--border-radius-md)", color: "var(--color-text-secondary)", cursor: "pointer",
  },
  textarea: {
    width: "100%", boxSizing: "border-box", fontSize: 13, lineHeight: 1.5,
    padding: "8px 10px", resize: "vertical",
    border: "0.5px solid var(--color-border-secondary)",
    borderRadius: "var(--border-radius-md)",
    background: "var(--color-background-primary)",
    color: "var(--color-text-primary)", fontFamily: "inherit",
  },
  select: {
    fontSize: 13, padding: "5px 8px", boxSizing: "border-box",
    border: "0.5px solid var(--color-border-secondary)",
    borderRadius: "var(--border-radius-md)",
    background: "var(--color-background-primary)",
    color: "var(--color-text-primary)",
  },
  btnPrimary: {
    fontSize: 12, padding: "5px 12px", borderRadius: "var(--border-radius-md)",
    border: "none", cursor: "pointer",
    background: "var(--color-text-info, #378ADD)", color: "#fff",
  },
  btnGhost: {
    fontSize: 12, padding: "5px 12px", borderRadius: "var(--border-radius-md)",
    background: "transparent", cursor: "pointer",
    border: "0.5px solid var(--color-border-secondary)", color: "var(--color-text-secondary)",
  },
};