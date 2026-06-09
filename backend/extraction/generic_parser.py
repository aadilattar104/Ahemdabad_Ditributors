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

    # Detect Pattern C — Mumbai Register (has Taxable @ 100% and Customer Name columns)
    taxable_col = _find_col(header_row, TAXABLE_KW, [])
    margin_col  = _find_col(header_row, ["margin%", "margin %", "margin"], ["retailor", "retailer"])

    if taxable_col is not None:
        return _parse_mumbai_register(
            df, header_idx,
            party_col, sku_col, date_col, billno_col,
            qty_col, taxable_col, margin_col,
            distributor_name,
        )

    # Detect Pattern F — Pune grouped format (MUST be before Pattern E)
    # "Amount" in header matches MRP_AMT_KW so Pattern E false-triggers without this guard.
    # Unique fingerprint: "Vendor Name" at col 3 AND "Description" at col 4.
    vendor_col = _find_col(header_row, ["vendor name", "vendor"], [])
    desc_col   = _find_col(header_row, ["description"], [])
    if vendor_col == 3 and desc_col == 4:
        return _parse_pune_grouped(
            df, header_idx,
            date_col, billno_col,
            distributor_name,
        )

    # Detect Pattern E — Sangeeta flat register (has MRP Amt column)
    mrp_amt_col = _find_col(header_row, MRP_AMT_KW, ["mrp amt", "mrp amount", "mrp", "taxable", "gst", "tax", "bill", "claim", "25%", "margin", "recd", "scheme"])
    if mrp_amt_col is not None:
        return _parse_sangeeta_register(
            df, header_idx,
            party_col, sku_col, date_col, billno_col,
            qty_col, mrp_amt_col,
            distributor_name,
        )

    # Detect Pattern D — Universal Marketing grouped
    # Identified by: header has "Particulars" or "Sales Register" style,
    # and data rows have date in col0 + shop in col1 (invoice row) then blank col0 + sku in col1 (detail row)
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


def _detect_pattern(df, header_idx):
    """
    Scan up to 30 rows after the header to determine format.
    - First positive integer in col0  → REGISTER (Synergy-style)
    - First shop-name row             → GROUPED  (Iceland-style)
    Defaults to GROUPED if neither is found within the scan window.
    """
    for i in range(header_idx + 1, min(header_idx + 30, len(df))):
        row  = df.iloc[i]
        col0 = row.iloc[0]
        if _is_pos_int(col0):
            return "REGISTER"
        if _is_shop_name_row(row):
            return "GROUPED"
    return "GROUPED"


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