import hmac
import hashlib
import secrets
import json
import time
from typing import Optional, Tuple
from fastapi import HTTPException, Security, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from server.config import AUTH_SECRET, DATA_DIR

security = HTTPBearer(auto_error=False)

def hash_password(password: str, salt: Optional[str] = None) -> Tuple[str, str]:
    """PBKDF2-SHA256 with 100,000 iterations and 16-byte random salt."""
    if not salt:
        salt = secrets.token_hex(16)
    key = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        100_000
    )
    return key.hex(), salt

def verify_password(password: str, password_hash: str, salt: str) -> bool:
    new_hash, _ = hash_password(password, salt)
    return hmac.compare_digest(new_hash, password_hash)

def create_token(user_id: str, purpose: str, token_version: int, ttl_days: int = 30) -> str:
    """Create stateless HMAC-SHA256 token: user_id.purpose.version.expiry.sig"""
    expiry = int(time.time()) + (ttl_days * 86400)
    payload = f"{user_id}.{purpose}.{token_version}.{expiry}"
    sig = hmac.new(
        AUTH_SECRET.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()
    return f"{payload}.{sig}"

def verify_token(token_str: str, expected_purpose: str = "session") -> Optional[Tuple[str, int, int]]:
    """
    Verify token integrity and expiry.
    Returns (user_id, token_version, expiry) if valid, None otherwise.
    """
    if not token_str:
        return None
    parts = token_str.split(".")
    if len(parts) != 5:
        return None
    user_id, purpose, ver_str, exp_str, sig = parts
    if purpose != expected_purpose:
        return None
    payload = f"{user_id}.{purpose}.{ver_str}.{exp_str}"
    expected_sig = hmac.new(
        AUTH_SECRET.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(sig, expected_sig):
        return None
    try:
        expiry = int(exp_str)
        if time.time() > expiry:
            return None
        version = int(ver_str)
        return user_id, version, expiry
    except ValueError:
        return None

# Reset Code Management (PRD §11, §13: reset_code.json)
RESET_CODE_FILE = DATA_DIR / "reset_code.json"

def get_current_reset_code() -> str:
    if RESET_CODE_FILE.exists():
        try:
            with open(RESET_CODE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data.get("code", "")
        except Exception:
            pass
    # Generate initial code if not present
    new_code = rotate_reset_code()
    return new_code

def rotate_reset_code() -> str:
    # Format: XXXX-XXXX (mono uppercase)
    p1 = secrets.token_hex(2).upper()
    p2 = secrets.token_hex(2).upper()
    code = f"{p1}-{p2}"
    with open(RESET_CODE_FILE, "w", encoding="utf-8") as f:
        json.dump({"code": code, "updated_at": int(time.time())}, f)
    return code

