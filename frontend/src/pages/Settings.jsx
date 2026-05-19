import { useState } from "react";

export default function Settings() {
  const [apiUrl, setApiUrl] = useState(
    process.env.REACT_APP_API_URL || "http://localhost:8000"
  );
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    // In production, these would be environment variables set at build time.
    // This UI is for local dev awareness / documentation purposes.
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "2rem 1rem" }}>
      <h1 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 500 }}>Settings</h1>
      <p style={{ margin: "0 0 2rem", fontSize: 14, color: "var(--color-text-secondary)" }}>
        Configuration for the Excel Intelligence system
      </p>

      <div style={{
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: "var(--border-radius-lg)",
        overflow: "hidden",
      }}>
        <div style={{ padding: "1rem 1.25rem", borderBottom: "0.5px solid var(--color-border-tertiary)", background: "var(--color-background-secondary)" }}>
          <p style={{ margin: 0, fontWeight: 500, fontSize: 14 }}>API configuration</p>
        </div>

        <div style={{ padding: "1.25rem" }}>
          <div style={{ marginBottom: "1.25rem" }}>
            <label style={{ display: "block", fontWeight: 500, fontSize: 14, marginBottom: 6 }}>
              Backend API URL
            </label>
            <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--color-text-secondary)" }}>
              Set via <code>REACT_APP_API_URL</code> environment variable at build time
            </p>
            <input
              type="text"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              style={{ width: "100%", boxSizing: "border-box" }}
              readOnly
            />
          </div>

          <div style={{ padding: "12px 16px", background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", fontSize: 13, color: "var(--color-text-secondary)", marginBottom: "1.25rem" }}>
            <p style={{ margin: "0 0 6px", fontWeight: 500, color: "var(--color-text-primary)" }}>Environment variables</p>
            <p style={{ margin: "0 0 4px" }}><code>REACT_APP_API_URL</code> — FastAPI backend URL</p>
            <p style={{ margin: 0 }}><code>REACT_APP_SUPABASE_URL</code> — Supabase project URL (if using Supabase JS client)</p>
          </div>

          <button onClick={handleSave} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            {saved
              ? <><i className="ti ti-check" style={{ fontSize: 14 }} aria-hidden /> Saved</>
              : <><i className="ti ti-device-floppy" style={{ fontSize: 14 }} aria-hidden /> Save</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}