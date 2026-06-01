import { useState, useEffect, useRef } from "react";
import UploadHistoryTable from "../components/UploadHistory/UploadHistoryTable";
import {
  getUploads, getExcelExportUrl, deleteUpload, renameDistributor,
  getMtUploads, deleteMtUpload, renameMtChain,
} from "../services/api";

// Props:
//   onDistributorsChange — () => void  tells App to re-fetch distributors immediately
export default function UploadHistory({ onDistributorsChange }) {
  const [tab, setTab] = useState("distributor"); // "distributor" | "mt"

  // ── Distributor state ────────────────────────────────────────────────────
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  const [renaming, setRenaming]           = useState(null);
  const [renameValue, setRenameValue]     = useState("");
  const [renameLoading, setRenameLoading] = useState(false);
  const [renameError, setRenameError]     = useState("");
  const renameInputRef = useRef();

  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // ── MT state ─────────────────────────────────────────────────────────────
  const [mtRows, setMtRows]       = useState([]);
  const [mtLoading, setMtLoading] = useState(true);
  const [mtError, setMtError]     = useState("");
  const [mtConfirmDelete, setMtConfirmDelete] = useState(null);
  const [mtDeleteLoading, setMtDeleteLoading] = useState(false);

  const [mtRenaming, setMtRenaming]           = useState(null);
  const [mtRenameValue, setMtRenameValue]     = useState("");
  const [mtRenameLoading, setMtRenameLoading] = useState(false);
  const [mtRenameError, setMtRenameError]     = useState("");
  const mtRenameInputRef = useRef();

  // ── Load distributor rows ────────────────────────────────────────────────
  const loadRows = () => {
    setLoading(true); setError("");
    getUploads()
      .then(setRows)
      .catch((err) => setError(err.message || "Failed to load history"))
      .finally(() => setLoading(false));
  };

  // ── Load MT rows ─────────────────────────────────────────────────────────
  const loadMtRows = () => {
    setMtLoading(true); setMtError("");
    getMtUploads()
      .then(setMtRows)
      .catch((err) => setMtError(err.message || "Failed to load MT history"))
      .finally(() => setMtLoading(false));
  };

  useEffect(() => { loadRows(); loadMtRows(); }, []);

  useEffect(() => {
    if (renaming)   setTimeout(() => renameInputRef.current?.focus(), 50);
  }, [renaming]);

  useEffect(() => {
    if (mtRenaming) setTimeout(() => mtRenameInputRef.current?.focus(), 50);
  }, [mtRenaming]);

  // ── Distributor rename ────────────────────────────────────────────────────
  const handleRenameOpen = (distributorName) => {
    setRenaming({ oldName: distributorName });
    setRenameValue(distributorName);
    setRenameError("");
  };

  const handleRenameConfirm = async () => {
    const newName = renameValue.trim();
    if (!newName || newName.toUpperCase() === renaming.oldName.toUpperCase()) {
      setRenaming(null); return;
    }
    setRenameLoading(true); setRenameError("");
    try {
      await renameDistributor(renaming.oldName, newName);
      setRenaming(null);
      loadRows();
      onDistributorsChange?.();
    } catch (e) {
      setRenameError(e.message || "Rename failed");
    } finally {
      setRenameLoading(false);
    }
  };

  const handleRenameCancel = () => { setRenaming(null); setRenameError(""); };

  // ── Distributor delete ────────────────────────────────────────────────────
  const handleDeleteRequest = (uploadId) => setConfirmDelete(uploadId);

  const handleDeleteConfirm = async () => {
    if (!confirmDelete) return;
    setDeleteLoading(true);
    try {
      await deleteUpload(confirmDelete);
      setConfirmDelete(null);
      loadRows();
      onDistributorsChange?.();
    } catch (e) {
      setError(e.message || "Delete failed");
      setConfirmDelete(null);
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleDeleteCancel = () => setConfirmDelete(null);

  // ── MT delete ─────────────────────────────────────────────────────────────
  const handleMtDeleteRequest = (uploadId) => setMtConfirmDelete(uploadId);

  const handleMtDeleteConfirm = async () => {
    if (!mtConfirmDelete) return;
    setMtDeleteLoading(true);
    try {
      await deleteMtUpload(mtConfirmDelete);
      setMtConfirmDelete(null);
      loadMtRows();
    } catch (e) {
      setMtError(e.message || "Delete failed");
      setMtConfirmDelete(null);
    } finally {
      setMtDeleteLoading(false);
    }
  };

  const handleMtDeleteCancel = () => setMtConfirmDelete(null);

  // ── MT rename ─────────────────────────────────────────────────────────────
  const handleMtRenameOpen = (chainName) => {
    setMtRenaming({ oldName: chainName });
    setMtRenameValue(chainName);
    setMtRenameError("");
  };

  const handleMtRenameConfirm = async () => {
    const newName = mtRenameValue.trim();
    if (!newName || newName.toUpperCase() === mtRenaming.oldName.toUpperCase()) {
      setMtRenaming(null); return;
    }
    setMtRenameLoading(true); setMtRenameError("");
    try {
      await renameMtChain(mtRenaming.oldName, newName);
      setMtRenaming(null);
      loadMtRows();
    } catch (e) {
      setMtRenameError(e.message || "Rename failed");
    } finally {
      setMtRenameLoading(false);
    }
  };

  const handleMtRenameCancel = () => { setMtRenaming(null); setMtRenameError(""); };

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1rem" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 500 }}>Upload history</h1>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "var(--color-text-secondary)" }}>
            All files uploaded and their extraction status
          </p>
        </div>
        {tab === "distributor" && (
          <a href={getExcelExportUrl()} download style={{ textDecoration: "none" }}>
            <button style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <i className="ti ti-download" style={{ fontSize: 14 }} aria-hidden /> Export Excel
            </button>
          </a>
        )}
      </div>

      {/* Tab toggle */}
      <div style={S.tabBar}>
        <button
          onClick={() => setTab("distributor")}
          style={{ ...S.tabBtn, ...(tab === "distributor" ? S.tabActive : {}), borderRight: "0.5px solid var(--color-border-tertiary)" }}
        >
          <i className="ti ti-building" style={{ fontSize: 13 }} /> Distributor
        </button>
        <button
          onClick={() => setTab("mt")}
          style={{ ...S.tabBtn, ...(tab === "mt" ? S.tabActive : {}) }}
        >
          <i className="ti ti-building-store" style={{ fontSize: 13 }} /> Modern Trade
        </button>
      </div>

      {/* ── DISTRIBUTOR TAB ── */}
      {tab === "distributor" && (
        <>
          {error && <div style={S.errorBox}><i className="ti ti-circle-x" style={{ fontSize: 14, marginRight: 6 }} />{error}</div>}

          {/* Rename modal */}
          {renaming && (
            <div style={overlayStyle}>
              <div style={modalStyle}>
                <p style={{ margin: "0 0 4px", fontWeight: 600, fontSize: 15 }}>Rename distributor</p>
                <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--color-text-secondary)" }}>
                  This will update <strong>all uploads and sales records</strong> named "{renaming.oldName}".
                </p>
                <input
                  ref={renameInputRef}
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter")  handleRenameConfirm();
                    if (e.key === "Escape") handleRenameCancel();
                  }}
                  style={{ width: "100%", marginBottom: 8, boxSizing: "border-box" }}
                  disabled={renameLoading}
                />
                {renameError && <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--color-text-danger)" }}>{renameError}</p>}
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button onClick={handleRenameCancel} disabled={renameLoading}
                    style={{ fontSize: 13, background: "transparent", border: "0.5px solid var(--color-border-secondary)" }}>
                    Cancel
                  </button>
                  <button onClick={handleRenameConfirm} disabled={renameLoading} style={{ fontSize: 13 }}>
                    {renameLoading ? "Saving…" : "Rename globally"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Delete confirm modal */}
          {confirmDelete && (
            <div style={overlayStyle}>
              <div style={modalStyle}>
                <p style={{ margin: "0 0 4px", fontWeight: 600, fontSize: 15 }}>Delete upload?</p>
                <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--color-text-secondary)" }}>
                  This will permanently delete this upload and all its extracted sales records. This cannot be undone.
                </p>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button onClick={handleDeleteCancel} disabled={deleteLoading}
                    style={{ fontSize: 13, background: "transparent", border: "0.5px solid var(--color-border-secondary)" }}>
                    Cancel
                  </button>
                  <button onClick={handleDeleteConfirm} disabled={deleteLoading}
                    style={{ fontSize: 13, background: "var(--color-background-danger, #fee2e2)", color: "var(--color-text-danger, #dc2626)", border: "0.5px solid var(--color-border-danger)" }}>
                    {deleteLoading ? "Deleting…" : "Yes, delete"}
                  </button>
                </div>
              </div>
            </div>
          )}

          <UploadHistoryTable
            rows={rows}
            loading={loading}
            onDelete={handleDeleteRequest}
            onRename={handleRenameOpen}
          />
        </>
      )}

      {/* ── MODERN TRADE TAB ── */}
      {tab === "mt" && (
        <>
          {mtError && <div style={S.errorBox}><i className="ti ti-circle-x" style={{ fontSize: 14, marginRight: 6 }} />{mtError}</div>}

          {/* MT rename modal */}
          {mtRenaming && (
            <div style={overlayStyle}>
              <div style={modalStyle}>
                <p style={{ margin: "0 0 4px", fontWeight: 600, fontSize: 15 }}>Rename chain</p>
                <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--color-text-secondary)" }}>
                  This will update <strong>all uploads and sales records</strong> named "{mtRenaming.oldName}".
                </p>
                <input
                  ref={mtRenameInputRef}
                  type="text"
                  value={mtRenameValue}
                  onChange={(e) => setMtRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter")  handleMtRenameConfirm();
                    if (e.key === "Escape") handleMtRenameCancel();
                  }}
                  style={{ width: "100%", marginBottom: 8, boxSizing: "border-box" }}
                  disabled={mtRenameLoading}
                />
                {mtRenameError && <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--color-text-danger)" }}>{mtRenameError}</p>}
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button onClick={handleMtRenameCancel} disabled={mtRenameLoading}
                    style={{ fontSize: 13, background: "transparent", border: "0.5px solid var(--color-border-secondary)" }}>
                    Cancel
                  </button>
                  <button onClick={handleMtRenameConfirm} disabled={mtRenameLoading} style={{ fontSize: 13 }}>
                    {mtRenameLoading ? "Saving…" : "Rename globally"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* MT delete confirm modal */}
          {mtConfirmDelete && (
            <div style={overlayStyle}>
              <div style={modalStyle}>
                <p style={{ margin: "0 0 4px", fontWeight: 600, fontSize: 15 }}>Delete MT upload?</p>
                <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--color-text-secondary)" }}>
                  This will permanently delete this upload and all its extracted sales and SOH records. This cannot be undone.
                </p>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button onClick={handleMtDeleteCancel} disabled={mtDeleteLoading}
                    style={{ fontSize: 13, background: "transparent", border: "0.5px solid var(--color-border-secondary)" }}>
                    Cancel
                  </button>
                  <button onClick={handleMtDeleteConfirm} disabled={mtDeleteLoading}
                    style={{ fontSize: 13, background: "var(--color-background-danger, #fee2e2)", color: "var(--color-text-danger, #dc2626)", border: "0.5px solid var(--color-border-danger)" }}>
                    {mtDeleteLoading ? "Deleting…" : "Yes, delete"}
                  </button>
                </div>
              </div>
            </div>
          )}

          <MtUploadHistoryTable
            rows={mtRows}
            loading={mtLoading}
            onDelete={handleMtDeleteRequest}
            onRename={handleMtRenameOpen}
          />
        </>
      )}
    </div>
  );
}

// ── MT-specific table (chain_name, sales_count, soh_count instead of distributor/month/records) ──
function MtUploadHistoryTable({ rows = [], loading = false, onDelete, onRename }) {
  function fmtDate(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  const iconBtn = {
    background: "transparent", border: "none", cursor: "pointer",
    padding: "4px 6px", borderRadius: "var(--border-radius-sm)",
    color: "var(--color-text-secondary)", fontSize: 15, lineHeight: 1,
    display: "inline-flex", alignItems: "center",
  };
  const iconBtnDanger = { ...iconBtn, color: "var(--color-text-danger)" };
  const STATUS_STYLES = {
    success: { background: "var(--color-background-success)", color: "var(--color-text-success)" },
    error:   { background: "var(--color-background-danger)",  color: "var(--color-text-danger)" },
    pending: { background: "var(--color-background-warning)", color: "var(--color-text-warning)" },
  };

  return (
    <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "var(--color-background-secondary)" }}>
            {["File", "Chain", "Sales Records", "SOH Records", "Status", "Uploaded", ""].map((h, i) => (
              <th key={i} style={{ padding: "10px 14px", textAlign: i >= 2 ? "center" : "left", fontWeight: 500, borderBottom: "0.5px solid var(--color-border-tertiary)", whiteSpace: "nowrap" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 3 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} style={{ padding: "10px 14px" }}>
                      <div style={{ height: 13, width: "60%", background: "var(--color-border-tertiary)", borderRadius: 4 }} />
                    </td>
                  ))}
                </tr>
              ))
            : rows.length === 0
            ? <tr><td colSpan={7} style={{ padding: "2rem", textAlign: "center", color: "var(--color-text-tertiary)" }}>No Modern Trade uploads yet</td></tr>
            : rows.map((row, i) => {
                const st = STATUS_STYLES[row.status] || STATUS_STYLES.pending;
                return (
                  <tr key={row.id} style={{ borderBottom: i < rows.length - 1 ? "0.5px solid var(--color-border-tertiary)" : "none" }}>
                    <td style={{ padding: "10px 14px", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.filename}>
                      <i className="ti ti-file-spreadsheet" style={{ fontSize: 13, marginRight: 6, color: "var(--color-text-secondary)" }} aria-hidden />
                      {row.filename}
                    </td>
                    <td style={{ padding: "10px 14px", fontWeight: 500 }}>{row.chain_name || "—"}</td>
                    <td style={{ padding: "10px 14px", textAlign: "center" }}>{row.sales_count ?? "—"}</td>
                    <td style={{ padding: "10px 14px", textAlign: "center" }}>{row.soh_count ?? "—"}</td>
                    <td style={{ padding: "10px 14px", textAlign: "center" }}>
                      <span style={{ fontSize: 11, padding: "2px 9px", borderRadius: "var(--border-radius-md)", fontWeight: 500, ...st }}>
                        {row.status}
                      </span>
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "center", color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>{fmtDate(row.uploaded_at)}</td>
                    <td style={{ padding: "10px 14px", textAlign: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 2 }}>
                        {onRename && (
                          <button
                            onClick={() => onRename(row.chain_name)}
                            style={iconBtn}
                            title={`Rename "${row.chain_name}" globally`}
                          >
                            <i className="ti ti-pencil" aria-hidden />
                          </button>
                        )}
                        {onDelete && (
                          <button onClick={() => onDelete(row.id)} style={iconBtnDanger} title="Delete this upload">
                            <i className="ti ti-trash" aria-hidden />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
        </tbody>
      </table>
    </div>
  );
}

const S = {
  tabBar: {
    display: "flex", border: "0.5px solid var(--color-border-tertiary)",
    borderRadius: "var(--border-radius-md)", overflow: "hidden", marginBottom: "1.25rem",
    width: "fit-content",
  },
  tabBtn: {
    padding: "7px 18px", fontSize: 13, border: "none", cursor: "pointer",
    background: "var(--color-background-primary)", color: "var(--color-text-secondary)",
    fontWeight: 400, display: "inline-flex", alignItems: "center", gap: 6,
  },
  tabActive: {
    background: "var(--color-background-secondary)",
    color: "var(--color-text-primary)", fontWeight: 500,
  },
  errorBox: {
    background: "var(--color-background-danger)", border: "0.5px solid var(--color-border-danger)",
    borderRadius: "var(--border-radius-md)", padding: "12px 16px", fontSize: 13,
    color: "var(--color-text-danger)", marginBottom: "1.25rem",
    display: "flex", alignItems: "center",
  },
};

const overlayStyle = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
};
const modalStyle = {
  background: "var(--color-background-primary)",
  border: "0.5px solid var(--color-border-primary)",
  borderRadius: "var(--border-radius-lg)",
  padding: "24px", width: 400, maxWidth: "90vw",
  boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
};