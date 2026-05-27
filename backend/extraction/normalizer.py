import re
from rapidfuzz import fuzz

EXCLUDE_SHOPS = {"unknown", ""}  # cash sales is valid — included

# Words that look like city names but are actually business words.
# If the double-space suffix matches one of these, keep it as part of the shop name.
_BUSINESS_WORDS = {
    "foods", "food", "store", "stores", "mart", "market", "markets",
    "supermart", "supermarket", "enterprise", "enterprises", "traders",
    "trading", "agency", "agencies", "products", "product", "services",
    "service", "solutions", "house", "hub", "centre", "center", "point",
    "corner", "plaza", "mall", "world", "zone", "circle", "square",
    "bazar", "bazaar", "medical", "pharmacy", "chemist", "general",
    "varieties", "variety", "collection", "collections", "depot", "supply",
    "suppliers", "distributor", "distributors", "wholesale", "retail",
    "international", "national", "india", "industries", "industry",
    "sweets", "sweet", "farsan", "dryfruits", "dryfruit", "nuts", "snacks",
    "grocery", "groceries", "provisions", "provision", "kirana", "departmental",
    "pvtltd", "llp", "ltd", "inc",
}


def clean_name(name: str) -> str:
    """
    Clean and normalise a shop name.

    Double-space stripping (Synergy city suffix handling):
      Synergy stores shop names as "SHOP NAME  CITY" with 2+ spaces before city.
      We strip the city suffix ONLY if it looks like a standalone city word — i.e.
      a single alpha word that is NOT a known business word (Foods, Store, etc.).
      This prevents "Shreeji  Foods" from being truncated to "Shreeji".
    """
    parts = re.split(r"  +", name)
    if len(parts) > 1:
        suffix = parts[-1].strip()
        suffix_key = suffix.lower().replace(" ", "")
        is_city_like = (
            len(suffix) >= 3
            and suffix.replace(" ", "").isalpha()   # purely alphabetic
            and " " not in suffix                    # single word
            and suffix_key not in _BUSINESS_WORDS    # not a business word
            and not suffix_key.startswith("pvt")
            and not suffix_key.startswith("llp")
        )
        name = parts[0].strip() if is_city_like else " ".join(parts).strip()
    else:
        name = name.strip()

    name = name.strip().strip("-").strip()
    name = re.sub(r"\s+", " ", name)
    name = name.upper()
    # Legal suffix normalisation
    name = re.sub(r"PVT\.?\s*LTD\.?", "PVT LTD", name)
    name = re.sub(r"LLP\.?", "LLP", name)
    name = re.sub(r"INC\.?", "INC", name)
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
    for sep in [" - ", "-", ", ", ","]:
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
    if bool(s1) != bool(s2):
        return False
    if s1 and s2 and s1 != s2:
        return False
    return True


FUZZY_THRESHOLD = 90


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
    - Excludes junk shops (Unknown, blank — NOT Cash Sales)
    - Fuzzy merges typo/casing variants ONLY within same distributor
    - Keeps different branches separate (different location suffix = different shop)
    - Keeps same shop served by two distributors as separate rows
    - Passes through SKU-level fields: sku_name, bill_no, bill_date, rate
    - Passes city through from parser (Mumbai = Pattern C, None = Ahmedabad)
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
                shop_name = dist_names[match]
            else:
                seen_shops[(dist, shop_name)] = shop_name
        else:
            seen_shops[(dist, shop_name)] = shop_name

        normalized.append({
            "upload_id":        upload_id,
            "distributor_name": dist,
            "shop_name":        shop_name,
            "shop_type":        rec.get("shop_type") or "REGULAR",
            "sku_name":         str(rec.get("sku_name") or "UNKNOWN").strip(),
            "bill_no":          rec.get("bill_no"),
            "bill_date":        rec.get("bill_date"),
            "rate":             rec.get("rate"),
            "qty":              qty,
            "revenue":          round(revenue, 2),
            "month":            rec.get("month"),
            "year":             rec.get("year"),
            "city":             rec.get("city"),
        })

    return normalized