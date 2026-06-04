"""
chat.py
=======
Text-to-SQL chatbot pipeline for Excel Intelligence dashboard.

Flow:
  1. User question → build prompt with schema + examples + context
  2. Groq API (Llama 3.3 70B) → SQL query
  3. Validate SQL (SELECT only) → execute against Supabase
  4. Raw rows → Groq API → natural language answer
  5. Return answer to frontend

No embeddings. No vector search. Pure SQL on structured data.
"""

import os
import re
from database.supabase_client import get_supabase

GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"

def _get_gemini_key() -> str:
    return os.getenv("GEMINI_API_KEY", "")

# ─── Database schema context given to the LLM ────────────────────────────────

DB_SCHEMA = """
You have access to the following PostgreSQL tables:

TABLE: sales_records
  - id             uuid
  - upload_id      uuid
  - distributor_name text      -- e.g. "SYNERGY", "ICELAND", "VIDHATA", "SANGEETA"
  - shop_name      text        -- retail shop / party name
  - shop_type      text        -- "REGULAR" or "CASH_SALE"
  - sku_name       text        -- raw product name from distributor file
  - bill_no        text
  - bill_date      date
  - qty            integer     -- units sold
  - rate           numeric     -- per-unit rate
  - revenue        numeric     -- total value (qty × rate)
  - month          text        -- e.g. "January", "April"
  - year           integer     -- e.g. 2025, 2026
  - city           text        -- e.g. "Ahmedabad", "Mumbai"

TABLE: mt_sales_records
  - id             uuid
  - upload_id      uuid
  - chain_name     text        -- e.g. "RELIANCE", "FIRSTCLUB"
  - store_code     text        -- store identifier
  - store_name     text        -- full store name
  - article_id     text
  - sku_name       text        -- raw product name from MT file
  - qty            integer
  - revenue        numeric
  - month          text
  - year           integer

TABLE: sku_canonical
  - id             uuid
  - category       text        -- "Namkeen" or "Khakhara"
  - family         text        -- e.g. "Chana Jor", "Moong Jor"
  - name           text        -- canonical SKU name e.g. "Chana Jor 200g"

TABLE: sku_mappings
  - id             uuid
  - raw_sku        text        -- raw name in sales_records or mt_sales_records
  - canonical_id   uuid        -- references sku_canonical(id)
  - source_type    text        -- "DISTRIBUTOR" or "MT"
  - source_name    text        -- distributor or chain name

TABLE: shop_margins
  - shop_name         text
  - distributor_name  text
  - margin_pct        numeric   -- margin percentage e.g. 30.0

TABLE: mt_soh_records
  - store_code     text
  - store_name     text
  - sku_name       text
  - soh_qty        integer     -- stock on hand units
  - soh_value      numeric
  - map_price      numeric

IMPORTANT RULES:
- Always use SELECT only. Never use INSERT, UPDATE, DELETE, DROP, or TRUNCATE.
- Revenue is in Indian Rupees (₹).
- When the user asks about a product by family name (e.g. "Chana Jor"), join through sku_mappings → sku_canonical to find all raw SKU variants.
- When the user asks about "distributor sales" use sales_records. For "modern trade" or chain names use mt_sales_records.
- Limit results to 20 rows unless the user asks for more.
- Always cast numeric results to 2 decimal places using ROUND(x, 2).
"""

# ─── Few-shot examples ────────────────────────────────────────────────────────

FEW_SHOT_EXAMPLES = """
EXAMPLE 1:
Question: Which shop had the highest revenue in April 2026?
SQL:
SELECT shop_name, distributor_name, ROUND(SUM(revenue)::numeric, 2) AS total_revenue
FROM sales_records
WHERE month = 'April' AND year = 2026
GROUP BY shop_name, distributor_name
ORDER BY total_revenue DESC
LIMIT 1;

EXAMPLE 2:
Question: What was the total qty sold for Chana Jor across all distributors?
SQL:
SELECT ROUND(SUM(sr.qty)::numeric, 2) AS total_qty
FROM sales_records sr
JOIN sku_mappings sm ON sr.sku_name = sm.raw_sku AND sm.source_type = 'DISTRIBUTOR'
JOIN sku_canonical sc ON sm.canonical_id = sc.id
WHERE sc.family = 'Chana Jor';

EXAMPLE 3:
Question: Show me month-wise revenue for SYNERGY
SQL:
SELECT month, year, ROUND(SUM(revenue)::numeric, 2) AS total_revenue, SUM(qty) AS total_qty
FROM sales_records
WHERE distributor_name = 'SYNERGY'
GROUP BY month, year
ORDER BY year, CASE month
  WHEN 'January' THEN 1 WHEN 'February' THEN 2 WHEN 'March' THEN 3
  WHEN 'April' THEN 4 WHEN 'May' THEN 5 WHEN 'June' THEN 6
  WHEN 'July' THEN 7 WHEN 'August' THEN 8 WHEN 'September' THEN 9
  WHEN 'October' THEN 10 WHEN 'November' THEN 11 WHEN 'December' THEN 12
END;

EXAMPLE 4:
Question: Which Reliance store has the most stock on hand?
SQL:
SELECT store_name, SUM(soh_qty) AS total_soh
FROM mt_soh_records
GROUP BY store_name
ORDER BY total_soh DESC
LIMIT 5;

EXAMPLE 5:
Question: Top 5 SKUs by revenue in Mumbai this year
SQL:
SELECT sku_name, ROUND(SUM(revenue)::numeric, 2) AS total_revenue
FROM sales_records
WHERE city = 'Mumbai' AND year = 2026
GROUP BY sku_name
ORDER BY total_revenue DESC
LIMIT 5;
"""


# ─── Groq API call ────────────────────────────────────────────────────────────

def _call_gemini(messages: list[dict], max_tokens: int = 1024) -> str:
    import urllib.request
    import json

    api_key = _get_gemini_key()
    if not api_key:
        raise ValueError("GEMINI_API_KEY environment variable not set")

    # Convert OpenAI-style messages to Gemini format
    # System message gets prepended to first user message
    system_text = ""
    user_parts = []
    for m in messages:
        if m["role"] == "system":
            system_text = m["content"]
        elif m["role"] == "user":
            user_parts.append(m["content"])

    full_prompt = f"{system_text}\n\n{chr(10).join(user_parts)}" if system_text else "\n".join(user_parts)

    payload = json.dumps({
        "contents": [{"parts": [{"text": full_prompt}]}],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": max_tokens,
        }
    }).encode("utf-8")

    url = f"{GEMINI_API_URL}?key={api_key}"
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    return data["candidates"][0]["content"]["parts"][0]["text"].strip()


# ─── SQL extraction and validation ───────────────────────────────────────────

def _extract_sql(raw: str) -> str:
    """
    Extract SQL from LLM response. Handles markdown code blocks and raw SQL.
    """
    # Try ```sql ... ``` block
    m = re.search(r"```(?:sql)?\s*([\s\S]+?)```", raw, re.IGNORECASE)
    if m:
        return m.group(1).strip()

    # Try to find SELECT statement directly
    m = re.search(r"(SELECT[\s\S]+?;)", raw, re.IGNORECASE)
    if m:
        return m.group(1).strip()

    return raw.strip()


def _validate_sql(sql: str) -> str:
    """
    Ensure only SELECT statements are executed.
    Raises ValueError if any dangerous keywords found.
    """
    sql_upper = sql.upper().strip()

    # Must start with SELECT or WITH (for CTEs)
    if not (sql_upper.startswith("SELECT") or sql_upper.startswith("WITH")):
        raise ValueError("Only SELECT queries are allowed")

    # Block any mutation keywords
    dangerous = ["INSERT", "UPDATE", "DELETE", "DROP", "TRUNCATE",
                 "ALTER", "CREATE", "GRANT", "REVOKE", "EXEC", "EXECUTE"]
    for keyword in dangerous:
        if re.search(rf"\b{keyword}\b", sql_upper):
            raise ValueError(f"Query contains forbidden keyword: {keyword}")

    return sql


# ─── Execute SQL via Supabase ────────────────────────────────────────────────

def _execute_sql(sql: str) -> list[dict]:
    """
    Execute a validated SELECT query via Supabase's rpc or direct postgrest.
    Uses the execute_sql RPC function in Supabase.
    """
    sb = get_supabase()
    result = sb.rpc("execute_sql", {"query": sql}).execute()
    return result.data or []


# ─── Build step-1 prompt (question → SQL) ────────────────────────────────────

def _build_sql_prompt(question: str, context: dict) -> list[dict]:
    context_str = ""
    if context:
        parts = []
        if context.get("distributor"):
            parts.append(f"Active distributor filter: {context['distributor']}")
        if context.get("city"):
            parts.append(f"Active city filter: {context['city']}")
        if context.get("month") and context.get("year"):
            parts.append(f"Active period filter: {context['month']} {context['year']}")
        elif context.get("month"):
            parts.append(f"Active month filter: {context['month']}")
        elif context.get("year"):
            parts.append(f"Active year filter: {context['year']}")
        if context.get("chain"):
            parts.append(f"Active MT chain filter: {context['chain']}")
        if parts:
            context_str = "\nCurrent dashboard context (apply these filters if relevant):\n" + "\n".join(f"- {p}" for p in parts)

    system = f"""You are a SQL expert for a sales analytics database.
{DB_SCHEMA}
{FEW_SHOT_EXAMPLES}
{context_str}

Generate a single valid PostgreSQL SELECT query that answers the user's question.
Return ONLY the SQL query inside a ```sql code block. No explanation. No commentary."""

    return [
        {"role": "system", "content": system},
        {"role": "user",   "content": question},
    ]


# ─── Build step-2 prompt (rows → natural language answer) ────────────────────

def _build_answer_prompt(question: str, sql: str, rows: list[dict]) -> list[dict]:
    import json

    rows_str = json.dumps(rows[:20], indent=2, default=str)

    system = """You are a helpful sales analytics assistant for a distributor business in India.
Format the query results into a clear, concise natural language answer.
- Use ₹ for currency values
- Use Indian number formatting (lakhs/thousands where appropriate)
- Be direct and specific — cite exact numbers from the results
- If the result is empty, say so clearly
- Do not mention SQL or databases
- Keep the answer under 150 words unless a table is clearly better"""

    user = f"""Question: {question}

Query result:
{rows_str}

Please provide a clear, concise answer based on these results."""

    return [
        {"role": "system", "content": system},
        {"role": "user",   "content": user},
    ]


# ─── Main pipeline function ───────────────────────────────────────────────────

def run_chat_pipeline(question: str, context: dict = None) -> dict:
    """
    Full Text-to-SQL pipeline.

    Returns:
      {
        "answer":  str,          # natural language answer
        "sql":     str,          # SQL that was executed (for debugging)
        "rows":    list[dict],   # raw query results
        "error":   str | None,   # error message if failed
      }
    """
    context = context or {}

    # Step 1 — Generate SQL
    try:
        sql_messages = _build_sql_prompt(question, context)
        sql_raw      = _call_gemini(sql_messages, max_tokens=512)
        sql          = _extract_sql(sql_raw)
        sql          = _validate_sql(sql)
        print(f"[CHAT] Generated SQL:\n{sql}")
    except Exception as e:
        print(f"[CHAT] SQL generation error: {e}")
        return {
            "answer": f"Sorry, I couldn't generate a valid query for that question. Please try rephrasing. ({e})",
            "sql":    "",
            "rows":   [],
            "error":  str(e),
        }

    # Step 2 — Execute SQL
    try:
        rows = _execute_sql(sql)
        print(f"[CHAT] Query returned {len(rows)} rows")
    except Exception as e:
        print(f"[CHAT] SQL execution error: {e}")
        return {
            "answer": "I generated a query but it failed to execute. The question might be too complex or reference data that doesn't exist. Please try a simpler question.",
            "sql":    sql,
            "rows":   [],
            "error":  str(e),
        }

    # Step 3 — Format answer
    try:
        answer_messages = _build_answer_prompt(question, sql, rows)
        answer          = _call_gemini(answer_messages, max_tokens=512)
    except Exception as e:
        # Fallback: return raw rows as text if answer formatting fails
        print(f"[CHAT] Answer formatting error: {e}")
        answer = f"Query returned {len(rows)} result(s): {rows[:5]}"

    return {
        "answer": answer,
        "sql":    sql,
        "rows":   rows,
        "error":  None,
    }