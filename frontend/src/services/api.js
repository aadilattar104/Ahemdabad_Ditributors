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
  const p = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== ""));
  const s = new URLSearchParams(p).toString();
  return s ? "?" + s : "";
}

// Upload
export async function uploadFile(file, distributorName) {
  const form = new FormData();
  form.append("file", file);
  if (distributorName) form.append("distributor_name", distributorName);
  return request("/upload", { method: "POST", body: form });
}

// Uploads history
export async function getUploads() { return request("/uploads"); }
export async function getUploadById(id) { return request(`/uploads/${id}`); }

// Distributors
export async function getDistributors() { return request("/distributors"); }

// SKUs
export async function getSkus() { return request("/analytics/skus"); }

// Analytics — all accept { month, year, distributor, sku }
export async function getOverview(params = {})      { return request(`/analytics/overview${qs(params)}`); }
export async function getShops(params = {})         { return request(`/analytics/shops${qs(params)}`); }
export async function getMoMTrend(params = {})      { return request(`/analytics/mom-trend${qs(params)}`); }
export async function getTopShops(params = {})      { return request(`/analytics/top-shops${qs(params)}`); }
export async function getTopShopsByQty(params = {}) { return request(`/analytics/top-shops-by-qty${qs(params)}`); }
export async function getRecurringShops(params = {})        { return request(`/analytics/recurring-shops${qs(params)}`); }
export async function getTopShopsSkuBreakdown(params = {}) { return request(`/analytics/top-shops-sku-breakdown${qs(params)}`); }

// Export
export function getExcelExportUrl(params = {}) { return `${BASE_URL}/export/excel${qs(params)}`; }