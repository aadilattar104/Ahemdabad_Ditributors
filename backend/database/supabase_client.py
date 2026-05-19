import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

# ──────────────────────────────────────────────────────────────────────────────
# Paste your Supabase credentials in the .env file at the root of backend/
# SUPABASE_URL  → your project URL  (https://xxxx.supabase.co)
# SUPABASE_SERVICE_KEY → your service_role secret key (NOT the anon key)
# ──────────────────────────────────────────────────────────────────────────────

_URL: str | None = None
_KEY: str | None = None


def get_supabase() -> Client:
    """
    Returns a fresh Supabase client on every call.
    This avoids the httpx/HTTP2 'Server disconnected' error that happens
    when a cached client reuses a stale connection.
    """
    global _URL, _KEY
    if _URL is None:
        _URL = os.getenv("SUPABASE_URL")
        _KEY = os.getenv("SUPABASE_SERVICE_KEY")
        if not _URL or not _KEY:
            raise RuntimeError(
                "Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env file.\n"
                "Open backend/.env and paste your credentials from:\n"
                "Supabase Dashboard → Settings → API"
            )
    return create_client(_URL, _KEY)