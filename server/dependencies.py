from typing import Optional, Dict, Any
from fastapi import Header, HTTPException, status, Depends
from sqlalchemy import select
from server.db import AsyncSessionLocal, User
from server.auth import verify_token

async def get_current_user(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    """Verify Bearer token and return user dictionary."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Autentikasi dibutuhkan."
        )
    token = authorization.split(" ")[1]
    verified = verify_token(token, expected_purpose="session")
    if not verified:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sesi tidak valid atau telah kedaluwarsa."
        )
    user_id, token_version, _ = verified

    if not AsyncSessionLocal:
        raise HTTPException(status_code=500, detail="Database belum terhubung.")

    async with AsyncSessionLocal() as session:
        user = await session.get(User, user_id)
        if not user or not user.is_active:
            raise HTTPException(status_code=401, detail="User tidak ditemukan atau nonaktif.")
        if user.token_version != token_version:
            raise HTTPException(status_code=401, detail="Sesi telah dicabut.")

        return {
            "id": user.id,
            "name": user.name,
            "role": user.role,
            "division_id": user.division_id,
            "token_version": user.token_version,
        }

async def require_admin(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Require SUPER_ADMIN or DIVISION_ADMIN. Return 404 on failure as per PRD §2."""
    if user["role"] not in ("SUPER_ADMIN", "DIVISION_ADMIN"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    return user

async def require_super_admin(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Require SUPER_ADMIN. Return 404 on failure as per PRD §2."""
    if user["role"] != "SUPER_ADMIN":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    return user

def require_self(target_user_id: str, current_user: Dict[str, Any]):
    """Ensure user only accesses their own /api/users/{id}/* resource."""
    if current_user["id"] != target_user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Akses ditolak.")

