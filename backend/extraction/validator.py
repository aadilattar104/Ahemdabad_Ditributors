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
    # Allow negative qty and revenue — these are valid return/credit note rows
    # (Sangeeta S/Re and Scra transaction types). Only reject if BOTH are zero.
    qty     = rec.get("qty", 0)
    revenue = rec.get("revenue", 0.0)
    if qty == 0 and revenue == 0.0:
        return "Zero qty and zero revenue"
    return None