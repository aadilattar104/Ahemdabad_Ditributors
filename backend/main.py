import os
import uuid
import io
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, Response
from analytics.aggregator import get_projection

from database.supabase_client import get_supabase
from extraction import run_extraction_pipeline
from analytics.aggregator import (get_cities, get_projection,
    get_overview, get_shops, get_mom_trend, get_top_shops,
    get_top_shops_by_qty, get_skus, get_recurring_shops,
    get_top_shops_sku_breakdown,
)
from exports.exporter import export_to_excel, export_audit_csv
from analytics.aggregator import get_distributor_mom
from analytics.aggregator import _load_sku_maps_mt, _apply_sku_filter_mt, _norm_sku_mt

app = FastAPI(title="Excel Intelligence API", version="1.0.0")

# ── CORS ───────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

FILES_BUCKET = os.getenv("SUPABASE_FILES_BUCKET", "distributor-files")


# ─────────────────────────────────────────────────────────────────────────────
# UPLOAD
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    distributor_name: str = Form(None),
):
    sb = get_supabase()
    file_bytes = await file.read()
    filename = file.filename or "upload.xlsx"

    # 1. Create upload audit row (pending)
    upload_id = str(uuid.uuid4())
    sb.table("uploads").insert({
        "id": upload_id,
        "filename": filename,
        "distributor_name": distributor_name or "UNKNOWN",
        "status": "pending",
    }).execute()

    # 2. Upload raw file to Supabase Storage
    storage_path = f"{distributor_name or 'unknown'}/{upload_id}/{filename}"
    try:
        sb.storage.from_(FILES_BUCKET).upload(
            path=storage_path,
            file=file_bytes,
            file_options={"content-type": file.content_type or "application/octet-stream"},
        )
    except Exception as e:
        # Non-fatal — storage failure should not block extraction
        storage_path = None

    # 3. Ensure distributor exists in DB
    if distributor_name:
        existing = sb.table("distributors").select("id").eq("distributor_name", distributor_name).execute()
        if not existing.data:
            sb.table("distributors").insert({
                "distributor_name": distributor_name,
                "status": "ACTIVE",
            }).execute()

    # 4. Run extraction pipeline
    import traceback as _tb
    try:
        result = run_extraction_pipeline(
            file_bytes=file_bytes,
            filename=filename,
            distributor_name=distributor_name or "UNKNOWN",
            upload_id=upload_id,
        )
    except Exception as e:
        print(f"[EXTRACTION ERROR] {str(e)}")
        _tb.print_exc()
        sb.table("uploads").update({
            "status": "error",
            "error_message": str(e),
            "storage_path": storage_path,
        }).eq("id", upload_id).execute()
        raise HTTPException(status_code=422, detail=f"Extraction failed: {str(e)}")

    # DEBUG logging
    print(f"[UPLOAD] file={filename} distributor={distributor_name}")
    print(f"[EXTRACTION] format={result['format']} month={result['month']} year={result['year']}")
    print(f"[EXTRACTION] records={result['record_count']} skipped={len(result['skipped'])}")
    if result['records']:
        print(f"[EXTRACTION] sample: {result['records'][:2]}")
    else:
        print("[EXTRACTION] WARNING: 0 records extracted")

    # 5. Insert sales records into DB
    if result["records"]:
        sb.table("sales_records").insert(result["records"]).execute()
        print(f"[DB] Inserted {len(result['records'])} rows into sales_records")
    else:
        print("[DB] Nothing to insert")

    # 5b. Upsert margins if extracted (Pattern C / Mumbai format)
    if result.get("margin_records"):
        for m in result["margin_records"]:
            sb.table("shop_margins").upsert(
                m, on_conflict="shop_name,distributor_name"
            ).execute()
        print(f"[DB] Upserted {len(result['margin_records'])} margin rows")

    # 6. Update upload audit row to success
    sb.table("uploads").update({
        "status": "success",
        "distributor_name": distributor_name or "UNKNOWN",
        "month": result["month"],
        "year": result["year"],
        "format_detected": result["format"],
        "record_count": result["record_count"],
        "storage_path": storage_path,
    }).eq("id", upload_id).execute()

    return {
        "upload_id": upload_id,
        "distributor_name": distributor_name,
        "format": result["format"],
        "month": result["month"],
        "year": result["year"],
        "record_count": result["record_count"],
        "skipped_count": len(result["skipped"]),
    }


# ─────────────────────────────────────────────────────────────────────────────
# UPLOADS HISTORY
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/uploads")
def list_uploads():
    sb = get_supabase()
    result = sb.table("uploads").select("*").order("uploaded_at", desc=True).execute()
    return result.data


@app.get("/uploads/{upload_id}")
def get_upload(upload_id: str):
    sb = get_supabase()
    result = sb.table("uploads").select("*").eq("id", upload_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Upload not found")
    upload = result.data[0]
    records = sb.table("sales_records").select("*").eq("upload_id", upload_id).execute()
    upload["records"] = records.data
    return upload


# ─────────────────────────────────────────────────────────────────────────────
# DELETE UPLOAD
# Removes the upload row, all its sales_records, and the storage file.
# ─────────────────────────────────────────────────────────────────────────────

@app.delete("/uploads/{upload_id}")
def delete_upload(upload_id: str):
    sb = get_supabase()

    # Fetch upload to get distributor_name + storage_path before deleting
    row = sb.table("uploads").select("id, storage_path, distributor_name").eq("id", upload_id).execute()
    if not row.data:
        raise HTTPException(status_code=404, detail="Upload not found")

    storage_path     = row.data[0].get("storage_path")
    distributor_name = row.data[0].get("distributor_name")

    # Delete sales_records first
    sb.table("sales_records").delete().eq("upload_id", upload_id).execute()

    # Delete upload row
    sb.table("uploads").delete().eq("id", upload_id).execute()

    # Clean up distributors table:
    # If no remaining uploads exist for this distributor, remove it from distributors table.
    if distributor_name:
        remaining = sb.table("uploads").select("id").eq("distributor_name", distributor_name).execute()
        if not remaining.data:
            sb.table("distributors").delete().eq("distributor_name", distributor_name).execute()
            print(f"[DELETE] Removed distributor '{distributor_name}' — no uploads remain")

    # Delete file from storage (non-fatal)
    if storage_path:
        try:
            sb.storage.from_(FILES_BUCKET).remove([storage_path])
        except Exception as e:
            print(f"[DELETE] Storage removal failed (non-fatal): {e}")

    return {"ok": True, "deleted_upload_id": upload_id}


@app.delete("/distributors/cleanup-orphans")
def cleanup_orphan_distributors():
    """
    One-time cleanup: removes distributor rows that have no uploads.
    Call once from browser/Postman to fix existing stale data.
    GET http://localhost:8000/distributors/cleanup-orphans  (use DELETE method)
    """
    sb = get_supabase()
    all_dists = sb.table("distributors").select("id, distributor_name").execute().data
    removed = []
    for d in all_dists:
        uploads = sb.table("uploads").select("id").eq("distributor_name", d["distributor_name"]).execute()
        if not uploads.data:
            sb.table("distributors").delete().eq("id", d["id"]).execute()
            removed.append(d["distributor_name"])
            print(f"[CLEANUP] Removed orphan distributor: '{d['distributor_name']}'")
    return {"removed": removed, "count": len(removed)}


# ─────────────────────────────────────────────────────────────────────────────
# DISTRIBUTORS
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/distributors")
def list_distributors():
    sb = get_supabase()
    result = sb.table("distributors").select("*").order("distributor_name").execute()
    return result.data


@app.post("/distributors")
def create_distributor(body: dict):
    sb = get_supabase()
    name = body.get("distributor_name", "").strip().upper()
    if not name:
        raise HTTPException(status_code=400, detail="distributor_name is required")
    existing = sb.table("distributors").select("id").eq("distributor_name", name).execute()
    if existing.data:
        raise HTTPException(status_code=409, detail="Distributor already exists")
    result = sb.table("distributors").insert({"distributor_name": name, "status": "ACTIVE"}).execute()
    return result.data[0]


# ─────────────────────────────────────────────────────────────────────────────
# RENAME DISTRIBUTOR — MUST be before /distributors/{dist_id} to avoid conflict
# Body: { "old_name": "Synergy", "new_name": "SYNERGY" }
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/distributors/rename")
def rename_distributor(body: dict):
    sb = get_supabase()

    old_name = (body.get("old_name") or "").strip().upper()
    new_name = (body.get("new_name") or "").strip().upper()

    if not old_name or not new_name:
        raise HTTPException(status_code=400, detail="old_name and new_name are required")
    if old_name.upper() == new_name:
        raise HTTPException(status_code=400, detail="Names are already the same")

    # 1. Update all uploads rows with this distributor name
    sb.table("uploads").update({"distributor_name": new_name}).eq("distributor_name", old_name).execute()

    # 2. Update all sales_records rows
    sb.table("sales_records").update({"distributor_name": new_name}).eq("distributor_name", old_name).execute()

    # 3. Update distributors table — if new_name already exists, delete the old row to avoid duplicate
    existing_new = sb.table("distributors").select("id").eq("distributor_name", new_name).execute()
    if existing_new.data:
        # new_name already exists → just delete the old_name row (merge)
        sb.table("distributors").delete().eq("distributor_name", old_name).execute()
    else:
        # rename the distributors row itself
        sb.table("distributors").update({"distributor_name": new_name}).eq("distributor_name", old_name).execute()

    return {"ok": True, "old_name": old_name, "new_name": new_name}


@app.patch("/distributors/{dist_id}")
def update_distributor(dist_id: str, body: dict):
    sb = get_supabase()
    update_data = {}
    if "status" in body:
        update_data["status"] = body["status"]
    if "replaced_by" in body:
        update_data["replaced_by"] = body["replaced_by"]
    if not update_data:
        raise HTTPException(status_code=400, detail="Nothing to update")
    result = sb.table("distributors").update(update_data).eq("id", dist_id).execute()
    return result.data[0] if result.data else {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# ANALYTICS
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/analytics/overview")
def analytics_overview(
    month: str = Query(None),
    year: int = Query(None),
    distributor: str = Query(None),
    sku: str = Query(None),
    city: str = Query(None),
    category: str = Query(None),
):
    return get_overview(month=month, year=year, distributor=distributor, sku=sku, city=city, category=category)


@app.get("/analytics/shops")
def analytics_shops(
    month: str = Query(None),
    year: int = Query(None),
    distributor: str = Query(None),
    sku: str = Query(None),
    city: str = Query(None),
    category: str = Query(None),
):
    return get_shops(month=month, year=year, distributor=distributor, sku=sku, city=city, category=category)


@app.get("/analytics/mom-trend")
def analytics_mom_trend(
    distributor: str = Query(None),
    sku: str = Query(None),
    month: str = Query(None),
    year: int = Query(None),
    city: str = Query(None),
    category: str = Query(None),
):
    return get_mom_trend(distributor=distributor, sku=sku, month=month, year=year, city=city, category=category)
    
@app.get("/analytics/distributor-mom")
def analytics_distributor_mom(
    distributor: str = Query(None),
    sku: str = Query(None),
    month: str = Query(None),
    year: int = Query(None),
    city: str = Query(None),
    category: str = Query(None),
):
    return get_distributor_mom(distributor=distributor, sku=sku, month=month, year=year, city=city, category=category)


@app.get("/analytics/top-shops")
def analytics_top_shops(
    month: str = Query(None),
    year: int = Query(None),
    distributor: str = Query(None),
    sku: str = Query(None),
    limit: int = Query(10),
    city: str = Query(None),
    category: str = Query(None),
):
    return get_top_shops(month=month, year=year, distributor=distributor, sku=sku, limit=limit, city=city, category=category)


@app.get("/analytics/top-shops-by-qty")
def analytics_top_shops_qty(
    month: str = Query(None),
    year: int = Query(None),
    distributor: str = Query(None),
    sku: str = Query(None),
    limit: int = Query(10),
    city: str = Query(None),
    category: str = Query(None),
):
    return get_top_shops_by_qty(month=month, year=year, distributor=distributor, sku=sku, limit=limit, city=city, category=category)


@app.get("/analytics/cities")
def analytics_cities():
    return get_cities()


@app.get("/analytics/skus")
def analytics_skus():
    return get_skus()


@app.get("/analytics/recurring-shops")
def analytics_recurring_shops(
    month: str = Query(None),
    year: int = Query(None),
    distributor: str = Query(None),
    sku: str = Query(None),
    city: str = Query(None),
    category: str = Query(None),
):
    return get_recurring_shops(month=month, year=year, distributor=distributor, sku=sku, city=city, category=category)


@app.get("/analytics/top-shops-sku-breakdown")
def analytics_top_shops_sku_breakdown(
    month: str = Query(None),
    year: int = Query(None),
    distributor: str = Query(None),
    sku: str = Query(None),
    limit: int = Query(10),
    city: str = Query(None),
    category: str = Query(None),
):
    return get_top_shops_sku_breakdown(month=month, year=year, distributor=distributor, sku=sku, limit=limit, city=city, category=category)


# ─────────────────────────────────────────────────────────────────────────────
# MANUAL MAPPING
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/manual-mapping/confirm")
async def manual_mapping_confirm(
    file: UploadFile = File(...),
    distributor_name: str = Form(...),
    shop_name_col: str = Form(...),
    qty_col: str = Form(...),
    revenue_col: str = Form(...),
):
    """
    Accepts a file + column mapping from ManualMappingModal.
    Runs extraction using the user-specified column indices.
    """
    import pandas as pd
    sb = get_supabase()
    file_bytes = await file.read()
    filename = file.filename or "upload.xlsx"
    ext = filename.lower().rsplit(".", 1)[-1]
    engine = "xlrd" if ext == "xls" else "openpyxl"

    df = pd.read_excel(io.BytesIO(file_bytes), header=None, engine=engine)

    upload_id = str(uuid.uuid4())
    records = []

    from extraction.shop_name_cleaner import clean_shop_name
    from extraction.date_extractor import extract_date_from_df, extract_date_from_filename
    from extraction.normalizer import normalize_records
    from extraction.validator import validate_records

    month, year = extract_date_from_df(df)
    if not month:
        month, year = extract_date_from_filename(filename)

    cols = list(df.columns)

    def col_index(name_or_idx: str) -> int:
        try:
            return int(name_or_idx)
        except ValueError:
            return cols.index(name_or_idx)

    try:
        sc = col_index(shop_name_col)
        qc = col_index(qty_col)
        rc = col_index(revenue_col)
    except (ValueError, IndexError):
        raise HTTPException(status_code=400, detail="Invalid column mapping")

    import numpy as np
    for row_idx in range(len(df)):
        row = df.iloc[row_idx]
        shop_raw = row.iloc[sc]
        qty_raw  = row.iloc[qc]
        rev_raw  = row.iloc[rc]
        if not isinstance(shop_raw, str) or not shop_raw.strip():
            continue
        try:
            qty = int(qty_raw) if not (isinstance(qty_raw, float) and np.isnan(qty_raw)) else 0
            rev = float(rev_raw) if not (isinstance(rev_raw, float) and np.isnan(rev_raw)) else 0.0
        except (TypeError, ValueError):
            continue
        shop_name, shop_type = clean_shop_name(shop_raw.strip())
        records.append({"distributor_name": distributor_name, "shop_name": shop_name, "shop_type": shop_type, "qty": qty, "revenue": rev, "month": month, "year": year})

    sb.table("uploads").insert({"id": upload_id, "filename": filename, "distributor_name": distributor_name, "status": "pending"}).execute()

    normalized = normalize_records(records, distributor_name, upload_id, month, year)
    valid, skipped = validate_records(normalized)

    if valid:
        sb.table("sales_records").insert(valid).execute()

    sb.table("uploads").update({"status": "success", "month": month, "year": year, "format_detected": "MANUAL", "record_count": len(valid)}).eq("id", upload_id).execute()

    return {"upload_id": upload_id, "record_count": len(valid), "skipped_count": len(skipped)}


# ─────────────────────────────────────────────────────────────────────────────
# EXPORTS
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/export/excel")
def export_excel(
    month: str = Query(None),
    year: int = Query(None),
    distributor: str = Query(None),
):
    xlsx_bytes = export_to_excel(month=month, year=year, distributor=distributor)
    filename = f"sales_export_{distributor or 'all'}_{month or 'all'}_{year or 'all'}.xlsx"
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/export/audit")
def export_audit(upload_id: str = Query(None)):
    csv_str = export_audit_csv(upload_id=upload_id)
    return Response(
        content=csv_str,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="audit_log.csv"'},
    )


# ─────────────────────────────────────────────────────────────────────────────
# HEALTH CHECK
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    host = os.getenv("APP_HOST", "0.0.0.0")
    port = int(os.getenv("APP_PORT", 8000))
    uvicorn.run("main:app", host=host, port=port, reload=True)


# =============================================================================
# MODERN TRADE — all new endpoints below. Nothing above this line was touched.
# =============================================================================

from extraction.modern_trade_parser import run_mt_extraction_pipeline


# ── MT Upload ─────────────────────────────────────────────────────────────────

@app.post("/upload/modern-trade")
async def upload_modern_trade(
    file: UploadFile = File(...),
    chain_name: str  = Form(...),
):
    sb         = get_supabase()
    file_bytes = await file.read()
    filename   = file.filename or "mt_upload.xlsx"
    chain_name = chain_name.strip().upper()
    upload_id  = str(uuid.uuid4())

    # 1. Upsert chain
    existing = sb.table("mt_chains").select("id").eq("chain_name", chain_name).execute()
    if not existing.data:
        sb.table("mt_chains").insert({"chain_name": chain_name}).execute()

    # 2. Audit row (pending)
    sb.table("mt_uploads").insert({
        "id":         upload_id,
        "filename":   filename,
        "chain_name": chain_name,
        "status":     "pending",
    }).execute()

    # 3. Store file (non-fatal)
    storage_path = f"mt/{chain_name}/{upload_id}/{filename}"
    try:
        sb.storage.from_(FILES_BUCKET).upload(
            path=storage_path,
            file=file_bytes,
            file_options={"content-type": file.content_type or "application/octet-stream"},
        )
    except Exception:
        storage_path = None

    # 4. Parse
    import traceback as _tb
    try:
        result = run_mt_extraction_pipeline(
            file_bytes=file_bytes,
            filename=filename,
            chain_name=chain_name,
            upload_id=upload_id,
        )
    except Exception as e:
        print(f"[MT EXTRACTION ERROR] {e}")
        _tb.print_exc()
        sb.table("mt_uploads").update({
            "status":        "error",
            "error_message": str(e),
            "storage_path":  storage_path,
        }).eq("id", upload_id).execute()
        raise HTTPException(status_code=422, detail=f"MT Extraction failed: {e}")

    # 5. Insert records
    if result["sales_records"]:
        sb.table("mt_sales_records").insert(result["sales_records"]).execute()
    if result["soh_records"]:
        sb.table("mt_soh_records").insert(result["soh_records"]).execute()

    # 6. Mark success
    sb.table("mt_uploads").update({
        "status":       "success",
        "record_count": result["sales_count"],
        "soh_count":    result["soh_count"],
        "stores_found": result["stores_found"],
        "storage_path": storage_path,
    }).eq("id", upload_id).execute()

    return {
        "upload_id":    upload_id,
        "chain_name":   chain_name,
        "stores_found": result["stores_found"],
        "sales_count":  result["sales_count"],
        "soh_count":    result["soh_count"],
    }


# ── MT Chains ─────────────────────────────────────────────────────────────────

@app.get("/mt/chains")
def mt_list_chains():
    sb = get_supabase()
    return sb.table("mt_chains").select("*").order("chain_name").execute().data


# ── MT Filter Dropdowns ───────────────────────────────────────────────────────

@app.get("/mt/analytics/stores")
def mt_analytics_stores(chain: str = Query(None)):
    sb   = get_supabase()
    q    = sb.table("mt_sales_records").select("store_code, store_name")
    if chain:
        q = q.eq("chain_name", chain)
    rows = q.execute().data
    seen = {}
    for r in rows:
        seen[r["store_code"]] = r["store_name"]
    return [{"store_code": k, "store_name": v} for k, v in sorted(seen.items())]


@app.get("/mt/analytics/months")
def mt_analytics_months(chain: str = Query(None)):
    MONTH_ORDER = ["January","February","March","April","May","June",
                   "July","August","September","October","November","December"]
    sb = get_supabase()
    q  = sb.table("mt_sales_records").select("month, year")
    if chain:
        q = q.eq("chain_name", chain)
    rows = q.execute().data
    seen = {}
    for r in rows:
        key = (r["month"], r["year"])
        seen[key] = {"month": r["month"], "year": r["year"]}
    result = list(seen.values())
    result.sort(key=lambda x: x["year"] * 100 + (MONTH_ORDER.index(x["month"]) + 1
                                                   if x["month"] in MONTH_ORDER else 0))
    return result


@app.get("/mt/analytics/skus")
def mt_analytics_skus(chain: str = Query(None)):
    """
    Returns canonical SKU names (from sku_canonical where source_type=MT mappings exist).
    Falls back to raw SKU names for any unmapped SKUs.
    """
    sb = get_supabase()
    q  = sb.table("mt_sales_records").select("sku_name")
    if chain:
        q = q.eq("chain_name", chain)
    rows = q.execute().data
    raw_skus = {r["sku_name"] for r in rows}

    # Resolve raw → canonical using MT mappings
    aliases_mt, _ = _load_sku_maps_mt()
    canonical_skus = sorted({aliases_mt.get(s, s) for s in raw_skus})
    return [{"sku_name": s} for s in canonical_skus]


# ── MT Chart Data ─────────────────────────────────────────────────────────────

def _mt_sales_query(sb, chain, store, month, year, sku):
    """
    Fetch MT sales rows with canonical SKU resolution.
    `sku` param is a canonical name — expanded to raw names via MT mappings.
    Returned rows have sku_name replaced with canonical name.
    """
    aliases_mt, reverse_mt = _load_sku_maps_mt()

    q = sb.table("mt_sales_records").select(
        "chain_name, store_code, store_name, sku_name, qty, revenue, month, year"
    )
    if chain: q = q.eq("chain_name", chain)
    if store: q = q.eq("store_code", store)
    if month: q = q.eq("month", month)
    if year:  q = q.eq("year", int(year))
    # Don't filter by sku_name at DB level — filter after canonical resolution below
    rows = q.execute().data

    # Normalise raw SKU names → canonical names in every row
    for r in rows:
        r["sku_name"] = _norm_sku_mt(r.get("sku_name"), aliases_mt)

    # Apply canonical SKU filter in Python after normalisation
    if sku:
        rows = [r for r in rows if r["sku_name"] == sku]

    return rows


@app.get("/mt/analytics/revenue")
def mt_analytics_revenue(
    chain: str = Query(None), store: str = Query(None),
    month: str = Query(None), year:  int = Query(None), sku: str = Query(None),
):
    sb   = get_supabase()
    rows = _mt_sales_query(sb, chain, store, month, year, sku)
    agg  = {}
    for r in rows:
        key = (r["sku_name"], r["month"], r["year"])
        agg[key] = agg.get(key, 0) + (r["revenue"] or 0)
    return [{"sku_name": k[0], "month": k[1], "year": k[2], "total_revenue": round(v, 2)}
            for k, v in agg.items()]


@app.get("/mt/analytics/qty")
def mt_analytics_qty(
    chain: str = Query(None), store: str = Query(None),
    month: str = Query(None), year:  int = Query(None), sku: str = Query(None),
):
    sb   = get_supabase()
    rows = _mt_sales_query(sb, chain, store, month, year, sku)
    agg  = {}
    for r in rows:
        key = (r["sku_name"], r["month"], r["year"])
        agg[key] = agg.get(key, 0) + (r["qty"] or 0)
    return [{"sku_name": k[0], "month": k[1], "year": k[2], "total_qty": v}
            for k, v in agg.items()]


@app.get("/mt/analytics/soh")
def mt_analytics_soh(
    chain: str = Query(None), store: str = Query(None), sku: str = Query(None),
):
    """SOH with canonical SKU resolution. sku param is canonical name."""
    sb = get_supabase()
    uq = sb.table("mt_uploads").select("id").eq("status", "success")
    if chain:
        uq = uq.eq("chain_name", chain)
    uploads = uq.order("uploaded_at", desc=True).limit(1).execute().data
    if not uploads:
        return []
    latest_upload_id = uploads[0]["id"]
    q = sb.table("mt_soh_records").select(
        "store_code, store_name, sku_name, soh_qty, soh_value, map_price"
    ).eq("upload_id", latest_upload_id)
    if store: q = q.eq("store_code", store)
    rows = q.execute().data

    # Normalise raw → canonical SKU names
    aliases_mt, _ = _load_sku_maps_mt()
    for r in rows:
        r["sku_name"] = _norm_sku_mt(r.get("sku_name"), aliases_mt)

    # Apply canonical SKU filter in Python
    if sku:
        rows = [r for r in rows if r["sku_name"] == sku]

    return rows


# ── MT Upload History ─────────────────────────────────────────────────────────

@app.get("/mt/uploads")
def mt_list_uploads(chain: str = Query(None)):
    sb = get_supabase()
    q  = sb.table("mt_uploads").select("*").order("uploaded_at", desc=True)
    if chain:
        q = q.eq("chain_name", chain)
    return q.execute().data
@app.delete("/mt/uploads/{upload_id}")
def delete_mt_upload(upload_id: str):
    sb = get_supabase()

    row = sb.table("mt_uploads").select("id, chain_name").eq("id", upload_id).execute()
    if not row.data:
        raise HTTPException(status_code=404, detail="MT upload not found")

    chain_name = row.data[0].get("chain_name")

    # Delete associated records first
    sb.table("mt_sales_records").delete().eq("upload_id", upload_id).execute()
    sb.table("mt_soh_records").delete().eq("upload_id", upload_id).execute()

    # Delete upload row
    sb.table("mt_uploads").delete().eq("id", upload_id).execute()

    # If no remaining uploads for this chain, remove from mt_chains
    if chain_name:
        remaining = sb.table("mt_uploads").select("id").eq("chain_name", chain_name).execute()
        if not remaining.data:
            sb.table("mt_chains").delete().eq("chain_name", chain_name).execute()
            print(f"[MT DELETE] Removed chain '{chain_name}' — no uploads remain")

    return {"ok": True, "deleted_upload_id": upload_id}


@app.post("/mt/chains/rename")
def rename_mt_chain(body: dict):
    sb = get_supabase()

    old_name = (body.get("old_name") or "").strip().upper()
    new_name = (body.get("new_name") or "").strip().upper()

    if not old_name or not new_name:
        raise HTTPException(status_code=400, detail="old_name and new_name are required")
    if old_name == new_name:
        raise HTTPException(status_code=400, detail="Names are already the same")

    # 1. Update all mt_uploads rows
    sb.table("mt_uploads").update({"chain_name": new_name}).eq("chain_name", old_name).execute()

    # 2. Update all mt_sales_records rows
    sb.table("mt_sales_records").update({"chain_name": new_name}).eq("chain_name", old_name).execute()

    # 3. Update all mt_soh_records rows
    sb.table("mt_soh_records").update({"chain_name": new_name}).eq("chain_name", old_name).execute()

    # 4. Rename in mt_chains — if new_name already exists, merge by deleting old row
    existing_new = sb.table("mt_chains").select("id").eq("chain_name", new_name).execute()
    if existing_new.data:
        sb.table("mt_chains").delete().eq("chain_name", old_name).execute()
    else:
        sb.table("mt_chains").update({"chain_name": new_name}).eq("chain_name", old_name).execute()

    print(f"[MT RENAME] '{old_name}' → '{new_name}'")
    return {"ok": True, "old_name": old_name, "new_name": new_name}




# =============================================================================
# MARGIN — parse file, detect conflicts, save to shop_margins
# =============================================================================

def _parse_margin_file(file_bytes: bytes, filename: str, distributor_name: str) -> dict:
    """
    Parse a distributor sales file and extract shop_name → margin % mapping.

    Returns:
      {
        "clean":     [{ shop_name, margin_pct }],   # shops with one consistent margin
        "conflicts": [{ shop_name, values: [25, 30] }],  # shops with 2+ different margins
      }
    """
    import pandas as pd

    ext = filename.rsplit(".", 1)[-1].lower()
    if ext == "xls":
        df = pd.read_excel(io.BytesIO(file_bytes), sheet_name=0, engine="xlrd", header=None)
    else:
        import openpyxl as _ox
        wb = _ox.load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
        df = pd.DataFrame(rows)

    shop_margins: dict[str, set] = {}

    for i, row in df.iterrows():
        if i < 11:          # skip header rows
            continue
        margin_raw = row[0]
        party_raw  = row[5]

        if pd.isna(margin_raw) or pd.isna(party_raw):
            continue
        party = str(party_raw).strip()
        if not party:
            continue
        try:
            margin = float(margin_raw)
        except (ValueError, TypeError):
            continue

        shop_margins.setdefault(party, set()).add(margin)

    clean     = []
    conflicts = []

    for shop, values in shop_margins.items():
        if len(values) == 1:
            clean.append({
                "shop_name":        shop,
                "distributor_name": distributor_name,
                "margin_pct":       round(list(values)[0], 2),
            })
        else:
            conflicts.append({
                "shop_name": shop,
                "values":    sorted(values),
            })

    return {"clean": clean, "conflicts": conflicts}


@app.post("/margins/preview")
async def margins_preview(
    file:             UploadFile = File(...),
    distributor_name: str        = Form(...),
):
    """
    Step 1 — Parse file, return clean margins + conflicts.
    Frontend shows a popup for conflicts so the user can enter the correct value.
    Nothing is saved to DB yet.
    """
    file_bytes = await file.read()
    filename   = file.filename or "margin.xls"

    result = _parse_margin_file(file_bytes, filename, distributor_name.strip().upper())

    return {
        "distributor_name": distributor_name.strip().upper(),
        "clean_count":      len(result["clean"]),
        "conflict_count":   len(result["conflicts"]),
        "clean":            result["clean"],
        "conflicts":        result["conflicts"],
    }


@app.post("/margins/save")
async def margins_save(body: dict):
    """
    Step 2 — Save resolved margins to shop_margins table.
    Body:
      {
        "distributor_name": "SYNERGY",
        "margins": [
          { "shop_name": "SHOP A", "margin_pct": 30 },
          { "shop_name": "SHOP B", "margin_pct": 25 },
          ...
        ]
      }
    Uses upsert on (shop_name, distributor_name) so re-uploads update existing rows.
    """
    sb               = get_supabase()
    distributor_name = str(body.get("distributor_name", "")).strip().upper()
    margins          = body.get("margins", [])

    if not distributor_name:
        raise HTTPException(status_code=400, detail="distributor_name is required")
    if not margins:
        raise HTTPException(status_code=400, detail="No margins provided")

    rows = []
    for m in margins:
        shop = str(m.get("shop_name", "")).strip()
        try:
            pct = round(float(m["margin_pct"]), 2)
        except (KeyError, ValueError, TypeError):
            continue
        if not shop:
            continue
        rows.append({
            "shop_name":        shop,
            "distributor_name": distributor_name,
            "margin_pct":       pct,
            "updated_at":       "now()",
        })

    if not rows:
        raise HTTPException(status_code=400, detail="No valid margin rows to save")

    sb.table("shop_margins").upsert(
        rows,
        on_conflict="shop_name,distributor_name"
    ).execute()

    return {"saved": len(rows), "distributor_name": distributor_name}


@app.get("/margins")
def margins_list(distributor: str = Query(None)):
    """Return all shop margins, optionally filtered by distributor."""
    sb = get_supabase()
    q  = sb.table("shop_margins").select("*").order("shop_name")
    if distributor:
        q = q.eq("distributor_name", distributor)
    return q.execute().data
@app.post("/margins/save-one")
def margins_save_one(body: dict):
    sb = get_supabase()
 
    shop_name        = (body.get("shop_name") or "").strip()
    distributor_name = (body.get("distributor_name") or "").strip()
    margin_pct       = body.get("margin_pct")
 
    if not shop_name or not distributor_name:
        raise HTTPException(status_code=400, detail="shop_name and distributor_name are required")
    if margin_pct is None:
        raise HTTPException(status_code=400, detail="margin_pct is required")
    try:
        margin_pct = float(margin_pct)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="margin_pct must be a number")
    if not (0 <= margin_pct <= 100):
        raise HTTPException(status_code=400, detail="margin_pct must be between 0 and 100")
 
    sb.table("shop_margins").upsert(
        {
            "shop_name":        shop_name,
            "distributor_name": distributor_name,
            "margin_pct":       margin_pct,
            "updated_at":       "now()",
        },
        on_conflict="shop_name,distributor_name",
    ).execute()
 
    return {"ok": True, "shop_name": shop_name, "distributor_name": distributor_name, "margin_pct": margin_pct}
@app.get("/analytics/projection")
def analytics_projection(distributor: str = Query(None)):
    return get_projection(distributor=distributor)

# =============================================================================
# PROJECTION REMARKS — global notes (sales drop, shop closed, etc.)
# =============================================================================

@app.get("/projection-remarks")
def get_projection_remarks():
    sb = get_supabase()
    return sb.table("projection_remarks").select("*").order("created_at", desc=True).execute().data


@app.post("/projection-remarks")
def create_projection_remark(body: dict):
    sb       = get_supabase()
    remark   = (body.get("remark")   or "").strip()
    category = (body.get("category") or "Other").strip()
    if not remark:
        raise HTTPException(status_code=400, detail="remark is required")
    result = sb.table("projection_remarks").insert({
        "id": str(uuid.uuid4()), "remark": remark, "category": category,
    }).execute()
    return result.data[0]


@app.patch("/projection-remarks/{remark_id}")
def update_projection_remark(remark_id: str, body: dict):
    sb      = get_supabase()
    update  = {}
    if "remark"   in body: update["remark"]   = (body["remark"]   or "").strip()
    if "category" in body: update["category"] = (body["category"] or "Other").strip()
    if not update:
        raise HTTPException(status_code=400, detail="Nothing to update")
    result = sb.table("projection_remarks").update(update).eq("id", remark_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Remark not found")
    return result.data[0]


@app.delete("/projection-remarks/{remark_id}")
def delete_projection_remark(remark_id: str):
    sb = get_supabase()
    sb.table("projection_remarks").delete().eq("id", remark_id).execute()
    return {"ok": True}

# =============================================================================
# SKU NORMALISATION ENDPOINTS
# =============================================================================

@app.get("/sku/canonical")
def get_sku_canonical(source_type: str = Query("DISTRIBUTOR")):
    sb = get_supabase()
    canonicals = sb.table("sku_canonical").select("*").order("category").order("family").order("name").execute().data
    mappings   = sb.table("sku_mappings").select("*").eq("source_type", source_type).execute().data
    mapping_map = {}
    for m in mappings:
        mapping_map.setdefault(m["canonical_id"], []).append(m)
    for c in canonicals:
        c["mappings"] = mapping_map.get(c["id"], [])
    return canonicals


@app.get("/sku/unmapped")
def get_unmapped_skus(source_type: str = Query("DISTRIBUTOR")):
    """
    Returns raw SKU names not yet mapped, each with source distributor/chain.
    source_type = "DISTRIBUTOR" → sales_records.distributor_name
    source_type = "MT"          → mt_sales_records.chain_name
    """
    sb = get_supabase()
    if source_type == "MT":
        rows = sb.table("mt_sales_records").select("sku_name, chain_name").execute().data
        raw_map = {}
        for r in rows:
            sku = (r.get("sku_name") or "").strip()
            src = (r.get("chain_name") or "UNKNOWN").strip()
            if sku:
                raw_map.setdefault(sku, set()).add(src)
    else:
        rows = sb.table("sales_records").select("sku_name, distributor_name").execute().data
        raw_map = {}
        for r in rows:
            sku = (r.get("sku_name") or "").strip()
            src = (r.get("distributor_name") or "UNKNOWN").strip()
            if sku:
                raw_map.setdefault(sku, set()).add(src)

    mapped = sb.table("sku_mappings").select("raw_sku").eq("source_type", source_type).execute().data
    mapped_set = {m["raw_sku"] for m in mapped}

    unmapped = [
        {"raw_sku": sku, "sources": sorted(srcs)}
        for sku, srcs in sorted(raw_map.items())
        if sku not in mapped_set
    ]
    return {"unmapped": unmapped, "count": len(unmapped)}


@app.get("/sku/categories")
def get_sku_categories():
    """Returns all distinct categories currently in sku_canonical."""
    sb = get_supabase()
    rows = sb.table("sku_canonical").select("category").execute().data
    cats = sorted({r["category"] for r in rows if r.get("category")})
    return {"categories": cats}


@app.post("/sku/canonical")
def create_sku_canonical(body: dict):
    sb = get_supabase()
    category = (body.get("category") or "").strip()
    family   = (body.get("family")   or "").strip()
    name     = (body.get("name")     or "").strip()
    if not all([category, family, name]):
        raise HTTPException(status_code=400, detail="category, family, and name are required")
    result = sb.table("sku_canonical").insert({
        "id": str(uuid.uuid4()), "category": category, "family": family, "name": name
    }).execute()
    return result.data[0]


@app.patch("/sku/canonical/{canonical_id}")
def update_sku_canonical(canonical_id: str, body: dict):
    sb = get_supabase()
    update = {}
    if "category" in body: update["category"] = body["category"].strip()
    if "family"   in body: update["family"]   = body["family"].strip()
    if "name"     in body: update["name"]     = body["name"].strip()
    if not update:
        raise HTTPException(status_code=400, detail="Nothing to update")
    result = sb.table("sku_canonical").update(update).eq("id", canonical_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Canonical SKU not found")
    return result.data[0]


@app.delete("/sku/canonical/{canonical_id}")
def delete_sku_canonical(canonical_id: str):
    sb = get_supabase()
    sb.table("sku_mappings").delete().eq("canonical_id", canonical_id).execute()
    sb.table("sku_canonical").delete().eq("id", canonical_id).execute()
    return {"ok": True}


@app.post("/sku/mappings")
def create_sku_mapping(body: dict):
    sb = get_supabase()
    raw_sku      = (body.get("raw_sku")      or "").strip()
    canonical_id = (body.get("canonical_id") or "").strip()
    source_type  = (body.get("source_type")  or "DISTRIBUTOR").strip()
    source_name  = (body.get("source_name")  or "").strip()
    if not all([raw_sku, canonical_id, source_name]):
        raise HTTPException(status_code=400, detail="raw_sku, canonical_id, and source_name are required")
    existing = sb.table("sku_mappings").select("id").eq("raw_sku", raw_sku).eq("source_type", source_type).execute()
    if existing.data:
        result = sb.table("sku_mappings").update({
            "canonical_id": canonical_id, "source_name": source_name
        }).eq("id", existing.data[0]["id"]).execute()
        return result.data[0]
    result = sb.table("sku_mappings").insert({
        "id": str(uuid.uuid4()),
        "raw_sku": raw_sku, "canonical_id": canonical_id,
        "source_type": source_type, "source_name": source_name,
    }).execute()
    return result.data[0]


@app.delete("/sku/mappings/{mapping_id}")
def delete_sku_mapping(mapping_id: str):
    sb = get_supabase()
    sb.table("sku_mappings").delete().eq("id", mapping_id).execute()
    return {"ok": True}