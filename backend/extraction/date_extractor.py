import re
import pandas as pd

MONTH_MAP = {
    "jan": "January", "feb": "February", "mar": "March", "apr": "April",
    "may": "May", "jun": "June", "jul": "July", "aug": "August",
    "sep": "September", "oct": "October", "nov": "November", "dec": "December",
    "january": "January", "february": "February", "march": "March",
    "april": "April", "june": "June", "july": "July", "august": "August",
    "september": "September", "october": "October", "november": "November",
    "december": "December",
}

DATE_RANGE_RE = re.compile(
    r"from\s+date\s+\d{1,2}/\d{1,2}/(\d{4})\s+to\s+\d{1,2}/\d{1,2}/\d{4}",
    re.IGNORECASE,
)
MONTH_YEAR_RE = re.compile(
    r"\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b",
    re.IGNORECASE,
)


def _parse_month_from_date_range(text: str) -> tuple[str | None, int | None]:
    """Extract month/year from 'From Date DD/MM/YYYY To DD/MM/YYYY'."""
    m = DATE_RANGE_RE.search(text)
    if m:
        year = int(m.group(1))
        # find the month number from the first date
        date_m = re.search(r"(\d{1,2})/(\d{1,2})/\d{4}", text)
        if date_m:
            month_num = int(date_m.group(2))
            month_names = list(MONTH_MAP.values())
            # deduplicate while preserving order
            seen = set()
            unique_months = []
            for mn in month_names:
                if mn not in seen:
                    seen.add(mn)
                    unique_months.append(mn)
            if 1 <= month_num <= 12:
                return unique_months[month_num - 1], year
    return None, None


def extract_date_from_df(df: pd.DataFrame) -> tuple[str | None, int | None]:
    """
    Scan first 10 rows of the dataframe for a date range string.
    Returns (month_name, year) or (None, None).
    """
    for row_idx in range(min(10, len(df))):
        for col_idx in range(len(df.columns)):
            val = df.iat[row_idx, col_idx]
            if not isinstance(val, str):
                continue
            # Try date range pattern first
            month, year = _parse_month_from_date_range(val)
            if month:
                return month, year
            # Try plain "Month YYYY"
            m = MONTH_YEAR_RE.search(val)
            if m:
                return MONTH_MAP.get(m.group(1).lower(), m.group(1).capitalize()), int(m.group(2))
    return None, None


def extract_date_from_filename(filename: str) -> tuple[str | None, int | None]:
    """Try to extract month from filename like SYNERGY_April.xlsx."""
    base = filename.rsplit(".", 1)[0]
    parts = re.split(r"[_\-\s]+", base)
    for part in parts:
        lower = part.lower()
        if lower in MONTH_MAP:
            # try to find year too
            year_m = re.search(r"\b(20\d{2})\b", base)
            year = int(year_m.group(1)) if year_m else None
            return MONTH_MAP[lower], year
    return None, None