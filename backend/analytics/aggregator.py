from database.supabase_client import get_supabase
from collections import defaultdict


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
    rows = query.execute().data

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
    rows = sb.table("sales_records").select("sku_name").execute().data
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
    rows = query.execute().data

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
    rows = query.execute().data

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
    query = sb.table("sales_records").select("distributor_name, month, year, qty, revenue")
    if distributor: query = query.eq("distributor_name", distributor)
    if month:       query = query.eq("month", month)
    if year:        query = query.eq("year", year)
    if city:        query = query.eq("city", city)
    query = _apply_sku_filter(query, sku, reverse, cat_skus)      # pass reverse — no extra DB call
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
    rows = sb.table("sales_records").select("city").execute().data
    return sorted({r["city"] for r in rows if r.get("city")})