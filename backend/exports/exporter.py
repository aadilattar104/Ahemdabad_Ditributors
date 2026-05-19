import io
import xlsxwriter
from database.supabase_client import get_supabase


def export_to_excel(month: str | None = None, year: int | None = None, distributor: str | None = None) -> bytes:
    """
    Generates an Excel file of filtered sales_records.
    Returns raw bytes of the .xlsx file.
    """
    sb = get_supabase()
    query = sb.table("sales_records").select(
        "distributor_name, shop_name, shop_type, qty, revenue, month, year"
    )
    if month:
        query = query.eq("month", month)
    if year:
        query = query.eq("year", year)
    if distributor:
        query = query.eq("distributor_name", distributor)

    result = query.order("distributor_name").order("revenue", desc=True).execute()
    rows = result.data

    output = io.BytesIO()
    workbook = xlsxwriter.Workbook(output, {"in_memory": True})
    ws = workbook.add_worksheet("Sales Data")

    # Formats
    header_fmt = workbook.add_format({"bold": True, "bg_color": "#D9E1F2", "border": 1})
    money_fmt   = workbook.add_format({"num_format": "#,##0.00", "border": 1})
    int_fmt     = workbook.add_format({"num_format": "#,##0", "border": 1})
    text_fmt    = workbook.add_format({"border": 1})

    headers = ["Distributor", "Shop Name", "Shop Type", "Month", "Year", "Qty", "Revenue (₹)"]
    col_widths = [20, 40, 12, 12, 8, 10, 18]

    for col, (h, w) in enumerate(zip(headers, col_widths)):
        ws.write(0, col, h, header_fmt)
        ws.set_column(col, col, w)

    for row_idx, row in enumerate(rows, start=1):
        ws.write(row_idx, 0, row.get("distributor_name", ""), text_fmt)
        ws.write(row_idx, 1, row.get("shop_name", ""), text_fmt)
        ws.write(row_idx, 2, row.get("shop_type", "REGULAR"), text_fmt)
        ws.write(row_idx, 3, row.get("month", ""), text_fmt)
        ws.write(row_idx, 4, row.get("year") or "", int_fmt)
        ws.write(row_idx, 5, row.get("qty", 0), int_fmt)
        ws.write(row_idx, 6, row.get("revenue", 0.0), money_fmt)

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