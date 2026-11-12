import base64
import hashlib
from cryptography.fernet import Fernet
from server.config import ACCOUNT_KEY_SECRET

def _get_fernet() -> Fernet:
    # Derive a 32-byte key from ACCOUNT_KEY_SECRET
    key_bytes = hashlib.sha256(ACCOUNT_KEY_SECRET.encode("utf-8")).digest()
    url_safe_key = base64.urlsafe_b64encode(key_bytes)
    return Fernet(url_safe_key)

def encrypt_api_key(raw_key: str) -> str:
    """Encrypt snapgen API key for safe storage at rest."""
    if not raw_key:
        return ""
    f = _get_fernet()
    return f.encrypt(raw_key.encode("utf-8")).decode("utf-8")

def decrypt_api_key(encrypted_key: str) -> str:
    """Decrypt snapgen API key for worker execution."""
    if not encrypted_key:
        return ""
    f = _get_fernet()
    return f.decrypt(encrypted_key.encode("utf-8")).decode("utf-8")

def mask_api_key(key: str) -> str:
    """Mask key showing only last 4 characters e.g. ••••abcd."""
    if not key:
        return "••••"
    if len(key) <= 4:
        return "••••" + key
    return "••••" + key[-4:]

