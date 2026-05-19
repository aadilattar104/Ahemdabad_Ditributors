import os
import uuid
import io
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, Response

from database.supabase_client import get_supabase
from extraction import run_extraction_pipeline
from analytics.aggregator import (
    get_overview, get_shops, get_mom_trend, get_top_shops,
    get_top_shops_by_qty, get_skus, get_recurring_shops,
    get_top_shops_sku_breakdown,
)
from exports.exporter import export_to_excel, export_audit_csv

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
):
    return get_overview(month=month, year=year, distributor=distributor, sku=sku)


@app.get("/analytics/shops")
def analytics_shops(
    month: str = Query(None),
    year: int = Query(None),
    distributor: str = Query(None),
    sku: str = Query(None),
):
    return get_shops(month=month, year=year, distributor=distributor, sku=sku)


@app.get("/analytics/mom-trend")
def analytics_mom_trend(
    distributor: str = Query(None),
    sku: str = Query(None),
):
    return get_mom_trend(distributor=distributor, sku=sku)


@app.get("/analytics/top-shops")
def analytics_top_shops(
    month: str = Query(None),
    year: int = Query(None),
    distributor: str = Query(None),
    sku: str = Query(None),
    limit: int = Query(10),
):
    return get_top_shops(month=month, year=year, distributor=distributor, sku=sku, limit=limit)


@app.get("/analytics/top-shops-by-qty")
def analytics_top_shops_qty(
    month: str = Query(None),
    year: int = Query(None),
    distributor: str = Query(None),
    sku: str = Query(None),
    limit: int = Query(10),
):
    return get_top_shops_by_qty(month=month, year=year, distributor=distributor, sku=sku, limit=limit)


@app.get("/analytics/skus")
def analytics_skus():
    return get_skus()


@app.get("/analytics/recurring-shops")
def analytics_recurring_shops(
    month: str = Query(None),
    year: int = Query(None),
    distributor: str = Query(None),
    sku: str = Query(None),
):
    return get_recurring_shops(month=month, year=year, distributor=distributor, sku=sku)


@app.get("/analytics/top-shops-sku-breakdown")
def analytics_top_shops_sku_breakdown(
    month: str = Query(None),
    year: int = Query(None),
    distributor: str = Query(None),
    sku: str = Query(None),
    limit: int = Query(10),
):
    return get_top_shops_sku_breakdown(month=month, year=year, distributor=distributor, sku=sku, limit=limit)


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