import { useState, useEffect } from "react";
import UploadHistoryTable from "../components/UploadHistory/UploadHistoryTable";
import { getUploads, getExcelExportUrl } from "../services/api";

export default function UploadHistory() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    getUploads()
      .then(setRows)
      .catch((err) => setError(err.message || "Failed to load history"))
      .finally(() => setLoading(false));
  }, []);

  const handleView = (uploadId) => {
    // Navigate to upload detail — implement routing as needed
    console.log("View upload:", uploadId);
  };

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1rem" }}>
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
        <div style={{
          background: "var(--color-background-danger)",
          border: "0.5px solid var(--color-border-danger)",
          borderRadius: "var(--border-radius-md)",
          padding: "12px 16px",
          fontSize: 13,
          color: "var(--color-text-danger)",
          marginBottom: "1.25rem",
        }}>
          <i className="ti ti-circle-x" style={{ fontSize: 14, marginRight: 6 }} aria-hidden />{error}
        </div>
      )}

      <UploadHistoryTable rows={rows} loading={loading} onView={handleView} />
    </div>
  );
}