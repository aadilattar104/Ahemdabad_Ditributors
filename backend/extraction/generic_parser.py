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

PATTERN B — Invoice register (Synergy):
  header row(s) → Sr | Date | Bill No | C/D | Party Name | ... | Qty | Rate | Amount
  invoice row: col[0]=Sr(int), col[1]=date, col[2]=bill_no, col[4]=party_name
  product line: col[0]=blank, col[1]=sku_name, col[7]=qty, col[8]=rate, col[9]=amount
"""

import pandas as pd
import numpy as np
import datetime
from .shop_name_cleaner import clean_shop_name

QTY_KEYWORDS   = ["qty", "quantity", "units", "pcs"]
AMT_KEYWORDS   = ["product amount", "prod amt", "net amount", "net amt", "amount", "value"]
AMT_SKIP       = ["bill amt", "gst", "igst", "cgst", "sgst", "tax", "total amt", "bill amount"]
RATE_KEYWORDS  = ["rate", "price", "mrp"]
PARTY_KEYWORDS = ["party name", "party", "customer name", "customer", "shop name", "retailer"]
SKU_KEYWORDS   = ["product name", "product", "particular", "item name", "item", "description"]
DATE_KEYWORDS  = ["bill date", "date"]
BILLNO_KEYWORDS = ["bill no", "bill number", "invoice no", "voucher no"]


def parse_generic(
    df: pd.DataFrame,
    distributor_name: str,
    month: str | None,
    year: int | None,
) -> list[dict]:

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

    pattern = _detect_pattern(df, header_idx)

    if pattern == "GROUPED":
        return _parse_grouped(
            df, header_idx,
            qty_col, amt_col, rate_col, sku_col, date_col, billno_col,
            distributor_name, month, year
        )
    else:
        return _parse_register(
            df, header_idx,
            qty_col, amt_col, rate_col, party_col, sku_col, date_col, billno_col,
            distributor_name, month, year
        )


# ─────────────────────────────────────────────────────────────────────────────
# PATTERN A: Party-wise grouped (Iceland)
# ─────────────────────────────────────────────────────────────────────────────

def _parse_grouped(df, header_idx, qty_col, amt_col, rate_col, sku_col, date_col, billno_col, distributor_name, month, year):
    records = []
    current_shop = None
    current_shop_type = "REGULAR"
    current_bill_no = None
    current_bill_date = None

    for i in range(header_idx + 1, len(df)):
        row = df.iloc[i]
        col0 = row.iloc[0]

        if _is_grand_total(row):
            break
        if _is_blank(row):
            continue
        if _is_subtotal(row):
            continue

        # Shop name row
        if _is_shop_name_row(row):
            current_shop, current_shop_type = clean_shop_name(_str(col0))
            current_bill_no = None
            current_bill_date = None
            continue

        if current_shop is None:
            continue

        # Bill header line: col0 is numeric (bill number), col1 is a date
        # In Iceland format each line IS a product line with bill_no repeated
        if _is_numeric_val(col0):
            # Extract bill info from this line
            current_bill_no = _str(col0).strip()
            if date_col is not None:
                current_bill_date = _parse_date(row.iloc[date_col])
            elif len(row) > 1:
                current_bill_date = _parse_date(row.iloc[1])

            # Extract SKU and quantities from this same line
            sku = ""
            if sku_col is not None:
                sku = _str(row.iloc[sku_col])
            # fallback: col2 is product name in Iceland
            if not sku and len(row) > 2:
                sku = _str(row.iloc[2])

            qty     = _safe_int(row.iloc[qty_col])   if qty_col is not None  else 0
            revenue = _safe_float(row.iloc[amt_col]) if amt_col is not None  else 0.0
            rate    = _safe_float(row.iloc[rate_col]) if rate_col is not None else None

            if sku and (qty > 0 or revenue > 0):
                records.append(_make(
                    distributor_name, current_shop, current_shop_type,
                    sku, current_bill_no, current_bill_date,
                    qty, rate, revenue, month, year
                ))

    return records


# ─────────────────────────────────────────────────────────────────────────────
# PATTERN B: Invoice register (Synergy)
# ─────────────────────────────────────────────────────────────────────────────

def _parse_register(df, header_idx, qty_col, amt_col, rate_col, party_col, sku_col, date_col, billno_col, distributor_name, month, year):
    records = []
    current_shop = None
    current_shop_type = "REGULAR"
    current_bill_no = None
    current_bill_date = None

    # Skip sub-header rows after main header
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
        row = df.iloc[i]
        col0 = row.iloc[0]

        if _is_grand_total(row):
            break
        if _is_blank(row):
            continue

        # Invoice header row: col0 is positive integer (Sr No)
        if _is_pos_int(col0):
            # Party name
            party_name = ""
            if party_col is not None and party_col < len(row):
                party_name = _str(row.iloc[party_col])
            if not party_name:
                for j in range(2, min(10, len(row))):
                    v = _str(row.iloc[j])
                    if v and len(v) > 3 and not _is_numeric_val(row.iloc[j]):
                        party_name = v
                        break

            current_shop, current_shop_type = clean_shop_name(party_name) if party_name else ("UNKNOWN", "REGULAR")

            # Bill date from invoice row
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

        # Product line: col0 blank, col1 is SKU name
        col0_blank = _is_blank_val(col0)
        col1 = row.iloc[1] if len(row) > 1 else None
        col1_str = isinstance(col1, str) and col1.strip() and col1.strip().lower() != "nan"

        if current_shop and col0_blank and col1_str:
            sku = ""
            if sku_col is not None and sku_col < len(row):
                sku = _str(row.iloc[sku_col])
            if not sku:
                sku = _str(col1)

            qty     = _safe_int(row.iloc[qty_col])    if qty_col is not None  else 0
            revenue = _safe_float(row.iloc[amt_col])  if amt_col is not None  else 0.0
            rate    = _safe_float(row.iloc[rate_col]) if rate_col is not None else None

            if sku and (qty > 0 or revenue > 0):
                records.append(_make(
                    distributor_name, current_shop, current_shop_type,
                    sku, current_bill_no, current_bill_date,
                    qty, rate, revenue, month, year
                ))

    return records


# ─────────────────────────────────────────────────────────────────────────────
# Header detection
# ─────────────────────────────────────────────────────────────────────────────

def _find_header_row(df):
    all_kw = QTY_KEYWORDS + AMT_KEYWORDS + PARTY_KEYWORDS + SKU_KEYWORDS + DATE_KEYWORDS + BILLNO_KEYWORDS + ["sr.", "sr"]
    for i in range(min(20, len(df))):
        row = df.iloc[i]
        texts = [_str(v).lower() for v in row if isinstance(v, str) and v.strip()]
        matches = sum(1 for t in texts if any(kw in t for kw in all_kw))
        if matches >= 2:
            merged = list(row)
            if i + 1 < len(df):
                next_row = df.iloc[i + 1]
                next_texts = [_str(v).lower() for v in next_row if isinstance(v, str) and v.strip()]
                next_matches = sum(1 for t in next_texts if any(kw in t for kw in all_kw))
                if next_matches >= 1:
                    for j, val in enumerate(next_row):
                        if _is_blank_val(merged[j]) and not _is_blank_val(val):
                            merged[j] = val
            return i, pd.Series(merged)
    return None, None


def _find_col(header_row, keywords, skip_keywords):
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
    for i in range(header_idx + 1, min(header_idx + 30, len(df))):
        row = df.iloc[i]
        col0 = row.iloc[0]
        if _is_pos_int(col0):
            return "REGISTER"
        if _is_shop_name_row(row):
            return "GROUPED"
    return "GROUPED"


# ─────────────────────────────────────────────────────────────────────────────
# Row helpers
# ─────────────────────────────────────────────────────────────────────────────

def _is_grand_total(row):
    return any(isinstance(v, str) and "grand total" in v.lower() for v in row)

def _is_subtotal(row):
    return any(isinstance(v, str) and v.strip().lower() in ("total", "sub total", "subtotal") for v in row)

def _is_blank(row):
    return all(_is_blank_val(v) for v in row)

def _is_blank_val(v):
    if v is None: return True
    if isinstance(v, float) and np.isnan(v): return True
    if str(v).strip() in ("", "nan"): return True
    return False

def _is_shop_name_row(row):
    col0 = row.iloc[0]
    if not isinstance(col0, str) or not col0.strip() or col0.strip().lower() == "nan":
        return False
    try:
        float(col0.strip())
        return False
    except (ValueError, TypeError):
        pass
    others = list(row.iloc[1:])
    blank_count = sum(1 for v in others if _is_blank_val(v))
    return blank_count >= max(1, len(others) * 0.7)

def _is_pos_int(val):
    if isinstance(val, (int, np.integer)) and val > 0: return True
    if isinstance(val, float) and not np.isnan(val) and val > 0 and val == int(val): return True
    if isinstance(val, str):
        try:
            v = float(val.strip())
            return v > 0 and v == int(v)
        except: pass
    return False

def _is_numeric_val(val):
    if _is_blank_val(val): return False
    if isinstance(val, (int, float, np.integer, np.floating)):
        return not (isinstance(val, float) and np.isnan(val))
    try:
        float(str(val).strip())
        return True
    except: return False

def _parse_date(val) -> datetime.date | None:
    if val is None or _is_blank_val(val): return None
    if isinstance(val, (datetime.datetime, pd.Timestamp)):
        return val.date()
    if isinstance(val, datetime.date):
        return val
    try:
        return pd.to_datetime(str(val).strip()).date()
    except: return None

def _str(val):
    if _is_blank_val(val): return ""
    return str(val).strip()

def _safe_int(val):
    try:
        if _is_blank_val(val): return 0
        return int(float(str(val).strip()))
    except: return 0

def _safe_float(val):
    try:
        if _is_blank_val(val): return 0.0
        return float(str(val).strip())
    except: return 0.0

def _make(distributor_name, shop_name, shop_type, sku_name, bill_no, bill_date, qty, rate, revenue, month, year):
    return {
        "distributor_name": distributor_name,
        "shop_name": shop_name,
        "shop_type": shop_type,
        "sku_name": sku_name,
        "bill_no": bill_no,
        "bill_date": bill_date.isoformat() if bill_date else None,
        "qty": qty,
        "rate": rate,
        "revenue": round(revenue, 2),
        "month": month,
        "year": year,
    }