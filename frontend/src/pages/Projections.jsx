import { useState, useEffect } from "react";
import ProjectionOverviewCards from "../components/Analytics/ProjectionOverviewCards";
import ProjectionTable from "../components/Analytics/ProjectionTable";
import ProjectionRemarksModal from "../components/Analytics/ProjectionRemarksModal";
import { getProjection, getDistributors, getProjectionRemarks } from "../services/api";

export default function Projections() {
  const [distributor, setDistributor]   = useState("");
  const [distributors, setDistributors] = useState([]);
  const [data, setData]                 = useState(null);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState("");
  const [showRemarks, setShowRemarks]   = useState(false);
  const [remarkCount, setRemarkCount]   = useState(0);

  useEffect(() => {
    getDistributors()
      .then((d) => setDistributors(d.map((x) => x.distributor_name)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true); setError("");
    getProjection({ distributor: distributor || undefined })
      .then((d) => { if (d?.error) { setError(d.error); setData(null); } else setData(d); })
      .catch((e) => setError(e.message || "Failed to load projection"))
      .finally(() => setLoading(false));
  }, [distributor]);

  // Load remark count for badge on button
  const loadRemarkCount = () => {
    getProjectionRemarks()
      .then((rows) => setRemarkCount(rows.length))
      .catch(() => {});
  };
  useEffect(() => { loadRemarkCount(); }, []);

  return (
    <div style={{ padding: "2rem 2.5rem" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "2rem", flexWrap: "wrap", gap: 12 }}>
        <div>
          <p style={{ margin: 0, fontWeight: 600, fontSize: 24 }}>Revenue Projections</p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* ── Remarks button ── */}
          <button
            onClick={() => setShowRemarks(true)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              fontSize: 13, padding: "6px 12px", cursor: "pointer",
              background: "transparent",
              border: "0.5px solid var(--color-border-secondary)",
              borderRadius: "var(--border-radius-md)",
              color: "var(--color-text-secondary)",
            }}
          >
            <i className="ti ti-message-circle" style={{ fontSize: 15 }} aria-hidden />
            Remarks
            {remarkCount > 0 && (
              <span style={{
                fontSize: 11, fontWeight: 600, padding: "1px 6px",
                borderRadius: 20, marginLeft: 2,
                background: "var(--color-text-info, #378ADD)",
                color: "#fff",
              }}>
                {remarkCount}
              </span>
            )}
          </button>

          {/* Distributor filter */}
          <label style={{ fontSize: 13, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
            Distributor
          </label>
          <select
            value={distributor}
            onChange={(e) => setDistributor(e.target.value)}
            style={{ fontSize: 13, padding: "6px 10px", minWidth: 160 }}
          >
            <option value="">All distributors</option>
            {distributors.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          {distributor && (
            <button
              onClick={() => setDistributor("")}
              style={{
                fontSize: 12, padding: "5px 10px", cursor: "pointer",
                background: "transparent",
                border: "0.5px solid var(--color-border-secondary)",
                borderRadius: "var(--border-radius-md)",
                color: "var(--color-text-secondary)",
                display: "flex", alignItems: "center", gap: 4,
              }}
            >
              <i className="ti ti-x" style={{ fontSize: 12 }} aria-hidden /> Clear
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          background: "var(--color-background-danger)",
          border: "0.5px solid var(--color-border-danger)",
          borderRadius: "var(--border-radius-md)",
          padding: "12px 16px", fontSize: 14,
          color: "var(--color-text-danger)", marginBottom: "1.5rem",
        }}>
          <i className="ti ti-circle-x" style={{ fontSize: 15, marginRight: 6 }} aria-hidden />{error}
        </div>
      )}

      <div style={{ marginBottom: "2rem" }}>
        <ProjectionOverviewCards data={data} loading={loading} />
      </div>

      <ProjectionTable data={data} loading={loading} />

      {/* Remarks modal */}
      {showRemarks && (
        <ProjectionRemarksModal
          onClose={() => { setShowRemarks(false); loadRemarkCount(); }}
        />
      )}
    </div>
  );
}