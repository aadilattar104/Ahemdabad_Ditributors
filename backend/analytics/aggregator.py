from database.supabase_client import get_supabase
from collections import defaultdict


# ---------------------------------------------------------------------------
# Pagination helper — bypasses Supabase PostgREST 1 000-row default cap
# ---------------------------------------------------------------------------

_PAGE = 1000   # rows per request; matches PostgREST default max


def _fetch_all(query) -> list[dict]:
    """
    Fetch every row matching a Supabase query, regardless of table size.

    Supabase PostgREST silently truncates results at 1 000 rows when no
    .range() is specified.  Without this helper, the "All distributors"
    aggregate totals come out LOWER than the sum of individual distributors
    because the combined table exceeds the cap.

    Usage — replace every bare:
        rows = _fetch_all(query)
    with:
        rows = _fetch_all(query)
    """
    rows: list[dict] = []
    offset = 0
    while True:
        batch = query.range(offset, offset + _PAGE - 1).execute().data or []
        rows.extend(batch)
        if len(batch) < _PAGE:
            break
        offset += _PAGE
    return rows


# ---------------------------------------------------------------------------
# SKU normalisation — DB-driven, fetched fresh on every request
# ---------------------------------------------------------------------------

MONTH_ORDER = ["January", "February", "March", "April", "May", "June",
               "July", "August", "September", "October", "November", "December"]


def _load_sku_maps(source_type: str = "DISTRIBUTOR") -> tuple[dict, dict]:
    try:
        sb = get_supabase()
        mappings = (
            sb.table("sku_mappings")
            .select("raw_sku, canonical_id, source_type")
            .eq("source_type", source_type)
            .execute()
            .data
        )
        if not mappings:
            return {}, {}
        canonical_ids = list({m["canonical_id"] for m in mappings})
        canonicals = (
            sb.table("sku_canonical")
            .select("id, name")
            .in_("id", canonical_ids)
            .execute()
            .data
        )
        id_to_name = {c["id"]: c["name"] for c in canonicals}
        aliases = {}
        reverse = {}
        for m in mappings:
            raw       = m.get("raw_sku", "")
            canonical = id_to_name.get(m.get("canonical_id", ""))
            if raw and canonical:
                aliases[raw] = canonical
                reverse.setdefault(canonical, []).append(raw)
        return aliases, reverse
    except Exception as e:
        print(f"[SKU MAP] Warning: {e}")
        return {}, {}


def _load_sku_maps_mt() -> tuple[dict, dict]:
    """Same as _load_sku_maps but for source_type=MT (mt_sales_records)."""
    return _load_sku_maps("MT")


def _apply_sku_filter_mt(rows: list[dict], sku: str | None, reverse: dict) -> list[dict]:
    """
    Filter a list of mt_sales_records dicts by canonical SKU name.
    Used after fetching rows in Python (MT data is small enough).
    If sku is a canonical name, expand to all mapped raw SKUs.
    Falls back to exact match if no mapping exists.
    """
    if not sku:
        return rows
    raw_names = reverse.get(sku)
    if raw_names:
        raw_set = set(raw_names)
        return [r for r in rows if r.get("sku_name") in raw_set]
    return [r for r in rows if r.get("sku_name") == sku]


def _norm_sku_mt(name: str | None, aliases: dict) -> str:
    """Normalise a raw MT SKU name to its canonical name."""
    raw = (name or "").strip()
    return aliases.get(raw, raw)


def _month_order(month: str | None) -> int:
    if not month:
        return 99
    try:
        return MONTH_ORDER.index(month)
    except ValueError:
        return 99


def _norm_sku(name: str | None, aliases: dict) -> str:
    """Normalise a raw SKU name using pre-loaded aliases. Never hits DB."""
    raw = (name or "").strip()
    return aliases.get(raw, raw)


def _apply_sku_filter(query, sku: str | None, reverse: dict, category_raw_skus: list | None = None):
    """Apply SKU filter using pre-loaded reverse map. Never hits DB."""
    if sku:
        raw_names = reverse.get(sku)
        if raw_names:
            return query.in_("sku_name", raw_names)
        return query.eq("sku_name", sku)
    if category_raw_skus:
        return query.in_("sku_name", category_raw_skus)
    return query


def _get_raw_skus_for_category(category: str) -> list[str]:
    """Returns all raw SKU names mapped to any canonical in the given category."""
    if not category:
        return []
    try:
        sb = get_supabase()
        canonicals = sb.table("sku_canonical").select("id").eq("category", category).execute().data
        if not canonicals:
            return []
        canonical_ids = [c["id"] for c in canonicals]
        mappings = (
            sb.table("sku_mappings").select("raw_sku")
            .in_("canonical_id", canonical_ids)
            .eq("source_type", "DISTRIBUTOR").execute().data
        )
        return [m["raw_sku"] for m in mappings if m.get("raw_sku")]
    except Exception as e:
        print(f"[SKU CATEGORY] Warning: {e}")
        return []


def get_overview(month=None, year=None, distributor=None, sku=None, city=None, category=None) -> dict:
    aliases, reverse = _load_sku_maps("DISTRIBUTOR")
    cat_skus = _get_raw_skus_for_category(category) if (category and not sku) else []
    sb = get_supabase()
    query = sb.table("sales_records").select("distributor_name, shop_name, qty, revenue")
    if month:       query = query.eq("month", month)
    if year:        query = query.eq("year", year)
    if distributor: query = query.eq("distributor_name", distributor)
    if city:        query = query.eq("city", city)
    query = _apply_sku_filter(query, sku, reverse, cat_skus)
    rows = _fetch_all(query)

    total_revenue     = round(sum(r["revenue"] for r in rows), 2)
    total_qty         = sum(r["qty"] for r in rows)
    shop_count        = len({(r["shop_name"].upper().strip(), r["distributor_name"]) for r in rows})
    distributor_count = len({r["distributor_name"] for r in rows})

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
            "revenue":    round(v["revenue"], 2),
            "qty":        v["qty"],
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


def get_shops(month=None, year=None, distributor=None, sku=None, city=None, category=None) -> list[dict]:
    aliases, reverse = _load_sku_maps("DISTRIBUTOR")
    cat_skus = _get_raw_skus_for_category(category) if (category and not sku) else []
    sb = get_supabase()
    query = sb.table("sales_records").select(
        "distributor_name, shop_name, shop_type, qty, revenue, month, year, bill_no"
    )
    if month:       query = query.eq("month", month)
    if year:        query = query.eq("year", year)
    if distributor: query = query.eq("distributor_name", distributor)
    if city:        query = query.eq("city", city)
    query = _apply_sku_filter(query, sku, reverse, cat_skus)
    rows = _fetch_all(query)

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


def get_mom_trend(distributor=None, sku=None, month=None, year=None, city=None, category=None):
    aliases, reverse = _load_sku_maps("DISTRIBUTOR")
    cat_skus = _get_raw_skus_for_category(category) if (category and not sku) else []
    sb = get_supabase()
    query = sb.table("sales_records").select("distributor_name, month, year, qty, revenue")
    if distributor: query = query.eq("distributor_name", distributor)
    if month:       query = query.eq("month", month)
    if year:        query = query.eq("year", year)
    if city:        query = query.eq("city", city)
    query = _apply_sku_filter(query, sku, reverse, cat_skus)
    rows = _fetch_all(query)

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


def get_top_shops(month=None, year=None, distributor=None, sku=None, city=None, limit=10, category=None) -> list[dict]:
    return get_shops(month=month, year=year, distributor=distributor, sku=sku, city=city, category=category)[:limit]


def get_top_shops_by_qty(month=None, year=None, distributor=None, sku=None, city=None, limit=10, category=None) -> list[dict]:
    shops = get_shops(month=month, year=year, distributor=distributor, sku=sku, city=city, category=category)
    return sorted(shops, key=lambda x: x["qty"], reverse=True)[:limit]


def get_skus() -> list[str]:
    try:
        sb = get_supabase()
        canonical_rows = (
            sb.table("sku_canonical")
            .select("name")
            .order("category").order("family").order("name")
            .execute().data
        )
        if canonical_rows:
            return [r["name"] for r in canonical_rows]
    except Exception:
        pass
    aliases, _ = _load_sku_maps("DISTRIBUTOR")
    sb = get_supabase()
    rows = _fetch_all(sb.table("sales_records").select("sku_name"))
    return sorted({aliases.get(r["sku_name"], r["sku_name"]) for r in rows if r.get("sku_name")})


def get_recurring_shops(month=None, year=None, distributor=None, sku=None, city=None, category=None) -> list[dict]:
    """
    Returns shops that placed orders on multiple different dates in the same month.
    Only shops with 2+ distinct bill_dates are included.
    """
    aliases, reverse = _load_sku_maps("DISTRIBUTOR")   # load ONCE
    cat_skus = _get_raw_skus_for_category(category) if (category and not sku) else []
    sb = get_supabase()
    query = sb.table("sales_records").select(
        "distributor_name, shop_name, sku_name, bill_no, bill_date, qty, revenue"
    )
    if month:       query = query.eq("month", month)
    if year:        query = query.eq("year", year)
    if distributor: query = query.eq("distributor_name", distributor)
    if city:        query = query.eq("city", city)
    query = _apply_sku_filter(query, sku, reverse, cat_skus)      # pass reverse — no extra DB call
    rows = _fetch_all(query)

    shop_dates: dict[tuple, set] = defaultdict(set)
    for r in rows:
        key = (r["shop_name"].upper().strip(), r["distributor_name"])
        if r.get("bill_date"):
            shop_dates[key].add(r["bill_date"])

    recurring_keys = {k for k, dates in shop_dates.items() if len(dates) >= 2}
    result = [r for r in rows if (r["shop_name"].upper().strip(), r["distributor_name"]) in recurring_keys]
    for r in result:
        r["sku_name"] = _norm_sku(r["sku_name"], aliases)   # pass aliases — no extra DB call per row
    return sorted(result, key=lambda x: (x["shop_name"].upper(), x["bill_date"] or ""))


def get_top_shops_sku_breakdown(month=None, year=None, distributor=None, sku=None, city=None, limit=10, category=None) -> dict:
    """Returns SKU-level breakdown for top shops by revenue AND top shops by qty."""
    aliases, reverse = _load_sku_maps("DISTRIBUTOR")   # load ONCE
    cat_skus = _get_raw_skus_for_category(category) if (category and not sku) else []
    sb = get_supabase()
    query = sb.table("sales_records").select("shop_name, sku_name, qty, revenue")
    if month:       query = query.eq("month", month)
    if year:        query = query.eq("year", year)
    if distributor: query = query.eq("distributor_name", distributor)
    if city:        query = query.eq("city", city)
    query = _apply_sku_filter(query, sku, reverse, cat_skus)      # pass reverse — no extra DB call
    rows = _fetch_all(query)

    agg: dict[tuple, dict] = {}
    shop_totals_rev: dict[str, float] = {}
    shop_totals_qty: dict[str, int]   = {}

    for r in rows:
        shop     = r["shop_name"].upper().strip()
        sku_norm = _norm_sku(r.get("sku_name"), aliases)   # pass aliases — no extra DB call per row
        key      = (shop, sku_norm)
        if key not in agg:
            agg[key] = {"shop_name": r["shop_name"], "sku_name": sku_norm, "revenue": 0.0, "qty": 0}
        agg[key]["revenue"] += r["revenue"]
        agg[key]["qty"]     += r["qty"]
        shop_totals_rev[shop] = shop_totals_rev.get(shop, 0.0) + r["revenue"]
        shop_totals_qty[shop] = shop_totals_qty.get(shop, 0)   + r["qty"]

    top_rev_shops = {s for s, _ in sorted(shop_totals_rev.items(), key=lambda x: x[1], reverse=True)[:limit]}
    top_qty_shops = {s for s, _ in sorted(shop_totals_qty.items(), key=lambda x: x[1], reverse=True)[:limit]}

    by_revenue = [{**v, "revenue": round(v["revenue"], 2)} for (shop, _), v in agg.items() if shop in top_rev_shops]
    by_qty     = [{**v, "revenue": round(v["revenue"], 2)} for (shop, _), v in agg.items() if shop in top_qty_shops]
    return {"by_revenue": by_revenue, "by_qty": by_qty}


def get_distributor_mom(distributor=None, sku=None, month=None, year=None, city=None, category=None):
    aliases, reverse = _load_sku_maps("DISTRIBUTOR")   # load ONCE
    cat_skus = _get_raw_skus_for_category(category) if (category and not sku) else []
    sb = get_supabase()
    query = sb.table("sales_records").select("distributor_name, shop_name, month, year, qty, revenue")
    if distributor: query = query.eq("distributor_name", distributor)
    if month:       query = query.eq("month", month)
    if year:        query = query.eq("year", year)
    if city:        query = query.eq("city", city)
    query = _apply_sku_filter(query, sku, reverse, cat_skus)      # pass reverse — no extra DB call
    rows = _fetch_all(query)

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
                "shops":   set(),
            }
        agg[key]["revenue"] += r["revenue"]
        agg[key]["qty"]     += r["qty"]
        if r.get("shop_name"):
            agg[key]["shops"].add(r["shop_name"].upper().strip())

    result = list(agg.values())
    for r in result:
        r["revenue"]    = round(r["revenue"], 2)
        r["shop_count"] = len(r.pop("shops"))
    return sorted(result, key=lambda x: (x["year"] or 0, _month_order(x["month"]), x["distributor_name"]))


def get_projection(distributor: str | None = None) -> dict:
    sb = get_supabase()
    # Paginate to bypass Supabase default 1 000-row cap — get_projection is the
    # only function that queries across ALL months with no month/year filter.
    rows: list[dict] = []
    page_size = 1000
    offset = 0
    while True:
        q = sb.table("sales_records").select("sku_name, month, year, qty, revenue")
        if distributor:
            q = q.eq("distributor_name", distributor)
        batch = q.range(offset, offset + page_size - 1).execute().data or []
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size

    def sort_key(y, m):
        try:    return y * 100 + MONTH_ORDER.index(m)
        except: return 0

    def next_month(y, m):
        idx = MONTH_ORDER.index(m)
        if idx == 11: return y + 1, MONTH_ORDER[0]
        return y, MONTH_ORDER[idx + 1]

    def month_label(y, m):
        return f"{m[:3]} {str(y)[2:]}"

    # Suppress MoM% badge when the previous month has fewer than this many
    # units — avoids misleading spikes when a prior month is sparse.
    SPARSE_QTY_THRESHOLD = 100

    month_totals: dict[tuple, dict] = {}
    sku_month:    dict[tuple, dict] = {}
    aliases_dist, _ = _load_sku_maps("DISTRIBUTOR")

    for r in rows:
        sku = _norm_sku(r.get("sku_name"), aliases_dist)
        mo  = r["month"]
        yr  = r["year"]
        rev = r["revenue"] or 0
        qty = r["qty"] or 0

        k = (yr, mo)
        if k not in month_totals:
            month_totals[k] = {"year": yr, "month": mo, "revenue": 0.0, "qty": 0}
        month_totals[k]["revenue"] += rev
        month_totals[k]["qty"]     += qty

        sk = (yr, mo, sku)
        if sk not in sku_month:
            sku_month[sk] = {"year": yr, "month": mo, "sku_name": sku, "revenue": 0.0, "qty": 0}
        sku_month[sk]["revenue"] += rev
        sku_month[sk]["qty"]     += qty

    sorted_months = sorted(month_totals.keys(), key=lambda x: sort_key(x[0], x[1]))
    if len(sorted_months) < 2:
        return {"error": "Not enough data for projection (need at least 2 months)"}

    M0 = sorted_months[-1]
    M1 = sorted_months[-2]
    # M2 is None when fewer than 3 months exist — avoids duplicating M1 data
    M2 = sorted_months[-3] if len(sorted_months) >= 3 else None

    m0 = month_totals[M0]
    m1 = month_totals[M1]
    m2 = month_totals[M2] if M2 else None

    # Blended weighted growth: 2/3 on most-recent MoM, 1/3 on prior MoM.
    # Falls back to simple MoM when M2 unavailable, or 1.10 if M1 = 0.
    # Capped at 0.5×–2.0× to prevent outlier distortion.
    if m2 and m2["revenue"] > 0 and m1["revenue"] > 0:
        blended_rev_growth = ((m0["revenue"] / m1["revenue"]) * 2 + (m1["revenue"] / m2["revenue"]) * 1) / 3
    elif m1["revenue"] > 0:
        blended_rev_growth = m0["revenue"] / m1["revenue"]
    else:
        blended_rev_growth = 1.10

    if m2 and m2["qty"] > 0 and m1["qty"] > 0:
        blended_qty_growth = ((m0["qty"] / m1["qty"]) * 2 + (m1["qty"] / m2["qty"]) * 1) / 3
    elif m1["qty"] > 0:
        blended_qty_growth = m0["qty"] / m1["qty"]
    else:
        blended_qty_growth = 1.10

    blended_rev_growth = max(0.5, min(blended_rev_growth, 2.0))
    blended_qty_growth = max(0.5, min(blended_qty_growth, 2.0))

    proj_next_rev  = m0["revenue"] * blended_rev_growth
    proj_next_qty  = m0["qty"]     * blended_qty_growth
    proj_after_rev = proj_next_rev * blended_rev_growth
    proj_after_qty = proj_next_qty * blended_qty_growth

    # Return None when prev month is sparse — UI badge is hidden automatically
    mom_rev_pct = round(((m0["revenue"] - m1["revenue"]) / m1["revenue"] * 100), 1) if m1["revenue"] and m1["qty"] >= SPARSE_QTY_THRESHOLD else None
    mom_qty_pct = round(((m0["qty"]     - m1["qty"])     / m1["qty"]     * 100), 1) if m1["qty"]     >= SPARSE_QTY_THRESHOLD                else None

    next_yr,  next_mo  = next_month(M0[0], M0[1])
    after_yr, after_mo = next_month(next_yr, next_mo)

    all_skus = sorted({k[2] for k in sku_month})
    by_sku   = []

    # _sv defined once outside loop — avoids Python late-binding closure bug
    def _sv(key, field):
        return sku_month.get(key, {}).get(field, 0) or 0

    for sku in all_skus:
        s0_rev = _sv((*M0, sku), "revenue"); s0_qty = _sv((*M0, sku), "qty")
        s1_rev = _sv((*M1, sku), "revenue"); s1_qty = _sv((*M1, sku), "qty")
        s2_rev = _sv((*M2, sku), "revenue") if M2 else 0
        s2_qty = _sv((*M2, sku), "qty")     if M2 else 0

        # Per-SKU blended growth; falls back to global rate when data is sparse
        if s2_rev > 0 and s1_rev > 0:
            sku_rev_g = ((s0_rev / s1_rev) * 2 + (s1_rev / s2_rev) * 1) / 3
        elif s1_rev > 0:
            sku_rev_g = s0_rev / s1_rev
        else:
            sku_rev_g = blended_rev_growth

        if s2_qty > 0 and s1_qty > 0:
            sku_qty_g = ((s0_qty / s1_qty) * 2 + (s1_qty / s2_qty) * 1) / 3
        elif s1_qty > 0:
            sku_qty_g = s0_qty / s1_qty
        else:
            sku_qty_g = blended_qty_growth

        sku_rev_g = max(0.5, min(sku_rev_g, 2.0))
        sku_qty_g = max(0.5, min(sku_qty_g, 2.0))

        s_proj_next_rev  = s0_rev * sku_rev_g
        s_proj_next_qty  = s0_qty * sku_qty_g
        s_proj_after_rev = s_proj_next_rev  * sku_rev_g
        s_proj_after_qty = s_proj_next_qty  * sku_qty_g

        by_sku.append({
            "sku_name":           sku,
            "m2_label":           month_label(M2[0], M2[1]) if M2 else "—",
            "m1_label":           month_label(M1[0], M1[1]),
            "m0_label":           month_label(M0[0], M0[1]),
            "proj_next_label":    month_label(next_yr,  next_mo),
            "proj_after_label":   month_label(after_yr, after_mo),
            "m2_revenue":         round(s2_rev, 2),
            "m2_qty":             int(s2_qty),
            "m1_revenue":         round(s1_rev, 2),
            "m1_qty":             int(s1_qty),
            "m0_revenue":         round(s0_rev, 2),
            "m0_qty":             int(s0_qty),
            "proj_next_revenue":  round(s_proj_next_rev, 2),
            "proj_next_qty":      int(round(s_proj_next_qty)),
            "proj_after_revenue": round(s_proj_after_rev, 2),
            "proj_after_qty":     int(round(s_proj_after_qty)),
        })
    by_sku.sort(key=lambda x: x["m0_revenue"], reverse=True)

    return {
        "current_month": {"month": M0[1], "year": M0[0], "revenue": round(m0["revenue"], 2), "qty": m0["qty"]},
        "prev_month":    {"month": M1[1], "year": M1[0], "revenue": round(m1["revenue"], 2), "qty": m1["qty"]},
        "proj_next":     {"month": next_mo,  "year": next_yr,  "revenue": round(proj_next_rev, 2),  "qty": int(round(proj_next_qty))},
        "proj_after":    {"month": after_mo, "year": after_yr, "revenue": round(proj_after_rev, 2), "qty": int(round(proj_after_qty))},
        "mom_rev_pct":   mom_rev_pct,
        "mom_qty_pct":   mom_qty_pct,
        "by_sku":        by_sku,
    }


def get_cities() -> list[str]:
    sb = get_supabase()
    rows = _fetch_all(sb.table("sales_records").select("city"))
    return sorted({r["city"] for r in rows if r.get("city")})


# ---------------------------------------------------------------------------
# Shop Activity Matrix
# ---------------------------------------------------------------------------

_MONTH_NUM = {m: i + 1 for i, m in enumerate(MONTH_ORDER)}


def _month_key(year, month) -> tuple:
    """Sortable (year, month_index) key."""
    return (year or 0, _MONTH_NUM.get(month, 0))


def _month_label(year, month) -> str:
    return f"{month} {year}"


def get_shop_activity_matrix(distributor: str, city: str | None = None, year: int | None = None, category: str | None = None, sku: str | None = None, grammage: str | None = None) -> dict:
    """
    Build a shop × month pivot table for the given distributor.

    Cell status rules:
      ACTIVE   — revenue > 0
      GAP      — revenue = 0 AND month is within the shop's first→last active month range
      INACTIVE — revenue = 0 AND month is outside the shop's active range

    Shop classification (priority order):
      is_new      → True when the shop's first active month is within the last 2
                    months of the global data range
      Has Gaps    → is_new=False AND gap_months > 0
      Consistent  → is_new=False AND is_lapsed=False AND gap_months=0 AND active_months >= 3
                    (actively ordering in latest month, no gaps, established)
      (none)      → established but sparse OR lapsed; appears only under "All" filter

    sku — optional canonical SKU name (e.g. "Chana Jor 72g"). Restricts to shops
          that bought this specific SKU, expanded to all raw variants via
          _load_sku_maps(). Takes precedence over category if both are passed.
    """
    sb = get_supabase()
    query = (
        sb.table("sales_records")
        .select("shop_name, month, year, revenue, sku_name")
        .eq("distributor_name", distributor)
    )
    if city:
        query = query.eq("city", city)
    # NOTE: year filter intentionally omitted — the matrix shows the full cross-year
    # activity timeline for each shop. Filtering by year would cut off shops whose
    # history spans multiple years (e.g. Oct 2025 → May 2026).

    if sku:
        # Specific SKU filter takes precedence — expand canonical name to raw variants
        _, reverse = _load_sku_maps("DISTRIBUTOR")
        raw_names = reverse.get(sku)
        if raw_names:
            query = query.in_("sku_name", raw_names)
        else:
            query = query.eq("sku_name", sku)
    elif category:
        cat_skus = _get_raw_skus_for_category(category)
        if cat_skus:
            query = query.in_("sku_name", cat_skus)
        else:
            return {"months": [], "shops": [], "data_range_months": []}

    rows = _fetch_all(query)

    # ── Grammage filter — DB-driven via canonical SKU names ─────────────────
    # Looks up canonical SKUs whose name ends with the grammage suffix,
    # expands them to raw SKU names via sku_mappings, then filters rows.
    # This is reliable regardless of distributor SKU naming conventions.
    if grammage and not sku:  # skip if a specific SKU is already selected
        GRAMMAGE_SUFFIX = {
            "72g":  "72g",
            "200g": ["200g", "185g"],
        }
        suffixes = GRAMMAGE_SUFFIX.get(grammage)
        if suffixes:
            if isinstance(suffixes, str):
                suffixes = [suffixes]
            try:
                # Step 1: find canonical IDs whose name ends with any suffix
                all_canonicals = (
                    sb.table("sku_canonical")
                    .select("id, name")
                    .execute()
                    .data or []
                )
                matched_ids = [
                    c["id"] for c in all_canonicals
                    if any(c.get("name", "").lower().endswith(s) for s in suffixes)
                ]
                # Step 2: expand to raw SKU names via sku_mappings
                if matched_ids:
                    mappings = (
                        sb.table("sku_mappings")
                        .select("raw_sku")
                        .in_("canonical_id", matched_ids)
                        .eq("source_type", "DISTRIBUTOR")
                        .execute()
                        .data or []
                    )
                    raw_set = {m["raw_sku"] for m in mappings if m.get("raw_sku")}
                    rows = [r for r in rows if r.get("sku_name") in raw_set]
                else:
                    rows = []
            except Exception as e:
                print(f"[GRAMMAGE] Warning: DB lookup failed — {e}")

    if not rows:
        return {"months": [], "shops": [], "data_range_months": []}

    # ── Aggregate revenue per (shop, month, year) ────────────────────────────
    cell_rev: dict[tuple, float] = {}   # (shop, year, month) → revenue
    for r in rows:
        shop = (r.get("shop_name") or "").strip()
        mo   = r.get("month")
        yr   = r.get("year")
        rev  = r.get("revenue") or 0.0
        if not shop or not mo or not yr:
            continue
        k = (shop, yr, mo)
        cell_rev[k] = cell_rev.get(k, 0.0) + rev

    # ── Build global sorted month list ───────────────────────────────────────
    all_ym: set[tuple] = set()
    for (shop, yr, mo) in cell_rev:
        all_ym.add((yr, mo))
    sorted_ym = sorted(all_ym, key=lambda x: _month_key(x[0], x[1]))
    global_months = [_month_label(yr, mo) for yr, mo in sorted_ym]   # e.g. ["April 2026", "May 2026"]

    # Last 2 months of global range define the "new shop" threshold
    new_threshold_keys = {sorted_ym[-1], sorted_ym[-2]} if len(sorted_ym) >= 2 else {sorted_ym[-1]}

    # ── Per-shop first/last active month ─────────────────────────────────────
    shop_names = sorted({k[0] for k in cell_rev})
    shop_active: dict[str, list[tuple]] = {s: [] for s in shop_names}
    for (shop, yr, mo), rev in cell_rev.items():
        if rev > 0:
            shop_active[shop].append((yr, mo))

    # ── Build shop rows ───────────────────────────────────────────────────────
    shops_out = []
    for shop in shop_names:
        active_ym = shop_active[shop]
        if not active_ym:
            continue  # never had revenue — skip entirely

        first_ym = min(active_ym, key=lambda x: _month_key(x[0], x[1]))
        last_ym  = max(active_ym, key=lambda x: _month_key(x[0], x[1]))

        cells = []
        active_count = 0
        gap_count    = 0
        total_rev    = 0.0

        for yr, mo in sorted_ym:
            rev    = cell_rev.get((shop, yr, mo), 0.0)
            mk     = _month_key(yr, mo)
            first_k = _month_key(first_ym[0], first_ym[1])
            last_k  = _month_key(last_ym[0],  last_ym[1])

            if rev > 0:
                status = "ACTIVE"
                active_count += 1
                total_rev    += rev
            elif first_k <= mk <= last_k:
                status = "GAP"
                gap_count += 1
            else:
                status = "INACTIVE"

            cells.append({
                "month":   _month_label(yr, mo),
                "revenue": round(rev, 2),
                "status":  status,
            })

        is_new    = first_ym in new_threshold_keys
        # is_lapsed: shop's last active month is NOT the latest global month.
        # A lapsed shop stopped ordering — it must NOT be classified as Consistent
        # even if it has no gap cells (those trailing months are INACTIVE, not GAP).
        is_lapsed = last_ym != sorted_ym[-1]

        shops_out.append({
            "shop_name":     shop,
            "cells":         cells,
            "total_revenue": round(total_rev, 2),
            "active_months": active_count,
            "gap_months":    gap_count,
            "is_new":        is_new,
            "is_lapsed":     is_lapsed,
        })

    # Sort shops by total revenue descending
    shops_out.sort(key=lambda x: x["total_revenue"], reverse=True)

    return {
        "months":            global_months,
        "shops":             shops_out,
        "data_range_months": global_months,
    }