import re

CASH_SALE_PATTERNS = re.compile(r"^cash\s*(sales?|sale)?$", re.IGNORECASE)


def clean_shop_name(raw: str) -> tuple:
    """
    Returns (cleaned_name, shop_type).
    Keeps location suffixes intact — branch deduplication is handled by normalizer.

    Rules:
    1. Strip leading/trailing whitespace
    2. Tag as CASH_SALE if matches cash sale pattern
    """
    if not raw or not isinstance(raw, str):
        return str(raw), "REGULAR"

    name = raw.strip()

    if CASH_SALE_PATTERNS.match(name):
        return name, "CASH_SALE"

    return name, "REGULAR"