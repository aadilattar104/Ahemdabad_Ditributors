import { useState, useEffect, useCallback } from "react";
import Dashboard from "./pages/Dashboard";
import Upload from "./pages/Upload";
import UploadHistory from "./pages/UploadHistory";
import Settings from "./pages/Settings";
import ModernTradeAnalytics from "./pages/ModernTradeAnalytics";
import { getDistributors, getSkus } from "./services/api";

const NAV = [
  { key: "dashboard",      label: "Distributor Dashboard", icon: "chart-bar" },
  { key: "modern-trade",   label: "Modern Trade",          icon: "building-store" },
  { key: "upload",         label: "Upload file",           icon: "upload" },
  { key: "upload-history", label: "Upload history",        icon: "history" },
  { key: "settings",       label: "Settings",              icon: "settings" },
];

function NavItem({ item, active, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        padding: "9px 14px",
        borderRadius: "var(--border-radius-md)",
        textAlign: "left",
        fontSize: 14,
        fontWeight: active ? 500 : 400,
        background: active ? "var(--color-background-secondary)" : "transparent",
        color: active ? "var(--color-text-primary)" : "var(--color-text-secondary)",
        border: active ? "0.5px solid var(--color-border-tertiary)" : "0.5px solid transparent",
      }}
    >
      <i className={`ti ti-${item.icon}`} style={{ fontSize: 16 }} aria-hidden />
      {item.label}
    </button>
  );
}

export default function App() {
  const [page, setPage] = useState("dashboard");

  // ── Shared distributor + SKU list ────────────────────────────────────────
  // Lifted here so Dashboard and UploadHistory both see the same up-to-date list.
  // Call refreshDistributors() after any delete or rename to keep everything in sync.
  const [distributors, setDistributors] = useState([]);
  const [skus, setSkus]                 = useState([]);

  const refreshDistributors = useCallback(() => {
    getDistributors()
      .then((d) => setDistributors(d.map((x) => x.distributor_name)))
      .catch(() => {});
    getSkus().then(setSkus).catch(() => {});
  }, []);

  // Load once on mount
  useEffect(() => { refreshDistributors(); }, [refreshDistributors]);

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--color-background-tertiary, #f9f9f8)" }}>
      {/* Sidebar */}
      <nav
        aria-label="Main navigation"
        style={{
          width: 220,
          flexShrink: 0,
          borderRight: "0.5px solid var(--color-border-tertiary)",
          background: "var(--color-background-primary)",
          padding: "1.5rem 12px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <div style={{ padding: "0 14px 1.5rem", marginBottom: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <i className="ti ti-table-import" style={{ fontSize: 20, color: "var(--color-text-info)" }} aria-hidden />
            <p style={{ margin: 0, fontWeight: 500, fontSize: 15 }}>Excel Intelligence</p>
          </div>
        </div>

        {NAV.map((item) => (
          <NavItem
            key={item.key}
            item={item}
            active={page === item.key}
            onClick={() => setPage(item.key)}
          />
        ))}
      </nav>

      {/* Main content — conditional render so pages remount on navigation */}
      <main style={{ flex: 1, overflowY: "auto" }}>
        {page === "dashboard" && (
          <Dashboard
            distributors={distributors}
            skus={skus}
            onDistributorsChange={refreshDistributors}
          />
        )}
        {page === "modern-trade"    && <ModernTradeAnalytics />}
        {page === "upload"          && <Upload onUploadSuccess={refreshDistributors} />}
        {page === "upload-history"  && (
          <UploadHistory onDistributorsChange={refreshDistributors} />
        )}
        {page === "settings"        && <Settings />}
      </main>
    </div>
  );
}