import { useState, useRef, useCallback } from "react";

// Accepts a .xlsx or .xls file and calls onFile(file).
// Shows a warning banner + distributor name prompt if auto-detection fails.
export default function UploadSection({ onFile, disabled = false }) {
  const inputRef = useRef();
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file && !disabled) onFile(file);
    },
    [onFile, disabled]
  );

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label="Upload Excel file"
      onClick={() => !disabled && inputRef.current.click()}
      onKeyDown={(e) => !disabled && e.key === "Enter" && inputRef.current.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      style={{
        border: `1.5px dashed ${dragging ? "var(--color-border-info)" : "var(--color-border-secondary)"}`,
        borderRadius: "var(--border-radius-lg)",
        padding: "3rem 2rem",
        textAlign: "center",
        cursor: disabled ? "default" : "pointer",
        background: dragging
          ? "var(--color-background-info)"
          : "var(--color-background-primary)",
        transition: "border-color 0.15s, background 0.15s",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        style={{ display: "none" }}
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
      />
      <i
        className="ti ti-file-spreadsheet"
        style={{
          fontSize: 36,
          color: "var(--color-text-secondary)",
          display: "block",
          marginBottom: 12,
        }}
        aria-hidden
      />
      <p style={{ margin: "0 0 4px", fontWeight: 500 }}>
        Drop your Excel file here
      </p>
      <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-secondary)" }}>
        or click to browse — .xlsx and .xls supported
      </p>
    </div>
  );
}