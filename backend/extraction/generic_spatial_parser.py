import pandas as pd
import numpy as np
from .shop_name_cleaner import clean_shop_name

# Column name patterns to look for (case-insensitive)
SHOP_COL_HINTS   = ["party name", "shop name", "customer", "party", "shop", "retailer"]
QTY_COL_HINTS    = ["qty", "quantity", "units"]
REV_COL_HINTS    = ["product amount", "prod amt", "net amount", "net amt", "amount", "value"]
SKIP_REV_HINTS   = ["bill amt", "gst", "igst", "cgst", "sgst", "tax"]


def parse_generic(df: pd.DataFrame, distributor_name: str, month: str | None, year: int | None) -> list[dict]:
    """
    Fallback parser: finds the header row by scanning for keyword hints,
    maps columns automatically, then extracts row by row.

    Works for any tabular layout where:
    - One row contains column headers
    - Each subsequent row is a data row with shop, qty, revenue
    """
    header_row_idx = _find_header_row(df)
    if header_row_idx is None:
        return []

    header = df.iloc[header_row_idx]
    shop_col = _find_col(header, SHOP_COL_HINTS, exclude=[])
    qty_col  = _find_col(header, QTY_COL_HINTS,  exclude=[])
    rev_col  = _find_col(header, REV_COL_HINTS,   exclude=SKIP_REV_HINTS)

    if shop_col is None or qty_col is None or rev_col is None:
        return []

    records = []
    shop_totals: dict[str, dict] = {}

    for row_idx in range(header_row_idx + 1, len(df)):
        row = df.iloc[row_idx]

        if _is_grand_total(row):
            break

        shop_raw = row.iloc[shop_col]
        qty_raw  = row.iloc[qty_col]
        rev_raw  = row.iloc[rev_col]

        if not isinstance(shop_raw, str) or not shop_raw.strip():
            continue

        shop_name, shop_type = clean_shop_name(shop_raw.strip())
        qty  = _safe_int(qty_raw)
        rev  = _safe_float(rev_raw)

        if qty == 0 and rev == 0.0:
            continue

        # Aggregate by shop name (generic format may have multiple rows per shop)
        key = shop_name.upper()
        if key in shop_totals:
            shop_totals[key]["qty"] += qty
            shop_totals[key]["revenue"] += rev
        else:
            shop_totals[key] = {
                "distributor_name": distributor_name,
                "shop_name": shop_name,
                "shop_type": shop_type,
                "qty": qty,
                "revenue": rev,
                "month": month,
                "year": year,
            }

    for entry in shop_totals.values():
        entry["revenue"] = round(entry["revenue"], 2)
        records.append(entry)

    return records


def _find_header_row(df: pd.DataFrame) -> int | None:
    all_hints = SHOP_COL_HINTS + QTY_COL_HINTS + REV_COL_HINTS
    for i in range(min(20, len(df))):
        texts = [str(v).strip().lower() for v in df.iloc[i] if isinstance(v, str)]
        matches = sum(1 for t in texts if any(h in t for h in all_hints))
        if matches >= 2:
            return i
    return None


def _find_col(header: pd.Series, hints: list[str], exclude: list[str]) -> int | None:
    for i, val in enumerate(header):
        if not isinstance(val, str):
            continue
        lower = val.strip().lower()
        if any(ex in lower for ex in exclude):
            continue
        if any(h in lower for h in hints):
            return i
    return None


def _is_grand_total(row: pd.Series) -> bool:
    return any(isinstance(v, str) and "grand total" in v.lower() for v in row)


def _safe_int(val) -> int:
    try:
        if isinstance(val, float) and np.isnan(val):
            return 0
        return int(val)
    except (TypeError, ValueError):
        return 0


def _safe_float(val) -> float:
    try:
        if isinstance(val, float) and np.isnan(val):
            return 0.0
        return float(val)
    except (TypeError, ValueError):
        return 0.0