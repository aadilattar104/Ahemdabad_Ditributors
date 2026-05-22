import { useState, useRef, useCallback, useEffect } from "react";
import { uploadFile, uploadModernTrade, getMtChains } from "../../services/api";

/**
 * UploadSection
 * =============
 * Drop-zone that supports two modes selected via a toggle:
 *   • "Distributor" — calls POST /upload with distributor_name
 *   • "Modern Trade" — shows chain dropdown/input, calls POST /upload/modern-trade
 *
 * Props:
 *   onSuccess(result) — called after a successful upload with the API response
 *   disabled          — disables the whole widget
 */
export default function UploadSection({ onSuccess, disabled = false }) {
  const inputRef = useRef();

  // ── Mode toggle ──────────────────────────────────────────────────────────
  const [mode, setMode] = useState("distributor"); // "distributor" | "mt"

  // ── Distributor state ────────────────────────────────────────────────────
  const [distributorName, setDistributorName] = useState("");

  // ── MT state ─────────────────────────────────────────────────────────────
  const [chains, setChains]         = useState([]);
  const [chainInput, setChainInput] = useState("");   // typed value
  const [chainName, setChainName]   = useState("");   // committed value (trimmed + uppercased)

  // ── Upload lifecycle ─────────────────────────────────────────────────────
  const [dragging, setDragging]     = useState(false);
  const [uploading, setUploading]   = useState(false);
  const [error, setError]           = useState(null);

  // Load existing MT chain names for the dropdown
  useEffect(() => {
    if (mode === "mt") {
      getMtChains()
        .then(setChains)
        .catch(() => setChains([]));
    }
  }, [mode]);

  // Handle file — called both from drop and from file input change
  const handleFile = useCallback(
    async (file) => {
      if (!file || disabled || uploading) return;
      setError(null);

      if (mode === "distributor") {
        setUploading(true);
        try {
          const result = await uploadFile(file, distributorName || undefined);
          onSuccess?.(result);
        } catch (e) {
          setError(e.message);
        } finally {
          setUploading(false);
        }
      } else {
        // Modern Trade
        const chain = chainName.trim().toUpperCase();
        if (!chain) {
          setError("Please enter or select an MT chain name before uploading.");
          return;
        }
        setUploading(true);
        try {
          const result = await uploadModernTrade(file, chain);
          onSuccess?.(result);
        } catch (e) {
          setError(e.message);
        } finally {
          setUploading(false);
        }
      }
    },
    [disabled, uploading, mode, distributorName, chainName, onSuccess]
  );

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  // Commit chain name when user selects from dropdown or blurs text input
  const commitChain = (val) => {
    setChainName(val.trim().toUpperCase());
  };

  return (
    <div style={styles.wrapper}>
      {/* ── Mode toggle ─────────────────────────────────────────────────── */}
      <div style={styles.toggleRow}>
        <button
          style={{ ...styles.toggleBtn, ...(mode === "distributor" ? styles.toggleActive : {}) }}
          onClick={() => { setMode("distributor"); setError(null); }}
          disabled={uploading}
        >
          <i className="ti ti-truck" style={{ marginRight: 6 }} />
          Distributor
        </button>
        <button
          style={{ ...styles.toggleBtn, ...(mode === "mt" ? styles.toggleActive : {}) }}
          onClick={() => { setMode("mt"); setError(null); }}
          disabled={uploading}
        >
          <i className="ti ti-building-store" style={{ marginRight: 6 }} />
          Modern Trade
        </button>
      </div>

      {/* ── Mode-specific inputs ─────────────────────────────────────────── */}
      {mode === "distributor" && (
        <div style={styles.inputRow}>
          <label style={styles.inputLabel}>Distributor Name (optional)</label>
          <input
            style={styles.textInput}
            type="text"
            placeholder="e.g. ICELAND, SYNERGY"
            value={distributorName}
            onChange={(e) => setDistributorName(e.target.value)}
            disabled={uploading || disabled}
          />
        </div>
      )}

      {mode === "mt" && (
        <div style={styles.inputRow}>
          <label style={styles.inputLabel}>MT Chain Name *</label>

          {/* Existing chains as quick-select chips */}
          {chains.length > 0 && (
            <div style={styles.chipRow}>
              {chains.map((c) => (
                <button
                  key={c.id}
                  style={{
                    ...styles.chip,
                    ...(chainName === c.chain_name ? styles.chipActive : {}),
                  }}
                  onClick={() => {
                    setChainInput(c.chain_name);
                    commitChain(c.chain_name);
                  }}
                  disabled={uploading || disabled}
                >
                  {c.chain_name}
                </button>
              ))}
            </div>
          )}

          {/* Free-text input for new chain */}
          <input
            style={styles.textInput}
            type="text"
            placeholder="e.g. RELIANCE, DMART, BIGBAZAAR"
            value={chainInput}
            onChange={(e) => {
              setChainInput(e.target.value);
              commitChain(e.target.value);
            }}
            onBlur={(e) => commitChain(e.target.value)}
            disabled={uploading || disabled}
          />
          {chainName && (
            <p style={styles.chainHint}>
              Will be stored as: <strong>{chainName}</strong>
            </p>
          )}
        </div>
      )}

      {/* ── Drop zone ────────────────────────────────────────────────────── */}
      <div
        role="button"
        tabIndex={disabled || uploading ? -1 : 0}
        aria-label="Upload Excel file"
        onClick={() => !disabled && !uploading && inputRef.current.click()}
        onKeyDown={(e) =>
          !disabled && !uploading && e.key === "Enter" && inputRef.current.click()
        }
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        style={{
          ...styles.dropZone,
          borderColor: dragging
            ? "var(--color-border-info, #3b82f6)"
            : "var(--color-border-secondary, #334155)",
          background: dragging
            ? "var(--color-background-info, rgba(59,130,246,0.06))"
            : "var(--color-background-primary, #0f172a)",
          opacity: disabled || uploading ? 0.5 : 1,
          cursor: disabled || uploading ? "default" : "pointer",
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          style={{ display: "none" }}
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />

        {uploading ? (
          <>
            <i
              className="ti ti-loader-2"
              style={{ ...styles.dropIcon, animation: "spin 1s linear infinite" }}
              aria-hidden
            />
            <p style={styles.dropText}>Uploading & extracting…</p>
            <p style={styles.dropSub}>This may take a few seconds</p>
          </>
        ) : (
          <>
            <i
              className={`ti ${mode === "mt" ? "ti-building-store" : "ti-file-spreadsheet"}`}
              style={styles.dropIcon}
              aria-hidden
            />
            <p style={styles.dropText}>
              {mode === "mt"
                ? "Drop your Modern Trade Excel file here"
                : "Drop your Distributor Excel file here"}
            </p>
            <p style={styles.dropSub}>or click to browse — .xlsx and .xls supported</p>
          </>
        )}
      </div>

      {/* ── Error banner ─────────────────────────────────────────────────── */}
      {error && (
        <div style={styles.errorBanner}>
          <i className="ti ti-alert-circle" style={{ marginRight: 6 }} />
          {error}
        </div>
      )}

      {/* Spin animation injected inline (no extra CSS file needed) */}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = {
  wrapper: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  toggleRow: {
    display: "flex",
    gap: 8,
  },
  toggleBtn: {
    flex: 1,
    padding: "10px 16px",
    borderRadius: 8,
    border: "1px solid var(--color-border-primary, #334155)",
    background: "var(--color-background-secondary, #1e293b)",
    color: "var(--color-text-secondary, #94a3b8)",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.15s",
  },
  toggleActive: {
    background: "#F97316",
    borderColor: "#F97316",
    color: "#fff",
  },
  inputRow: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--color-text-secondary, #64748b)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  textInput: {
    padding: "8px 12px",
    borderRadius: 6,
    border: "1px solid var(--color-border-primary, #334155)",
    background: "var(--color-background-primary, #0f172a)",
    color: "var(--color-text-primary, #f1f5f9)",
    fontSize: 13,
    outline: "none",
  },
  chipRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
  },
  chip: {
    padding: "4px 12px",
    borderRadius: 20,
    border: "1px solid var(--color-border-primary, #334155)",
    background: "var(--color-background-secondary, #1e293b)",
    color: "var(--color-text-primary, #f1f5f9)",
    fontSize: 12,
    cursor: "pointer",
  },
  chipActive: {
    background: "#F97316",
    borderColor: "#F97316",
    color: "#fff",
  },
  chainHint: {
    margin: 0,
    fontSize: 11,
    color: "var(--color-text-secondary, #64748b)",
  },
  dropZone: {
    border: "1.5px dashed",
    borderRadius: "var(--border-radius-lg, 12px)",
    padding: "3rem 2rem",
    textAlign: "center",
    transition: "border-color 0.15s, background 0.15s",
  },
  dropIcon: {
    fontSize: 36,
    color: "var(--color-text-secondary, #94a3b8)",
    display: "block",
    marginBottom: 12,
  },
  dropText: {
    margin: "0 0 4px",
    fontWeight: 500,
    color: "var(--color-text-primary, #f1f5f9)",
  },
  dropSub: {
    margin: 0,
    fontSize: 13,
    color: "var(--color-text-secondary, #64748b)",
  },
  errorBanner: {
    padding: "10px 14px",
    borderRadius: 8,
    background: "rgba(239,68,68,0.1)",
    border: "1px solid rgba(239,68,68,0.3)",
    color: "#f87171",
    fontSize: 13,
    display: "flex",
    alignItems: "center",
  },
};