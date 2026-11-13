import uuid
from pathlib import Path
from typing import Tuple, Optional
from fastapi import HTTPException

from server.config import get_setting, DATA_DIR


def detect_image_magic(data: bytes) -> Optional[Tuple[str, str]]:
    """
    Inspect magic bytes of image content.
    Returns (mime_type, extension) or None if not a valid JPG/PNG/WEBP.
    """
    if len(data) < 12:
        return None
    # JPEG: FF D8 FF
    if data[:3] == b"\xff\xd8\xff":
        return ("image/jpeg", ".jpg")
    # PNG: 89 50 4E 47 0D 0A 1A 0A
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return ("image/png", ".png")
    # WEBP: RIFF....WEBP
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ("image/webp", ".webp")
    return None


def validate_and_save_uploaded_image(content: bytes) -> Tuple[str, str]:
    """
    Validates image bytes (non-empty, <= 10 MB, valid magic bytes JPG/PNG/WEBP)
    and saves once under DATA_DIR / 'uploads' with a server-generated UUID filename.
    Returns (relative_path, mime_type).
    """
    if not content:
        raise HTTPException(
            status_code=400,
            detail="File foto kosong. Silakan unggah foto format JPG, PNG, atau WEBP."
        )

    max_mb = get_setting("UPLOAD_MAX_MB", 10)
    max_bytes = max_mb * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"Ukuran foto melebihi batas maksimal {max_mb} MB."
        )

    detected = detect_image_magic(content)
    if not detected:
        raise HTTPException(
            status_code=400,
            detail="Format foto tidak valid. File harus berupa gambar JPG, PNG, atau WEBP asli."
        )

    mime_type, ext = detected
    safe_name = f"{uuid.uuid4().hex}{ext}"
    uploads_dir = DATA_DIR / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    dest = uploads_dir / safe_name
    with open(dest, "wb") as f:
        f.write(content)

    return (f"uploads/{safe_name}", mime_type)


def get_file_mime_from_disk(path: Path) -> str:
    try:
        with open(path, "rb") as f:
            head = f.read(16)
        det = detect_image_magic(head)
        if det:
            return det[0]
    except Exception:
        pass
    return "image/jpeg"

