import re
from rapidfuzz import fuzz

EXCLUDE_SHOPS = {"cash sales", "unknown", ""}
FUZZY_THRESHOLD = 90


def clean_name(name: str) -> str:
    # Strip city column if present (double space separator in Synergy)
    name = re.split(r'  +', name)[0].strip()
    name = name.strip().strip("-").strip()
    name = re.sub(r'\s+', ' ', name)
    name = name.upper()
    # Legal suffix normalization
    name = re.sub(r'PVT\.?\s*LTD\.?', 'PVT LTD', name)
    name = re.sub(r'LLP\.?', 'LLP', name)
    name = re.sub(r'INC\.?', 'INC', name)
    name = name.strip(".").strip(",").strip()
    return name


def _spaceless(name: str) -> str:
    """Remove spaces/dashes — catches SUPERCENTRE vs SUPER CENTRE."""
    return name.replace(" ", "").replace("-", "").replace("&", "AND")


def _get_suffix(name: str):
    """
    Extract location suffix after last separator.
    e.g. 'BAJARANG SUPER MARKET-THALTEJ' -> 'THALTEJ'
         'SHREEJI KAJUWALA, VASTRAPUR'   -> 'VASTRAPUR'
         'PURNIMA FOODS'                 -> None
    """
    for sep in [' - ', '-', ', ', ',']:
        if sep in name:
            parts = name.rsplit(sep, 1)
            suffix = parts[-1].strip()
            if len(suffix) > 2:
                return suffix
    return None


def _should_merge(name1: str, name2: str, score: float) -> bool:
    """
    Merge only if:
    - Score >= threshold
    - Both have no suffix (pure typo/casing variant), OR
    - Both have the exact same suffix (truly identical)
    Never merge if one has a suffix and other doesn't,
    or if both have different suffixes (different branches).
    """
    if score < FUZZY_THRESHOLD:
        return False
    s1 = _get_suffix(name1)
    s2 = _get_suffix(name2)
    # One has branch suffix, other doesn't = keep separate
    if bool(s1) != bool(s2):
        return False
    # Both have suffixes but different locations = different branches
    if s1 and s2 and s1 != s2:
        return False
    return True


def _best_match(name: str, candidates: list) -> tuple:
    best_match, best_score = None, 0.0
    name_sp = _spaceless(name)
    for c in candidates:
        s1 = fuzz.token_sort_ratio(name, c)
        s2 = fuzz.token_sort_ratio(name_sp, _spaceless(c))
        score = max(s1, s2)
        if score > best_score:
            best_score = score
            best_match = c
    return best_match, best_score


def normalize_records(
    raw_records: list,
    distributor_name: str,
    upload_id: str,
) -> list:
    """
    Normalize raw parser output into unified DB schema.

    - Drops records with qty == 0 AND revenue == 0
    - Excludes junk shops (Cash Sales, Unknown, etc.)
    - Fuzzy merges typo/casing variants ONLY within same distributor
    - Keeps different branches separate (different location suffix = different shop)
    - Keeps same shop served by two distributors as separate rows
    - Passes through SKU-level fields: sku_name, bill_no, bill_date, rate

    DATE ARCHITECTURE:
    month and year are taken directly from each record as set by the parser's _make().
    No external month/year fallback is applied — if the parser could not derive a date
    from a transaction's bill_date, month/year will be None for that record.
    This ensures each record carries its own correct date bucket and aggregation
    across mixed-month exports remains accurate.
    """
    seen_shops = {}  # (distributor, cleaned_name) -> canonical_name
    normalized = []

    for rec in raw_records:
        qty     = int(rec.get("qty") or 0)
        revenue = float(rec.get("revenue") or 0.0)

        if qty == 0 and revenue == 0.0:
            continue

        shop_name = clean_name(str(rec.get("shop_name") or ""))
        dist      = rec.get("distributor_name") or distributor_name

        if shop_name.lower() in EXCLUDE_SHOPS:
            continue

        # Fuzzy shop name resolution within same distributor
        dist_names = {k[1]: v for k, v in seen_shops.items() if k[0] == dist}

        if dist_names:
            match, score = _best_match(shop_name, list(dist_names.keys()))
            if _should_merge(shop_name, match, score):
                shop_name = dist_names[match]  # use canonical name
            else:
                seen_shops[(dist, shop_name)] = shop_name
        else:
            seen_shops[(dist, shop_name)] = shop_name

        normalized.append({
            "upload_id":        upload_id,
            "distributor_name": dist,
            "shop_name":        shop_name,
            "shop_type":        rec.get("shop_type") or "REGULAR",
            # ── SKU-level fields ────────────────────────────────────
            "sku_name":         str(rec.get("sku_name") or "UNKNOWN").strip(),
            "bill_no":          rec.get("bill_no"),
            "bill_date":        rec.get("bill_date"),
            "rate":             rec.get("rate"),
            # ───────────────────────────────────────────────────────
            "qty":              qty,
            "revenue":          round(revenue, 2),
            # month/year come purely from the parser (derived from bill_date).
            # No external fallback — None is intentionally preserved if bill_date
            # was missing, so bad records are visible rather than silently misdated.
            "month":            rec.get("month"),
            "year":             rec.get("year"),
            "city":             rec.get("city"),      # None for Ahmedabad, "Mumbai" for Pattern C
        })

    return normalized