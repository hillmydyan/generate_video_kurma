from fastapi import APIRouter, HTTPException, Depends, status
from pydantic import BaseModel, Field
from typing import Optional
from sqlalchemy import select, func, update
from server.db import AsyncSessionLocal, User, Division
from server.auth import (
    hash_password, verify_password, create_token, get_current_reset_code
)
from server.dependencies import get_current_user
from config.clock import now

router = APIRouter(prefix="/api/auth", tags=["auth"])

class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)

class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3)
    name: str = Field(..., min_length=1)
    password: str = Field(..., min_length=6)

class ResetPasswordRequest(BaseModel):
    username: str = Field(..., min_length=1)
    reset_code: str = Field(..., min_length=8)
    new_password: str = Field(..., min_length=6)

@router.get("/bootstrap")
async def check_bootstrap():
    """Check if first admin registration is still open."""
    async with AsyncSessionLocal() as session:
        stmt = select(func.count(User.id))
        res = await session.execute(stmt)
        count = res.scalar() or 0
        return {"open": count == 0}

@router.post("/register")
async def register_bootstrap_admin(req: RegisterRequest):
    """Register initial SUPER_ADMIN if DB is empty (PRD §2)."""
    async with AsyncSessionLocal() as session:
        stmt = select(func.count(User.id))
        res = await session.execute(stmt)
        if (res.scalar() or 0) > 0:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Pendaftaran mandiri telah ditutup."
            )

        # Create default divisions Kantor A & Kantor B if not exist
        kantor_a = await session.get(Division, "kantor_a")
        if not kantor_a:
            session.add(Division(id="kantor_a", name="Kantor A"))
            session.add(Division(id="kantor_b", name="Kantor B"))

        p_hash, salt = hash_password(req.password)
        user = User(
            id=req.username.strip().lower(),
            name=req.name.strip(),
            password_hash=p_hash,
            salt=salt,
            role="SUPER_ADMIN",
            division_id="kantor_a",
            is_active=True,
            token_version=1,
            created_at=now()
        )
        session.add(user)
        await session.commit()

        token = create_token(user.id, "session", user.token_version)
        media_token = create_token(user.id, "media", user.token_version)
        return {
            "token": token,
            "media_token": media_token,
            "user": {
                "id": user.id,
                "name": user.name,
                "role": user.role,
                "division_id": user.division_id,
            }
        }

@router.post("/login")
async def login(req: LoginRequest):
    uid = req.username.strip().lower()
    async with AsyncSessionLocal() as session:
        user = await session.get(User, uid)
        if not user or not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Username atau password salah."
            )

        if not verify_password(req.password, user.password_hash, user.salt):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Username atau password salah."
            )

        token = create_token(user.id, "session", user.token_version)
        media_token = create_token(user.id, "media", user.token_version)
        return {
            "token": token,
            "media_token": media_token,
            "user": {
                "id": user.id,
                "name": user.name,
                "role": user.role,
                "division_id": user.division_id,
            }
        }

@router.post("/reset-password")
async def reset_password(req: ResetPasswordRequest):
    current_code = get_current_reset_code()
    if req.reset_code.strip().upper() != current_code.upper():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Kode reset tidak valid atau salah."
        )

    uid = req.username.strip().lower()
    async with AsyncSessionLocal() as session:
        user = await session.get(User, uid)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User tidak ditemukan."
            )

        p_hash, salt = hash_password(req.new_password)
        user.password_hash = p_hash
        user.salt = salt
        user.token_version += 1  # Revoke all existing sessions
        await session.commit()

        token = create_token(user.id, "session", user.token_version)
        media_token = create_token(user.id, "media", user.token_version)
        return {
            "success": True,
            "token": token,
            "media_token": media_token,
            "message": "Password berhasil disetel ulang."
        }

@router.post("/logout")
async def logout(current_user: dict = Depends(get_current_user)):
    async with AsyncSessionLocal() as session:
        stmt = (
            update(User)
            .where(User.id == current_user["id"])
            .values(token_version=User.token_version + 1)
        )
        await session.execute(stmt)
        await session.commit()
    return {"success": True}

@router.post("/media-token")
async def refresh_media_token(current_user: dict = Depends(get_current_user)):
    media_token = create_token(current_user["id"], "media", current_user["token_version"])
    return {"media_token": media_token}

@router.get("/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    return current_user

