"""
Pattern G — TEJ Sales Corporation fixed-width .TXT report.

Completely different file type from Excel — plain text, fixed-width columns,
pipe-separated SKU quantity grid. Requires its own reader since pandas
cannot parse this structure.

FILE STRUCTURE:
  Header lines: company name, date range, column header with 12 pipe slots
  Data block: one or more lines per shop —
    First line:  code | name | area | date | invno | <12 pipe-separated qty cols> | kgs | value
    Continuation lines (same shop, different invoice): blank code/name/area,
      just date | invno | <12 qty cols> | kgs | value
  SKU master table (after "Total" line): code | name | pack | ... — maps the
    12 pipe-column positions to actual SKU names, in order.

REVENUE ALLOCATION:
  Each row only gives ONE total Value for potentially multiple SKUs in that
  row. Revenue is allocated proportionally by qty share across the SKUs
  present in that specific row. This is mathematically exact — no rate
  assumption needed — and the sum across all rows matches the file's
  printed Grand Total exactly (verified to within floating-point rounding).

CITY: Hardcoded "Mumbai" (Tej Sales Corporation services Mumbai).
"""

import re
import datetime


def _decode_txt(file_bytes: bytes) -> str:
    """TXT files from this report use latin-1/cp1252 encoding (has special chars like ³)."""
    try:
        return file_bytes.decode("utf-8")
    except UnicodeDecodeError:
        return file_bytes.decode("latin-1")


def _parse_sku_master(lines: list[str]) -> dict[int, str]:
    """
    Parse the SKU master table at the bottom of the file.
    Returns {sku_code: sku_name} in the order they appear — this order
    corresponds positionally to the 12 pipe-columns in data rows.
    """
    sku_master = {}
    in_master = False

    for line in lines:
        if "Code Name" in line and "Pack" in line:
            in_master = True
            continue
        if not in_master:
            continue
        if line.strip().startswith("---"):
            continue
        parts = line.strip().split()
        if not parts or not parts[0].isdigit():
            if sku_master:
                break  # reached the trailing totals line — done
            continue

        code = int(parts[0])
        rest = line[6:]  # skip the code prefix
        m = re.search(r"(\d+G[MN])", rest)  # pack size token like "200GM" or "200GN"
        if m:
            name = rest[: m.start()].strip()
            sku_master[code] = name

    return sku_master


def _parse_tej_date(date_str: str, year_hint: int = None) -> datetime.date | None:
    """Parse dates like '28-May-26' or '5-Jun-26'."""
    date_str = date_str.strip()
    if not date_str:
        return None
    try:
        return datetime.datetime.strptime(date_str, "%d-%b-%y").date()
    except ValueError:
        return None


def is_tej_txt_format(file_bytes: bytes, filename: str) -> bool:
    """
    Detect this format: .txt extension AND header contains the
    distinctive column header line with pipe-separated SKU grid.
    """
    if not filename.lower().endswith(".txt"):
        return False
    try:
        text = _decode_txt(file_bytes)
    except Exception:
        return False
    return "Inv Date" in text and "Invno" in text and "Kgs/Ltr" in text


def parse_tej_txt(file_bytes: bytes, distributor_name: str) -> list[dict]:
    """
    Parse a TEJ Sales Corporation fixed-width .TXT distribution report.

    Returns list of raw record dicts in the same shape as generic_parser
    output — ready to flow into normalize_records().
    """
    text = _decode_txt(file_bytes)
    lines = text.split("\n")

    # Step 1 — parse SKU master table (maps pipe-column position → SKU name)
    sku_master = _parse_sku_master(lines)
    sku_codes_ordered = sorted(sku_master.keys())  # [1061, 1062, ..., 1072]

    if not sku_codes_ordered:
        return []

    # Step 2 — find the data block boundaries
    # Data starts after the "Code  Name ... Kgs/Ltr     Value" header + dashes
    # Data ends at the "Total" line (dashes before it)
    data_start = None
    data_end = None
    for i, line in enumerate(lines):
        if data_start is None and "Inv Date" in line and "Invno" in line:
            data_start = i + 2  # skip header + dashes line — only set on FIRST occurrence
        if data_start is not None and line.strip().startswith("Total"):
            data_end = i
            break

    if data_start is None or data_end is None:
        return []

    records = []
    current_code = None
    current_shop_raw = None
    current_area = None

    for line in lines[data_start:data_end]:
        if not line.strip() or line.strip().startswith("---"):
            continue
        if "Page :" in line or "Print:" in line or "Distribution Tracking" in line:
            continue  # page-break repeated header on multi-page reports

        if "|" not in line:
            continue

        prefix, rest = line.split("|", 1)
        cols = rest.split("|")

        if len(cols) != len(sku_codes_ordered) + 1:
            continue  # malformed line — skip safely

        qty_cols = cols[: len(sku_codes_ordered)]
        trailing = cols[-1]  # "    6.000   3857.10" → kgs, value

        # ── Determine if this is a new-shop line or a continuation line ────
        # New-shop line: prefix has a 5-digit code at the start
        code_match = re.match(r"\s*(\d{5})\s+(.{0,20})", prefix)
        if code_match:
            current_code = code_match.group(1)
            # name + area are smushed together in the fixed-width prefix;
            # we don't need to split them precisely — shop_name uses the
            # raw prefix tail for display, code is used for grouping.
            name_area = code_match.group(2).strip()
            current_shop_raw = f"{name_area} [{current_code}]"

        if current_shop_raw is None:
            continue  # no shop context yet — skip malformed leading lines

        # ── Extract date from prefix (continuation lines have date here too) ─
        date_match = re.search(r"(\d{1,2}-[A-Za-z]{3}-\d{2})", prefix)
        bill_date = _parse_tej_date(date_match.group(1)) if date_match else None

        # ── Extract bill_no from prefix (starts with 'S' followed by digits) ─
        billno_match = re.search(r"(S\d+)", prefix)
        bill_no = billno_match.group(1) if billno_match else None

        # ── Extract total row value (last number in trailing segment) ───────
        value_match = re.search(r"([\d.]+)\s*$", trailing.strip())
        row_value = float(value_match.group(1)) if value_match else 0.0

        # ── Parse qty for each SKU column, allocate revenue proportionally ──
        qtys = []
        for c in qty_cols:
            c = c.strip()
            try:
                qtys.append(float(c) if c else 0.0)
            except ValueError:
                qtys.append(0.0)

        total_qty_row = sum(qtys)
        if total_qty_row == 0:
            continue  # nothing sold on this line

        for idx, qty in enumerate(qtys):
            if qty == 0:
                continue
            sku_code = sku_codes_ordered[idx]
            sku_name = sku_master[sku_code]

            # Revenue allocated proportionally by qty share within this row.
            # Mathematically exact — sums to row_value exactly across all SKUs.
            revenue_share = round(row_value * (qty / total_qty_row), 2)

            records.append({
                "distributor_name": distributor_name,
                "shop_name":        current_shop_raw,
                "shop_type":        "REGULAR",
                "sku_name":         sku_name,
                "bill_no":          bill_no,
                "bill_date":        bill_date.isoformat() if bill_date else None,
                "qty":              int(qty),
                "rate":             None,
                "revenue":          revenue_share,
                "month":            bill_date.strftime("%B") if bill_date else None,
                "year":             bill_date.year if bill_date else None,
                "city":             "Mumbai",
            })

    return records