"""
Generic SKU-level parser — extracts one row per product line per invoice.

Each output record contains:
  distributor_name, shop_name, shop_type,
  sku_name, bill_no, bill_date,
  qty, rate, revenue,
  month, year

PATTERN A — Party-wise grouped (Iceland):
  header row → Bill No | Bill Date | Product Name | Qty | Rate | Product Amount
  shop name row: col[0] text, rest blank
  bill line: col[0]=bill_no, col[1]=date, col[2]=product_name, col[3]=qty, col[4]=rate, col[5]=amount

PATTERN F — Pune grouped format:
  header row → S.no | Date | Bill No | Vendor Name | Description | QTY | Rate | Amount
  invoice row: col[0]=S.no (positive int), col[1]=date, col[2]=bill_no, col[3]=shop_name
  detail row:  col[0]=None, col[3]=None, col[4]=sku, col[5]=qty, col[6]=rate, col[7]=amount
  Revenue = Amount (col 7). City = "Pune" hardcoded.

PATTERN B — Invoice register (Synergy):
  header row(s) → Sr | Date | Bill No | C/D | Party Name | ... | Qty | Rate | Amount
  invoice row: col[0]=Sr(int), col[1]=date, col[2]=bill_no, col[4]=party_name
  product line: col[0]=blank, col[1]=sku_name, col[7]=qty, col[8]=rate, col[9]=amount

DATE ARCHITECTURE (transaction-driven):
  month and year are ALWAYS derived from each transaction's bill_date inside _make().
  External month/year parameters have been removed entirely from parse_generic(),
  _parse_grouped(), _parse_register(), and _make().
  This prevents wrong aggregation when distributors export full-FY, multi-month,
  partial, or manually edited files with incorrect report headers.
  _parse_date() uses dayfirst=True to correctly handle Indian DD/MM/YYYY formats.
"""

import pandas as pd
import numpy as np
import datetime
from .shop_name_cleaner import clean_shop_name

QTY_KEYWORDS    = ["qty", "quantity", "units", "pcs"]
AMT_KEYWORDS    = ["product amount", "prod amt", "net amount", "net amt", "amount", "value"]
TAXABLE_KW      = ["taxable @ 100%", "taxable@100%"]
AMT_SKIP        = ["bill amt", "gst", "igst", "cgst", "sgst", "tax", "total amt", "bill amount"]
RATE_KEYWORDS   = ["rate", "price", "mrp"]
PARTY_KEYWORDS  = ["party name", "party", "customer name", "customer", "shop name", "retailer"]
SKU_KEYWORDS    = ["product name", "product", "particular", "item name", "item", "description"]
DATE_KEYWORDS   = ["bill date", "date"]
BILLNO_KEYWORDS = ["bill no", "bill number", "invoice no", "voucher no"]
MRP_AMT_KW      = ["mrp amt", "mrp amount", "amount"]
PARTICULARS_KW  = ["particulars", "particular"]


def _header_has_all(header_row, *keywords) -> bool:
    """Return True if every keyword appears (as substring) in at least one header cell."""
    texts = [str(v).strip().lower() for v in header_row if v is not None]
    return all(any(kw in t for t in texts) for kw in keywords)


def _header_col_exact(header_row, col_idx: int, keyword: str) -> bool:
    """Return True if header_row[col_idx] exactly equals keyword (case-insensitive)."""
    if col_idx >= len(header_row) or header_row[col_idx] is None:
        return False
    return str(header_row[col_idx]).strip().lower() == keyword.lower()


def _fingerprint_pattern(header_row) -> str | None:
    """
    Identify the distributor pattern from STRUCTURAL fingerprints ONLY.
    Each fingerprint uses a combination of unique column names that cannot
    appear together in any other known format. Returns a pattern code or None.

    Pattern codes:
      ICELAND   — Bill No + Bill Date + Product Name + Product Amount
      SYNERGY   — Sr. + C/D + Prod Amt  (register with C/D debit/credit col)
      VIDHAATA  — Taxable @ 100% anywhere in header
      PUNE      — Vendor Name at col3 AND Description at col4
      KEDAR     — BILL NO. + PARTY NAME + AMOUNT at exact col positions 0,1,2
      SANGEETA  — MRP Amt anywhere in header
      UNIVERSAL — Particulars anywhere + no Party Name col
      (None)    — fall through to _detect_pattern for GROUPED vs REGISTER
    """
    texts = [str(v).strip().lower() if v is not None else "" for v in header_row]

    # ── VIDHAATA (Pattern C) ────────────────────────────────────────────────
    # Unique: only file with "taxable @ 100%" column
    if any("taxable @ 100%" in t or "taxable@100%" in t for t in texts):
        return "VIDHAATA"

    # ── KEDAR / MARG ERP (Pattern G) ───────────────────────────────────────
    # Unique: col0="bill no." col1="party name" col2="amount" — exact positions
    if (len(texts) >= 3
            and texts[0] == "bill no."
            and texts[1] == "party name"
            and texts[2] == "amount"):
        return "KEDAR"

    # ── PUNE grouped (Pattern F) ────────────────────────────────────────────
    # Unique: "vendor name" at col3 AND "description" at col4
    if (len(texts) >= 5
            and "vendor" in texts[3]
            and "description" in texts[4]):
        return "PUNE"

    # ── SANGEETA flat register (Pattern E) ─────────────────────────────────
    # Unique: "mrp amt" column (not "mrp amount" or just "mrp")
    if any(t == "mrp amt" or t.startswith("mrp amt") for t in texts):
        return "SANGEETA"

    # ── ICELAND party-wise grouped (Pattern A) ──────────────────────────────
    # Unique: "bill no" + "bill date" + "product name" + "product amount"
    # This MUST come after Sangeeta — Sangeeta also has "bill no" but not "product name".
    if (any("bill date" in t for t in texts)
            and any("product name" in t for t in texts)
            and any("product amount" in t for t in texts)):
        return "ICELAND"

    # ── SYNERGY register (Pattern B) ────────────────────────────────────────
    # Unique: "c/d" column (debit/credit indicator) + "prod amt"
    if any(t == "c/d" for t in texts) and any("prod amt" in t for t in texts):
        return "SYNERGY"

    # ── UNIVERSAL grouped (Pattern D) ───────────────────────────────────────
    # Unique: "particulars" column AND no "party name" / "customer name" column
    has_particulars = any("particulars" in t or "particular" == t for t in texts)
    has_party       = any("party name" in t or "customer name" in t or "vendor name" in t for t in texts)
    if has_particulars and not has_party:
        return "UNIVERSAL"

    return None   # unknown — fall through to keyword cascade


def parse_generic(
    df: pd.DataFrame,
    distributor_name: str,
) -> list[dict]:
    """
    Parse any distributor Excel sheet into a list of SKU-level transaction records.

    month and year are NOT accepted as parameters — they are derived per-transaction
    from bill_date inside _make(). This is the single source of truth for date bucketing.

    Args:
        df:               DataFrame of the best sheet (from select_best_sheet)
        distributor_name: Name of the distributor (used for shop fuzzy grouping)

    Returns:
        List of raw record dicts, each containing month and year derived from bill_date.
    """
    header_idx, header_row = _find_header_row(df)
    if header_idx is None:
        return []

    qty_col    = _find_col(header_row, QTY_KEYWORDS,    AMT_SKIP)
    amt_col    = _find_col(header_row, AMT_KEYWORDS,    AMT_SKIP)
    rate_col   = _find_col(header_row, RATE_KEYWORDS,   AMT_SKIP)
    party_col  = _find_col(header_row, PARTY_KEYWORDS,  [])
    sku_col    = _find_col(header_row, SKU_KEYWORDS,    [])
    date_col   = _find_col(header_row, DATE_KEYWORDS,   [])
    billno_col = _find_col(header_row, BILLNO_KEYWORDS, [])

    # ── Step 1: Structural fingerprint (primary routing, mismatch-proof) ────
    # Identifies each known distributor format by unique column combinations
    # that cannot appear together in any other format. This runs BEFORE any
    # keyword-substring matching to prevent false triggers like
    # "Product Amount" matching "amount" and mis-routing to Sangeeta.
    fingerprint = _fingerprint_pattern(header_row)
    print(f"[PARSER] Distributor='{distributor_name}' -> fingerprint={fingerprint!r}")

    if fingerprint == "VIDHAATA":
        margin_col = _find_col(header_row, ["margin%", "margin %", "margin"], ["retailor", "retailer"])
        taxable_col = _find_col(header_row, TAXABLE_KW, [])
        return _parse_mumbai_register(
            df, header_idx,
            party_col, sku_col, date_col, billno_col,
            qty_col, taxable_col, margin_col,
            distributor_name,
        )

    if fingerprint == "KEDAR":
        return _parse_marg_erp(df, header_idx, distributor_name)

    if fingerprint == "PUNE":
        return _parse_pune_grouped(
            df, header_idx,
            date_col, billno_col,
            distributor_name,
        )

    if fingerprint == "SANGEETA":
        mrp_amt_col = _find_col(header_row, MRP_AMT_KW,
                                 ["mrp amount", "mrp", "taxable", "gst", "tax",
                                  "bill", "claim", "25%", "margin", "recd", "scheme",
                                  "product amount", "product"])
        return _parse_sangeeta_register(
            df, header_idx,
            party_col, sku_col, date_col, billno_col,
            qty_col, mrp_amt_col,
            distributor_name,
        )

    if fingerprint == "ICELAND":
        return _parse_grouped(
            df, header_idx,
            qty_col, amt_col, rate_col, sku_col, date_col, billno_col,
            distributor_name,
        )

    if fingerprint == "SYNERGY":
        return _parse_register(
            df, header_idx,
            qty_col, amt_col, rate_col, party_col, sku_col, date_col, billno_col,
            distributor_name,
        )

    if fingerprint == "UNIVERSAL":
        return _parse_universal_grouped(
            df, header_idx,
            qty_col, amt_col, rate_col, date_col, billno_col,
            distributor_name,
        )

    # ── Step 2: Keyword cascade fallback (for future/unknown formats) ────────
    # Only reached if _fingerprint_pattern returns None (unrecognised file).
    # Preserved exactly as before — no changes to existing logic.
    print(f"[PARSER] WARNING: No fingerprint match for '{distributor_name}' -- falling back to keyword cascade")

    taxable_col = _find_col(header_row, TAXABLE_KW, [])
    margin_col  = _find_col(header_row, ["margin%", "margin %", "margin"], ["retailor", "retailer"])
    if taxable_col is not None:
        return _parse_mumbai_register(
            df, header_idx,
            party_col, sku_col, date_col, billno_col,
            qty_col, taxable_col, margin_col,
            distributor_name,
        )

    vendor_col = _find_col(header_row, ["vendor name", "vendor"], [])
    desc_col   = _find_col(header_row, ["description"], [])
    if vendor_col == 3 and desc_col == 4:
        return _parse_pune_grouped(
            df, header_idx,
            date_col, billno_col,
            distributor_name,
        )

    header_texts = [str(v).strip().lower() for v in header_row if isinstance(v, str)]
    if "bill no." in header_texts and "party name" in header_texts and "amount" in header_texts:
        return _parse_marg_erp(df, header_idx, distributor_name)

    mrp_amt_col = _find_col(header_row, MRP_AMT_KW,
                             ["mrp amount", "mrp", "taxable", "gst", "tax",
                              "bill", "claim", "25%", "margin", "recd", "scheme",
                              "product amount", "product"])
    if mrp_amt_col is not None:
        return _parse_sangeeta_register(
            df, header_idx,
            party_col, sku_col, date_col, billno_col,
            qty_col, mrp_amt_col,
            distributor_name,
        )

    particulars_col = _find_col(header_row, PARTICULARS_KW, [])
    if particulars_col is not None and party_col is None:
        return _parse_universal_grouped(
            df, header_idx,
            qty_col, amt_col, rate_col, date_col, billno_col,
            distributor_name,
        )

    pattern = _detect_pattern(df, header_idx)
    if pattern == "GROUPED":
        return _parse_grouped(
            df, header_idx,
            qty_col, amt_col, rate_col, sku_col, date_col, billno_col,
            distributor_name,
        )
    else:
        return _parse_register(
            df, header_idx,
            qty_col, amt_col, rate_col, party_col, sku_col, date_col, billno_col,
            distributor_name,
        )


# ─────────────────────────────────────────────────────────────────────────────
# PATTERN A: Party-wise grouped (Iceland)
# ─────────────────────────────────────────────────────────────────────────────

def _parse_grouped(
    df, header_idx,
    qty_col, amt_col, rate_col, sku_col, date_col, billno_col,
    distributor_name,
):
    """
    Parse party-wise grouped format (e.g. Iceland).

    Structure:
      - Shop name row:  col[0] = shop name, rest blank/sparse
      - Product line:   col[0] = bill_no (numeric), col[1] = bill_date,
                        col[2] = product_name, col[3] = qty, col[4] = rate, col[5] = amount

    month/year are derived from bill_date per transaction inside _make().
    """
    records = []
    current_shop      = None
    current_shop_type = "REGULAR"
    current_bill_no   = None
    current_bill_date = None

    for i in range(header_idx + 1, len(df)):
        row  = df.iloc[i]
        col0 = row.iloc[0]

        if _is_grand_total(row):
            break
        if _is_blank(row):
            continue
        if _is_subtotal(row):
            continue

        # ── Shop name row ────────────────────────────────────────────────────
        if _is_shop_name_row(row):
            current_shop, current_shop_type = clean_shop_name(_str(col0))
            current_bill_no   = None
            current_bill_date = None
            continue

        if current_shop is None:
            continue

        # ── Product/bill line: col0 is numeric (bill_no) ─────────────────────
        # In Iceland format every product line carries bill_no + bill_date inline.
        if _is_numeric_val(col0):
            # Bill metadata from this line
            current_bill_no = _str(col0).strip()

            if date_col is not None:
                current_bill_date = _parse_date(row.iloc[date_col])
            elif len(row) > 1:
                current_bill_date = _parse_date(row.iloc[1])

            # SKU name
            sku = ""
            if sku_col is not None:
                sku = _str(row.iloc[sku_col])
            if not sku and len(row) > 2:          # fallback: col2 in Iceland layout
                sku = _str(row.iloc[2])

            qty     = _safe_int(row.iloc[qty_col])    if qty_col is not None  else 0
            revenue = _safe_float(row.iloc[amt_col])  if amt_col is not None  else 0.0
            rate    = _safe_float(row.iloc[rate_col]) if rate_col is not None else None

            if sku and (qty != 0 or revenue != 0.0):
                records.append(_make(
                    distributor_name, current_shop, current_shop_type,
                    sku, current_bill_no, current_bill_date,
                    qty, rate, revenue,
                ))

    return records


# ─────────────────────────────────────────────────────────────────────────────
# PATTERN B: Invoice register (Synergy)
# ─────────────────────────────────────────────────────────────────────────────

def _parse_register(
    df, header_idx,
    qty_col, amt_col, rate_col, party_col, sku_col, date_col, billno_col,
    distributor_name,
):
    """
    Parse invoice-register format (e.g. Synergy).

    Structure:
      - Invoice header row: col[0] = Sr (positive int), col[1] = date,
                            col[2] = bill_no, col[4] = party_name
      - Product line:       col[0] = blank, col[1] = sku_name,
                            col[7] = qty, col[8] = rate, col[9] = amount

    bill_date is extracted from the invoice header row.
    month/year are derived from that bill_date inside _make().
    """
    records = []
    current_shop      = None
    current_shop_type = "REGULAR"
    current_bill_no   = None
    current_bill_date = None

    # Skip any sub-header rows immediately after the main header
    data_start = header_idx + 1
    while data_start < len(df):
        row = df.iloc[data_start]
        if _is_blank(row):
            data_start += 1
            continue
        if not _is_pos_int(row.iloc[0]):
            data_start += 1
            continue
        break

    for i in range(data_start, len(df)):
        row  = df.iloc[i]
        col0 = row.iloc[0]

        if _is_grand_total(row):
            break
        if _is_blank(row):
            continue

        # ── Invoice header row: col0 is positive integer (Sr No) ─────────────
        if _is_pos_int(col0):
            # Party name extraction
            party_name = ""
            if party_col is not None and party_col < len(row):
                party_name = _str(row.iloc[party_col])
            if not party_name:
                # Fallback: scan cols 2–9 for first non-numeric text > 3 chars
                for j in range(2, min(10, len(row))):
                    v = _str(row.iloc[j])
                    if v and len(v) > 3 and not _is_numeric_val(row.iloc[j]):
                        party_name = v
                        break

            current_shop, current_shop_type = (
                clean_shop_name(party_name) if party_name else ("UNKNOWN", "REGULAR")
            )

            # Bill date — extracted from the invoice header row (source of truth)
            if date_col is not None and date_col < len(row):
                current_bill_date = _parse_date(row.iloc[date_col])
            elif len(row) > 1:
                current_bill_date = _parse_date(row.iloc[1])

            # Bill no
            if billno_col is not None and billno_col < len(row):
                current_bill_no = _str(row.iloc[billno_col])
            elif len(row) > 2:
                current_bill_no = _str(row.iloc[2])

            continue

        # ── Product line: col0 blank, col1 is SKU name ────────────────────────
        col0_blank = _is_blank_val(col0)
        col1       = row.iloc[1] if len(row) > 1 else None
        col1_str   = isinstance(col1, str) and col1.strip() and col1.strip().lower() != "nan"

        if current_shop and col0_blank and col1_str:
            sku = ""
            if sku_col is not None and sku_col < len(row):
                sku = _str(row.iloc[sku_col])
            if not sku:
                sku = _str(col1)

            qty     = _safe_int(row.iloc[qty_col])    if qty_col is not None  else 0
            revenue = _safe_float(row.iloc[amt_col])  if amt_col is not None  else 0.0
            rate    = _safe_float(row.iloc[rate_col]) if rate_col is not None else None

            if sku and (qty != 0 or revenue != 0.0):
                records.append(_make(
                    distributor_name, current_shop, current_shop_type,
                    sku, current_bill_no, current_bill_date,
                    qty, rate, revenue,
                ))

    return records


# ─────────────────────────────────────────────────────────────────────────────
# PATTERN C: Mumbai flat register (Vidhaata / Taxable @ 100% format)
# ─────────────────────────────────────────────────────────────────────────────

def _parse_mumbai_register(
    df, header_idx,
    party_col, sku_col, date_col, billno_col,
    qty_col, taxable_col, margin_col,
    distributor_name,
):
    """
    Parse Mumbai flat register format (e.g. Vidhaata Ventures LLP).

    Structure: one row per SKU per invoice — completely flat, no grouping rows.
    Header row identifies: Date | Voucher No | Customer Name | Particulars |
                           Quantity | Margin% | Taxable @ 100%

    Revenue = Taxable @ 100% column.
    City    = "Mumbai" (hardcoded for this format).
    Margin% is extracted and returned per row for upsert into shop_margins.
    """
    records = []

    for i in range(header_idx + 1, len(df)):
        row = df.iloc[i]

        if _is_grand_total(row):
            break
        if _is_blank(row):
            continue
        if _is_subtotal(row):
            continue

        # Skip rows where first col is a string header / label
        col0 = row.iloc[0]
        if isinstance(col0, str) and col0.strip() and not _is_numeric_val(col0):
            # Could be a date — pandas sometimes reads dates as strings
            parsed = _parse_date(col0)
            if parsed is None:
                continue  # skip label rows

        # Extract fields
        bill_date  = _parse_date(row.iloc[date_col])   if date_col   is not None else None
        bill_no    = _str(row.iloc[billno_col])         if billno_col is not None else None
        shop_raw   = _str(row.iloc[party_col])          if party_col  is not None else ""
        sku        = _str(row.iloc[sku_col])            if sku_col    is not None else ""
        qty        = _safe_int(row.iloc[qty_col])       if qty_col    is not None else 0
        revenue    = _safe_float(row.iloc[taxable_col])
        margin_pct = _safe_float(row.iloc[margin_col])  if margin_col is not None else None

        if not shop_raw or not sku:
            continue
        if qty == 0 and revenue == 0.0:
            continue

        from .shop_name_cleaner import clean_shop_name
        shop_name, shop_type = clean_shop_name(shop_raw)

        rec = _make(
            distributor_name, shop_name, shop_type,
            sku, bill_no, bill_date,
            qty, None, revenue,
        )
        rec["city"]       = "Mumbai"
        rec["margin_pct"] = round(margin_pct * 100, 2) if margin_pct and margin_pct < 1 else (round(margin_pct, 2) if margin_pct else None)

        records.append(rec)

    return records


# ─────────────────────────────────────────────────────────────────────────────
# PATTERN D: Universal Marketing grouped (Sales Register format)
# Date in col0, shop+voucher in col1/col3 of invoice row, SKU in col1 of detail rows
# ─────────────────────────────────────────────────────────────────────────────

def _parse_universal_grouped(
    df, header_idx,
    qty_col, amt_col, rate_col, date_col, billno_col,
    distributor_name,
):
    """
    Parse Universal Marketing Sales Register format.

    Structure:
      Header: Date | Particulars | Voucher Type | Voucher No. | Quantity | Rate | Value | Gross Total
      Invoice row (col0 = date):  col1=shop_name, col3=voucher_no, col6=net_value, col7=gross_total
      Detail row  (col0 = blank): col1=sku_name,  col4=qty, col5=rate, col6=sku_value

    Revenue strategy:
      col7 (Gross Total) is ONLY present on the invoice header row, never on detail rows.
      Each detail row's revenue is scaled proportionally:
          detail_revenue = detail_col6 / invoice_col6_total  *  invoice_col7_gross
      This distributes the gross total across SKUs in proportion to their net values.

      Fallback: if col7 is absent or zero (e.g. older April format where both
      columns are identical), scale = 1.0 so col6 is used unchanged.

    City = "Mumbai". Returns/negatives are included as-is.
    """
    records           = []
    current_shop      = None
    current_shop_type = "REGULAR"
    current_bill_no   = None
    current_bill_date = None
    current_gross     = None   # col7 Gross Total from invoice header row
    current_value     = None   # col6 Value total from invoice header row (scale denominator)
    pending_details   = []     # buffer detail rows; flushed on next invoice or EOF

    DATE_COL      = 0
    SHOP_COL      = 1

    # ── Auto-detect column layout ─────────────────────────────────────────
    # 8-col variant (with "Voucher Type" column):
    #   Date | Particulars | Voucher Type | Voucher No. | Qty | Rate | Value | Gross Total
    # 6-col variant (without "Voucher Type" column):
    #   Date | Particulars | Voucher No. | Qty | Rate | Value
    # Detected by checking the header row column count.
    header_row = df.iloc[header_idx]
    ncols = sum(1 for v in header_row if not _is_blank_val(v))
    if ncols <= 6:
        # 6-col: no Voucher Type column, no Gross Total column
        BILLNO_COL    = 2
        QTY_COL       = 3
        RATE_COL      = 4
        VALUE_COL     = 5
        GROSS_TOT_COL = None   # not present in this variant
    else:
        # 8-col: original layout with Voucher Type + Gross Total
        BILLNO_COL    = 3
        QTY_COL       = 4
        RATE_COL      = 5
        VALUE_COL     = 6   # net value — on both header and detail rows
        GROSS_TOT_COL = 7   # gross / MRP total — ONLY on header row

    def _flush():
        """Emit buffered detail rows, scaling each revenue to the invoice gross total."""
        if not pending_details:
            return
        detail_sum = sum(d["_raw_rev"] for d in pending_details)
        # Scale factor: gross / sum-of-detail-values.
        # Guard: only apply when both gross and detail_sum are non-zero.
        if current_gross and detail_sum:
            scale = current_gross / detail_sum
        else:
            scale = 1.0
        for d in pending_details:
            rec = _make(
                d["dist"], d["shop"], d["shop_type"],
                d["sku"],  d["bill_no"], d["bill_date"],
                d["qty"],  d["rate"],    round(d["_raw_rev"] * scale, 2),
            )
            rec["city"] = "Mumbai"
            records.append(rec)
        pending_details.clear()

    for i in range(header_idx + 1, len(df)):
        row  = df.iloc[i]
        col0 = row.iloc[DATE_COL] if len(row) > DATE_COL else None
        col1 = row.iloc[SHOP_COL] if len(row) > SHOP_COL else None

        if _is_grand_total(row):
            break
        if _is_blank(row):
            continue

        # ── Invoice header row: col0 has a date ──────────────────────────────
        parsed_date = _parse_date(col0)
        if parsed_date is not None and col1 and _str(col1):
            _flush()  # emit the previous invoice's buffered details first
            current_bill_date = parsed_date
            current_shop, current_shop_type = clean_shop_name(_str(col1))
            current_bill_no = _str(row.iloc[BILLNO_COL]) if len(row) > BILLNO_COL else None
            # Capture both value columns from the header row
            current_value = _safe_float(row.iloc[VALUE_COL])     if len(row) > VALUE_COL     else None
            gross_raw     = row.iloc[GROSS_TOT_COL]              if (GROSS_TOT_COL is not None and len(row) > GROSS_TOT_COL) else None
            current_gross = _safe_float(gross_raw) if not _is_blank_val(gross_raw) else None
            continue

        # ── Detail row: col0 blank, col1 = SKU name ───────────────────────────
        if current_shop and _is_blank_val(col0) and col1 and _str(col1):
            sku = _str(col1)
            if not sku or sku.lower() in ("particulars", "item", "description", ""):
                continue

            qty_raw  = row.iloc[QTY_COL]  if len(row) > QTY_COL  else None
            rev_raw  = row.iloc[VALUE_COL] if len(row) > VALUE_COL else None
            rate_raw = row.iloc[RATE_COL]  if len(row) > RATE_COL  else None

            qty     = _safe_int(qty_raw)
            revenue = _safe_float(rev_raw)
            rate    = _safe_float(rate_raw) if rate_raw else None

            if qty == 0 and revenue == 0.0:
                continue

            pending_details.append({
                "dist": distributor_name, "shop": current_shop, "shop_type": current_shop_type,
                "sku": sku, "bill_no": current_bill_no, "bill_date": current_bill_date,
                "qty": qty, "rate": rate, "_raw_rev": revenue,
            })

    _flush()  # emit the final invoice's details
    return records


# ─────────────────────────────────────────────────────────────────────────────
# PATTERN E: Sangeeta Enterprises flat register (MRP Amt column)
# Completely flat — one row per SKU per invoice, party name has locality suffix
# ─────────────────────────────────────────────────────────────────────────────

def _parse_sangeeta_register(
    df, header_idx,
    party_col, sku_col, date_col, billno_col,
    qty_col, mrp_amt_col,
    distributor_name,
):
    """
    Parse Sangeeta Enterprises Date-wise Sale Analysis format.

    Structure (completely flat, one row per SKU):
      col0=Date, col1=Bill No, col2=Type, col3=Party Name, col4=Item Name,
      col5=Batch, col6=Qty, col7=Free Qty, col8=Rate, ..., col11=MRP Amt

    Transaction types:
      "Sale" → positive qty / revenue (normal sales)
      "S/Re" → sales return — qty and revenue stored as NEGATIVE
      "Scra" → scrap/damaged — qty and revenue stored as NEGATIVE

    Sign is enforced from the Type column using -abs(), so SUM(qty) and
    SUM(revenue) across the period naturally produce the correct net figures
    (e.g. 508 gross sales − 25 returns = 483 net).

    Party Name format: "PATEL GENERAL STORE           COLABA"
      — locality is after multiple spaces, stripped by normalizer's clean_name().

    SKU Name format: "SWAS CHANA JOR 85 GM          85 GM"
      — size suffix after multiple spaces is stripped here.

    Revenue = MRP Amt (col 11). City = "Mumbai".
    """
    records = []

    # Fixed column indices for Sangeeta format
    DATE_COL    = 0
    BILLNO_COL  = 1
    TYPE_COL    = 2  # "Sale", "S/Re" (return), "Scra" (scrap/damaged)
    PARTY_COL   = 3
    SKU_COL     = 4
    QTY_COL     = 6
    RATE_COL    = 8
    MRP_AMT_COL = 11  # Amount column = col L (index 11), fixed for Sangeeta format

    # Transaction types that represent negative flows (returns / write-offs).
    # Qty and revenue for these rows must be stored as negative values so that
    # SUM(qty) and SUM(revenue) across the period give the correct net figures.
    NEGATIVE_TYPES = {"s/re", "scra"}

    for i in range(header_idx + 1, len(df)):
        row = df.iloc[i]

        if _is_blank(row):
            continue
        if _is_grand_total(row):
            break

        # Skip sub-header rows (col0 is a string label, not a date)
        col0 = row.iloc[DATE_COL] if len(row) > DATE_COL else None
        bill_date = _parse_date(col0)
        if bill_date is None and isinstance(col0, str) and col0.strip():
            continue  # label row

        shop_raw = _str(row.iloc[PARTY_COL]) if len(row) > PARTY_COL else ""
        sku_raw  = _str(row.iloc[SKU_COL])   if len(row) > SKU_COL   else ""

        if not shop_raw or not sku_raw:
            continue

        # Clean SKU: strip size suffix after multiple spaces
        # "SWAS CHANA JOR 85 GM          85 GM" → "SWAS CHANA JOR 85 GM"
        sku_parts = sku_raw.split("  ")
        sku = sku_parts[0].strip() if sku_parts else sku_raw

        bill_no  = _str(row.iloc[BILLNO_COL]) if len(row) > BILLNO_COL else None
        txn_type = _str(row.iloc[TYPE_COL]).lower() if len(row) > TYPE_COL else ""
        qty      = _safe_int(row.iloc[QTY_COL])       if len(row) > QTY_COL     else 0
        revenue  = _safe_float(row.iloc[MRP_AMT_COL]) if len(row) > MRP_AMT_COL else 0.0
        rate     = _safe_float(row.iloc[RATE_COL])    if len(row) > RATE_COL    else None

        # Enforce sign from transaction type — source data from Tally already
        # writes these as negatives, but we re-enforce here so any future
        # export variant (which might omit the sign) is handled correctly.
        if txn_type in NEGATIVE_TYPES:
            qty     = -abs(qty)
            revenue = -abs(revenue)

        if qty == 0 and revenue == 0.0:
            continue

        shop_name, shop_type = clean_shop_name(shop_raw)

        rec = _make(
            distributor_name, shop_name, shop_type,
            sku, bill_no, bill_date,
            qty, rate, revenue,
        )
        rec["city"] = "Mumbai"
        records.append(rec)

    return records


# ─────────────────────────────────────────────────────────────────────────────
# PATTERN F: Pune grouped format
# S.no | Date | Bill No | Vendor Name | Description | QTY | Rate | Amount
# ─────────────────────────────────────────────────────────────────────────────

def _parse_pune_grouped(
    df, header_idx,
    date_col, billno_col,
    distributor_name,
):
    """
    Parse Pune distributor grouped format.

    Structure:
      Header: S.no | Date | Bill No | Vendor Name | Description | QTY | Rate | Amount
      Invoice row (col0 = positive int): col1=date, col2=bill_no, col3=shop_name
      Detail row  (col0 = blank, col3 = blank): col4=sku, col5=qty, col6=rate, col7=amount

    Revenue = col7 (Amount). City = "Pune" hardcoded.
    """
    # Fixed column indices for this format
    SERNO_COL  = 0
    DATE_COL   = 1
    BILLNO_COL = 2
    SHOP_COL   = 3
    SKU_COL    = 4
    QTY_COL    = 5
    RATE_COL   = 6
    AMT_COL    = 7

    records           = []
    current_shop      = None
    current_shop_type = "REGULAR"
    current_bill_no   = None
    current_bill_date = None

    for i in range(header_idx + 1, len(df)):
        row = df.iloc[i]

        if _is_grand_total(row):
            break
        if _is_blank(row):
            continue
        if _is_subtotal(row):
            continue

        col0 = row.iloc[SERNO_COL] if len(row) > SERNO_COL else None

        # ── Invoice header row: col0 is a positive integer (S.no) ─────────────────────
        # Invoice row ALSO carries the first SKU inline in cols 4-7 — emit it.
        if _is_pos_int(col0):
            current_bill_date = _parse_date(row.iloc[DATE_COL])   if len(row) > DATE_COL   else None
            current_bill_no   = _str(row.iloc[BILLNO_COL])         if len(row) > BILLNO_COL else None
            shop_raw          = _str(row.iloc[SHOP_COL])            if len(row) > SHOP_COL   else ""
            current_shop, current_shop_type = (
                clean_shop_name(shop_raw) if shop_raw else ("UNKNOWN", "REGULAR")
            )
            sku     = _str(row.iloc[SKU_COL])     if len(row) > SKU_COL  else ""
            qty     = _safe_int(row.iloc[QTY_COL])    if len(row) > QTY_COL  else 0
            rate    = _safe_float(row.iloc[RATE_COL])  if len(row) > RATE_COL else None
            revenue = _safe_float(row.iloc[AMT_COL])   if len(row) > AMT_COL  else 0.0
            if sku and (qty != 0 or revenue != 0.0):
                rec = _make(
                    distributor_name, current_shop, current_shop_type,
                    sku, current_bill_no, current_bill_date,
                    qty, rate, revenue,
                )
                rec["city"] = "Pune"
                records.append(rec)
            continue

        # ── Detail row: col0 blank AND col3 blank, col4 = SKU ─────────────────
        col3 = row.iloc[SHOP_COL] if len(row) > SHOP_COL else None
        if current_shop and _is_blank_val(col0) and _is_blank_val(col3):
            sku     = _str(row.iloc[SKU_COL])    if len(row) > SKU_COL  else ""
            qty     = _safe_int(row.iloc[QTY_COL])   if len(row) > QTY_COL  else 0
            rate    = _safe_float(row.iloc[RATE_COL]) if len(row) > RATE_COL else None
            revenue = _safe_float(row.iloc[AMT_COL])  if len(row) > AMT_COL  else 0.0

            if not sku or (qty == 0 and revenue == 0.0):
                continue

            rec = _make(
                distributor_name, current_shop, current_shop_type,
                sku, current_bill_no, current_bill_date,
                qty, rate, revenue,
            )
            rec["city"] = "Pune"
            records.append(rec)

    return records


# ─────────────────────────────────────────────────────────────────────────────
# Header detection
# ─────────────────────────────────────────────────────────────────────────────

def _find_header_row(df):
    """
    Scan the first 20 rows for the column-header row.
    Handles merged / multi-row headers by merging the next row if it also
    contains header keywords — so split two-row headers become one unified row.
    """
    all_kw = (
        QTY_KEYWORDS + AMT_KEYWORDS + PARTY_KEYWORDS
        + SKU_KEYWORDS + DATE_KEYWORDS + BILLNO_KEYWORDS
        + ["sr.", "sr"]
    )
    for i in range(min(20, len(df))):
        row    = df.iloc[i]
        texts  = [_str(v).lower() for v in row if isinstance(v, str) and v.strip()]
        matches = sum(1 for t in texts if any(kw in t for kw in all_kw))
        if matches >= 3:
            merged = list(row)
            # Peek at the next row — if it also looks like a sub-header, merge it in
            if i + 1 < len(df):
                next_row    = df.iloc[i + 1]
                next_texts  = [_str(v).lower() for v in next_row if isinstance(v, str) and v.strip()]
                next_matches = sum(1 for t in next_texts if any(kw in t for kw in all_kw))
                if next_matches >= 1:
                    for j, val in enumerate(next_row):
                        if _is_blank_val(merged[j]) and not _is_blank_val(val):
                            merged[j] = val
            return i, pd.Series(merged)
    return None, None


def _find_col(header_row, keywords, skip_keywords):
    """
    Return the column index whose header text matches any keyword
    and does NOT match any skip keyword.
    First match wins (left-to-right).
    """
    if header_row is None:
        return None
    for i, val in enumerate(header_row):
        if not isinstance(val, str):
            continue
        lower = val.strip().lower()
        if any(sk in lower for sk in skip_keywords):
            continue
        if any(kw in lower for kw in keywords):
            return i
    return None


def _is_separator_row(row) -> bool:
    """
    True for rows that are visual separators (dashes/equals/underscores) not data.
    e.g. '-----...' used as section dividers in Synergy Sales Register.
    """
    col0 = row.iloc[0]
    if not isinstance(col0, str):
        return False
    stripped = col0.strip()
    return len(stripped) >= 5 and all(c in '-=_*' for c in stripped)


def _detect_pattern(df, header_idx):
    """
    Scan up to 30 rows after the header to determine format.
    - First positive integer in col0  → REGISTER (Synergy-style)
    - First shop-name row             → GROUPED  (Iceland-style)
    Separator rows (---) are skipped before checking.
    Defaults to GROUPED if neither is found within the scan window.
    """
    for i in range(header_idx + 1, min(header_idx + 30, len(df))):
        row  = df.iloc[i]
        col0 = row.iloc[0]
        if _is_blank(row):
            continue
        if _is_separator_row(row):      # skip --- divider lines
            continue
        if _is_pos_int(col0):
            return "REGISTER"
        if _is_shop_name_row(row):
            return "GROUPED"
    return "GROUPED"



# ─────────────────────────────────────────────────────────────────────────────
# PATTERN G: MARG ERP Sales Register (Kedar Enterprise / SVS format)
# Header: BILL NO. | PARTY NAME | AMOUNT | DISCOUNT | NET AMT | TAX PAYABLE | DR/CR NET AMOUNT
# Date row:    col0 = date string (e.g. "23/05/2026"), rest blank → sets current_bill_date
# Invoice row: col0 = alphanumeric bill no (e.g. "A000716"), col1 = shop name
# SKU row:     col0 = SKU prefix (e.g. "SVS WORLD"), col1 = SKU name + qty embedded at end
#              col2 = AMOUNT (revenue for this SKU line)
# Page-break rows (SUB TOTAL, repeated headers, "Continued", "Page No") are skipped.
# City = "Mumbai" hardcoded. No margin column in this format.
# ─────────────────────────────────────────────────────────────────────────────

def _parse_marg_erp(df, header_idx, distributor_name):
    """
    Parse MARG ERP 9+ Sales Register format (Kedar Enterprise / SVS distributor).

    Row identification logic:
      - Date row:    col0 is a parseable date, rest of row is blank or whitespace
      - Invoice row: col0 is a non-date string starting with a letter+digits (e.g. "A000716"),
                     col1 is shop name, col2 is total invoice amount (not used — we sum SKU lines)
      - SKU row:     col0 is a non-blank string that is NOT a date and NOT an invoice no,
                     col1 contains SKU description with qty embedded as last integer token,
                     col2 is the SKU line amount (revenue)
      - Skip rows:   blank, SUB TOTAL, TOTAL, page headers (repeated BILL NO. header),
                     "Continued", "Page No", company name rows

    Qty extraction: col1 text ends with a number after whitespace (e.g. "BEST CHANA JOR 200GM   7")
    Revenue: col2 (AMOUNT column) of the SKU detail row
    Rate: derived as revenue / qty if qty > 0, else None
    """
    import re

    records           = []
    current_shop      = None
    current_shop_type = "REGULAR"
    current_bill_no   = None
    current_bill_date = None

    # Regex to extract trailing integer qty from SKU description strings
    # e.g. "BEST CHANA JOR 200GM                                   7" → 7
    _QTY_RE = re.compile(r"\s+(\d+)\s*$")

    # Tokens that indicate a page-break / header row to skip
    _SKIP_TOKENS = {
        "bill no.", "party name", "amount", "sub total", "subtotal",
        "total", "continued", "page no", "sales statement", "company :",
        "gstin", "phone", "e-mail", "food lic",
    }

    def _is_marg_skip_row(row):
        """True if this row is a page-break, repeated header, or company-info row."""
        texts = [str(v).strip().lower() for v in row if not _is_blank_val(v)]
        if not texts:
            return True  # blank
        first = texts[0]
        # Any known skip token present in first non-blank cell
        if any(tok in first for tok in _SKIP_TOKENS):
            return True
        # "Continued ..2" or "Page No....2" patterns
        if "continued" in first or "page no" in first:
            return True
        return False

    def _is_date_row(row):
        """col0 is a parseable date string AND the rest of the row is blank."""
        col0 = row.iloc[0]
        if _is_blank_val(col0):
            return False
        parsed = _parse_date(col0)
        if parsed is None:
            return False
        # Remaining cells should be blank (date rows in MARG format have nothing else)
        others = list(row.iloc[1:])
        blank_count = sum(1 for v in others if _is_blank_val(v))
        return blank_count >= max(1, len(others) * 0.8)

    def _is_invoice_row(row):
        """col0 = alphanumeric bill no (letter + digits), col1 = shop name."""
        col0 = row.iloc[0]
        col1 = row.iloc[1] if len(row) > 1 else None
        if _is_blank_val(col0) or _is_blank_val(col1):
            return False
        col0_str = str(col0).strip()
        # Must start with a letter and contain digits — e.g. "A000716"
        if not re.match(r"^[A-Za-z]\d", col0_str):
            return False
        # col1 must be a non-numeric string (shop name)
        col1_str = str(col1).strip()
        if not col1_str or col1_str.lower() == "nan":
            return False
        try:
            float(col1_str)
            return False  # numeric → not a shop name
        except ValueError:
            pass
        return True

    def _is_sku_row(row):
        """col0 = SKU prefix string (non-blank, non-date, non-invoice), col1 = SKU desc+qty."""
        col0 = row.iloc[0]
        col1 = row.iloc[1] if len(row) > 1 else None
        if _is_blank_val(col0) or _is_blank_val(col1):
            return False
        col0_str = str(col0).strip()
        # Must not be a date
        if _parse_date(col0_str) is not None:
            return False
        # Must not be an invoice no (letter+digits pattern)
        if re.match(r"^[A-Za-z]\d", col0_str):
            return False
        # Must not be a skip token
        if any(tok in col0_str.lower() for tok in _SKIP_TOKENS):
            return False
        # col1 must be a non-blank string
        col1_str = str(col1).strip()
        if not col1_str or col1_str.lower() == "nan":
            return False
        return True

    def _extract_sku_and_qty(col0_val, col1_val):
        """
        Build full SKU name from col0 prefix + col1 text (stripped of trailing qty).
        Extract qty from trailing integer in col1.

        e.g. col0="SVS WORLD", col1="BEST CHANA JOR 200GM                   7"
             → sku_name="SVS WORLD BEST CHANA JOR 200GM", qty=7
        """
        col0_str = str(col0_val).strip()
        col1_str = str(col1_val).strip()

        qty = 0
        m = _QTY_RE.search(col1_str)
        if m:
            qty = int(m.group(1))
            col1_str = col1_str[:m.start()].strip()

        sku_name = f"{col0_str} {col1_str}".strip()
        return sku_name, qty

    # ── Main parse loop ───────────────────────────────────────────────────────
    # Start after the header row. Also need to handle page 2 which repeats headers.
    i = header_idx + 1
    while i < len(df):
        row = df.iloc[i]
        i += 1

        if _is_blank(row):
            continue

        if _is_marg_skip_row(row):
            continue

        if _is_date_row(row):
            current_bill_date = _parse_date(row.iloc[0])
            continue

        if _is_invoice_row(row):
            current_bill_no   = str(row.iloc[0]).strip()
            shop_raw          = str(row.iloc[1]).strip()
            current_shop, current_shop_type = clean_shop_name(shop_raw)
            continue

        if _is_sku_row(row) and current_shop is not None:
            sku_name, qty = _extract_sku_and_qty(row.iloc[0], row.iloc[1])
            revenue = _safe_float(row.iloc[2]) if len(row) > 2 else 0.0
            rate    = round(revenue / qty, 2) if qty > 0 else None

            if not sku_name or (qty == 0 and revenue == 0.0):
                continue

            rec = _make(
                distributor_name, current_shop, current_shop_type,
                sku_name, current_bill_no, current_bill_date,
                qty, rate, revenue,
            )
            rec["city"] = "Mumbai"
            records.append(rec)

    return records

# ─────────────────────────────────────────────────────────────────────────────
# Row / value helpers
# ─────────────────────────────────────────────────────────────────────────────

def _is_grand_total(row):
    return any(isinstance(v, str) and "grand total" in v.lower() for v in row)


def _is_subtotal(row):
    return any(
        isinstance(v, str) and v.strip().lower() in ("total", "sub total", "subtotal")
        for v in row
    )


def _is_blank(row):
    return all(_is_blank_val(v) for v in row)


def _is_blank_val(v):
    if v is None:
        return True
    if isinstance(v, float) and np.isnan(v):
        return True
    if str(v).strip() in ("", "nan"):
        return True
    # Whitespace-only strings (e.g. "           ") must also be treated as blank.
    # Some Tally exports pad subtotal rows with spaces instead of leaving cells empty,
    # which would otherwise bypass _is_blank() and get parsed as data rows.
    if isinstance(v, str) and not v.strip():
        return True
    return False


def _is_shop_name_row(row):
    """
    True when col0 is a non-numeric string and ≥70 % of remaining columns are blank.
    Used to identify party/shop group header rows in GROUPED format.
    """
    col0 = row.iloc[0]
    if not isinstance(col0, str) or not col0.strip() or col0.strip().lower() == "nan":
        return False
    try:
        float(col0.strip())
        return False  # numeric string → not a shop name
    except (ValueError, TypeError):
        pass
    others      = list(row.iloc[1:])
    blank_count = sum(1 for v in others if _is_blank_val(v))
    return blank_count >= max(1, len(others) * 0.7)


def _is_pos_int(val):
    """True for positive integers — used to detect Sr No / invoice sequence rows."""
    if isinstance(val, (int, np.integer)) and val > 0:
        return True
    if isinstance(val, float) and not np.isnan(val) and val > 0 and val == int(val):
        return True
    if isinstance(val, str):
        try:
            v = float(val.strip())
            return v > 0 and v == int(v)
        except Exception:
            pass
    return False


def _is_numeric_val(val):
    if _is_blank_val(val):
        return False
    if isinstance(val, (int, float, np.integer, np.floating)):
        return not (isinstance(val, float) and np.isnan(val))
    try:
        float(str(val).strip())
        return True
    except Exception:
        return False


def _parse_date(val) -> datetime.date | None:
    """
    Robustly parse a date value from any cell type.

    Uses dayfirst=True to correctly handle Indian DD/MM/YYYY formats
    (e.g. 19/12/2025 → Dec 19, not Jan 12).

    Priority:
      1. Already a datetime/Timestamp/date object → return .date() directly
      2. String → pd.to_datetime(..., dayfirst=True, errors='coerce')
      3. Fallback: return None (never raises)
    """
    if val is None or _is_blank_val(val):
        return None
    # Native Python / pandas date types — trust them directly
    if isinstance(val, pd.Timestamp):
        return val.date()
    if isinstance(val, datetime.datetime):
        return val.date()
    if isinstance(val, datetime.date):
        return val
    # String parsing — enforce dayfirst for Indian DD/MM/YYYY
    try:
        parsed = pd.to_datetime(str(val).strip(), dayfirst=True, errors="coerce")
        if pd.isna(parsed):
            return None
        return parsed.date()
    except Exception:
        return None


def _str(val):
    if _is_blank_val(val):
        return ""
    return str(val).strip()


def _safe_int(val):
    try:
        if _is_blank_val(val):
            return 0
        return int(float(str(val).strip()))
    except Exception:
        return 0


def _safe_float(val):
    try:
        if _is_blank_val(val):
            return 0.0
        return float(str(val).strip())
    except Exception:
        return 0.0


def _make(
    distributor_name, shop_name, shop_type,
    sku_name, bill_no, bill_date,
    qty, rate, revenue,
) -> dict:
    """
    Build a single raw record dict.

    month and year are derived HERE from bill_date — this is the ONLY place
    that sets these fields. No external month/year parameters are accepted.

    Derivation hierarchy:
      1. bill_date is a valid date  → month = bill_date.strftime("%B"), year = bill_date.year
      2. bill_date is None          → month = None, year = None
         (normalizer will retain None; analytics layer handles missing dates)
    """
    if bill_date is not None:
        derived_month = bill_date.strftime("%B")   # e.g. "December", "January"
        derived_year  = bill_date.year             # e.g. 2025, 2026
    else:
        derived_month = None
        derived_year  = None

    return {
        "distributor_name": distributor_name,
        "shop_name":        shop_name,
        "shop_type":        shop_type,
        "sku_name":         sku_name,
        "bill_no":          bill_no,
        "bill_date":        bill_date.isoformat() if bill_date else None,
        "qty":              qty,
        "rate":             rate,
        "revenue":          round(revenue, 2),
        "month":            derived_month,
        "year":             derived_year,
    }