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

MONTH_ORDER = ["January", "February", "March", "April", "May", "June",
               "July", "August", "September", "October", "November", "December"]


def _month_order(month: str | None) -> int:
    if not month:
        return 99
    try:
        return MONTH_ORDER.index(month)
    except ValueError:
        return 99


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


def get_overview(month: str | None = None, year: int | None = None, distributor: str | None = None, sku: str | None = None, city: str | None = None) -> dict:
    sb = get_supabase()
    query = sb.table("sales_records").select("distributor_name, shop_name, qty, revenue")
    if month:       query = query.eq("month", month)
    if year:        query = query.eq("year", year)
    if distributor: query = query.eq("distributor_name", distributor)
    if city:        query = query.eq("city", city)
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


def get_shops(month: str | None = None, year: int | None = None, distributor: str | None = None, sku: str | None = None, city: str | None = None) -> list[dict]:
    sb = get_supabase()
    query = sb.table("sales_records").select("distributor_name, shop_name, shop_type, qty, revenue, month, year, bill_no")
    if month:       query = query.eq("month", month)
    if year:        query = query.eq("year", year)
    if distributor: query = query.eq("distributor_name", distributor)
    if city:        query = query.eq("city", city)
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


def get_mom_trend(distributor=None, sku=None, month=None, year=None, city=None):
    sb = get_supabase()
    query = sb.table("sales_records").select("distributor_name, month, year, qty, revenue")
    if distributor: query = query.eq("distributor_name", distributor)
    if month:       query = query.eq("month", month)
    if year:        query = query.eq("year", year)
    if city:        query = query.eq("city", city)
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


def get_top_shops(month: str | None = None, year: int | None = None, distributor: str | None = None, sku: str | None = None, city: str | None = None, limit: int = 10) -> list[dict]:
    return get_shops(month=month, year=year, distributor=distributor, sku=sku, city=city)[:limit]


def get_top_shops_by_qty(month: str | None = None, year: int | None = None, distributor: str | None = None, sku: str | None = None, city: str | None = None, limit: int = 10) -> list[dict]:
    shops = get_shops(month=month, year=year, distributor=distributor, sku=sku, city=city)
    return sorted(shops, key=lambda x: x["qty"], reverse=True)[:limit]


def get_skus() -> list[str]:
    sb = get_supabase()
    rows = sb.table("sales_records").select("sku_name").execute().data
    return sorted({_norm_sku(r["sku_name"]) for r in rows if r.get("sku_name")})


def get_recurring_shops(month: str | None = None, year: int | None = None, distributor: str | None = None, sku: str | None = None, city: str | None = None) -> list[dict]:
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
    if city:        query = query.eq("city", city)
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
    city: str | None = None,
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
    if city:        query = query.eq("city", city)
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


def get_distributor_mom(distributor=None, sku=None, month=None, year=None, city=None):
    sb = get_supabase()
    query = sb.table("sales_records").select("distributor_name, month, year, qty, revenue")
    if distributor: query = query.eq("distributor_name", distributor)
    if month:       query = query.eq("month", month)
    if year:        query = query.eq("year", year)
    if city:        query = query.eq("city", city)
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


def get_projection(distributor: str | None = None) -> dict:
    """
    Weighted moving average projection for revenue and qty.

    Logic:
      - Fetch all monthly totals (per SKU) from sales_records
      - Sort months chronologically
      - Latest completed month = "current month" (April 2026 in current data)
      - Projected next month  = w1*M0 + w2*M-1 + w3*M-2  (w1=0.5, w2=0.3, w3=0.2)
      - Projected month after = w1*proj_next + w2*M0 + w3*M-1

    Returns:
    {
      "current_month":  { month, year, revenue, qty },
      "prev_month":     { month, year, revenue, qty },
      "proj_next":      { month, year, revenue, qty },          # e.g. May 2026
      "proj_after":     { month, year, revenue, qty },          # e.g. Jun 2026
      "mom_rev_pct":    float,   # % change current vs prev revenue
      "mom_qty_pct":    float,   # % change current vs prev qty
      "by_sku": [
        {
          sku_name,
          m2_revenue, m2_qty,            # 3 months ago
          m1_revenue, m1_qty,            # 2 months ago
          m0_revenue, m0_qty,            # latest (current) month
          proj_next_revenue, proj_next_qty,
          proj_after_revenue, proj_after_qty,
          m2_label, m1_label, m0_label,
          proj_next_label, proj_after_label,
        },
        ...
      ]
    }
    """
    sb = get_supabase()
    query = sb.table("sales_records").select("sku_name, month, year, qty, revenue")
    if distributor:
        query = query.eq("distributor_name", distributor)
    rows = query.execute().data

    # ── Helper functions ─────────────────────────────────────────────────────
    def sort_key(y, m):
        try:
            return y * 100 + MONTH_ORDER.index(m)
        except Exception:
            return 0

    def next_month(y, m):
        idx = MONTH_ORDER.index(m)
        if idx == 11:
            return y + 1, MONTH_ORDER[0]
        return y, MONTH_ORDER[idx + 1]

    def month_label(y, m):
        return f"{m[:3]} {str(y)[2:]}"

    # ── Aggregate totals per (year, month) and per (year, month, sku) ──────
    # Total per month
    month_totals: dict[tuple, dict] = {}
    # Per SKU per month
    sku_month: dict[tuple, dict] = {}

    for r in rows:
        sku  = _norm_sku(r.get("sku_name"))
        mo   = r["month"]
        yr   = r["year"]
        rev  = r["revenue"] or 0
        qty  = r["qty"] or 0

        # totals
        k = (yr, mo)
        if k not in month_totals:
            month_totals[k] = {"year": yr, "month": mo, "revenue": 0.0, "qty": 0}
        month_totals[k]["revenue"] += rev
        month_totals[k]["qty"]     += qty

        # by sku
        sk = (yr, mo, sku)
        if sk not in sku_month:
            sku_month[sk] = {"year": yr, "month": mo, "sku_name": sku, "revenue": 0.0, "qty": 0}
        sku_month[sk]["revenue"] += rev
        sku_month[sk]["qty"]     += qty

    # ── Sort months chronologically ──────────────────────────────────────────
    sorted_months = sorted(month_totals.keys(), key=lambda x: sort_key(x[0], x[1]))
    if len(sorted_months) < 2:
        return {"error": "Not enough data for projection (need at least 2 months)"}

    # Latest = M0 (current), previous months = M1, M2
    M0 = sorted_months[-1]   # latest completed month
    M1 = sorted_months[-2]   # one before
    M2 = sorted_months[-3] if len(sorted_months) >= 3 else M1

    W0, W1, W2 = 0.5, 0.3, 0.2

    def weighted(v0, v1, v2):
        return v0 * W0 + v1 * W1 + v2 * W2

    # ── Overall KPI projection ────────────────────────────────────────────────
    m0 = month_totals[M0]
    m1 = month_totals[M1]
    m2 = month_totals[M2]

    proj_next_rev  = m0["revenue"] * 1.10
    proj_next_qty  = m0["qty"]     * 1.10

    proj_after_rev = proj_next_rev * 1.10
    proj_after_qty = proj_next_qty * 1.10

    mom_rev_pct = round(((m0["revenue"] - m1["revenue"]) / m1["revenue"] * 100), 1) if m1["revenue"] else 0
    mom_qty_pct = round(((m0["qty"]     - m1["qty"])     / m1["qty"]     * 100), 1) if m1["qty"]     else 0

    next_yr, next_mo     = next_month(M0[0], M0[1])
    after_yr, after_mo   = next_month(next_yr, next_mo)

    # ── Per-SKU projection ────────────────────────────────────────────────────
    all_skus = sorted({k[2] for k in sku_month})
    by_sku   = []

    for sku in all_skus:
        def sv(key, field):
            return sku_month.get(key, {}).get(field, 0) or 0

        s0_rev = sv((*M0, sku), "revenue");  s0_qty = sv((*M0, sku), "qty")
        s1_rev = sv((*M1, sku), "revenue");  s1_qty = sv((*M1, sku), "qty")
        s2_rev = sv((*M2, sku), "revenue");  s2_qty = sv((*M2, sku), "qty")

        s_proj_next_rev  = s0_rev * 1.10
        s_proj_next_qty  = s0_qty * 1.10
        s_proj_after_rev = s_proj_next_rev * 1.10
        s_proj_after_qty = s_proj_next_qty * 1.10

        by_sku.append({
            "sku_name":          sku,
            "m2_label":          month_label(M2[0], M2[1]),
            "m1_label":          month_label(M1[0], M1[1]),
            "m0_label":          month_label(M0[0], M0[1]),
            "proj_next_label":   month_label(next_yr,  next_mo),
            "proj_after_label":  month_label(after_yr, after_mo),
            "m2_revenue":        round(s2_rev, 2),
            "m2_qty":            int(s2_qty),
            "m1_revenue":        round(s1_rev, 2),
            "m1_qty":            int(s1_qty),
            "m0_revenue":        round(s0_rev, 2),
            "m0_qty":            int(s0_qty),
            "proj_next_revenue": round(s_proj_next_rev, 2),
            "proj_next_qty":     int(round(s_proj_next_qty)),
            "proj_after_revenue":round(s_proj_after_rev, 2),
            "proj_after_qty":    int(round(s_proj_after_qty)),
        })

    by_sku.sort(key=lambda x: x["m0_revenue"], reverse=True)

    return {
        "current_month":  {"month": M0[1], "year": M0[0], "revenue": round(m0["revenue"], 2), "qty": m0["qty"]},
        "prev_month":     {"month": M1[1], "year": M1[0], "revenue": round(m1["revenue"], 2), "qty": m1["qty"]},
        "proj_next":      {"month": next_mo,  "year": next_yr,  "revenue": round(proj_next_rev, 2),  "qty": int(round(proj_next_qty))},
        "proj_after":     {"month": after_mo, "year": after_yr, "revenue": round(proj_after_rev, 2), "qty": int(round(proj_after_qty))},
        "mom_rev_pct":    mom_rev_pct,
        "mom_qty_pct":    mom_qty_pct,
        "by_sku":         by_sku,
    }


def get_cities() -> list[str]:
    sb = get_supabase()
    rows = sb.table("sales_records").select("city").execute().data
    return sorted({r["city"] for r in rows if r.get("city")})