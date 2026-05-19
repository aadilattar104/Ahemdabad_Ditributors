import { useState } from "react";
import UploadSection from "../components/UploadSection/UploadSection";
import DistributorNamePrompt from "../components/UploadSection/DistributorNamePrompt";
import { uploadFile } from "../services/api";

// Utility: try to extract distributor name from filename (e.g. SYNERGY_April.xlsx → SYNERGY)
function detectDistributorFromFilename(filename) {
  const base = filename.replace(/\.(xlsx|xls)$/i, "");
  const first = base.split("_")[0].trim().toUpperCase();
  return /^[A-Z]{3,20}$/.test(first) ? first : null;
}

const STATUS = {
  IDLE: "idle",
  NEEDS_DISTRIBUTOR: "needs_distributor",
  UPLOADING: "uploading",
  SUCCESS: "success",
  ERROR: "error",
};

export default function Upload() {
  const [status, setStatus] = useState(STATUS.IDLE);
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const handleFile = (f) => {
    setFile(f);
    setError("");
    setResult(null);
    const detected = detectDistributorFromFilename(f.name);
    if (detected) {
      submit(f, detected);
    } else {
      setStatus(STATUS.NEEDS_DISTRIBUTOR);
    }
  };

  const submit = async (f, distributorName) => {
    setStatus(STATUS.UPLOADING);
    try {
      const data = await uploadFile(f, distributorName);
      setResult(data);
      setStatus(STATUS.SUCCESS);
    } catch (err) {
      setError(err.message || "Upload failed");
      setStatus(STATUS.ERROR);
    }
  };

  const reset = () => {
    setStatus(STATUS.IDLE);
    setFile(null);
    setResult(null);
    setError("");
  };

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "2rem 1rem" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 500 }}>Upload file</h1>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "var(--color-text-secondary)" }}>
            Upload a distributor Excel file to extract shop-wise sales data
          </p>
        </div>
        {status !== STATUS.IDLE && (
          <button onClick={reset} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <i className="ti ti-refresh" style={{ fontSize: 14 }} aria-hidden /> Start over
          </button>
        )}
      </div>

      {/* Upload zone */}
      {status === STATUS.IDLE && <UploadSection onFile={handleFile} />}

      {/* Distributor name prompt */}
      {status === STATUS.NEEDS_DISTRIBUTOR && (
        <DistributorNamePrompt
          filename={file?.name}
          onConfirm={(name) => submit(file, name)}
        />
      )}

      {/* Uploading */}
      {status === STATUS.UPLOADING && (
        <div style={{ textAlign: "center", padding: "3rem 0", color: "var(--color-text-secondary)" }}>
          <i className="ti ti-loader-2" style={{ fontSize: 28, display: "block", marginBottom: 12 }} aria-hidden />
          <p style={{ margin: 0 }}>Uploading and extracting…</p>
        </div>
      )}

      {/* Success */}
      {status === STATUS.SUCCESS && result && (
        <div style={{
          background: "var(--color-background-success)",
          border: "0.5px solid var(--color-border-success)",
          borderRadius: "var(--border-radius-lg)",
          padding: "1.25rem 1.5rem",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <i className="ti ti-circle-check" style={{ fontSize: 16, color: "var(--color-text-success)" }} aria-hidden />
            <p style={{ margin: 0, fontWeight: 500, color: "var(--color-text-success)" }}>Extraction complete</p>
          </div>
          <div style={{ fontSize: 13, color: "var(--color-text-secondary)", display: "flex", flexDirection: "column", gap: 4 }}>
            <span>Distributor: <strong>{result.distributor_name}</strong></span>
            <span>Format detected: <strong>{result.format}</strong></span>
            <span>Shops extracted: <strong>{result.record_count}</strong></span>
            {result.month && result.year && <span>Period: <strong>{result.month} {result.year}</strong></span>}
          </div>
        </div>
      )}

      {/* Error */}
      {status === STATUS.ERROR && (
        <div style={{
          background: "var(--color-background-danger)",
          border: "0.5px solid var(--color-border-danger)",
          borderRadius: "var(--border-radius-lg)",
          padding: "1.25rem 1.5rem",
        }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
            <i className="ti ti-circle-x" style={{ fontSize: 16, color: "var(--color-text-danger)" }} aria-hidden />
            <p style={{ margin: 0, fontWeight: 500, color: "var(--color-text-danger)" }}>Upload failed</p>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-secondary)" }}>{error}</p>
        </div>
      )}
    </div>
  );
}