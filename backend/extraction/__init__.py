from .sheet_selector import select_best_sheet
from .date_extractor import extract_date_from_df, extract_date_from_filename
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
    """
    # Step 1 — Select best sheet
    df, sheet_name = select_best_sheet(file_bytes, filename)
    print(f"[PIPELINE] sheet='{sheet_name}' shape={df.shape}")

    # Step 2 — Extract date
    month, year = extract_date_from_df(df)
    if not month:
        month, year = extract_date_from_filename(filename)
    print(f"[PIPELINE] month={month} year={year}")

    # Step 3 — Run generic parser (auto-detects GROUPED vs REGISTER pattern)
    raw_records = parse_generic(df, distributor_name, month, year)
    print(f"[PIPELINE] raw_records={len(raw_records)}")

    # Step 4 — Normalize
    normalized = normalize_records(raw_records, distributor_name, upload_id, month, year)

    # Step 5 — Validate
    valid, skipped = validate_records(normalized)
    print(f"[PIPELINE] valid={len(valid)} skipped={len(skipped)}")

    return {
        "records": valid,
        "skipped": skipped,
        "format": "GENERIC",
        "month": month,
        "year": year,
        "record_count": len(valid),
    }