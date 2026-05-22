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
    Works for any distributor Excel format — party-wise grouped or invoice register.

    DATE ARCHITECTURE:
    month and year are NO LONGER derived from report headers or passed externally.
    They are derived per-transaction from bill_date inside generic_parser._make().
    This prevents wrong aggregation when distributors export full-FY, multi-month,
    partial, or manually edited files with incorrect/misleading report headers
    (e.g. 'Sales Register From Date 01/04/2025 To 02/02/2026').

    The summary month/year returned in this dict are derived from the valid records
    themselves — they are informational only and must NOT be used for bucketing.
    Each record carries its own correct month/year from its own bill_date.
    """
    # Step 1 — Select best sheet
    df, sheet_name = select_best_sheet(file_bytes, filename)
    print(f"[PIPELINE] sheet='{sheet_name}' shape={df.shape}")

    # Step 2 — Parse (month/year derived per-transaction from bill_date, not externally)
    raw_records = parse_generic(df, distributor_name)
    print(f"[PIPELINE] raw_records={len(raw_records)}")

    # Step 3 — Normalize (fuzzy shop logic; month/year come from records, not passed in)
    normalized = normalize_records(raw_records, distributor_name, upload_id)

    # Step 4 — Validate
    valid, skipped = validate_records(normalized)
    print(f"[PIPELINE] valid={len(valid)} skipped={len(skipped)}")

    # Step 5 — Derive summary month/year from valid records (informational only)
    # Uses first value when all records share the same month/year (single-month file),
    # or first value when mixed (multi-month file) — analytics must group by each
    # record's own month/year field, NOT this summary.
    months = [r["month"] for r in valid if r.get("month")]
    years  = [r["year"]  for r in valid if r.get("year")]
    summary_month = months[0] if months else None
    summary_year  = years[0]  if years  else None

    if len(set(months)) > 1:
        print(f"[PIPELINE] WARNING: multi-month file detected — months={sorted(set(months))}")
    if len(set(years)) > 1:
        print(f"[PIPELINE] WARNING: multi-year file detected — years={sorted(set(years))}")

    return {
        "records":      valid,
        "skipped":      skipped,
        "format":       "GENERIC",
        "month":        summary_month,
        "year":         summary_year,
        "record_count": len(valid),
    }