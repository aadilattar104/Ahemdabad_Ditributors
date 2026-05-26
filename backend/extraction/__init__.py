from .sheet_selector import select_best_sheet
from .generic_parser import parse_generic
from .normalizer import normalize_records
from .validator import validate_records


def run_extraction_pipeline(
    file_bytes: bytes,
    filename: str,
    distributor_name: str,
    upload_id: str,
) -> dict:
    """
    Single generic extraction pipeline.
    Works for any distributor Excel format — party-wise grouped, invoice register,
    or Mumbai flat register (Pattern C with Taxable @ 100% revenue column).

    DATE ARCHITECTURE:
    month and year are NO LONGER derived from report headers or passed externally.
    They are derived per-transaction from bill_date inside generic_parser._make().

    CITY ARCHITECTURE:
    city is set to "Mumbai" by _parse_mumbai_register() for Pattern C files.
    For all other formats city is None (Ahmedabad distributor files).

    MARGIN ARCHITECTURE:
    Pattern C files carry margin_pct per row. These are extracted here and returned
    separately as margin_records for upsert into shop_margins by main.py.
    """
    # Step 1 — Select best sheet
    df, sheet_name = select_best_sheet(file_bytes, filename)
    print(f"[PIPELINE] sheet='{sheet_name}' shape={df.shape}")

    # Step 2 — Parse
    raw_records = parse_generic(df, distributor_name)
    print(f"[PIPELINE] raw_records={len(raw_records)}")

    # Step 2b — Extract margin records from Pattern C (Mumbai) rows
    margin_records = []
    seen_margins   = set()
    for r in raw_records:
        if r.get("margin_pct") is not None and r.get("shop_name"):
            key = (r["shop_name"], distributor_name)
            if key not in seen_margins:
                seen_margins.add(key)
                margin_records.append({
                    "shop_name":        r["shop_name"],
                    "distributor_name": distributor_name,
                    "margin_pct":       r["margin_pct"],
                })

    # Step 3 — Normalize
    normalized = normalize_records(raw_records, distributor_name, upload_id)

    # Step 4 — Validate
    valid, skipped = validate_records(normalized)
    print(f"[PIPELINE] valid={len(valid)} skipped={len(skipped)}")

    # Step 5 — Derive summary month/year (informational only)
    months = [r["month"] for r in valid if r.get("month")]
    years  = [r["year"]  for r in valid if r.get("year")]
    summary_month = months[0] if months else None
    summary_year  = years[0]  if years  else None

    if len(set(months)) > 1:
        print(f"[PIPELINE] WARNING: multi-month file detected — months={sorted(set(months))}")
    if len(set(years)) > 1:
        print(f"[PIPELINE] WARNING: multi-year file detected — years={sorted(set(years))}")

    # Step 6 — Detect city from records; stamp "Ahmedabad" on any record without a city
    for r in valid:
        if not r.get("city"):
            r["city"] = "Ahmedabad"
    cities = {r.get("city") for r in valid if r.get("city")}
    city   = list(cities)[0] if len(cities) == 1 else None

    return {
        "records":        valid,
        "skipped":        skipped,
        "format":         "GENERIC",
        "month":          summary_month,
        "year":           summary_year,
        "record_count":   len(valid),
        "city":           city,
        "margin_records": margin_records,
    }