import hashlib
from database.supabase_client import get_supabase


def compute_file_fingerprint(file_bytes: bytes) -> str:
    """SHA-256 fingerprint of the raw file bytes."""
    return hashlib.sha256(file_bytes).hexdigest()


def is_duplicate(fingerprint: str) -> bool:
    """
    Check if this exact file has been uploaded before by looking up
    the fingerprint in the uploads table.
    Returns True if a matching record exists with status='success'.
    """
    try:
        sb = get_supabase()
        result = (
            sb.table("uploads")
            .select("id")
            .eq("file_fingerprint", fingerprint)
            .eq("status", "success")
            .limit(1)
            .execute()
        )
        return len(result.data) > 0
    except Exception:
        # If fingerprint column doesn't exist yet, don't block uploads
        return False