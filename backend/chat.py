"""
chat.py
=======
Text-to-SQL chatbot pipeline for Excel Intelligence dashboard.

Flow:
  1. User question → classify/resolve product ambiguity
  2. Build prompt with CRITICAL RULES first, then schema + examples + context
  3. Groq API (Llama 3.3 70B) → SQL query
  4. Validate SQL → check fan-out risk → execute against Supabase
  5. Inject missing context filters → check unmapped SKUs
  6. Raw rows → pre-format INR → Groq API → natural language answer
  7. Return answer to frontend

No embeddings. No vector search. Pure SQL on structured data.
"""

import os
import re
import time
import httpx
from datetime import date
from database.supabase_client import get_supabase

# ─────────────────────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────────────────────

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL   = "llama-3.3-70b-versatile"

_GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")


def _get_groq_key() -> str:
    if not _GROQ_API_KEY:
        raise ValueError("GROQ_API_KEY not found in environment")
    if len(_GROQ_API_KEY) < 20:
        raise ValueError("Invalid GROQ_API_KEY detected")
    return _GROQ_API_KEY


# ─────────────────────────────────────────────────────────────
# RUNTIME DB LOOKUPS
# ─────────────────────────────────────────────────────────────

import functools

@functools.lru_cache(maxsize=1)
def _get_actual_distributor_names() -> str:
    """
    Fetch exact distributor_name values from DB once per process lifetime.
    Injected into the SQL prompt so the LLM always sees real spellings.
    Falls back to hardcoded list if DB call fails.
    """
    try:
        sb = get_supabase()
        rows = sb.table("distributors").select("distributor_name").execute().data
        if rows:
            # Preserve exact DB casing — this is what the LLM must use in SQL
            names = sorted({r["distributor_name"] for r in rows if r.get("distributor_name")})
            return ", ".join(f'"{n}"' for n in names)
    except Exception as e:
        print(f"[CHAT] Could not fetch distributor names: {e}")
    return '"SYNERGY", "ICELAND", "Vidhaata", "SANGEETA", "UNIVERSAL"'  


def _resolve_distributor_name(raw: str) -> str:
    """
    Resolve a user-typed distributor name to the exact DB value including exact casing.
    e.g. "vidhata" → "Vidhaata", "SYNERGY" → "SYNERGY"

    All comparisons are case-insensitive but the RETURN VALUE is the exact DB string.
    This is critical — SQL WHERE clauses are case-sensitive in PostgreSQL by default.

    Three-level resolution:
      1. Case-insensitive exact match  → return exact DB value
      2. Substring match               → return exact DB value
      3. Character similarity ≥ 0.7    → return exact DB value
    Falls back to raw.strip() if nothing matches.
    """
    if not raw:
        return raw
    raw_norm = raw.upper().strip()
    try:
        sb = get_supabase()
        rows = sb.table("distributors").select("distributor_name").execute().data
        # Keep original casing — this is what goes into the SQL WHERE clause
        db_names = [r["distributor_name"] for r in rows if r.get("distributor_name")]

        # Level 1: case-insensitive exact match
        for n in db_names:
            if n.upper() == raw_norm:
                print(f"[RESOLVE exact] '{raw}' → '{n}'")
                return n

        # Level 2: substring (case-insensitive)
        matches = [n for n in db_names if raw_norm in n.upper() or n.upper() in raw_norm]
        if len(matches) == 1:
            print(f"[RESOLVE substr] '{raw}' → '{matches[0]}'")
            return matches[0]

        # Level 3: character similarity
        def similarity(a, b):
            return sum(c in b for c in a) / max(len(a), 1)

        scored = sorted(db_names, key=lambda n: similarity(raw_norm, n.upper()), reverse=True)
        if scored and similarity(raw_norm, scored[0].upper()) > 0.7:
            print(f"[RESOLVE fuzzy] '{raw}' → '{scored[0]}'")
            return scored[0]
    except Exception as e:
        print(f"[RESOLVE] Error: {e}")
    return raw.strip()


# ─────────────────────────────────────────────────────────────
# DATABASE SCHEMA CONTEXT
# ─────────────────────────────────────────────────────────────

DB_SCHEMA = """
You are a SQL expert for a sales analytics system used by an FMCG distributor business in India.
The business sells snack products (Khakhara, Namkeen) through distributors and modern trade chains.

=== TABLES ===

TABLE: sales_records   <-- USE THIS for distributor/secondary sales questions
  id               uuid
  upload_id        uuid
  distributor_name text      -- e.g. "SYNERGY", "ICELAND", "Vidhaata", "SANGEETA", "UNIVERSAL"
  shop_name        text      -- retail shop / party name e.g. "FALGUNI GRUH UDHYOG"
  shop_type        text      -- "REGULAR" or "CASH_SALE"
  sku_name         text      -- raw product name e.g. "SVASTHYA CHANA JOR 210G MRP 180/-"
  bill_no          text      -- invoice number
  bill_date        date      -- actual invoice date e.g. 2026-04-15
  qty              integer   -- units sold
  rate             numeric   -- per-unit selling price
  revenue          numeric   -- total value = qty x rate (in Indian Rupees)
  month            text      -- full month name e.g. "April", "January"
  year             integer   -- e.g. 2025, 2026
  city             text      -- e.g. "Ahmedabad", "Mumbai"

TABLE: mt_sales_records   <-- USE THIS for modern trade / chain store questions
  id               uuid
  upload_id        uuid
  chain_name       text      -- e.g. "RELIANCE", "FIRSTCLUB"
  store_code       text      -- store identifier e.g. "TTP1", "T5EP", "TE8C"
  store_name       text      -- full store name e.g. "FP MUM Mum JWD Maker Maxity BK"
  article_id       text      -- retailer's product code
  sku_name         text      -- raw product name from MT file
  qty              integer   -- units sold
  revenue          numeric   -- total value in Indian Rupees
  month            text      -- full month name
  year             integer

TABLE: mt_soh_records   <-- USE THIS for stock on hand / inventory questions for MT
  id               uuid
  upload_id        uuid
  chain_name       text
  store_code       text
  store_name       text
  article_id       text
  sku_name         text
  soh_qty          integer   -- current stock units at the store
  soh_value        numeric   -- stock value in rupees
  map_price        numeric   -- maximum allowed price

TABLE: sku_canonical   <-- USE THIS to get canonical/clean product names
  id               uuid
  category         text      -- "Namkeen" or "Khakhara"
  family           text      -- product family e.g. "Chana Jor", "Moong Jor", "Jowar Bajra Khakhra"
  name             text      -- canonical SKU name e.g. "Chana Jor 200g", "Jowar Bajra Khakhra 200g"

TABLE: sku_mappings   <-- JOIN with sku_canonical to resolve raw SKU names
  id               uuid
  raw_sku          text      -- raw name as stored in sales_records or mt_sales_records
  canonical_id     uuid      -- foreign key to sku_canonical(id)
  source_type      text      -- "DISTRIBUTOR" or "MT"
  source_name      text      -- which distributor or chain this mapping came from

TABLE: shop_margins   <-- USE THIS for margin/profitability questions
  -- WARNING: may contain multiple records per shop (one per upload). ALWAYS use
  -- DISTINCT ON (shop_name) ORDER BY shop_name, updated_at DESC to get the latest margin only.
  id               uuid
  shop_name        text
  distributor_name text
  margin_pct       numeric   -- margin percentage e.g. 30.0 means 30%
  upload_id        uuid
  updated_at       timestamptz

TABLE: distributors   <-- USE THIS to list available distributors
  id               uuid
  distributor_name text      -- e.g. "SYNERGY", "ICELAND", "Vidhaata"
  status           text      -- "ACTIVE" or "INACTIVE"
  replaced_by      text
  created_at       timestamptz

TABLE: uploads   <-- USE THIS for upload history questions
  id               uuid
  filename         text
  distributor_name text
  month            text
  year             integer
  format_detected  text
  status           text      -- "success", "error", "pending"
  record_count     integer
  uploaded_at      timestamptz

TABLE: mt_uploads   <-- USE THIS for modern trade upload history
  id               uuid
  filename         text
  chain_name       text
  status           text
  record_count     integer
  soh_count        integer
  stores_found     text[]
  uploaded_at      timestamptz

=== ROUTING RULES ===

When the user asks about:
- "distributors", "shops", "secondary sales", "Synergy", "Iceland", "Vidhaata", "Sangeeta", "Universal"
  → USE sales_records

- "modern trade", "MT", "Reliance", "Firstclub", "chain stores", "stores"
  → USE mt_sales_records

- "stock", "SOH", "stock on hand", "inventory", "units in store"
  → USE mt_soh_records

- product name by family (e.g. "Chana Jor", "Moong Jor", "Khakhara")
  → ALWAYS JOIN sku_mappings and sku_canonical to expand to all raw variants
  NEVER use ILIKE — it silently misses SKUs with naming variants across distributors

- "margin", "profit margin" for shops
  → USE shop_margins with DISTINCT ON (shop_name) ORDER BY shop_name, updated_at DESC

=== STRICT RULES ===
1. Only SELECT queries. Never INSERT, UPDATE, DELETE, DROP, TRUNCATE.
2. Revenue is in Indian Rupees (INR). Use ₹ symbol when describing.
3. Always use ROUND(SUM(revenue)::numeric, 2) for revenue aggregations.
4. Limit results to 20 rows unless user asks for more or less.
5. month column stores FULL month names: "January", "February", ..., "December"
6. year column stores integers: 2025, 2026
7. distributor_name and chain_name are UPPERCASE in the database.
8. When joining sku_mappings, always filter by source_type:
   - source_type = 'DISTRIBUTOR' for sales_records
   - source_type = 'MT' for mt_sales_records
"""


# ─────────────────────────────────────────────────────────────
# FEW SHOT EXAMPLES
# ─────────────────────────────────────────────────────────────

FEW_SHOT_EXAMPLES = """
=== EXAMPLES ===

-- NEGATIVE EXAMPLE (WRONG — causes fan-out):
-- Q: Total Namkeen revenue
-- BAD SQL (DO NOT USE):
-- SELECT ROUND(SUM(sr.revenue)::numeric, 2) AS total_revenue
-- FROM sales_records sr
-- JOIN sku_mappings sm ON sm.raw_sku = sr.sku_name  -- WRONG: plain JOIN multiplies rows if multiple mappings exist
-- JOIN sku_canonical sc ON sc.id = sm.canonical_id
-- WHERE sc.category = 'Namkeen';
--
-- CORRECT: use EXISTS to filter without fan-out:
-- SELECT ROUND(SUM(sr.revenue)::numeric, 2) AS total_revenue
-- FROM sales_records sr
-- WHERE EXISTS (
--   SELECT 1 FROM sku_mappings sm JOIN sku_canonical sc ON sc.id = sm.canonical_id
--   WHERE sm.raw_sku = sr.sku_name AND sm.source_type = 'DISTRIBUTOR' AND sc.category = 'Namkeen'
-- );

Q: Which shop had the highest revenue in April 2026?
SQL:
SELECT shop_name, distributor_name, ROUND(SUM(revenue)::numeric, 2) AS total_revenue
FROM sales_records
WHERE month = 'April' AND year = 2026
GROUP BY shop_name, distributor_name
ORDER BY total_revenue DESC
LIMIT 1;

Q: Show me total revenue and qty for each distributor
SQL:
SELECT distributor_name,
       ROUND(SUM(revenue)::numeric, 2) AS total_revenue,
       SUM(qty) AS total_qty
FROM sales_records
GROUP BY distributor_name
ORDER BY total_revenue DESC;

Q: Monthly revenue trend for SYNERGY
SQL:
SELECT month, year,
       ROUND(SUM(revenue)::numeric, 2) AS total_revenue,
       SUM(qty) AS total_qty
FROM sales_records
WHERE distributor_name = 'SYNERGY'
GROUP BY month, year
ORDER BY year,
  CASE month
    WHEN 'January' THEN 1 WHEN 'February' THEN 2 WHEN 'March' THEN 3
    WHEN 'April' THEN 4 WHEN 'May' THEN 5 WHEN 'June' THEN 6
    WHEN 'July' THEN 7 WHEN 'August' THEN 8 WHEN 'September' THEN 9
    WHEN 'October' THEN 10 WHEN 'November' THEN 11 WHEN 'December' THEN 12
  END;

Q: Top 5 SKUs by quantity sold across all distributors
SQL:
SELECT sku_name, SUM(qty) AS total_qty, ROUND(SUM(revenue)::numeric, 2) AS total_revenue
FROM sales_records
GROUP BY sku_name
ORDER BY total_qty DESC
LIMIT 5;

Q: Which Reliance stores have the highest sales?
SQL:
SELECT store_name, store_code,
       ROUND(SUM(revenue)::numeric, 2) AS total_revenue,
       SUM(qty) AS total_qty
FROM mt_sales_records
WHERE chain_name = 'RELIANCE'
GROUP BY store_name, store_code
ORDER BY total_revenue DESC;

Q: What is the current stock on hand for all Reliance stores?
SQL:
SELECT store_name, sku_name, SUM(soh_qty) AS total_soh, ROUND(SUM(soh_value)::numeric, 2) AS total_value
FROM mt_soh_records
WHERE chain_name = 'RELIANCE'
GROUP BY store_name, sku_name
ORDER BY store_name, total_soh DESC;

Q: What are the margins for shops under SYNERGY?
SQL:
SELECT shop_name, margin_pct
FROM (
  SELECT DISTINCT ON (shop_name) shop_name, margin_pct
  FROM shop_margins
  WHERE distributor_name = 'SYNERGY'
  ORDER BY shop_name, updated_at DESC
) latest
ORDER BY margin_pct DESC;

Q: How many shops are there in Ahmedabad?
SQL:
SELECT COUNT(DISTINCT shop_name) AS shop_count
FROM sales_records
WHERE city = 'Ahmedabad';

Q: Which product family sold the most units across all distributors?
SQL:
SELECT sc.family,
       SUM(sr.qty) AS total_qty,
       ROUND(SUM(sr.revenue)::numeric, 2) AS total_revenue
FROM sales_records sr
JOIN LATERAL (
  SELECT sm2.canonical_id FROM sku_mappings sm2
  WHERE sm2.raw_sku = sr.sku_name AND sm2.source_type = 'DISTRIBUTOR'
  LIMIT 1
) sm_l ON true
JOIN sku_canonical sc ON sc.id = sm_l.canonical_id
GROUP BY sc.family
ORDER BY total_qty DESC
LIMIT 20;

Q: Compare Khakhara vs Namkeen sales
SQL:
SELECT sc.category,
       SUM(sr.qty) AS total_qty,
       ROUND(SUM(sr.revenue)::numeric, 2) AS total_revenue
FROM sales_records sr
JOIN LATERAL (
  SELECT sm2.canonical_id FROM sku_mappings sm2
  WHERE sm2.raw_sku = sr.sku_name AND sm2.source_type = 'DISTRIBUTOR'
  LIMIT 1
) sm_l ON true
JOIN sku_canonical sc ON sc.id = sm_l.canonical_id
GROUP BY sc.category
ORDER BY total_revenue DESC;

Q: Total revenue for Namkeen category
SQL:
SELECT ROUND(SUM(sr.revenue)::numeric, 2) AS total_revenue
FROM sales_records sr
WHERE EXISTS (
  SELECT 1 FROM sku_mappings sm
  JOIN sku_canonical sc ON sc.id = sm.canonical_id
  WHERE sm.raw_sku = sr.sku_name
    AND sm.source_type = 'DISTRIBUTOR'
    AND sc.category = 'Namkeen'
);

Q: Total revenue for Khakhara category
SQL:
SELECT ROUND(SUM(sr.revenue)::numeric, 2) AS total_revenue
FROM sales_records sr
WHERE EXISTS (
  SELECT 1 FROM sku_mappings sm
  JOIN sku_canonical sc ON sc.id = sm.canonical_id
  WHERE sm.raw_sku = sr.sku_name
    AND sm.source_type = 'DISTRIBUTOR'
    AND sc.category = 'Khakhara'
);

Q: Namkeen category revenue by distributor
SQL:
SELECT sr.distributor_name,
       ROUND(SUM(sr.revenue)::numeric, 2) AS total_revenue,
       SUM(sr.qty) AS total_qty
FROM sales_records sr
WHERE EXISTS (
  SELECT 1 FROM sku_mappings sm
  JOIN sku_canonical sc ON sc.id = sm.canonical_id
  WHERE sm.raw_sku = sr.sku_name
    AND sm.source_type = 'DISTRIBUTOR'
    AND sc.category = 'Namkeen'
)
GROUP BY sr.distributor_name
ORDER BY total_revenue DESC;

Q: Khakhara category revenue by distributor
SQL:
SELECT sr.distributor_name,
       ROUND(SUM(sr.revenue)::numeric, 2) AS total_revenue,
       SUM(sr.qty) AS total_qty
FROM sales_records sr
WHERE EXISTS (
  SELECT 1 FROM sku_mappings sm
  JOIN sku_canonical sc ON sc.id = sm.canonical_id
  WHERE sm.raw_sku = sr.sku_name
    AND sm.source_type = 'DISTRIBUTOR'
    AND sc.category = 'Khakhara'
)
GROUP BY sr.distributor_name
ORDER BY total_revenue DESC;

Q: Revenue breakdown by category (Namkeen vs Khakhara) per distributor
SQL:
SELECT sr.distributor_name,
       sc.category,
       ROUND(SUM(sr.revenue)::numeric, 2) AS total_revenue,
       SUM(sr.qty) AS total_qty
FROM sales_records sr
JOIN LATERAL (
  SELECT sm2.canonical_id FROM sku_mappings sm2
  WHERE sm2.raw_sku = sr.sku_name AND sm2.source_type = 'DISTRIBUTOR'
  LIMIT 1
) sm_l ON true
JOIN sku_canonical sc ON sc.id = sm_l.canonical_id
GROUP BY sr.distributor_name, sc.category
ORDER BY sr.distributor_name, sc.category;

Q: Top products by revenue (canonical SKU names, not raw)
SQL:
SELECT sc.name AS product_name,
       sc.family,
       sc.category,
       ROUND(SUM(sr.revenue)::numeric, 2) AS total_revenue,
       SUM(sr.qty) AS total_qty
FROM sales_records sr
JOIN LATERAL (
  SELECT sm2.canonical_id FROM sku_mappings sm2
  WHERE sm2.raw_sku = sr.sku_name AND sm2.source_type = 'DISTRIBUTOR'
  LIMIT 1
) sm_l ON true
JOIN sku_canonical sc ON sc.id = sm_l.canonical_id
GROUP BY sc.name, sc.family, sc.category
ORDER BY total_revenue DESC
LIMIT 10;

Q: Compare April 2025 vs April 2026 revenue
SQL:
SELECT
  year,
  ROUND(SUM(revenue)::numeric, 2) AS total_revenue,
  SUM(qty) AS total_qty
FROM sales_records
WHERE month = 'April' AND year IN (2025, 2026)
GROUP BY year
ORDER BY year;

Q: Compare Khakhara revenue in March 2025 vs March 2026
SQL:
SELECT
  sr.year,
  ROUND(SUM(sr.revenue)::numeric, 2) AS total_revenue,
  SUM(sr.qty) AS total_qty
FROM sales_records sr
WHERE sr.month = 'March'
  AND sr.year IN (2025, 2026)
  AND EXISTS (
    SELECT 1 FROM sku_mappings sm
    JOIN sku_canonical sc ON sc.id = sm.canonical_id
    WHERE sm.raw_sku = sr.sku_name
      AND sm.source_type = 'DISTRIBUTOR'
      AND sc.category = 'Khakhara'
  )
GROUP BY sr.year
ORDER BY sr.year;

Q: Year-over-year revenue comparison for all distributors (2025 vs 2026)
SQL:
SELECT
  distributor_name,
  ROUND(SUM(CASE WHEN year = 2025 THEN revenue END)::numeric, 2) AS revenue_2025,
  ROUND(SUM(CASE WHEN year = 2026 THEN revenue END)::numeric, 2) AS revenue_2026,
  SUM(CASE WHEN year = 2025 THEN qty END) AS qty_2025,
  SUM(CASE WHEN year = 2026 THEN qty END) AS qty_2026
FROM sales_records
GROUP BY distributor_name
ORDER BY revenue_2026 DESC NULLS LAST;

Q: Total combined revenue across distributors and modern trade
SQL:
SELECT channel, ROUND(SUM(revenue)::numeric, 2) AS total_revenue, SUM(qty) AS total_qty
FROM (
  SELECT 'Distributor' AS channel, revenue, qty FROM sales_records
  UNION ALL
  SELECT 'Modern Trade' AS channel, revenue, qty FROM mt_sales_records
) combined
GROUP BY channel
ORDER BY total_revenue DESC;

Q: Which month had the highest combined revenue across all channels?
SQL:
SELECT month, year, ROUND(SUM(revenue)::numeric, 2) AS total_revenue
FROM (
  SELECT month, year, revenue FROM sales_records
  UNION ALL
  SELECT month, year, revenue FROM mt_sales_records
) combined
GROUP BY month, year
ORDER BY year,
  CASE month
    WHEN 'January' THEN 1 WHEN 'February' THEN 2 WHEN 'March' THEN 3
    WHEN 'April' THEN 4 WHEN 'May' THEN 5 WHEN 'June' THEN 6
    WHEN 'July' THEN 7 WHEN 'August' THEN 8 WHEN 'September' THEN 9
    WHEN 'October' THEN 10 WHEN 'November' THEN 11 WHEN 'December' THEN 12
  END DESC
LIMIT 1;
"""


# ─────────────────────────────────────────────────────────────
# GROQ API CALL
# ─────────────────────────────────────────────────────────────

def _call_groq(messages: list[dict], max_tokens: int = 1024, temperature: float = 0.1) -> str:
    """
    temperature=0.0  for SQL generation (deterministic).
    temperature=0.1  for answer formatting (allows natural phrasing).
    """
    api_key = _get_groq_key()

    payload = {
        "model": GROQ_MODEL,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0"
    }

    for attempt in range(2):
        response = httpx.post(
            GROQ_API_URL,
            headers=headers,
            json=payload,
            timeout=30
        )
        if response.status_code == 429 and attempt == 0:
            time.sleep(2)
            continue
        break

    if response.status_code != 200:
        raise Exception(f"GROQ ERROR {response.status_code}: {response.text}")

    return response.json()["choices"][0]["message"]["content"].strip()


# ─────────────────────────────────────────────────────────────
# SQL EXTRACTION
# ─────────────────────────────────────────────────────────────

def _extract_sql(raw: str) -> str:
    m = re.search(r"```(?:sql)?\s*([\s\S]+?)```", raw, re.IGNORECASE)
    if m:
        return m.group(1).strip()

    m = re.search(r"(SELECT[\s\S]+?;)", raw, re.IGNORECASE)
    if m:
        return m.group(1).strip()

    return raw.strip()


# ─────────────────────────────────────────────────────────────
# SQL VALIDATION
# ─────────────────────────────────────────────────────────────

def _validate_sql(sql: str) -> str:
    sql_upper = sql.upper().strip()

    if not (sql_upper.startswith("SELECT") or sql_upper.startswith("WITH")):
        raise ValueError("Only SELECT queries allowed")

    blocked = [
        "INSERT", "UPDATE", "DELETE", "DROP", "TRUNCATE",
        "ALTER", "CREATE", "GRANT", "REVOKE", "EXEC", "EXECUTE",
    ]
    for word in blocked:
        if re.search(rf"\b{word}\b", sql_upper):
            raise ValueError(f"Blocked SQL keyword detected: {word}")

    return sql


# ─────────────────────────────────────────────────────────────
# FAN-OUT RISK CHECK
# ─────────────────────────────────────────────────────────────

def _check_fanout_risk(sql: str) -> bool:
    """
    Returns True if sku_mappings is referenced in the SQL without a safe join pattern.
    A plain JOIN to sku_mappings when aggregating revenue/qty causes fan-out:
    each sales row is multiplied N times if it has N mapping entries.
    Safe patterns: LATERAL JOIN (with LIMIT 1) or EXISTS subquery.
    """
    sql_upper = sql.upper()
    if "SKU_MAPPINGS" not in sql_upper:
        return False
    has_lateral = bool(re.search(r'\bLATERAL\b', sql_upper))
    has_exists  = bool(re.search(r'\bEXISTS\b', sql_upper))
    if has_lateral or has_exists:
        return False
    # sku_mappings present but no LATERAL or EXISTS → fan-out risk
    return True


# ─────────────────────────────────────────────────────────────
# SUPABASE EXECUTION
# ─────────────────────────────────────────────────────────────

def _execute_sql(sql: str):
    sb = get_supabase()
    clean_sql = sql.strip().rstrip(';').strip()
    if not re.search(r'\bLIMIT\b', clean_sql, re.IGNORECASE):
        clean_sql = clean_sql + " LIMIT 100"
    result = sb.rpc("execute_sql", {"query": clean_sql}).execute()
    if result.data is None:
        raise RuntimeError(
            f"SQL execution returned no response from RPC. "
            f"Raw error: {getattr(result, 'error', 'unknown error')}"
        )
    # result.data == [] means query succeeded but returned no rows — valid empty result
    return result.data


# ─────────────────────────────────────────────────────────────
# PROMPTS
# ─────────────────────────────────────────────────────────────

def _build_sql_prompt(question: str, context: dict):
    """
    Build the SQL generation prompt.
    Structure (Fix 1 — CRITICAL RULES first):
      1. CRITICAL RULES block (fan-out prevention, LATERAL/EXISTS, NULLIF, both revenue+qty,
         month-without-year guard, shop_margins DISTINCT ON)
      2. DB_SCHEMA block (with real distributor names injected from DB)
      3. FEW_SHOT_EXAMPLES block
      4. MANDATORY FILTERS block (hard WHERE conditions from active context)
    """
    today_str = date.today().strftime('%B %d, %Y')

    # Inject actual distributor names from DB so LLM never guesses spellings
    actual_names = _get_actual_distributor_names()
    schema = DB_SCHEMA.replace(
        'distributor_name text      -- EXACT VALUES FROM DATABASE: {distributor_names_placeholder}',
        f'distributor_name text      -- EXACT DB VALUES (use these exactly): {actual_names}'
    ) if '{distributor_names_placeholder}' in DB_SCHEMA else DB_SCHEMA

    # Build MANDATORY FILTERS block from active context (Fix 3 — hard enforcement)
    mandatory_filters_block = ""
    if context:
        filter_lines = []
        if context.get("distributor"):
            resolved_dist = _resolve_distributor_name(context["distributor"])
            filter_lines.append(f"  - distributor_name = '{resolved_dist}'")
        if context.get("city"):
            filter_lines.append(f"  - city = '{context['city']}'")
        if context.get("month") and context.get("year"):
            filter_lines.append(f"  - month = '{context['month']}'")
            filter_lines.append(f"  - year = {int(context['year'])}")
        elif context.get("month"):
            filter_lines.append(f"  - month = '{context['month']}'")
        elif context.get("year"):
            filter_lines.append(f"  - year = {int(context['year'])}")
        if context.get("chain"):
            filter_lines.append(f"  - chain_name = '{context['chain'].upper()}'")

        if filter_lines:
            mandatory_filters_block = (
                "\n\nMANDATORY FILTERS — these are non-negotiable WHERE conditions:\n"
                + "\n".join(filter_lines)
                + "\nYou MUST include ALL of the above as WHERE conditions in your SQL."
                + "\nThere is NO escape hatch — do not omit any of them."
                + "\nOnly exception: if the user's question explicitly says a DIFFERENT value"
                + " for that dimension, use -- USER OVERRIDE comment and apply user's value instead."
            )

    system = f"""You are a PostgreSQL SQL expert for a sales analytics database.
Today's date: {today_str}

CRITICAL RULES — follow these exactly before writing any SQL:
1. FAN-OUT PREVENTION — NEVER use a plain JOIN to sku_mappings when doing SUM(revenue) or SUM(qty).
   A plain JOIN multiplies rows if one raw_sku has multiple mapping entries, inflating all aggregates.
   - For FILTERING by category/family (WHERE condition only): use EXISTS subquery:
     WHERE EXISTS (SELECT 1 FROM sku_mappings sm JOIN sku_canonical sc ON sc.id = sm.canonical_id
                   WHERE sm.raw_sku = sr.sku_name AND sm.source_type = 'DISTRIBUTOR' AND sc.category = 'Namkeen')
   - For GROUPING BY category/family (SELECT sc.category / sc.family): use LATERAL JOIN with LIMIT 1:
     JOIN LATERAL (SELECT sm2.canonical_id FROM sku_mappings sm2
                   WHERE sm2.raw_sku = sr.sku_name AND sm2.source_type = 'DISTRIBUTOR' LIMIT 1) sm_l ON true
     JOIN sku_canonical sc ON sc.id = sm_l.canonical_id

2. LATERAL JOIN — always add LIMIT 1 inside the lateral subquery to guarantee one mapping row per sales row.

3. EXISTS PATTERN — preferred for pure filtering; never reference the subquery alias in outer SELECT/GROUP BY.

4. NULLIF DIVISION — when computing ratios or averages, use NULLIF(denominator, 0) to avoid division by zero.

5. MANDATORY BOTH COLUMNS — for any aggregation query, always include BOTH:
   - ROUND(SUM(revenue)::numeric, 2) AS total_revenue
   - SUM(qty) AS total_qty
   unless the user explicitly asks for only one.

6. YEAR DEFAULTING — when a month filter is specified but no year:
   Inject: AND year = (SELECT MAX(year) FROM sales_records)
   or for mt_sales_records: AND year = (SELECT MAX(year) FROM mt_sales_records)

7. shop_margins — this table has MULTIPLE rows per shop (one per upload cycle).
   ALWAYS use: DISTINCT ON (shop_name) ORDER BY shop_name, updated_at DESC
   to get the most recent margin per shop.

8. Always use table aliases (sr for sales_records, sm for sku_mappings, sc for sku_canonical).
9. Use ROUND(value::numeric, 2) for all revenue/numeric columns.
10. Return ONLY the SQL query inside a ```sql code block. No explanation.
11. Only SELECT queries. Never INSERT, UPDATE, DELETE, DROP, TRUNCATE.
12. Limit results to 20 rows unless asked for more.

{schema}

{FEW_SHOT_EXAMPLES}
{mandatory_filters_block}"""

    return [
        {"role": "system", "content": system},
        {"role": "user",   "content": question},
    ]


# ─────────────────────────────────────────────────────────────
# INR FORMATTING
# ─────────────────────────────────────────────────────────────

def _format_inr(value) -> str:
    """
    Convert a numeric value to Indian number format string.
    Done in Python — never delegated to the LLM which makes arithmetic errors.
    Examples:
      627729    → "Rs 6.28 lakhs"
      1481510   → "Rs 14.82 lakhs"
      14815106  → "Rs 1.48 crores"
      980       → "Rs 980"
    """
    try:
        v = float(value)
    except (TypeError, ValueError):
        return str(value)
    if v >= 10_000_000:
        return f"Rs {v / 10_000_000:.2f} crores"
    if v >= 100_000:
        return f"Rs {v / 100_000:.2f} lakhs"
    return f"Rs {v:,.0f}"


def _pre_format_rows(rows: list[dict]) -> list[dict]:
    """
    Pre-format numeric revenue/value fields in rows to INR strings
    so the LLM never has to do arithmetic on raw numbers.
    """
    revenue_keys = {"total_revenue", "revenue", "total_value", "soh_value", "map_price",
                    "revenue_2025", "revenue_2026"}
    formatted = []
    for row in rows:
        new_row = {}
        for k, v in row.items():
            if k in revenue_keys and v is not None:
                try:
                    new_row[k] = _format_inr(float(v))
                except (TypeError, ValueError):
                    new_row[k] = v
            else:
                new_row[k] = v
        formatted.append(new_row)
    return formatted


# ─────────────────────────────────────────────────────────────
# ANSWER PROMPT
# ─────────────────────────────────────────────────────────────

def _build_answer_prompt(question: str, sql: str, rows, context: dict = None):
    import json

    total_rows = len(rows)
    display_rows = rows[:20]

    # Fix 9: truncation note in user message content
    truncation_note = (
        f"\nNote: showing first 20 of {total_rows} results."
        if total_rows > 20 else ""
    )

    formatted_rows = _pre_format_rows(display_rows)
    rows_str = json.dumps(formatted_rows, indent=2, default=str)

    # Build active filter sentence — LLM must open its answer with the scope
    filter_parts = []
    if context:
        if context.get("distributor"): filter_parts.append(f"distributor={context['distributor']}")
        if context.get("city"):        filter_parts.append(f"city={context['city']}")
        if context.get("month"):       filter_parts.append(f"month={context['month']}")
        if context.get("year"):        filter_parts.append(f"year={context['year']}")
        if context.get("chain"):       filter_parts.append(f"chain={context['chain']}")

    filter_sentence = ""
    if filter_parts:
        # Build a human-readable scope prefix the LLM must open with
        scope_parts = []
        if context.get("distributor"): scope_parts.append(context["distributor"])
        if context.get("chain"):       scope_parts.append(context["chain"])
        if context.get("city"):        scope_parts.append(context["city"])
        if context.get("month") and context.get("year"):
            scope_parts.append(f"{context['month']} {context['year']}")
        elif context.get("month"):
            scope_parts.append(context["month"])
        elif context.get("year"):
            scope_parts.append(str(context["year"]))
        scope_str = ", ".join(scope_parts)
        filter_sentence = (
            f'Open your answer with the scope, e.g. "For {scope_str}, ..." '
            f"Active filters: {', '.join(filter_parts)}. "
        )

    return [
        {
            "role": "system",
            "content": (
                "You are a helpful sales analytics assistant for an Indian FMCG distributor business. "
                "Convert the SQL query results into a clear, concise natural language answer. "
                "All revenue values are pre-formatted in Indian notation (e.g. 'Rs 14.82 lakhs') — "
                "use them exactly as-is. Do NOT recompute, reformat, or convert any numbers. "
                f"{filter_sentence}"
                "Be direct and cite exact numbers. Do not mention SQL or databases. Keep answer under 150 words. "
                "If query results are empty, respond only with: No data was found for this query. Do not speculate on why."
            )
        },
        {
            "role": "user",
            "content": (
                f"Question: {question}\n\n"
                f"Query results:\n{rows_str}{truncation_note}\n\n"
                "Please answer the question based on these results."
            )
        }
    ]


# ─────────────────────────────────────────────────────────────
# SQL DISTRIBUTOR CASING FIX
# ─────────────────────────────────────────────────────────────

def _fix_distributor_casing(sql: str) -> str:
    """
    After SQL is generated by the LLM, scan for any distributor_name string literals
    and replace wrong-cased values with the exact DB casing.

    Problem: LLM generates WHERE distributor_name = 'VIDHAATA' but DB has 'Vidhaata'.
    This runs regardless of context — fixes LLM-generated SQL directly.

    Strategy: find all single-quoted string values after distributor_name =
    and replace each with the resolved exact DB value.
    """
    try:
        sb = get_supabase()
        rows = sb.table("distributors").select("distributor_name").execute().data
        db_names = [r["distributor_name"] for r in rows if r.get("distributor_name")]
        # Build case-insensitive lookup: upper → exact
        db_lookup = {n.upper(): n for n in db_names}
    except Exception as e:
        print(f"[CASING FIX] Could not fetch distributors: {e}")
        return sql

    def replace_match(m):
        quoted_val = m.group(1)
        exact = db_lookup.get(quoted_val.upper())
        if exact and exact != quoted_val:
            print(f"[CASING FIX] '{quoted_val}' → '{exact}'")
            return f"distributor_name = '{exact}'"
        return m.group(0)

    # Match distributor_name = 'ANY_VALUE' (with optional spaces around =)
    fixed = re.sub(
        r"distributor_name\s*=\s*'([^']+)'",
        replace_match,
        sql,
        flags=re.IGNORECASE
    )
    return fixed


# ─────────────────────────────────────────────────────────────
# FILTER INJECTION
# ─────────────────────────────────────────────────────────────

def _inject_context_filters(sql: str, context: dict) -> str:
    """
    Programmatically enforce active dashboard filters in the generated SQL.

    Problem: the LLM receives context filters as instructions but may ignore them.
    Solution: parse the WHERE clause and inject any missing active filters as AND conditions.
    Only injects into single-table SELECT statements to avoid ambiguous column references
    in UNION queries.

    Fix 4 (month-without-year guard):
    If the SQL contains a month filter but no year, inject the MAX(year) subquery
    to default to the most recent year deterministically.
    """
    if not context:
        return sql

    sql_upper = sql.upper()

    # Skip UNION queries — filter scope is ambiguous across branches
    if re.search(r'\bUNION\b', sql_upper):
        return sql

    is_distributor = 'SALES_RECORDS' in sql_upper and 'MT_SALES_RECORDS' not in sql_upper
    is_mt          = 'MT_SALES_RECORDS' in sql_upper

    injections = []

    if is_distributor:
        dist_raw = context.get("distributor", "")
        dist  = _resolve_distributor_name(dist_raw) if dist_raw else ""
        city  = context.get("city", "")
        month = context.get("month", "")
        year  = context.get("year", "")

        # Compare case-insensitively but inject exact resolved casing into SQL
        if dist and dist.upper() not in sql_upper:
            injections.append(f"distributor_name = '{dist}'")
        if city  and city.upper() not in sql_upper:
            injections.append(f"city = '{city}'")
        if month and month.upper() not in sql_upper:
            injections.append(f"month = '{month}'")
        if year  and str(year) not in sql:
            injections.append(f"year = {int(year)}")

        # Month-without-year guard (Fix 4)
        has_month_filter = bool(re.search(r'\bmonth\s*=', sql, re.IGNORECASE))
        has_year_filter  = bool(re.search(r'\byear\s*[=<>]|\byear\s+IN\b|\bIN\s*\(\s*\d{4}', sql, re.IGNORECASE))
        if has_month_filter and not has_year_filter and not year:
            injections.append("year = (SELECT MAX(year) FROM sales_records)")

    elif is_mt:
        chain = context.get("chain", "")
        month = context.get("month", "")
        year  = context.get("year", "")

        if chain and chain.upper() not in sql_upper:
            injections.append(f"chain_name = '{chain.upper()}'")
        if month and month.upper() not in sql_upper:
            injections.append(f"month = '{month}'")
        if year  and str(year) not in sql:
            injections.append(f"year = {int(year)}")

        # Month-without-year guard (Fix 4)
        has_month_filter = bool(re.search(r'\bmonth\s*=', sql, re.IGNORECASE))
        has_year_filter  = bool(re.search(r'\byear\s*[=<>]|\byear\s+IN\b|\bIN\s*\(\s*\d{4}', sql, re.IGNORECASE))
        if has_month_filter and not has_year_filter and not year:
            injections.append("year = (SELECT MAX(year) FROM mt_sales_records)")

    if not injections:
        return sql

    injected_clause = " AND ".join(injections)

    if re.search(r'\bWHERE\b', sql_upper):
        match = re.search(
            r'(\bWHERE\b)(.*?)(\bGROUP BY\b|\bORDER BY\b|\bLIMIT\b|\bHAVING\b|$)',
            sql, re.IGNORECASE | re.DOTALL
        )
        if match:
            insert_pos = match.start(3) if match.group(3) else len(sql)
            sql = sql[:insert_pos].rstrip() + f"\n  AND {injected_clause} -- [injected]\n" + sql[insert_pos:]
        else:
            sql = sql.rstrip().rstrip(';') + f"\n  AND {injected_clause} -- [injected]"
    else:
        match = re.search(
            r'(\bGROUP BY\b|\bORDER BY\b|\bLIMIT\b|\bHAVING\b)',
            sql, re.IGNORECASE
        )
        if match:
            insert_pos = match.start()
            sql = sql[:insert_pos].rstrip() + f"\nWHERE {injected_clause} -- [injected]\n" + sql[insert_pos:]
        else:
            sql = sql.rstrip().rstrip(';') + f"\nWHERE {injected_clause} -- [injected]"

    print(f"[FILTER INJECTION] Injected: {injections}")
    return sql


# ─────────────────────────────────────────────────────────────
# UNMAPPED SKU CHECK
# ─────────────────────────────────────────────────────────────

def _check_unmapped_skus(sql: str, rows: list) -> str | None:
    """
    Fix 10: If sku_mappings is referenced in the SQL, run a secondary query counting
    DISTINCT sku_name values in the relevant sales table that have no mapping.
    Returns a warning string if unmapped SKUs exist, else None.
    """
    sql_upper = sql.upper()
    if "SKU_MAPPINGS" not in sql_upper:
        return None

    is_mt = "MT_SALES_RECORDS" in sql_upper
    source_type = "MT" if is_mt else "DISTRIBUTOR"
    sales_table = "mt_sales_records" if is_mt else "sales_records"

    unmapped_sql = f"""
        SELECT COUNT(DISTINCT sku_name) AS unmapped_count
        FROM {sales_table}
        WHERE sku_name NOT IN (
            SELECT raw_sku FROM sku_mappings WHERE source_type = '{source_type}'
        )
    """
    try:
        sb = get_supabase()
        result = sb.rpc("execute_sql", {"query": unmapped_sql.strip()}).execute()
        if result.data and result.data[0].get("unmapped_count", 0) > 0:
            count = result.data[0]["unmapped_count"]
            return (
                f"\n\n⚠️ {count} SKU variant{'s' if count > 1 else ''} have no category mapping "
                f"and are excluded from this total."
            )
    except Exception as e:
        print(f"[UNMAPPED SKU CHECK] Error: {e}")
    return None


# ─────────────────────────────────────────────────────────────
# EMPTY RESULT ENRICHMENT
# ─────────────────────────────────────────────────────────────

def _enrich_empty_result() -> str:
    """
    Fix 11: When rows == [], query uploads table for 3 most recent successful months
    and return a human-readable message with available data range.
    """
    try:
        sb = get_supabase()
        result = sb.rpc("execute_sql", {
            "query": (
                "SELECT DISTINCT month, year FROM uploads "
                "WHERE status = 'success' "
                "ORDER BY year DESC, "
                "CASE month "
                "WHEN 'January' THEN 1 WHEN 'February' THEN 2 WHEN 'March' THEN 3 "
                "WHEN 'April' THEN 4 WHEN 'May' THEN 5 WHEN 'June' THEN 6 "
                "WHEN 'July' THEN 7 WHEN 'August' THEN 8 WHEN 'September' THEN 9 "
                "WHEN 'October' THEN 10 WHEN 'November' THEN 11 WHEN 'December' THEN 12 "
                "END DESC LIMIT 3"
            )
        }).execute()
        if result.data:
            periods = [f"{r['month']} {r['year']}" for r in result.data]
            period_str = ", ".join(periods)
            return (
                f"No data found. Most recent available data: {period_str}. "
                "Check Upload History."
            )
    except Exception as e:
        print(f"[ENRICH EMPTY] Error: {e}")
    return "No data was found for this query."


# ─────────────────────────────────────────────────────────────
# PRODUCT CLASSIFICATION & AMBIGUITY RESOLUTION
# ─────────────────────────────────────────────────────────────

def _classify_question(question: str) -> dict:
    """
    Fix 13: Classify whether the question references a product by family name
    that might have multiple canonical SKUs (e.g. different weights/variants).
    Returns:
      { "has_product_ref": bool, "product_family": str | None }
    """
    # Keywords that suggest a product family reference
    family_patterns = [
        r'\bchana\s+jor\b', r'\bmoong\s+jor\b', r'\bjowar\s+bajra\b',
        r'\bkhakhr[ae]\b', r'\bnamkeen\b', r'\bsev\b', r'\bmix\b',
        r'\bfarlali\b', r'\bchakli\b', r'\bchivda\b',
    ]
    q_lower = question.lower()
    for pattern in family_patterns:
        m = re.search(pattern, q_lower)
        if m:
            return {"has_product_ref": True, "product_family": m.group(0).strip()}
    return {"has_product_ref": False, "product_family": None}


def _get_variants_for_product(family_hint: str) -> list[dict]:
    """
    Fix 13: Query sku_canonical for all SKUs whose family or name matches the hint.
    Returns list of { id, name, family, category }.
    """
    try:
        sb = get_supabase()
        search_term = family_hint.replace("'", "''")
        result = sb.rpc("execute_sql", {
            "query": (
                f"SELECT id, name, family, category FROM sku_canonical "
                f"WHERE LOWER(family) LIKE LOWER('%{search_term}%') "
                f"   OR LOWER(name) LIKE LOWER('%{search_term}%') "
                f"ORDER BY family, name LIMIT 20"
            )
        }).execute()
        return result.data or []
    except Exception as e:
        print(f"[GET VARIANTS] Error: {e}")
        return []


def _resolve_product_ambiguity(question: str) -> dict:
    """
    Fix 13: Check if the question refers to a product family with multiple variants.
    If ambiguous (2+ canonical SKUs found), return clarification request.
    If unambiguous or no product ref, return proceed signal.

    Return shape:
      { "action": "none" }                          — no product reference found
      { "action": "proceed_total", "question": q }  — 1 variant or user said "all"/"total"
      { "action": "proceed_specific", "question": q, "variant": name }
      { "action": "proceed_compare" }               — user wants comparison
      { "action": "clarify", "family": str,
        "options": [{ "name", "family", "category" }],
        "message": str }
    """
    classification = _classify_question(question)
    if not classification["has_product_ref"]:
        return {"action": "none"}

    family = classification["product_family"]
    q_lower = question.lower()

    # User already specified intent
    if any(w in q_lower for w in ["all variants", "combined", "total", "overall"]):
        return {"action": "proceed_total", "question": question}
    if any(w in q_lower for w in ["compare", "vs", "versus", "breakdown"]):
        return {"action": "proceed_compare", "question": question}

    variants = _get_variants_for_product(family)
    if len(variants) <= 1:
        return {"action": "proceed_total", "question": question}

    # Check if a specific variant name is already in the question
    for v in variants:
        if v["name"].lower() in q_lower:
            enriched = question + f" (specifically for: {v['name']})"
            return {"action": "proceed_specific", "question": enriched, "variant": v["name"]}

    # Ambiguous — need clarification
    options_text = "\n".join(f"- {v['name']} ({v['category']})" for v in variants)
    message = (
        f"I found multiple variants of '{family.title()}'. Which would you like?\n\n"
        f"{options_text}\n\n"
        f"Or choose:\n- All variants combined\n- Compare all variants"
    )
    return {
        "action": "clarify",
        "family": family,
        "options": variants,
        "message": message,
    }


# ─────────────────────────────────────────────────────────────
# MAIN PIPELINE
# ─────────────────────────────────────────────────────────────

def run_chat_pipeline(question: str, context: dict = None):
    context = context or {}

    # ── Fix 13: Resolve product ambiguity before SQL generation ──────────────
    resolution = _resolve_product_ambiguity(question)

    if resolution["action"] == "clarify":
        return {
            "clarification_needed": True,
            "clarification_message": resolution["message"],
            "clarification_options": (
                [v["name"] for v in resolution["options"]]
                + ["All variants combined", "Compare all variants"]
            ),
            "answer": resolution["message"],
            "sql": "",
            "rows": [],
            "error": None,
        }

    # Enrich the question string if we resolved to a specific variant or compare intent
    if resolution["action"] in ("proceed_specific", "proceed_compare", "proceed_total"):
        question = resolution.get("question", question)

    # ── STEP 1: SQL generation ───────────────────────────────────────────────
    try:
        # temperature=0.0 for SQL — fully deterministic
        sql_raw = _call_groq(_build_sql_prompt(question, context), temperature=0.0)
        sql = _validate_sql(_extract_sql(sql_raw))
        print("[SQL GENERATED]", sql)

        # Fix casing: replace wrong-cased distributor names in LLM-generated SQL
        sql = _fix_distributor_casing(sql)

        # Fix 5: Fan-out risk check — auto-retry with explicit warning if triggered
        if _check_fanout_risk(sql):
            print("[CHAT] Fan-out risk detected — retrying with explicit warning")
            retry_messages = _build_sql_prompt(question, context)
            retry_messages[0]["content"] = (
                "CRITICAL FAN-OUT ERROR: Your previous SQL used a plain JOIN to sku_mappings "
                "while computing SUM(revenue) or SUM(qty). This multiplies revenue by the number "
                "of mapping rows per SKU, producing inflated totals. "
                "You MUST use either:\n"
                "  (a) EXISTS subquery for filtering\n"
                "  (b) LATERAL JOIN with LIMIT 1 for grouping by category/family\n"
                "NEVER a plain JOIN to sku_mappings in an aggregation query.\n\n"
                + retry_messages[0]["content"]
            )
            sql_raw = _call_groq(retry_messages, temperature=0.0)
            sql = _validate_sql(_extract_sql(sql_raw))
            print("[SQL after fan-out retry]", sql)

        # Fix 4: Python-level filter injection
        sql = _inject_context_filters(sql, context)
        print("[SQL AFTER FILTER INJECTION]", sql)

    except Exception as e:
        return {
            "answer": f"SQL generation failed: {e}",
            "sql": "",
            "rows": [],
            "error": str(e),
            "clarification_needed": False,
        }

    # ── STEP 2: Execute SQL — with one auto-retry on alias error ─────────────
    try:
        rows = _execute_sql(sql)
        print("[ROWS]", len(rows))

    except Exception as e:
        err_str = str(e)
        if "42P01" in err_str or "missing FROM-clause" in err_str:
            print("[CHAT] Auto-retry: fixing missing FROM-clause alias error")
            try:
                retry_messages = _build_sql_prompt(question, context)
                retry_messages[0]["content"] += (
                    "\nCRITICAL: Your previous SQL failed with missing FROM-clause entry."
                    " This happens when you reference an alias like sc.category in SELECT or GROUP BY"
                    " that was only defined inside a subquery. Fix: use LATERAL JOIN or EXISTS subquery."
                    " NEVER reference a subquery alias in the outer SELECT or GROUP BY."
                )
                sql_raw2 = _call_groq(retry_messages, temperature=0.0)
                sql2 = _validate_sql(_extract_sql(sql_raw2))
                print("[CHAT] Retry SQL:", sql2)
                rows = _execute_sql(sql2)
                sql = sql2
                print("[ROWS after retry]", len(rows))
            except Exception as e2:
                return {
                    "answer": "SQL execution failed after retry. Please rephrase your question.",
                    "sql": sql,
                    "rows": [],
                    "error": str(e2),
                    "clarification_needed": False,
                }
        else:
            return {
                "answer": "SQL execution failed",
                "sql": sql,
                "rows": [],
                "error": err_str,
                "clarification_needed": False,
            }

    # ── Fix 11: Empty result enrichment ─────────────────────────────────────
    if rows == []:
        answer = _enrich_empty_result()
        return {
            "answer": answer,
            "sql": sql,
            "rows": [],
            "error": None,
            "clarification_needed": False,
        }

    # ── STEP 3: Natural language answer ──────────────────────────────────────
    try:
        # temperature=0.1 for answer — allows natural phrasing variation
        answer_raw = _call_groq(
            _build_answer_prompt(question, sql, rows, context=context),
            temperature=0.1
        )
    except Exception as e:
        answer_raw = f"Fallback answer: {rows[:5]}"

    # ── Fix 10: Append unmapped SKU warning if applicable ────────────────────
    sku_warning = _check_unmapped_skus(sql, rows)
    if sku_warning:
        answer_raw += sku_warning

    return {
        "answer": answer_raw,
        "sql": sql,
        "rows": rows,
        "error": None,
        "clarification_needed": False,
    }