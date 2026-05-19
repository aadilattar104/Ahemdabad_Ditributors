import pandas as pd
import re


def detect_layout(df: pd.DataFrame) -> str:
    """
    Returns one of: 'TYPE_A' | 'TYPE_B' | 'GENERIC' | 'UNKNOWN'

    TYPE_A (Invoice Register — SYNERGY format):
      - Has a header block in first ~10 rows
      - Column headers in rows 8-9 with "Bill No", "Qty"/"Quantity", "Prod Amt"
      - Data rows have integer Sr in col 0 + datetime in col 1

    TYPE_B (Party-wise Grouped — ICELAND format):
      - Has "Bill No", "Bill Date", "Qty", "Product Amount" in a single header row
      - Shop name rows where only col 0 is filled and rest are blank

    GENERIC:
      - Has detectable column headers but not matching A or B exactly
    """
    text_cells = _extract_text_cells(df)

    # TYPE_B signals
    has_bill_no = any("bill no" in c for c in text_cells)
    has_product_amount = any("product amount" in c for c in text_cells)
    has_bill_date = any("bill date" in c for c in text_cells)

    if has_bill_no and has_product_amount and has_bill_date:
        return "TYPE_B"

    # TYPE_A signals
    has_party_name = any("party name" in c for c in text_cells)
    has_prod_amt = any("prod amt" in c for c in text_cells)
    has_quantity = any(c in ("quantity", "qty") for c in text_cells)
    has_sales_register = any("sales register" in c for c in text_cells)

    if (has_party_name or has_sales_register) and (has_prod_amt or has_quantity):
        return "TYPE_A"

    # GENERIC — has some structured header row
    if _has_structured_header(df):
        return "GENERIC"

    return "UNKNOWN"


def _extract_text_cells(df: pd.DataFrame) -> list[str]:
    """Return all string cell values in first 15 rows, lowercased and stripped."""
    cells = []
    for row_idx in range(min(15, len(df))):
        for col_idx in range(len(df.columns)):
            val = df.iat[row_idx, col_idx]
            if isinstance(val, str) and val.strip():
                cells.append(val.strip().lower())
    return cells


def _has_structured_header(df: pd.DataFrame) -> bool:
    """Check if any row within first 15 rows has 3+ non-empty string cells."""
    for row_idx in range(min(15, len(df))):
        row = df.iloc[row_idx]
        str_count = sum(1 for v in row if isinstance(v, str) and v.strip())
        if str_count >= 3:
            return True
    return False


def find_header_row(df: pd.DataFrame, layout: str) -> int:
    """Return the row index of the actual column header row."""
    for row_idx in range(min(15, len(df))):
        row = df.iloc[row_idx]
        texts = [str(v).strip().lower() for v in row if isinstance(v, str) and v.strip()]
        if layout == "TYPE_B":
            if any("bill no" in t for t in texts) and any("qty" in t or "quantity" in t for t in texts):
                return row_idx
        elif layout == "TYPE_A":
            if any("party name" in t for t in texts) or any("quantity" in t or "qty" in t for t in texts):
                return row_idx
        else:
            if len(texts) >= 3:
                return row_idx
    return 0