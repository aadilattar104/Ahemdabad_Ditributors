import io
import pandas as pd


def select_best_sheet(file_bytes: bytes, filename: str) -> tuple[pd.DataFrame, str]:
    """
    Opens workbook and returns (best_dataframe, sheet_name).
    Scores each sheet by number of non-empty cells.
    Handles both .xlsx (openpyxl) and .xls (xlrd).
    """
    ext = filename.lower().rsplit(".", 1)[-1]
    engine = "xlrd" if ext == "xls" else "openpyxl"

    xls = pd.ExcelFile(io.BytesIO(file_bytes), engine=engine)
    sheet_names = xls.sheet_names

    best_sheet = None
    best_score = -1
    best_df = None

    for name in sheet_names:
        try:
            df = pd.read_excel(
                io.BytesIO(file_bytes),
                sheet_name=name,
                header=None,
                engine=engine,
            )
            score = df.notna().sum().sum()
            if score > best_score:
                best_score = score
                best_sheet = name
                best_df = df
        except Exception:
            continue

    if best_df is None:
        raise ValueError("Could not read any sheet from the workbook.")

    return best_df, best_sheet
