def validate_records(records: list[dict]) -> tuple[list[dict], list[dict]]:
    valid = []
    skipped = []
    for rec in records:
        reason = _validate_one(rec)
        if reason:
            skipped.append({**rec, "skip_reason": reason})
        else:
            valid.append(rec)
    return valid, skipped


def _validate_one(rec: dict) -> str | None:
    if not rec.get("shop_name") or rec["shop_name"].strip() == "":
        return "Missing shop_name"
    if not rec.get("distributor_name"):
        return "Missing distributor_name"
    if not rec.get("sku_name") or rec["sku_name"].strip() == "":
        return "Missing sku_name"
    if rec.get("qty", 0) < 0:
        return f"Negative qty: {rec['qty']}"
    if rec.get("revenue", 0.0) < 0:
        return f"Negative revenue: {rec['revenue']}"
    return None