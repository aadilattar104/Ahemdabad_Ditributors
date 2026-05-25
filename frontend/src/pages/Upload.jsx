import { useState, useRef, useCallback } from "react";
import UploadSection from "../components/UploadSection/UploadSection";
import DistributorNamePrompt from "../components/UploadSection/DistributorNamePrompt";
import { uploadFile } from "../services/api";

const BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:8000";

// ── Utility ───────────────────────────────────────────────────────────────────
function detectDistributorFromFilename(filename) {
  const base  = filename.replace(/\.(xlsx|xls)$/i, "");
  const first = base.split("_")[0].trim().toUpperCase();
  return /^[A-Z]{3,20}$/.test(first) ? first : null;
}

const STATUS = {
  IDLE:              "idle",
  NEEDS_DISTRIBUTOR: "needs_distributor",
  UPLOADING:         "uploading",
  SUCCESS:           "success",
  ERROR:             "error",
};

const MARGIN_STATUS = {
  IDLE:      "idle",
  PARSING:   "parsing",
  CONFLICTS: "conflicts",   // waiting for user to resolve conflicts
  SAVING:    "saving",
  SUCCESS:   "success",
  ERROR:     "error",
};

// ── Conflict resolution popup ─────────────────────────────────────────────────
function ConflictModal({ conflicts, onResolve }) {
  // resolved: { [shop_name]: string (typed value) }
  const [values, setValues] = useState(() =>
    Object.fromEntries(conflicts.map(c => [c.shop_name, ""]))
  );
  const [touched, setTouched] = useState({});

  const allFilled = conflicts.every(c => {
    const v = values[c.shop_name];
    return v !== "" && !isNaN(parseFloat(v)) && parseFloat(v) > 0;
  });

  return (
    <div style={styles.modalOverlay}>
      <div style={styles.modal}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <i className="ti ti-alert-triangle" style={{ fontSize: 16, color: "var(--color-text-warning)" }} />
          <p style={{ margin: 0, fontWeight: 500, fontSize: 15 }}>Margin conflicts found</p>
        </div>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--color-text-secondary)" }}>
          The following shops have different margin % across invoices.
          Enter the correct margin for each before saving.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
          {conflicts.map(c => {
            const v   = values[c.shop_name];
            const err = touched[c.shop_name] && (v === "" || isNaN(parseFloat(v)) || parseFloat(v) <= 0);
            return (
              <div key={c.shop_name} style={styles.conflictRow}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: "0 0 2px", fontWeight: 500, fontSize: 13,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.shop_name}
                  </p>
                  <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-tertiary)" }}>
                    Found margins: {c.values.join("%, ")}%
                  </p>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.5"
                      placeholder="e.g. 30"
                      value={v}
                      onChange={e => setValues(prev => ({ ...prev, [c.shop_name]: e.target.value }))}
                      onBlur={() => setTouched(prev => ({ ...prev, [c.shop_name]: true }))}
                      style={{ ...styles.conflictInput, borderColor: err ? "var(--color-border-danger)" : "var(--color-border-secondary)" }}
                    />
                    <span style={{ fontSize: 13, color: "var(--color-text-tertiary)" }}>%</span>
                  </div>
                  {err && <p style={{ margin: 0, fontSize: 11, color: "var(--color-text-danger)" }}>Enter a valid margin</p>}
                </div>
              </div>
            );
          })}
        </div>

        <button
          style={{ ...styles.primaryBtn, opacity: allFilled ? 1 : 0.45, cursor: allFilled ? "pointer" : "default" }}
          disabled={!allFilled}
          onClick={() => {
            const resolved = conflicts.map(c => ({
              shop_name:  c.shop_name,
              margin_pct: parseFloat(values[c.shop_name]),
            }));
            onResolve(resolved);
          }}
        >
          Save all margins
        </button>
      </div>
    </div>
  );
}

// ── Margin upload tab ─────────────────────────────────────────────────────────
function MarginUpload() {
  const inputRef                    = useRef();
  const [dragging, setDragging]     = useState(false);
  const [distributor, setDistributor] = useState("");
  const [status, setStatus]         = useState(MARGIN_STATUS.IDLE);
  const [error, setError]           = useState("");
  const [preview, setPreview]       = useState(null);   // { clean, conflicts, distributor_name }
  const [savedCount, setSavedCount] = useState(0);

  const reset = () => {
    setStatus(MARGIN_STATUS.IDLE);
    setError(""); setPreview(null); setSavedCount(0);
  };

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    const dist = distributor.trim().toUpperCase();
    if (!dist) {
      setError("Enter a distributor name before uploading.");
      return;
    }
    setError("");
    setStatus(MARGIN_STATUS.PARSING);

    const form = new FormData();
    form.append("file", file);
    form.append("distributor_name", dist);

    try {
      const res  = await fetch(`${BASE_URL}/margins/preview`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);

      setPreview(data);

      if (data.conflicts.length > 0) {
        setStatus(MARGIN_STATUS.CONFLICTS);
      } else {
        // No conflicts — save immediately
        await saveMargins(data.distributor_name, data.clean, []);
      }
    } catch (e) {
      setError(e.message); setStatus(MARGIN_STATUS.ERROR);
    }
  }, [distributor]);

  const saveMargins = async (distributorName, clean, resolvedConflicts) => {
    setStatus(MARGIN_STATUS.SAVING);
    const all = [
      ...clean,
      ...resolvedConflicts,
    ];
    try {
      const res  = await fetch(`${BASE_URL}/margins/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ distributor_name: distributorName, margins: all }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      setSavedCount(data.saved);
      setStatus(MARGIN_STATUS.SUCCESS);
    } catch (e) {
      setError(e.message); setStatus(MARGIN_STATUS.ERROR);
    }
  };

  const handleDrop = useCallback((e) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }, [handleFile]);

  return (
    <div>
      {/* Conflict modal */}
      {status === MARGIN_STATUS.CONFLICTS && preview?.conflicts?.length > 0 && (
        <ConflictModal
          conflicts={preview.conflicts}
          onResolve={(resolved) => saveMargins(preview.distributor_name, preview.clean, resolved)}
        />
      )}

      {/* Distributor input */}
      {(status === MARGIN_STATUS.IDLE || status === MARGIN_STATUS.ERROR) && (
        <>
          <div style={{ marginBottom: 16 }}>
            <label style={styles.inputLabel}>Distributor Name</label>
            <input
              style={styles.textInput}
              type="text"
              placeholder="e.g. SYNERGY, ICELAND"
              value={distributor}
              onChange={e => setDistributor(e.target.value)}
            />
          </div>

          {/* Drop zone */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current.click()}
            onKeyDown={e => e.key === "Enter" && inputRef.current.click()}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            style={{
              ...styles.dropZone,
              borderColor: dragging ? "var(--color-border-info)" : "var(--color-border-secondary)",
              background:  dragging ? "var(--color-background-info)" : "var(--color-background-primary)",
            }}
          >
            <input ref={inputRef} type="file" accept=".xlsx,.xls"
              style={{ display: "none" }}
              onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
            <i className="ti ti-receipt-percent"
              style={{ fontSize: 32, color: "var(--color-text-secondary)", display: "block", marginBottom: 10 }} />
            <p style={{ margin: "0 0 4px", fontWeight: 500 }}>Drop your margin Excel file here</p>
            <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-secondary)" }}>
              or click to browse — .xlsx and .xls supported
            </p>
          </div>

          {error && (
            <div style={styles.errorBanner}>
              <i className="ti ti-alert-circle" style={{ marginRight: 6 }} />{error}
            </div>
          )}
        </>
      )}

      {/* Parsing / saving spinner */}
      {(status === MARGIN_STATUS.PARSING || status === MARGIN_STATUS.SAVING) && (
        <div style={{ textAlign: "center", padding: "3rem 0", color: "var(--color-text-secondary)" }}>
          <i className="ti ti-loader-2" style={{ fontSize: 28, display: "block", marginBottom: 12,
            animation: "spin 1s linear infinite" }} />
          <p style={{ margin: 0 }}>
            {status === MARGIN_STATUS.PARSING ? "Parsing file…" : "Saving margins…"}
          </p>
        </div>
      )}

      {/* Success */}
      {status === MARGIN_STATUS.SUCCESS && (
        <div style={styles.successBanner}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <i className="ti ti-circle-check" style={{ fontSize: 16, color: "var(--color-text-success)" }} />
            <p style={{ margin: 0, fontWeight: 500, color: "var(--color-text-success)" }}>Margins saved</p>
          </div>
          <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--color-text-secondary)" }}>
            {savedCount} shops updated for <strong>{preview?.distributor_name}</strong>
          </p>
          <button style={styles.ghostBtn} onClick={reset}>Upload another file</button>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Main Upload page ──────────────────────────────────────────────────────────
export default function Upload() {
  const [tab, setTab]       = useState("distributor");  // "distributor" | "margin"
  const [status, setStatus] = useState(STATUS.IDLE);
  const [file, setFile]     = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError]   = useState("");

  // ── Distributor tab logic (100% unchanged) ──────────────────────────────────
  const handleFile = (f) => {
    setFile(f); setError(""); setResult(null);
    const detected = detectDistributorFromFilename(f.name);
    if (detected) submit(f, detected);
    else          setStatus(STATUS.NEEDS_DISTRIBUTOR);
  };

  const submit = async (f, distributorName) => {
    setStatus(STATUS.UPLOADING);
    try {
      const data = await uploadFile(f, distributorName);
      setResult(data); setStatus(STATUS.SUCCESS);
    } catch (err) {
      setError(err.message || "Upload failed"); setStatus(STATUS.ERROR);
    }
  };

  const reset = () => {
    setStatus(STATUS.IDLE); setFile(null); setResult(null); setError("");
  };

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "2rem 1rem" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 500 }}>Upload file</h1>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "var(--color-text-secondary)" }}>
            {tab === "distributor"
              ? "Upload a distributor Excel file to extract shop-wise sales data"
              : "Upload a distributor file to extract and save shop margin %"}
          </p>
        </div>
        {tab === "distributor" && status !== STATUS.IDLE && (
          <button onClick={reset} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <i className="ti ti-refresh" style={{ fontSize: 14 }} aria-hidden /> Start over
          </button>
        )}
      </div>

      {/* Tab toggle */}
      <div style={styles.tabRow}>
        <button
          style={{ ...styles.tab, ...(tab === "distributor" ? styles.tabActive : {}) }}
          onClick={() => { setTab("distributor"); reset(); }}
        >
          <i className="ti ti-truck" style={{ marginRight: 6 }} />
          Distributor
        </button>
        <button
          style={{ ...styles.tab, ...(tab === "margin" ? styles.tabActive : {}) }}
          onClick={() => setTab("margin")}
        >
          <i className="ti ti-receipt-percent" style={{ marginRight: 6 }} />
          Margin
        </button>
      </div>

      {/* ── Distributor tab (unchanged) ── */}
      {tab === "distributor" && (
        <>
          {status === STATUS.IDLE && <UploadSection onFile={handleFile} />}

          {status === STATUS.NEEDS_DISTRIBUTOR && (
            <DistributorNamePrompt
              filename={file?.name}
              onConfirm={(name) => submit(file, name)}
            />
          )}

          {status === STATUS.UPLOADING && (
            <div style={{ textAlign: "center", padding: "3rem 0", color: "var(--color-text-secondary)" }}>
              <i className="ti ti-loader-2" style={{ fontSize: 28, display: "block", marginBottom: 12 }} aria-hidden />
              <p style={{ margin: 0 }}>Uploading and extracting…</p>
            </div>
          )}

          {status === STATUS.SUCCESS && result && (
            <div style={styles.successBanner}>
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

          {status === STATUS.ERROR && (
            <div style={styles.errorBannerLg}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                <i className="ti ti-circle-x" style={{ fontSize: 16, color: "var(--color-text-danger)" }} aria-hidden />
                <p style={{ margin: 0, fontWeight: 500, color: "var(--color-text-danger)" }}>Upload failed</p>
              </div>
              <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-secondary)" }}>{error}</p>
            </div>
          )}
        </>
      )}

      {/* ── Margin tab ── */}
      {tab === "margin" && <MarginUpload />}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = {
  tabRow: {
    display: "flex",
    gap: 8,
    marginBottom: "1.5rem",
  },
  tab: {
    flex: 1,
    padding: "9px 16px",
    borderRadius: "var(--border-radius-md)",
    border: "0.5px solid var(--color-border-secondary)",
    background: "transparent",
    color: "var(--color-text-secondary)",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.15s",
  },
  tabActive: {
    background: "var(--color-background-secondary)",
    color: "var(--color-text-primary)",
    border: "0.5px solid var(--color-border-tertiary)",
  },
  inputLabel: {
    display: "block",
    fontSize: 11,
    fontWeight: 500,
    color: "var(--color-text-tertiary)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    marginBottom: 6,
  },
  textInput: {
    width: "100%",
    padding: "7px 10px",
    borderRadius: "var(--border-radius-md)",
    border: "0.5px solid var(--color-border-secondary)",
    background: "var(--color-background-primary)",
    color: "var(--color-text-primary)",
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box",
  },
  dropZone: {
    border: "1.5px dashed",
    borderRadius: "var(--border-radius-lg)",
    padding: "3rem 2rem",
    textAlign: "center",
    cursor: "pointer",
    transition: "border-color 0.15s, background 0.15s",
  },
  errorBanner: {
    marginTop: 12,
    padding: "10px 14px",
    borderRadius: "var(--border-radius-md)",
    background: "var(--color-background-danger)",
    border: "0.5px solid var(--color-border-danger)",
    color: "var(--color-text-danger)",
    fontSize: 13,
    display: "flex",
    alignItems: "center",
  },
  errorBannerLg: {
    background: "var(--color-background-danger)",
    border: "0.5px solid var(--color-border-danger)",
    borderRadius: "var(--border-radius-lg)",
    padding: "1.25rem 1.5rem",
  },
  successBanner: {
    background: "var(--color-background-success)",
    border: "0.5px solid var(--color-border-success)",
    borderRadius: "var(--border-radius-lg)",
    padding: "1.25rem 1.5rem",
  },
  ghostBtn: {
    padding: "6px 14px",
    borderRadius: "var(--border-radius-md)",
    border: "0.5px solid var(--color-border-secondary)",
    background: "transparent",
    color: "var(--color-text-secondary)",
    fontSize: 13,
    cursor: "pointer",
  },
  // Conflict modal
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    padding: "1rem",
  },
  modal: {
    background: "var(--color-background-primary)",
    border: "0.5px solid var(--color-border-secondary)",
    borderRadius: "var(--border-radius-lg)",
    padding: "1.5rem",
    width: "100%",
    maxWidth: 520,
    maxHeight: "80vh",
    overflowY: "auto",
  },
  conflictRow: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    padding: "12px 14px",
    background: "var(--color-background-secondary)",
    border: "0.5px solid var(--color-border-tertiary)",
    borderRadius: "var(--border-radius-md)",
  },
  conflictInput: {
    width: 72,
    padding: "5px 8px",
    borderRadius: "var(--border-radius-md)",
    border: "0.5px solid",
    background: "var(--color-background-primary)",
    color: "var(--color-text-primary)",
    fontSize: 13,
    outline: "none",
    textAlign: "right",
  },
  primaryBtn: {
    width: "100%",
    padding: "10px",
    borderRadius: "var(--border-radius-md)",
    border: "none",
    background: "var(--color-text-info, #378ADD)",
    color: "#fff",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
  },
};