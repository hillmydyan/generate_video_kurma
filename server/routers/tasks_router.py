import io
import json
import uuid
import zipfile
import logging
from pathlib import Path
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, func, and_, or_, delete

from server.config import get_setting, DATA_DIR
from server.db import AsyncSessionLocal, Task, Division
from server.dependencies import get_current_user, require_self
from server.state import app_state
from server.quota import get_user_quota_status, consume_quota, refund_quota
from server.worker import get_or_create_worker
from config.clock import now

logger = logging.getLogger("snapgen.tasks")
router = APIRouter(prefix="/api", tags=["tasks"])

class PromptEntry(BaseModel):
    prompt: str = Field(..., min_length=1)
    count: int = Field(default=1, ge=1, le=10)
    image_path: Optional[str] = None

class GenerateRequest(BaseModel):
    model_key: str
    media_type: str = "video"  # video or image
    options: Dict[str, Any] = {}
    entries: List[PromptEntry]
    image_mode: str = "none"  # shared, per_entry, none
    clear_pending: bool = False

from server.media_security import validate_and_save_uploaded_image

@router.post("/upload")
async def upload_asset(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user)
):
    """Upload reference image (PNG/JPG/WEBP, max 10MB, magic-byte verified) - PRD §7.4, §14."""
    content = await file.read()
    rel_path, _ = validate_and_save_uploaded_image(content)
    return {"path": rel_path, "filename": file.filename}

@router.get("/users/{user_id}/quota")
async def get_quota(user_id: str, current_user: dict = Depends(get_current_user)):
    require_self(user_id, current_user)
    return await get_user_quota_status(user_id, current_user["division_id"])

@router.post("/users/{user_id}/generate")
async def submit_generate(
    user_id: str,
    req: GenerateRequest,
    current_user: dict = Depends(get_current_user)
):
    require_self(user_id, current_user)
    division_id = current_user["division_id"]

    # 1. Validate Model in Catalog
    app_state.load_catalog()
    model = app_state.get_model(req.model_key)
    if not model or not model.get("enabled", True):
        raise HTTPException(status_code=400, detail="Model tidak aktif atau tidak ditemukan.")

    # 2. Check Allowed Models for Division (PRD §3.4)
    if current_user["role"] != "SUPER_ADMIN":
        async with AsyncSessionLocal() as session:
            div = await session.get(Division, division_id)
            if div and div.allowed_models_json:
                try:
                    allowed = json.loads(div.allowed_models_json)
                    if allowed and req.model_key not in allowed:
                        raise HTTPException(
                            status_code=status.HTTP_403_FORBIDDEN,
                            detail="model_not_allowed"
                        )
                except json.JSONDecodeError:
                    pass

    # 3. Calculate outputs & credits
    total_outputs = sum(e.count for e in req.entries)
    if total_outputs > 50:
        raise HTTPException(status_code=400, detail="Maksimal 50 output per pengiriman.")

    cost_per_item = model.get("credits", 1)
    total_credits = cost_per_item * total_outputs

    # 4. Check user quota
    quota_status = await get_user_quota_status(user_id, division_id)
    if quota_status["limit"] > 0 and quota_status["remaining"] < total_outputs:
        raise HTTPException(
            status_code=400,
            detail=f"Kuota tidak mencukupi (sisa: {quota_status['remaining']}, dibutuhkan: {total_outputs})."
        )

    # 5. Create tasks and insert into queue
    created_tasks = []
    task_ids = []
    now_str = now().isoformat()
    est_sec = app_state.get_effective_est_seconds(req.model_key)

    async with AsyncSessionLocal() as session:
        for entry_idx, entry in enumerate(req.entries):
            for copy_idx in range(entry.count):
                tid = f"task_{uuid.uuid4().hex[:12]}"
                task_ids.append(tid)

                task_obj = Task(
                    task_id=tid,
                    user_id=user_id,
                    division_id=division_id,
                    status="queued",
                    prompt=entry.prompt.strip(),
                    prompt_index=entry_idx,
                    total_prompts=len(req.entries),
                    copy_index=copy_idx,
                    image_path=entry.image_path,
                    image_mode=req.image_mode,
                    model_key=req.model_key,
                    media_type=req.media_type,
                    options_json=json.dumps(req.options),
                    credit_cost=cost_per_item,
                    credit_estimated=cost_per_item,
                    est_seconds=est_sec,
                    created_at=now(),
                    updated_at=now()
                )
                session.add(task_obj)

                task_dict = {
                    "task_id": tid,
                    "user_id": user_id,
                    "division_id": division_id,
                    "status": "queued",
                    "prompt": entry.prompt.strip(),
                    "prompt_index": entry_idx,
                    "total_prompts": len(req.entries),
                    "copy_index": copy_idx,
                    "image_path": entry.image_path,
                    "image_mode": req.image_mode,
                    "model_key": req.model_key,
                    "media_type": req.media_type,
                    "options": req.options,
                    "credit_cost": cost_per_item,
                    "credit_estimated": cost_per_item,
                    "credit_used": 0,
                    "provider_pct": 0,
                    "est_seconds": est_sec,
                    "created_at": now_str,
                    "updated_at": now_str,
                }
                app_state.tasks[tid] = task_dict
                created_tasks.append(task_dict)

        await session.commit()

    # Consume user quota
    await consume_quota(user_id, task_ids, credits=cost_per_item)

    # Enqueue to division queue
    async with app_state.lock:
        q = app_state.division_queues.setdefault(division_id, [])
        q.extend(task_ids)

    # Ensure worker is running
    worker = get_or_create_worker(division_id)

    return {
        "queued": total_outputs,
        "tasks": created_tasks,
        "quota": await get_user_quota_status(user_id, division_id),
        "warnings": [],
        "estimate": {
            "per_output_sec": est_sec,
            "total_sec": est_sec * total_outputs
        },
        "credits_total": total_credits
    }

@router.get("/tasks")
async def list_tasks(
    media_type: Optional[str] = None,
    aspect: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    q: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(24, ge=1, le=100),
    current_user: dict = Depends(get_current_user)
):
    """List tasks for the current user with pagination and filters (PRD §7.5)."""
    user_id = current_user["id"]
    async with AsyncSessionLocal() as session:
        query = select(Task).where(Task.user_id == user_id)

        if media_type and media_type != "all":
            query = query.where(Task.media_type == media_type)
        if status_filter and status_filter != "all":
            query = query.where(Task.status == status_filter)
        if q:
            query = query.where(
                or_(
                    Task.prompt.ilike(f"%{q}%"),
                    Task.task_id.ilike(f"%{q}%"),
                    Task.model_key.ilike(f"%{q}%")
                )
            )

        # Count total
        count_stmt = select(func.count()).select_from(query.subquery())
        total = (await session.execute(count_stmt)).scalar() or 0

        # Paginate
        offset = (page - 1) * limit
        query = query.order_by(Task.created_at.desc()).offset(offset).limit(limit)
        items = (await session.execute(query)).scalars().all()

        tasks_list = []
        for t in items:
            opts = {}
            try:
                opts = json.loads(t.options_json) if t.options_json else {}
            except Exception:
                pass
            tasks_list.append({
                "task_id": t.task_id,
                "user_id": t.user_id,
                "division_id": t.division_id,
                "status": t.status,
                "prompt": t.prompt,
                "model_key": t.model_key,
                "media_type": t.media_type,
                "options": opts,
                "credit_cost": t.credit_cost,
                "credit_used": t.credit_used,
                "provider_pct": t.provider_pct,
                "result_url": t.result_url,
                "error": t.error,
                "est_seconds": t.est_seconds,
                "created_at": t.created_at.isoformat() if t.created_at else None,
                "finished_at": t.finished_at.isoformat() if t.finished_at else None,
            })

        return {
            "tasks": tasks_list,
            "total": total,
            "page": page,
            "limit": limit,
            "total_pages": max(1, (total + limit - 1) // limit)
        }

@router.delete("/tasks/{task_id}")
async def delete_task(task_id: str, current_user: dict = Depends(get_current_user)):
    user_id = current_user["id"]
    async with AsyncSessionLocal() as session:
        t = await session.get(Task, task_id)
        if not t:
            raise HTTPException(status_code=404, detail="Task tidak ditemukan.")
        if t.user_id != user_id and current_user["role"] not in ("SUPER_ADMIN", "DIVISION_ADMIN"):
            raise HTTPException(status_code=403, detail="Akses ditolak.")

        if t.status == "queued":
            await refund_quota(task_id)

        await session.delete(t)
        await session.commit()

    async with app_state.lock:
        app_state.tasks.pop(task_id, None)
        q = app_state.division_queues.get(current_user["division_id"], [])
        if task_id in q:
            q.remove(task_id)

    return {"success": True}

@router.get("/users/{user_id}/stats")
async def get_user_stats(user_id: str, current_user: dict = Depends(get_current_user)):
    require_self(user_id, current_user)
    today_start = datetime.combine(now().date(), datetime.min.time())

    async with AsyncSessionLocal() as session:
        # Total generations
        total_stmt = select(func.count(Task.task_id)).where(Task.user_id == user_id)
        total = (await session.execute(total_stmt)).scalar() or 0

        # Output today
        today_stmt = select(func.count(Task.task_id)).where(
            and_(Task.user_id == user_id, Task.status == "completed", Task.created_at >= today_start)
        )
        today_count = (await session.execute(today_stmt)).scalar() or 0

        # In-flight pipeline
        inflight_stmt = select(func.count(Task.task_id)).where(
            and_(Task.user_id == user_id, Task.status.in_(["queued", "generating", "downloading"]))
        )
        inflight = (await session.execute(inflight_stmt)).scalar() or 0

        # 7-day success rate
        seven_days_ago = now() - timedelta(days=7)
        success_stmt = select(func.count(Task.task_id)).where(
            and_(Task.user_id == user_id, Task.status == "completed", Task.created_at >= seven_days_ago)
        )
        failed_stmt = select(func.count(Task.task_id)).where(
            and_(Task.user_id == user_id, Task.status == "failed", Task.created_at >= seven_days_ago)
        )
        succ = (await session.execute(success_stmt)).scalar() or 0
        fail = (await session.execute(failed_stmt)).scalar() or 0
        total_finished = succ + fail
        rate = round((succ / total_finished * 100), 1) if total_finished > 0 else 100.0

    return {
        "total_generations": total,
        "output_today": today_count,
        "inflight_pipeline": inflight,
        "success_rate": rate
    }

class ZipRequest(BaseModel):
    task_ids: List[str]

@router.post("/users/{user_id}/tasks/zip")
async def download_selected_zip(
    user_id: str,
    req: ZipRequest,
    current_user: dict = Depends(get_current_user)
):
    require_self(user_id, current_user)
    zip_buffer = io.BytesIO()

    async with AsyncSessionLocal() as session:
        stmt = select(Task).where(
            and_(Task.user_id == user_id, Task.task_id.in_(req.task_ids), Task.status == "completed")
        )
        tasks = (await session.execute(stmt)).scalars().all()

        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
            for t in tasks:
                if t.result_url:
                    rel_path = t.result_url.lstrip("/")
                    local_file = DATA_DIR / rel_path
                    if local_file.exists():
                        zip_file.write(local_file, arcname=local_file.name)

    zip_buffer.seek(0)
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=kurmaflow_{user_id}_assets.zip"}
    )

