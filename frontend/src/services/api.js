const BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:8000";

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

function qs(params = {}) {
  const p = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== "")
  );
  const s = new URLSearchParams(p).toString();
  return s ? "?" + s : "";
}

// ─── Distributor upload ───────────────────────────────────────────────────────
export async function uploadFile(file, distributorName) {
  const form = new FormData();
  form.append("file", file);
  if (distributorName) form.append("distributor_name", distributorName);
  return request("/upload", { method: "POST", body: form });
}

// ─── Modern Trade upload ──────────────────────────────────────────────────────
export async function uploadModernTrade(file, chainName) {
  const form = new FormData();
  form.append("file", file);
  form.append("chain_name", chainName);
  return request("/upload/modern-trade", { method: "POST", body: form });
}

// ─── Uploads history ─────────────────────────────────────────────────────────
export async function getUploads()          { return request("/uploads"); }
export async function getUploadById(id)     { return request(`/uploads/${id}`); }

// ─── Delete upload ────────────────────────────────────────────────────────────
export async function deleteUpload(uploadId) {
  return request(`/uploads/${uploadId}`, { method: "DELETE" });
}

// ─── Distributors ─────────────────────────────────────────────────────────────
export async function getDistributors()     { return request("/distributors"); }

// ─── Rename distributor globally ─────────────────────────────────────────────
export async function renameDistributor(oldName, newName) {
  return request("/distributors/rename", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ old_name: oldName, new_name: newName }),
  });
}

// ─── SKUs ─────────────────────────────────────────────────────────────────────
export async function getSkus()             { return request("/analytics/skus"); }

// ─── Analytics ────────────────────────────────────────────────────────────────
export async function getOverview(params = {})             { return request(`/analytics/overview${qs(params)}`); }
export async function getShops(params = {})                { return request(`/analytics/shops${qs(params)}`); }
export async function getMoMTrend(params = {})             { return request(`/analytics/mom-trend${qs(params)}`); }
export async function getTopShops(params = {})             { return request(`/analytics/top-shops${qs(params)}`); }
export async function getTopShopsByQty(params = {})        { return request(`/analytics/top-shops-by-qty${qs(params)}`); }
export async function getRecurringShops(params = {})       { return request(`/analytics/recurring-shops${qs(params)}`); }
export async function getTopShopsSkuBreakdown(params = {}) { return request(`/analytics/top-shops-sku-breakdown${qs(params)}`); }

// ─── Distributor MoM grouped (NEW) ───────────────────────────────────────────
export async function getDistributorMoM(params = {}) {
  return request(`/analytics/distributor-mom${qs(params)}`);
}

// ─── Export ───────────────────────────────────────────────────────────────────
export function getExcelExportUrl(params = {}) {
  return `${BASE_URL}/export/excel${qs(params)}`;
}

// ─── Modern Trade — chains & filters ─────────────────────────────────────────
export async function getMtChains()                        { return request("/mt/chains"); }
export async function getMtStores(params = {})             { return request(`/mt/analytics/stores${qs(params)}`); }
export async function getMtMonths(params = {})             { return request(`/mt/analytics/months${qs(params)}`); }
export async function getMtSkus(params = {})               { return request(`/mt/analytics/skus${qs(params)}`); }

// ─── Modern Trade — chart data ────────────────────────────────────────────────
export async function getMtRevenue(params = {})            { return request(`/mt/analytics/revenue${qs(params)}`); }
export async function getMtQty(params = {})                { return request(`/mt/analytics/qty${qs(params)}`); }
export async function getMtSoh(params = {})                { return request(`/mt/analytics/soh${qs(params)}`); }

// ─── Modern Trade — upload history ───────────────────────────────────────────
export async function getMtUploads(params = {})            { return request(`/mt/uploads${qs(params)}`); }
export async function getMargins(params = {})              { return request(`/margins${qs(params)}`); }
// ─── Save single margin inline (NEW) ─────────────────────────────────────────
export async function saveMargin(shopName, distributorName, marginPct) {
  return request("/margins/save-one", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shop_name: shopName, distributor_name: distributorName, margin_pct: marginPct }),
  });
}