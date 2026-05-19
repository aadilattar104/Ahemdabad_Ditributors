const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 4 }, (_, i) => currentYear - i);

export default function FilterBar({ filters = {}, onChange, distributors = [], skus = [] }) {
  const update = (key, value) => onChange({ ...filters, [key]: value });
  const hasFilter = filters.month || filters.year || filters.distributor || filters.sku;

  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
      <select value={filters.month || ""} onChange={(e) => update("month", e.target.value)}>
        <option value="">All months</option>
        {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>

      <select value={filters.year || ""} onChange={(e) => update("year", e.target.value)}>
        <option value="">All years</option>
        {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>

      <select value={filters.distributor || ""} onChange={(e) => update("distributor", e.target.value)}>
        <option value="">All distributors</option>
        {distributors.map((d) => <option key={d} value={d}>{d}</option>)}
      </select>

      <select value={filters.sku || ""} onChange={(e) => update("sku", e.target.value)}>
        <option value="">All SKUs</option>
        {skus.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>

      {hasFilter && (
        <button onClick={() => onChange({ month: "", year: "", distributor: "", sku: "" })}
          style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4, color: "var(--color-text-secondary)" }}>
          <i className="ti ti-x" style={{ fontSize: 13 }} aria-hidden /> Clear filters
        </button>
      )}
    </div>
  );
}