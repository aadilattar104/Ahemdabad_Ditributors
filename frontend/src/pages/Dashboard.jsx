import { useState, useEffect } from "react";
import OverviewCards from "../components/Analytics/OverviewCards";
import DistributorTable from "../components/Analytics/DistributorTable";
import ShopTable from "../components/Analytics/ShopTable";
import TopShopsChart from "../components/Analytics/TopShopsChart";
import TopShopsByQtyChart from "../components/Analytics/TopShopsByQtyChart";
import MoMTrendChart from "../components/Analytics/MoMTrendChart";
import FilterBar from "../components/Filters/FilterBar";
import RecurringShopsTable from "../components/RecurringShops/RecurringShopsTable";
import {
  getOverview, getShops, getMoMTrend, getTopShops,
  getTopShopsByQty, getDistributors, getSkus, getRecurringShops,
  getTopShopsSkuBreakdown,
} from "../services/api";

export default function Dashboard() {
  const [filters, setFilters]         = useState({ month: "", year: "", distributor: "", sku: "" });
  const [distributors, setDistributors] = useState([]);
  const [skus, setSkus]               = useState([]);
  const [overview, setOverview]       = useState(null);
  const [shops, setShops]             = useState([]);
  const [trend, setTrend]             = useState([]);
  const [topRev, setTopRev]           = useState([]);
  const [topQty, setTopQty]           = useState([]);
  const [recurring, setRecurring]     = useState([]);
  const [skuBreakdown, setSkuBreakdown] = useState({ by_revenue: [], by_qty: [] });
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState("");

  // Load distributors + SKUs once
  useEffect(() => {
    getDistributors().then((d) => setDistributors(d.map((x) => x.distributor_name))).catch(() => {});
    getSkus().then(setSkus).catch(() => {});
  }, []);

  // Reload when filters change
  useEffect(() => {
    const p = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
    setLoading(true);
    setError("");
    Promise.all([
      getOverview(p),
      getShops(p),
      getMoMTrend(p),
      getTopShops({ ...p, limit: 10 }),
      getTopShopsByQty({ ...p, limit: 10 }),
      getRecurringShops(p),
      getTopShopsSkuBreakdown({ ...p, limit: 10 }),
    ])
      .then(([ov, sh, tr, tRev, tQty, rec, skuBd]) => {
        setOverview(ov);
        setShops(sh);
        setTrend(tr);
        setTopRev(tRev);
        setTopQty(tQty);
        setRecurring(rec);
        setSkuBreakdown(skuBd || { by_revenue: [], by_qty: [] });
      })
      .catch((e) => setError(e.message || "Failed to load data"))
      .finally(() => setLoading(false));
  }, [filters]);

  return (
    <div style={{ padding: "2rem 2.5rem" }}>

      {/* Header + filters */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "2rem", flexWrap: "wrap", gap: 12 }}>
        <div>
          <p style={{ margin: 0, fontWeight: 600, fontSize: 24 }}>Dashboard</p>
          <p style={{ margin: "4px 0 0", fontSize: 15, color: "var(--color-text-secondary)" }}>
            Shop-wise sales analytics across all distributors
          </p>
        </div>
        <FilterBar filters={filters} onChange={setFilters} distributors={distributors} skus={skus} />
      </div>

      {error && (
        <div style={{ background: "var(--color-background-danger)", border: "0.5px solid var(--color-border-danger)", borderRadius: "var(--border-radius-md)", padding: "12px 16px", fontSize: 14, color: "var(--color-text-danger)", marginBottom: "1.5rem" }}>
          <i className="ti ti-circle-x" style={{ fontSize: 15, marginRight: 6 }} aria-hidden />{error}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>

        {/* Overview cards */}
        <OverviewCards data={overview} loading={loading} />

        {/* Top shops by revenue — full width */}
        <TopShopsChart data={topRev} skuData={skuBreakdown.by_revenue} loading={loading} />

        {/* Top shops by qty — full width */}
        <TopShopsByQtyChart data={topQty} skuData={skuBreakdown.by_qty} loading={loading} />

        {/* MoM trend — full width */}
        <MoMTrendChart data={trend} loading={loading} />

        {/* By distributor table */}
        <DistributorTable rows={overview?.by_distributor || []} loading={loading} />

        {/* All shops table */}
        <ShopTable rows={shops} loading={loading} />

        {/* Recurring shops */}
        <RecurringShopsTable rows={recurring} loading={loading} />

      </div>
    </div>
  );
}