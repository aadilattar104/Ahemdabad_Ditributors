import io
import xlsxwriter
from database.supabase_client import get_supabase


def _build_canonical_lookup(sb, source_type: str) -> dict:
    """Returns {raw_sku: canonical_name} for the given source_type."""
    mappings = sb.table("sku_mappings").select(
        "raw_sku, canonical_id"
    ).eq("source_type", source_type).execute().data

    if not mappings:
        return {}

    canonical_ids = list({m["canonical_id"] for m in mappings})
    canonicals = sb.table("sku_canonical").select(
        "id, name"
    ).in_("id", canonical_ids).execute().data

    id_to_name = {c["id"]: c["name"] for c in canonicals}
    return {m["raw_sku"]: id_to_name[m["canonical_id"]]
            for m in mappings if m["canonical_id"] in id_to_name}


def export_to_excel(month: str | None = None, year: int | None = None, distributor: str | None = None) -> bytes:
    """
    Generates an Excel file of filtered sales_records.
    Uses range pagination to bypass Supabase's 1000-row default limit.
    Returns raw bytes of the .xlsx file.
    """
    sb = get_supabase()

    # Fetch ALL rows using range pagination to bypass Supabase's 1000-row limit
    all_rows = []
    batch_size = 1000
    offset = 0
    while True:
        q = sb.table("sales_records").select(
            "distributor_name, shop_name, shop_type, sku_name, qty, revenue, month, year"
        )
        if month:       q = q.eq("month", month)
        if year:        q = q.eq("year", year)
        if distributor: q = q.eq("distributor_name", distributor)
        batch = (
            q.order("distributor_name")
             .order("revenue", desc=True)
             .range(offset, offset + batch_size - 1)
             .execute().data
        )
        all_rows.extend(batch)
        if len(batch) < batch_size:
            break
        offset += batch_size
    rows = all_rows

    # Build canonical SKU lookup for DISTRIBUTOR source type
    canonical_lookup = _build_canonical_lookup(sb, "DISTRIBUTOR")

    output = io.BytesIO()
    workbook = xlsxwriter.Workbook(output, {"in_memory": True})
    ws = workbook.add_worksheet("Sales Data")

    # Formats
    header_fmt = workbook.add_format({"bold": True, "bg_color": "#D9E1F2", "border": 1})
    money_fmt   = workbook.add_format({"num_format": "#,##0.00", "border": 1})
    int_fmt     = workbook.add_format({"num_format": "#,##0", "border": 1})
    text_fmt    = workbook.add_format({"border": 1})

    # 8 columns — SKU (Canonical) inserted at index 3
    headers    = ["Distributor", "Shop Name", "Shop Type", "SKU (Canonical)", "Month", "Year", "Qty", "Revenue (₹)"]
    col_widths = [20,             40,           12,           35,               12,      8,      10,    18]

    for col, (h, w) in enumerate(zip(headers, col_widths)):
        ws.write(0, col, h, header_fmt)
        ws.set_column(col, col, w)

    for row_idx, row in enumerate(rows, start=1):
        raw_sku   = row.get("sku_name", "") or ""
        canonical = canonical_lookup.get(raw_sku, raw_sku)
        ws.write(row_idx, 0, row.get("distributor_name", ""), text_fmt)
        ws.write(row_idx, 1, row.get("shop_name", ""), text_fmt)
        ws.write(row_idx, 2, row.get("shop_type", "REGULAR"), text_fmt)
        ws.write(row_idx, 3, canonical, text_fmt)
        ws.write(row_idx, 4, row.get("month", ""), text_fmt)
        ws.write(row_idx, 5, row.get("year") or "", int_fmt)
        ws.write(row_idx, 6, row.get("qty", 0), int_fmt)
        ws.write(row_idx, 7, row.get("revenue", 0.0), money_fmt)

    workbook.close()
    return output.getvalue()


def export_mt_to_excel(
    month: str | None = None,
    year: int | None = None,
    chain: str | None = None,
) -> bytes:
    """
    Generates an Excel file of filtered mt_sales_records with canonical SKU names.
    Uses range pagination to bypass Supabase's 1000-row default limit.
    Returns raw bytes of the .xlsx file.
    """
    sb = get_supabase()

    # Fetch ALL rows using range pagination to bypass Supabase's 1000-row limit
    all_rows = []
    batch_size = 1000
    offset = 0
    while True:
        q = sb.table("mt_sales_records").select(
            "chain_name, store_name, store_code, sku_name, qty, revenue, month, year"
        )
        if month: q = q.eq("month", month)
        if year:  q = q.eq("year", int(year))
        if chain: q = q.eq("chain_name", chain)
        batch = (
            q.order("chain_name")
             .order("revenue", desc=True)
             .range(offset, offset + batch_size - 1)
             .execute().data
        )
        all_rows.extend(batch)
        if len(batch) < batch_size:
            break
        offset += batch_size
    rows = all_rows

    # Build canonical SKU lookup for MT source type
    canonical_lookup = _build_canonical_lookup(sb, "MT")

    output = io.BytesIO()
    workbook = xlsxwriter.Workbook(output, {"in_memory": True})
    ws = workbook.add_worksheet("MT Sales Data")

    # Formats
    header_fmt = workbook.add_format({"bold": True, "bg_color": "#D9E1F2", "border": 1})
    money_fmt   = workbook.add_format({"num_format": "#,##0.00", "border": 1})
    int_fmt     = workbook.add_format({"num_format": "#,##0", "border": 1})
    text_fmt    = workbook.add_format({"border": 1})

    headers    = ["Chain", "Store Name", "Store Code", "SKU (Canonical)", "Month", "Year", "Qty", "Revenue (₹)"]
    col_widths = [20,       35,            20,            35,               12,      8,      10,    18]

    for col, (h, w) in enumerate(zip(headers, col_widths)):
        ws.write(0, col, h, header_fmt)
        ws.set_column(col, col, w)

    for row_idx, row in enumerate(rows, start=1):
        raw_sku   = row.get("sku_name", "") or ""
        canonical = canonical_lookup.get(raw_sku, raw_sku)
        ws.write(row_idx, 0, row.get("chain_name", ""), text_fmt)
        ws.write(row_idx, 1, row.get("store_name", ""), text_fmt)
        ws.write(row_idx, 2, row.get("store_code", ""), text_fmt)
        ws.write(row_idx, 3, canonical, text_fmt)
        ws.write(row_idx, 4, row.get("month", ""), text_fmt)
        ws.write(row_idx, 5, row.get("year") or "", int_fmt)
        ws.write(row_idx, 6, row.get("qty", 0), int_fmt)
        ws.write(row_idx, 7, row.get("revenue", 0.0), money_fmt)

    workbook.close()
    return output.getvalue()


def export_audit_csv(upload_id: str | None = None) -> str:
    """Returns CSV string of upload audit log."""
    sb = get_supabase()
    query = sb.table("uploads").select("*")
    if upload_id:
        query = query.eq("id", upload_id)
    result = query.order("uploaded_at", desc=True).execute()
    rows = result.data

    lines = ["id,filename,distributor_name,month,year,format_detected,status,record_count,uploaded_at"]
    for r in rows:
        lines.append(",".join([
            str(r.get("id", "")),
            str(r.get("filename", "")),
            str(r.get("distributor_name", "")),
            str(r.get("month", "")),
            str(r.get("year", "")),
            str(r.get("format_detected", "")),
            str(r.get("status", "")),
            str(r.get("record_count", "")),
            str(r.get("uploaded_at", "")),
        ]))
    return "\n".join(lines)