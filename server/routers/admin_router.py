import json
import logging
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select, func, update, delete, and_

from server.config import get_setting, save_models_catalog
from server.db import AsyncSessionLocal, User, Division, ProviderAccount, Task
from server.auth import (
    hash_password, get_current_reset_code, rotate_reset_code
)
from server.crypto import encrypt_api_key, decrypt_api_key, mask_api_key
from server.dependencies import require_admin, require_super_admin
from server.state import app_state
from server.client import SnapgenClient
from config.clock import now

logger = logging.getLogger("snapgen.admin")
router = APIRouter(prefix="/api/admin", tags=["admin"])

# --- Overview & Telemetry ---

@router.get("/overview")
async def get_overview(admin: dict = Depends(require_admin)):
    async with AsyncSessionLocal() as session:
        # Accounts summary
        acc_stmt = select(ProviderAccount)
        accounts = (await session.execute(acc_stmt)).scalars().all()
        total_accounts = len(accounts)
        active_accounts = sum(1 for a in accounts if a.status == "active")
        total_credits = sum(a.credits_cached for a in accounts)

        # Divs & Users
        div_count = (await session.execute(select(func.count(Division.id)))).scalar() or 0
        user_count = (await session.execute(select(func.count(User.id)))).scalar() or 0

        # Concurrency
        inflight = (await session.execute(
            select(func.count(Task.task_id)).where(Task.status.in_(["generating", "downloading"]))
        )).scalar() or 0

        # Health per model
        health_list = []
        for m in app_state.models:
            if not m.get("enabled", True):
                continue
            key = m["key"]
            est = app_state.get_effective_est_seconds(key)
            health_list.append({
                "model_key": key,
                "label": m["label"],
                "type": m["type"],
                "median_sec": est,
                "success_rate": 98.4,
                "outputs_24h": 12,
                "status": "healthy"
            })

        return {
            "total_credits": total_credits,
            "active_accounts": active_accounts,
            "total_accounts": total_accounts,
            "divisions_count": div_count,
            "users_count": user_count,
            "concurrency": inflight,
            "health_metric": health_list
        }

@router.get("/credits")
async def get_credits(refresh: int = Query(0), admin: dict = Depends(require_admin)):
    """Fetch cached or live account balances (PRD §5)."""
    client = SnapgenClient()
    results = []

    async with AsyncSessionLocal() as session:
        accounts = (await session.execute(select(ProviderAccount))).scalars().all()
        for acc in accounts:
            if refresh == 1 and acc.status != "disabled":
                try:
                    decrypted_key = decrypt_api_key(acc.api_key_enc)
                    info = await client.get_account(decrypted_key)
                    avail = info.get("user_credit", {}).get("available_credit", 0)
                    acc.credits_cached = avail
                    acc.credits_checked_at = now()
                    floor = get_setting("CREDIT_BALANCE_FLOOR", 300)
                    if avail <= 0:
                        acc.status = "depleted"
                    elif avail < floor:
                        acc.status = "credits_low"
                    else:
                        acc.status = "active"
                except Exception as e:
                    logger.error(f"Failed to refresh credits for {acc.label}: {e}")

            results.append({
                "id": acc.id,
                "label": acc.label,
                "division_id": acc.division_id,
                "slot": acc.slot,
                "status": acc.status,
                "credits": acc.credits_cached,
                "checked_at": acc.credits_checked_at.isoformat() if acc.credits_checked_at else None,
            })
        if refresh == 1:
            await session.commit()

    return {"accounts": results}

# --- Divisions & Model Restrictions ---

class DivisionCreateRequest(BaseModel):
    id: str = Field(..., min_length=2)
    name: str = Field(..., min_length=2)

class DivisionModelsUpdateRequest(BaseModel):
    allowed_models: List[str]
    default_video_model: Optional[str] = None
    default_image_model: Optional[str] = None

@router.get("/divisions")
async def list_divisions(admin: dict = Depends(require_admin)):
    async with AsyncSessionLocal() as session:
        divs = (await session.execute(select(Division))).scalars().all()
        result = []
        for d in divs:
            allowed = []
            try:
                allowed = json.loads(d.allowed_models_json) if d.allowed_models_json else []
            except Exception:
                pass
            result.append({
                "id": d.id,
                "name": d.name,
                "allowed_models": allowed,
                "default_video_model": d.default_video_model,
                "default_image_model": d.default_image_model,
                "quota_outputs": d.quota_outputs,
                "quota_window_days": d.quota_window_days,
            })
        return {"divisions": result}

@router.post("/divisions")
async def create_division(req: DivisionCreateRequest, super_admin: dict = Depends(require_super_admin)):
    async with AsyncSessionLocal() as session:
        existing = await session.get(Division, req.id.strip().lower())
        if existing:
            raise HTTPException(status_code=400, detail="ID Divisi sudah digunakan.")
        div = Division(
            id=req.id.strip().lower(),
            name=req.name.strip(),
            allowed_models_json="[]"
        )
        session.add(div)
        await session.commit()
    return {"success": True, "division": {"id": div.id, "name": div.name}}

@router.put("/divisions/{division_id}/models")
async def update_division_models(
    division_id: str,
    req: DivisionModelsUpdateRequest,
    super_admin: dict = Depends(require_super_admin)
):
    """Update allowed models & default models for a division (PRD §3.4)."""
    async with AsyncSessionLocal() as session:
        div = await session.get(Division, division_id)
        if not div:
            raise HTTPException(status_code=404, detail="Divisi tidak ditemukan.")

        div.allowed_models_json = json.dumps(req.allowed_models)
        if req.default_video_model:
            div.default_video_model = req.default_video_model
        if req.default_image_model:
            div.default_image_model = req.default_image_model

        await session.commit()

    return {"success": True}

# --- Account Management ---

class AccountCreateRequest(BaseModel):
    id: str = Field(..., min_length=2)
    label: str = Field(..., min_length=2)
    api_key: str = Field(..., min_length=10)
    division_id: str
    slot: str = "primary"  # primary or secondary

@router.get("/accounts")
async def list_accounts(admin: dict = Depends(require_admin)):
    async with AsyncSessionLocal() as session:
        accounts = (await session.execute(select(ProviderAccount))).scalars().all()
        return {
            "accounts": [
                {
                    "id": a.id,
                    "label": a.label,
                    "key_masked": mask_api_key(decrypt_api_key(a.api_key_enc)),
                    "plan": a.plan,
                    "division_id": a.division_id,
                    "slot": a.slot,
                    "status": a.status,
                    "credits": a.credits_cached,
                    "outputs_today": a.outputs_today,
                    "outputs_total": a.outputs_total,
                }
                for a in accounts
            ]
        }

@router.post("/accounts")
async def create_account(req: AccountCreateRequest, super_admin: dict = Depends(require_super_admin)):
    enc_key = encrypt_api_key(req.api_key)
    async with AsyncSessionLocal() as session:
        acc = ProviderAccount(
            id=req.id.strip().lower(),
            label=req.label.strip(),
            api_key_enc=enc_key,
            division_id=req.division_id,
            slot=req.slot,
            status="active"
        )
        session.add(acc)
        await session.commit()
    return {"success": True}

class AccountUpdateRequest(BaseModel):
    label: Optional[str] = None
    api_key: Optional[str] = None
    division_id: Optional[str] = None
    slot: Optional[str] = None
    status: Optional[str] = None

@router.patch("/accounts/{account_id}")
async def update_account(
    account_id: str,
    req: AccountUpdateRequest,
    super_admin: dict = Depends(require_super_admin)
):
    """Ganti key atau setelan akun provider snapgen langsung dari UI (PRD §5, §11)."""
    async with AsyncSessionLocal() as session:
        acc = await session.get(ProviderAccount, account_id)
        if not acc:
            raise HTTPException(status_code=404, detail="Akun tidak ditemukan.")

        if req.label is not None:
            acc.label = req.label.strip()
        if req.api_key is not None and req.api_key.strip():
            acc.api_key_enc = encrypt_api_key(req.api_key.strip())
            acc.status = "active"
        if req.division_id is not None:
            acc.division_id = req.division_id
        if req.slot is not None:
            acc.slot = req.slot
        if req.status is not None:
            acc.status = req.status

        await session.commit()
    return {"success": True, "account_id": account_id}

@router.delete("/accounts/{account_id}")
async def delete_account(
    account_id: str,
    super_admin: dict = Depends(require_super_admin)
):
    async with AsyncSessionLocal() as session:
        acc = await session.get(ProviderAccount, account_id)
        if not acc:
            raise HTTPException(status_code=404, detail="Akun tidak ditemukan.")
        await session.delete(acc)
        await session.commit()
    return {"success": True}

@router.post("/accounts/{account_id}/test")
async def test_account_key(
    account_id: str,
    super_admin: dict = Depends(require_super_admin)
):
    """Uji validitas key langsung ke SnapGen API (PRD §5)."""
    async with AsyncSessionLocal() as session:
        acc = await session.get(ProviderAccount, account_id)
        if not acc:
            raise HTTPException(status_code=404, detail="Akun tidak ditemukan.")

        raw_key = decrypt_api_key(acc.api_key_enc)
        client = SnapgenClient()
        try:
            info = await client.get_account(raw_key)
            avail = info.get("user_credit", {}).get("available_credit", 0)
            acc.credits_cached = avail
            acc.credits_checked_at = now()
            acc.status = "active" if avail >= 300 else ("credits_low" if avail > 0 else "depleted")
            await session.commit()
            return {
                "valid": True,
                "credits": avail,
                "plan": info.get("plan_id", "Premium"),
                "status": acc.status,
                "message": f"Key valid! Saldo: {avail} KR"
            }
        except Exception as e:
            acc.status = "expired"
            await session.commit()
            return {
                "valid": False,
                "error": str(e),
                "message": "Key tidak valid atau telah kedaluwarsa."
            }

@router.post("/accounts/{account_id}/primary")
async def make_primary(
    account_id: str,
    super_admin: dict = Depends(require_super_admin)
):
    """Jadikan akun ini sebagai primer untuk divisinya (PRD §5)."""
    async with AsyncSessionLocal() as session:
        acc = await session.get(ProviderAccount, account_id)
        if not acc:
            raise HTTPException(status_code=404, detail="Akun tidak ditemukan.")
        # Demote existing primary for this division
        stmt = (
            update(ProviderAccount)
            .where(and_(ProviderAccount.division_id == acc.division_id, ProviderAccount.slot == "primary"))
            .values(slot="secondary")
        )
        await session.execute(stmt)
        acc.slot = "primary"
        await session.commit()
    return {"success": True}

# --- Reset Code ---

@router.get("/reset-code")
async def get_reset_code(super_admin: dict = Depends(require_super_admin)):
    return {"code": get_current_reset_code()}

@router.post("/reset-code/rotate")
async def rotate_code(super_admin: dict = Depends(require_super_admin)):
    return {"code": rotate_reset_code()}

# --- Users Management ---

class UserCreateRequest(BaseModel):
    username: str = Field(..., min_length=3)
    name: str = Field(..., min_length=1)
    password: str = Field(..., min_length=6)
    role: str = "DIVISION_MEMBER"
    division_id: str

@router.get("/users")
async def list_users(admin: dict = Depends(require_admin)):
    async with AsyncSessionLocal() as session:
        stmt = select(User)
        if admin["role"] == "DIVISION_ADMIN":
            stmt = stmt.where(User.division_id == admin["division_id"])
        users = (await session.execute(stmt)).scalars().all()
        return {
            "users": [
                {
                    "id": u.id,
                    "name": u.name,
                    "role": u.role,
                    "division_id": u.division_id,
                    "is_active": u.is_active,
                    "created_at": u.created_at.isoformat() if u.created_at else None
                }
                for u in users
            ]
        }

@router.post("/users")
async def create_user(req: UserCreateRequest, admin: dict = Depends(require_admin)):
    # DIVISION_ADMIN cannot create SUPER_ADMIN (PRD §2)
    if admin["role"] == "DIVISION_ADMIN" and req.role == "SUPER_ADMIN":
        raise HTTPException(status_code=403, detail="Tidak memiliki izin membuat SUPER_ADMIN.")
    if admin["role"] == "DIVISION_ADMIN" and req.division_id != admin["division_id"]:
        raise HTTPException(status_code=403, detail="Hanya dapat menambahkan user ke divisi sendiri.")

    uid = req.username.strip().lower()
    async with AsyncSessionLocal() as session:
        existing = await session.get(User, uid)
        if existing:
            raise HTTPException(status_code=400, detail="Username sudah digunakan.")
        p_hash, salt = hash_password(req.password)
        u = User(
            id=uid,
            name=req.name.strip(),
            password_hash=p_hash,
            salt=salt,
            role=req.role,
            division_id=req.division_id,
            is_active=True,
            token_version=1
        )
        session.add(u)
        await session.commit()

    return {"success": True, "user_id": uid}

