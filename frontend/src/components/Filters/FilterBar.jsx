import { useState, useEffect, useRef } from "react";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 4 }, (_, i) => currentYear - i);
const CATEGORIES = ["Namkeen", "Khakhara"];

function MultiSelect({ label, options, selected = [], onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const toggle = (val) => {
    const next = selected.includes(val)
      ? selected.filter(v => v !== val)
      : [...selected, val];
    onChange(next);
  };

  const isActive = selected.length > 0;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          fontSize: 13, padding: "5px 10px",
          borderRadius: "var(--border-radius-md)",
          border: isActive
            ? "0.5px solid var(--color-text-info, #378ADD)"
            : "0.5px solid var(--color-border-secondary)",
          background: isActive
            ? "rgba(55,138,221,0.07)"
            : "var(--color-background-primary)",
          color: isActive
            ? "var(--color-text-info, #378ADD)"
            : "var(--color-text-secondary)",
          cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
          whiteSpace: "nowrap",
        }}
      >
        {isActive ? `${label}: ${selected.length}` : `All ${label}`}
        <i className="ti ti-chevron-down" style={{ fontSize: 11 }} aria-hidden />
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 200,
          background: "var(--color-background-primary)",
          border: "0.5px solid var(--color-border-secondary)",
          borderRadius: "var(--border-radius-md)",
          boxShadow: "0 4px 16px rgba(0,0,0,0.10)",
          minWidth: 180, maxHeight: 260, overflowY: "auto",
          padding: "4px 0",
        }}>
          {options.map(opt => {
            const sel = selected.includes(opt);
            return (
              <div
                key={opt}
                onClick={() => toggle(opt)}
                style={{
                  padding: "7px 12px", fontSize: 13, cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 8,
                  background: sel ? "rgba(55,138,221,0.06)" : "transparent",
                  color: sel ? "var(--color-text-info, #378ADD)" : "var(--color-text-primary)",
                }}
              >
                <span style={{
                  width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                  border: sel
                    ? "1.5px solid var(--color-text-info, #378ADD)"
                    : "1.5px solid var(--color-border-secondary)",
                  background: sel ? "var(--color-text-info, #378ADD)" : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {sel && <i className="ti ti-check" style={{ fontSize: 9, color: "#fff" }} />}
                </span>
                {opt}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function FilterBar({ filters = {}, onChange, distributors = [], skus = [], cities = [] }) {
  const update = (key, value) => onChange({ ...filters, [key]: value });
  const updateCategory = (val) => onChange({ ...filters, category: val, sku: [] });

  const filteredSkus = filters.category
    ? skus.filter(s => typeof s === "string" ? true : s.category === filters.category)
    : skus;
  const skuNames = filteredSkus.map(s => typeof s === "string" ? s : s.name);

  const hasFilter =
    (filters.month?.length > 0) || (filters.year?.length > 0) ||
    (filters.distributor?.length > 0) || (filters.sku?.length > 0) ||
    (filters.city?.length > 0) || filters.category;

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <MultiSelect
        label="months"
        options={MONTHS}
        selected={filters.month || []}
        onChange={v => update("month", v)}
      />
      <MultiSelect
        label="years"
        options={YEARS.map(String)}
        selected={(filters.year || []).map(String)}
        onChange={v => update("year", v)}
      />
      <MultiSelect
        label="distributors"
        options={distributors}
        selected={filters.distributor || []}
        onChange={v => update("distributor", v)}
      />

      {/* Category stays single select */}
      <select
        value={filters.category || ""}
        onChange={e => updateCategory(e.target.value)}
        style={{
          fontSize: 13, padding: "5px 8px",
          borderRadius: "var(--border-radius-md)",
          border: filters.category
            ? "0.5px solid var(--color-text-info, #378ADD)"
            : "0.5px solid var(--color-border-secondary)",
          background: filters.category ? "rgba(55,138,221,0.07)" : "var(--color-background-primary)",
          color: filters.category ? "var(--color-text-info, #378ADD)" : "var(--color-text-secondary)",
        }}
      >
        <option value="">All categories</option>
        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
      </select>

      <MultiSelect
        label="SKUs"
        options={skuNames}
        selected={filters.sku || []}
        onChange={v => update("sku", v)}
      />

      {cities.length > 0 && (
        <MultiSelect
          label="cities"
          options={cities}
          selected={filters.city || []}
          onChange={v => update("city", v)}
        />
      )}

      {hasFilter && (
        <button
          onClick={() => onChange({ month: [], year: [], distributor: [], sku: [], city: [], category: "" })}
          style={{
            fontSize: 12, display: "flex", alignItems: "center", gap: 4,
            color: "var(--color-text-secondary)", background: "transparent",
            border: "none", cursor: "pointer",
          }}
        >
          <i className="ti ti-x" style={{ fontSize: 13 }} aria-hidden /> Clear filters
        </button>
      )}
    </div>
  );
}