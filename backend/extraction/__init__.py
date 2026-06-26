import io
import pandas as pd
from .sheet_selector import select_best_sheet
from .generic_parser import parse_generic
from .normalizer import normalize_records
from .validator import validate_records
from .tej_txt_parser import is_tej_txt_format, parse_tej_txt


def _get_all_sheets(file_bytes: bytes, filename: str) -> list[tuple[pd.DataFrame, str]]:
    """
    Returns all sheets that look like valid data sheets.
    A sheet is valid if it has at least 10 non-empty cells.
    Returns list of (df, sheet_name) sorted by sheet order.
    """
    ext = filename.lower().rsplit(".", 1)[-1]
    engine = "xlrd" if ext == "xls" else "openpyxl"

    xls = pd.ExcelFile(io.BytesIO(file_bytes), engine=engine)
    results = []

    for name in xls.sheet_names:
        try:
            df = pd.read_excel(
                io.BytesIO(file_bytes),
                sheet_name=name,
                header=None,
                engine=engine,
            )
            score = df.notna().sum().sum()
            if score >= 10:
                results.append((df, name, score))
        except Exception:
            continue

    return [(df, name) for df, name, score in results]


def run_extraction_pipeline(
    file_bytes: bytes,
    filename: str,
    distributor_name: str,
    upload_id: str,
) -> dict:
    """
    Single generic extraction pipeline.
    Works for any distributor Excel format — party-wise grouped or invoice register —
    and now also Pattern G: TEJ Sales Corporation fixed-width .TXT reports.

    PATTERN G — TXT ARCHITECTURE:
    Plain-text fixed-width reports (.txt extension) are detected first, before any
    Excel sheet logic runs, since pandas cannot read this file type. Detection checks
    for "Inv Date", "Invno", "Kgs/Ltr" markers unique to this report format.

    MULTI-SHEET ARCHITECTURE:
    When an Excel file has multiple valid data sheets (e.g. Sangeeta FY 25-26 + FY 26-27),
    ALL sheets are parsed and records are combined. This ensures full-year data is
    captured when distributors split data across FY sheets.

    DATE ARCHITECTURE:
    month and year are derived per-transaction from bill_date inside generic_parser._make()
    (or directly inside parse_tej_txt() for Pattern G). No external month/year is passed.

    CITY ARCHITECTURE:
    city is set to "Mumbai" by Mumbai-format parsers (including Pattern G — TEJ Sales
    Corporation is Mumbai-based). Ahmedabad records have city=None.

    MARGIN ARCHITECTURE:
    Pattern C (Vidhaata) files carry margin_pct per row. Extracted and returned
    separately as margin_records for upsert into shop_margins by main.py.
    """
    # ── Pattern G — plain text fixed-width report (checked FIRST, before Excel logic) ──
    if is_tej_txt_format(file_bytes, filename):
        print(f"[PIPELINE] Detected Pattern G (TEJ Sales TXT report)")
        all_raw = parse_tej_txt(file_bytes, distributor_name)
        print(f"[PIPELINE] Pattern G raw_records={len(all_raw)}")

        normalized = normalize_records(all_raw, distributor_name, upload_id)
        valid, skipped = validate_records(normalized)
        print(f"[PIPELINE] valid={len(valid)} skipped={len(skipped)}")

        months = [r["month"] for r in valid if r.get("month")]
        years  = [r["year"]  for r in valid if r.get("year")]
        summary_month = months[0] if months else None
        summary_year  = years[0]  if years  else None

        return {
            "records":        valid,
            "skipped":        skipped,
            "format":         "TEJ_TXT",
            "month":          summary_month,
            "year":           summary_year,
            "record_count":   len(valid),
            "city":           "Mumbai",
            "margin_records": [],
        }

    # ── Excel pipeline (Patterns A–F) ─────────────────────────────────────────────
    # Step 1 — Get all valid sheets
    all_sheets = _get_all_sheets(file_bytes, filename)

    if not all_sheets:
        raise ValueError("Could not read any valid sheet from the workbook.")

    print(f"[PIPELINE] Found {len(all_sheets)} valid sheet(s): {[s for _, s in all_sheets]}")

    # Step 2 — Parse all sheets, combine raw records
    all_raw = []
    for df, sheet_name in all_sheets:
        print(f"[PIPELINE] Parsing sheet='{sheet_name}' shape={df.shape}")
        try:
            raw = parse_generic(df, distributor_name)
            print(f"[PIPELINE] sheet='{sheet_name}' raw_records={len(raw)}")
            all_raw.extend(raw)
        except Exception as e:
            print(f"[PIPELINE] WARNING: sheet='{sheet_name}' failed — {e}")
            continue

    print(f"[PIPELINE] Total raw_records across all sheets: {len(all_raw)}")

    # Step 2b — Extract margin records from Pattern C (Mumbai) rows
    margin_records = []
    seen_margins   = set()
    for r in all_raw:
        if r.get("margin_pct") is not None and r.get("shop_name"):
            key = (r["shop_name"], distributor_name)
            if key not in seen_margins:
                seen_margins.add(key)
                margin_records.append({
                    "shop_name":        r["shop_name"],
                    "distributor_name": distributor_name,
                    "margin_pct":       r["margin_pct"],
                })

    # Step 3 — Normalize (fuzzy shop logic across all sheets combined)
    normalized = normalize_records(all_raw, distributor_name, upload_id)

    # Step 4 — Validate
    valid, skipped = validate_records(normalized)
    print(f"[PIPELINE] valid={len(valid)} skipped={len(skipped)}")

    # Step 5 — Derive summary month/year from valid records (informational only)
    months = [r["month"] for r in valid if r.get("month")]
    years  = [r["year"]  for r in valid if r.get("year")]
    summary_month = months[0] if months else None
    summary_year  = years[0]  if years  else None

    if len(set(months)) > 1:
        print(f"[PIPELINE] WARNING: multi-month file — months={sorted(set(months))}")
    if len(set(years)) > 1:
        print(f"[PIPELINE] WARNING: multi-year file — years={sorted(set(years))}")

    # Step 6 — Detect city from records
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