import { useState, useEffect, useRef } from "react";
import UploadHistoryTable from "../components/UploadHistory/UploadHistoryTable";
import { getUploads, getExcelExportUrl, deleteUpload, renameDistributor } from "../services/api";

// Props:
//   onDistributorsChange — () => void  tells App to re-fetch distributors immediately
export default function UploadHistory({ onDistributorsChange }) {
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

  const loadRows = () => {
    setLoading(true);
    setError("");
    getUploads()
      .then(setRows)
      .catch((err) => setError(err.message || "Failed to load history"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadRows(); }, []);

  useEffect(() => {
    if (renaming) setTimeout(() => renameInputRef.current?.focus(), 50);
  }, [renaming]);

  // ── Rename ───────────────────────────────────────────────────────────────
  const handleRenameOpen = (distributorName) => {
    setRenaming({ oldName: distributorName });
    setRenameValue(distributorName);
    setRenameError("");
  };

  const handleRenameConfirm = async () => {
  const newName = renameValue.trim();
  console.log("oldName:", renaming.oldName, "newName:", newName); // ← add this
  if (!newName || newName.toUpperCase() === renaming.oldName.toUpperCase()) {
    setRenaming(null);
    return;
  }
    setRenameLoading(true);
    setRenameError("");
    try {
      await renameDistributor(renaming.oldName, newName);
      setRenaming(null);
      loadRows();                    // refresh this page's table
      onDistributorsChange?.();      // tell App → Dashboard filter updates immediately
    } catch (e) {
      setRenameError(e.message || "Rename failed");
    } finally {
      setRenameLoading(false);
    }
  };

  const handleRenameCancel = () => { setRenaming(null); setRenameError(""); };

  // ── Delete ───────────────────────────────────────────────────────────────
  const handleDeleteRequest = (uploadId) => setConfirmDelete(uploadId);

  const handleDeleteConfirm = async () => {
    if (!confirmDelete) return;
    setDeleteLoading(true);
    try {
      await deleteUpload(confirmDelete);
      setConfirmDelete(null);
      loadRows();                    // refresh this page's table
      onDistributorsChange?.();      // tell App → Dashboard filter updates immediately
    } catch (e) {
      setError(e.message || "Delete failed");
      setConfirmDelete(null);
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleDeleteCancel = () => setConfirmDelete(null);

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
        <a href={getExcelExportUrl()} download style={{ textDecoration: "none" }}>
          <button style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <i className="ti ti-download" style={{ fontSize: 14 }} aria-hidden /> Export Excel
          </button>
        </a>
      </div>

      {error && (
        <div style={{ background: "var(--color-background-danger)", border: "0.5px solid var(--color-border-danger)", borderRadius: "var(--border-radius-md)", padding: "12px 16px", fontSize: 13, color: "var(--color-text-danger)", marginBottom: "1.25rem" }}>
          <i className="ti ti-circle-x" style={{ fontSize: 14, marginRight: 6 }} aria-hidden />{error}
        </div>
      )}

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
                if (e.key === "Enter") handleRenameConfirm();
                if (e.key === "Escape") handleRenameCancel();
              }}
              style={{ width: "100%", marginBottom: 8, boxSizing: "border-box" }}
              disabled={renameLoading}
            />
            {renameError && (
              <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--color-text-danger)" }}>
                {renameError}
              </p>
            )}
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
    </div>
  );
}

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