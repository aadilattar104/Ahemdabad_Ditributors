from database.supabase_client import get_supabase


# ---------------------------------------------------------------------------
# SKU normalisation — maps raw DB variants to a single canonical name
# ---------------------------------------------------------------------------
_SKU_ALIASES: dict[str, str] = {
    "SVASTHYA CHANA JOR 210G MRP 180/-": "Svasthya Chana Jor 200/210g",
    "Svasthyaa Chana Jor 200 Gms":       "Svasthya Chana Jor 200/210g",
    "SVASTHYA MOONG JOR 210G MRP 180/-": "Svasthya Moong Jor 200/210g",
    "Svasthyaa Moong Jor 200Gms":        "Svasthya Moong Jor 200/210g",
    "SVASTHYA HIGH FIBER MIX MRP 180/-": "Svasthya Millet/High Fiber Mix",
    "Svasthyaa Millet Mix 185 Gms":      "Svasthya Millet/High Fiber Mix",
}

# Reverse: canonical name → list of raw DB values
_SKU_REVERSE: dict[str, list[str]] = {}
for _raw, _canonical in _SKU_ALIASES.items():
    _SKU_REVERSE.setdefault(_canonical, []).append(_raw)

def _norm_sku(name: str | None) -> str:
    raw = (name or "").strip()
    return _SKU_ALIASES.get(raw, raw)

def _apply_sku_filter(query, sku: str | None):
    """Apply SKU filter expanding canonical names to all raw DB variants."""
    if not sku:
        return query
    raw_names = _SKU_REVERSE.get(sku)
    if raw_names:
        return query.in_("sku_name", raw_names)
    return query.eq("sku_name", sku)


def get_overview(month: str | None = None, year: int | None = None, distributor: str | None = None, sku: str | None = None) -> dict:
    sb = get_supabase()
    query = sb.table("sales_records").select("distributor_name, shop_name, qty, revenue")
    if month:       query = query.eq("month", month)
    if year:        query = query.eq("year", year)
    if distributor: query = query.eq("distributor_name", distributor)
    query = _apply_sku_filter(query, sku)
    rows = query.execute().data

    total_revenue      = round(sum(r["revenue"] for r in rows), 2)
    total_qty          = sum(r["qty"] for r in rows)
    shop_count         = len({(r["shop_name"].upper().strip(), r["distributor_name"]) for r in rows})
    distributor_count  = len({r["distributor_name"] for r in rows})

    dist_map: dict[str, dict] = {}
    for r in rows:
        d = r["distributor_name"]
        if d not in dist_map:
            dist_map[d] = {"distributor_name": d, "revenue": 0.0, "qty": 0, "shops": set()}
        dist_map[d]["revenue"] += r["revenue"]
        dist_map[d]["qty"]     += r["qty"]
        dist_map[d]["shops"].add((r["shop_name"].upper().strip(), d))

    by_distributor = [
        {
            "distributor_name": v["distributor_name"],
            "revenue":   round(v["revenue"], 2),
            "qty":       v["qty"],
            "shop_count": len(v["shops"]),
        }
        for v in sorted(dist_map.values(), key=lambda x: x["revenue"], reverse=True)
    ]

    return {
        "totalRevenue":     total_revenue,
        "totalQty":         total_qty,
        "shopCount":        shop_count,
        "distributorCount": distributor_count,
        "by_distributor":   by_distributor,
    }


def get_shops(month: str | None = None, year: int | None = None, distributor: str | None = None, sku: str | None = None) -> list[dict]:
    sb = get_supabase()
    query = sb.table("sales_records").select("distributor_name, shop_name, shop_type, qty, revenue, month, year, bill_no")
    if month:       query = query.eq("month", month)
    if year:        query = query.eq("year", year)
    if distributor: query = query.eq("distributor_name", distributor)
    query = _apply_sku_filter(query, sku)
    rows = query.execute().data

    shop_map: dict[tuple, dict] = {}
    for r in rows:
        key = (r["shop_name"].upper().strip(), r["distributor_name"])
        if key not in shop_map:
            shop_map[key] = {
                "shop_name":        r["shop_name"],
                "distributor_name": r["distributor_name"],
                "shop_type":        r["shop_type"],
                "qty":              0,
                "revenue":          0.0,
                "month":            r["month"],
                "year":             r["year"],
                "bill_nos":         set(),
            }
        shop_map[key]["qty"]     += r["qty"]
        shop_map[key]["revenue"] += r["revenue"]
        if r.get("bill_no"):
            shop_map[key]["bill_nos"].add(r["bill_no"])

    shops = list(shop_map.values())
    for s in shops:
        s["revenue"]       = round(s["revenue"], 2)
        s["invoice_count"] = len(s.pop("bill_nos"))
    return sorted(shops, key=lambda x: x["revenue"], reverse=True)


def get_mom_trend(distributor=None, sku=None, month=None, year=None):
    sb = get_supabase()
    query = sb.table("sales_records").select("distributor_name, month, year, qty, revenue")
    if distributor: query = query.eq("distributor_name", distributor)
    if month:       query = query.eq("month", month)
    if year:        query = query.eq("year", year)
    query = _apply_sku_filter(query, sku)
    rows = query.execute().data
    trend_map: dict[tuple, dict] = {}

    for r in rows:
        key = (r["year"], r["month"])
        if key not in trend_map:
            trend_map[key] = {"month": r["month"], "year": r["year"], "revenue": 0.0, "qty": 0}
        trend_map[key]["revenue"] += r["revenue"]
        trend_map[key]["qty"]     += r["qty"]

    trend = list(trend_map.values())
    for t in trend:
        t["revenue"] = round(t["revenue"], 2)
    return sorted(trend, key=lambda x: (x["year"] or 0, _month_order(x["month"])))


def get_top_shops(month: str | None = None, year: int | None = None, distributor: str | None = None, sku: str | None = None, limit: int = 10) -> list[dict]:
    return get_shops(month=month, year=year, distributor=distributor, sku=sku)[:limit]


def get_top_shops_by_qty(month: str | None = None, year: int | None = None, distributor: str | None = None, sku: str | None = None, limit: int = 10) -> list[dict]:
    shops = get_shops(month=month, year=year, distributor=distributor, sku=sku)
    return sorted(shops, key=lambda x: x["qty"], reverse=True)[:limit]


def get_skus() -> list[str]:
    sb = get_supabase()
    rows = sb.table("sales_records").select("sku_name").execute().data
    return sorted({_norm_sku(r["sku_name"]) for r in rows if r.get("sku_name")})


def get_recurring_shops(month: str | None = None, year: int | None = None, distributor: str | None = None, sku: str | None = None) -> list[dict]:
    """
    Returns shops that placed orders on multiple different dates in the same month.
    Each row: shop_name, distributor_name, sku_name, bill_date, qty, revenue, bill_no
    Only shops with 2+ distinct bill_dates are included.
    """
    sb = get_supabase()
    query = sb.table("sales_records").select(
        "distributor_name, shop_name, sku_name, bill_no, bill_date, qty, revenue"
    )
    if month:       query = query.eq("month", month)
    if year:        query = query.eq("year", year)
    if distributor: query = query.eq("distributor_name", distributor)
    query = _apply_sku_filter(query, sku)
    rows = query.execute().data

    # Find shops with 2+ distinct bill_dates
    from collections import defaultdict
    shop_dates: dict[tuple, set] = defaultdict(set)
    for r in rows:
        key = (r["shop_name"].upper().strip(), r["distributor_name"])
        if r.get("bill_date"):
            shop_dates[key].add(r["bill_date"])

    recurring_keys = {k for k, dates in shop_dates.items() if len(dates) >= 2}

    # Return all line rows for those shops sorted by shop then date
    result = [r for r in rows if (r["shop_name"].upper().strip(), r["distributor_name"]) in recurring_keys]
    for r in result:
        r["sku_name"] = _norm_sku(r["sku_name"])
    return sorted(result, key=lambda x: (x["shop_name"].upper(), x["bill_date"] or ""))


def get_top_shops_sku_breakdown(
    month: str | None = None,
    year: int | None = None,
    distributor: str | None = None,
    sku: str | None = None,
    limit: int = 10,
) -> dict:
    """
    Returns SKU-level breakdown for top shops by revenue AND top shops by qty.

    Output:
    {
      "by_revenue": [
        { "shop_name": "FALGUNI GRUH...", "sku_name": "Chana Jor", "revenue": 12000.0, "qty": 80 },
        ...
      ],
      "by_qty": [
        { "shop_name": "FALGUNI GRUH...", "sku_name": "Chana Jor", "revenue": 12000.0, "qty": 80 },
        ...
      ]
    }

    Each list contains one row per (shop, sku) pair, only for the top `limit` shops
    (determined by total revenue or total qty respectively).
    No existing functionality is changed — this is additive only.
    """
    sb = get_supabase()
    query = sb.table("sales_records").select("shop_name, sku_name, qty, revenue")
    if month:       query = query.eq("month", month)
    if year:        query = query.eq("year", year)
    if distributor: query = query.eq("distributor_name", distributor)
    query = _apply_sku_filter(query, sku)
    rows = query.execute().data

    # Aggregate per (shop, sku)
    agg: dict[tuple, dict] = {}
    shop_totals_rev: dict[str, float] = {}
    shop_totals_qty: dict[str, int]   = {}

    for r in rows:
        shop     = r["shop_name"].upper().strip()
        sku_norm = _norm_sku(r.get("sku_name"))
        key      = (shop, sku_norm)

        if key not in agg:
            agg[key] = {"shop_name": r["shop_name"], "sku_name": sku_norm, "revenue": 0.0, "qty": 0}
        agg[key]["revenue"] += r["revenue"]
        agg[key]["qty"]     += r["qty"]

        shop_totals_rev[shop] = shop_totals_rev.get(shop, 0.0) + r["revenue"]
        shop_totals_qty[shop] = shop_totals_qty.get(shop, 0)   + r["qty"]

    # Top shops by revenue / qty
    top_rev_shops = {s for s, _ in sorted(shop_totals_rev.items(), key=lambda x: x[1], reverse=True)[:limit]}
    top_qty_shops = {s for s, _ in sorted(shop_totals_qty.items(), key=lambda x: x[1], reverse=True)[:limit]}

    by_revenue = [
        {**v, "revenue": round(v["revenue"], 2)}
        for (shop, _), v in agg.items() if shop in top_rev_shops
    ]
    by_qty = [
        {**v, "revenue": round(v["revenue"], 2)}
        for (shop, _), v in agg.items() if shop in top_qty_shops
    ]

    return {"by_revenue": by_revenue, "by_qty": by_qty}
def get_distributor_mom(distributor=None, sku=None, month=None, year=None):
    sb = get_supabase()
    query = sb.table("sales_records").select("distributor_name, month, year, qty, revenue")
    if distributor: query = query.eq("distributor_name", distributor)
    if month:       query = query.eq("month", month)
    if year:        query = query.eq("year", year)
    query = _apply_sku_filter(query, sku)
    rows = query.execute().data

    agg: dict[tuple, dict] = {}
    for r in rows:
        key = (r["distributor_name"], r["year"], r["month"])
        if key not in agg:
            agg[key] = {
                "distributor_name": r["distributor_name"],
                "month":   r["month"],
                "year":    r["year"],
                "revenue": 0.0,
                "qty":     0,
            }
        agg[key]["revenue"] += r["revenue"]
        agg[key]["qty"]     += r["qty"]

    result = list(agg.values())
    for r in result:
        r["revenue"] = round(r["revenue"], 2)

    return sorted(result, key=lambda x: (
        x["year"] or 0,
        _month_order(x["month"]),
        x["distributor_name"],
    ))


MONTH_ORDER = ["January","February","March","April","May","June","July","August","September","October","November","December"]

def _month_order(month: str | None) -> int:
    if not month: return 99
    try: return MONTH_ORDER.index(month)
    except ValueError: return 99