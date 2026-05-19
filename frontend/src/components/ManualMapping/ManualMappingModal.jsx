import ColumnMapper from "./ColumnMapper";
import ExtractionPreview from "./ExtractionPreview";
import { useState } from "react";

// Shown when the backend cannot auto-detect the file format.
// Walks the user through mapping columns to known fields, then previews the result.
// onConfirm(mapping) submits the mapping to the backend.
// onClose dismisses without saving.
export default function ManualMappingModal({ filename, columns, previewRows, onConfirm, onClose }) {
  const [mapping, setMapping] = useState({});
  const [step, setStep] = useState("map"); // "map" | "preview"

  const handleMappingChange = (field, col) => {
    setMapping((prev) => ({ ...prev, [field]: col }));
  };

  const handleNext = () => {
    const required = ["shop_name", "qty", "revenue"];
    const missing = required.filter((f) => !mapping[f]);
    if (missing.length > 0) {
      alert(`Please map the following required fields: ${missing.join(", ")}`);
      return;
    }
    setStep("preview");
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Manual column mapping"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "1rem",
      }}
    >
      <div
        style={{
          background: "var(--color-background-primary)",
          borderRadius: "var(--border-radius-lg)",
          border: "0.5px solid var(--color-border-tertiary)",
          width: "100%",
          maxWidth: 680,
          maxHeight: "90vh",
          overflow: "auto",
          padding: "1.5rem",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.25rem" }}>
          <div>
            <p style={{ margin: 0, fontWeight: 500, fontSize: 16 }}>Manual column mapping</p>
            <p style={{ margin: "3px 0 0", fontSize: 13, color: "var(--color-text-secondary)" }}>
              {filename} — unknown format detected
            </p>
          </div>
          <button onClick={onClose} aria-label="Close">
            <i className="ti ti-x" style={{ fontSize: 16 }} aria-hidden />
          </button>
        </div>

        {/* Step indicator */}
        <div style={{ display: "flex", gap: 8, marginBottom: "1.5rem" }}>
          {["map", "preview"].map((s, i) => (
            <div key={s} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <div style={{
                width: 22, height: 22, borderRadius: "50%", display: "flex",
                alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 500,
                background: step === s ? "var(--color-background-info)" : "var(--color-background-secondary)",
                color: step === s ? "var(--color-text-info)" : "var(--color-text-tertiary)",
                border: `0.5px solid ${step === s ? "var(--color-border-info)" : "var(--color-border-tertiary)"}`,
              }}>
                {i + 1}
              </div>
              <span style={{ color: step === s ? "var(--color-text-primary)" : "var(--color-text-tertiary)" }}>
                {s === "map" ? "Map columns" : "Preview extraction"}
              </span>
              {i === 0 && <i className="ti ti-chevron-right" style={{ fontSize: 13, color: "var(--color-text-tertiary)" }} aria-hidden />}
            </div>
          ))}
        </div>

        {step === "map" && (
          <>
            <ColumnMapper columns={columns} mapping={mapping} onChange={handleMappingChange} />
            <div style={{ marginTop: "1.5rem", display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={onClose}>Cancel</button>
              <button onClick={handleNext}>Preview extraction →</button>
            </div>
          </>
        )}

        {step === "preview" && (
          <>
            <ExtractionPreview mapping={mapping} previewRows={previewRows} columns={columns} />
            <div style={{ marginTop: "1.5rem", display: "flex", justifyContent: "space-between" }}>
              <button onClick={() => setStep("map")}>← Back</button>
              <button onClick={() => onConfirm(mapping)}>Confirm &amp; extract</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}