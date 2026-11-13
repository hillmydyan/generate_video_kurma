import asyncio
import hashlib
import io
import json
import uuid
import zipfile
import logging
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any
from fastapi import (
    APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
)
from fastapi.responses import StreamingResponse
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from server.config import get_setting, DATA_DIR
from server.db import AsyncSessionLocal, Batch, Task, Division
from server.dependencies import get_current_user
from server.auth import verify_token
from server.state import app_state
from server.quota import get_user_quota_status, consume_quota, refund_quota
from server.worker import get_or_create_worker, division_workers
from server.credits import (
    LoopAwareLock,
    credit_lock,
    map_task_status_id,
    reserve_credits_in_session,
    refund_task_credit,
    recalculate_batch_status_in_session,
    get_kantor_available_kr,
)
from server.media_security import validate_and_save_uploaded_image
from server.sse import sse_broker
from config.clock import now

logger = logging.getLogger("snapgen.batches")
router = APIRouter(prefix="/api", tags=["batches"])

# Per-user lock to prevent double-submit race conditions
_user_submit_locks: Dict[str, LoopAwareLock] = {}


def _get_user_lock(user_id: str) -> LoopAwareLock:
    if user_id not in _user_submit_locks:
        _user_submit_locks[user_id] = LoopAwareLock()
    return _user_submit_locks[user_id]


def _default_batch_name() -> str:
    months = [
        "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
        "Jul", "Agu", "Sep", "Okt", "Nov", "Des"
    ]
    dt = now()
    m_str = months[dt.month - 1]
    return f"Batch {dt.day:02d} {m_str} {dt.hour:02d}.{dt.minute:02d}"


def _check_batch_access(batch: Batch, user: dict) -> None:
    role = user.get("role", "DIVISION_MEMBER")
    if role == "SUPER_ADMIN":
        return
    if role == "DIVISION_ADMIN" and batch.kantor_id == user.get("division_id"):
        return
    if batch.user_id == user.get("id"):
        return
    raise HTTPException(status_code=404, detail="Batch tidak ditemukan.")


def _serialize_batch_task(t: Task) -> Dict[str, Any]:
    mem = app_state.tasks.get(t.task_id, {})
    raw_status = mem.get("status", t.status)
    status_id = map_task_status_id(raw_status)
    prog = mem.get("provider_pct", t.progress or t.provider_pct or 0)
    if status_id == "selesai":
        prog = 100
    elif status_id == "antre":
        prog = 0

    vid_path = mem.get("result_url") or t.video_path or t.result_url
    err_msg = mem.get("error") or t.error_message or t.error
    est_sec = t.est_seconds or 120
    remaining_sec = max(5, int(est_sec * (100 - prog) / 100)) if status_id == "memproses" else est_sec

    return {
        "id": t.task_id,
        "task_id": t.task_id,
        "batch_id": t.batch_id,
        "urutan": t.urutan or (t.prompt_index or 0) + 1,
        "prompt": t.prompt,
        "status": status_id,
        "raw_status": raw_status,
        "provider_job_id": mem.get("provider_job_id") or t.provider_job_id,
        "progress": prog,
        "video_path": vid_path,
        "video_url": vid_path,
        "error_message": err_msg,
        "kr_biaya": t.kr_biaya or t.credit_cost or 0,
        "percobaan": mem.get("percobaan", t.percobaan or t.task_retries or 0),
        "est_seconds": est_sec,
        "remaining_seconds": remaining_sec,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "started_at": t.started_at.isoformat() if t.started_at else None,
        "finished_at": t.finished_at.isoformat() if t.finished_at else None,
    }


async def _serialize_batch(session: AsyncSession, batch: Batch, include_tasks: bool = True) -> Dict[str, Any]:
    await recalculate_batch_status_in_session(session, batch.id)
    stmt = select(Task).where(Task.batch_id == batch.id).order_by(Task.urutan.asc(), Task.created_at.asc())
    tasks = (await session.execute(stmt)).scalars().all()
    serialized_tasks = [_serialize_batch_task(t) for t in tasks]

    selesai_count = sum(1 for item in serialized_tasks if item["status"] == "selesai")
    gagal_count = sum(1 for item in serialized_tasks if item["status"] == "gagal")
    batal_count = sum(1 for item in serialized_tasks if item["status"] == "dibatalkan")
    memproses_count = sum(1 for item in serialized_tasks if item["status"] == "memproses")
    antre_count = sum(1 for item in serialized_tasks if item["status"] == "antre")
    total_count = len(serialized_tasks)

    app_state.load_catalog()
    model_info = app_state.get_model(batch.model)
    model_label = model_info.get("label", batch.model) if model_info else batch.model

    foto_url = f"/{batch.foto_path.lstrip('/')}" if batch.foto_path else None

    data: Dict[str, Any] = {
        "id": batch.id,
        "user_id": batch.user_id,
        "kantor_id": batch.kantor_id,
        "nama": batch.nama,
        "foto_path": batch.foto_path,
        "foto_url": foto_url,
        "model": batch.model,
        "model_label": model_label,
        "rasio": batch.rasio,
        "durasi": batch.durasi,
        "status": batch.status,
        "total_kr": batch.total_kr,
        "total_tasks": total_count,
        "selesai_count": selesai_count,
        "gagal_count": gagal_count,
        "dibatalkan_count": batal_count,
        "memproses_count": memproses_count,
        "antre_count": antre_count,
        "created_at": batch.created_at.isoformat() if batch.created_at else None,
        "finished_at": batch.finished_at.isoformat() if batch.finished_at else None,
    }
    if include_tasks:
        data["tasks"] = serialized_tasks
    return data


def _parse_prompts_input(
    prompts: Optional[List[str]],
    prompts_bracket: Optional[List[str]],
) -> List[str]:
    raw_list: List[str] = []
    for source in (prompts, prompts_bracket):
        if not source:
            continue
        for item in source:
            if not item:
                continue
            trimmed = item.strip()
            if trimmed.startswith("[") and trimmed.endswith("]"):
                try:
                    parsed = json.loads(trimmed)
                    if isinstance(parsed, list):
                        raw_list.extend(str(x) for x in parsed)
                        continue
                except Exception:
                    pass
            raw_list.append(item)

    cleaned = [p.strip() for p in raw_list if p and p.strip()]
    return cleaned


@router.post("/batches")
async def create_batch(
    foto: Optional[UploadFile] = File(None),
    prompts: Optional[List[str]] = Form(None),
    prompts_bracket: Optional[List[str]] = Form(None, alias="prompts[]"),
    rasio: str = Form("9:16"),
    durasi: int = Form(8),
    nama: Optional[str] = Form(None),
    model: Optional[str] = Form(None),
    current_user: dict = Depends(get_current_user),
):
    """
    Create a Foto + Multi Prompt batch:
    - Validates photo (JPG/PNG/WEBP magic bytes, max 10MB)
    - Validates 1..10 non-empty prompts (discards empty ones)
    - Enforces office model lock if office is locked to 1 model
    - Checks & reserves KR atomically in DB transaction
    - Saves photo once, creates 1 Batch + N Tasks, enqueues to worker, returns immediately
    """
    user_id = current_user["id"]
    kantor_id = current_user.get("division_id", "kantor_a")
    is_super = current_user.get("role") == "SUPER_ADMIN"

    if foto is None:
        raise HTTPException(status_code=400, detail="Foto model wajib diunggah.")

    foto_bytes = await foto.read()
    clean_prompts = _parse_prompts_input(prompts, prompts_bracket)

    if len(clean_prompts) == 0:
        raise HTTPException(status_code=400, detail="Minimal 1 prompt tidak boleh kosong.")
    if len(clean_prompts) > 10:
        raise HTTPException(status_code=400, detail="Maksimal 10 prompt per batch.")

    for idx, p in enumerate(clean_prompts, start=1):
        if len(p) > 32000:
            raise HTTPException(
                status_code=400,
                detail=f"Prompt #{idx} melebihi batas maksimal 32.000 karakter."
            )

    if rasio not in ("9:16", "16:9", "1:1"):
        raise HTTPException(status_code=400, detail="Rasio video tidak valid.")

    user_lock = _get_user_lock(user_id)
    async with user_lock:
        # Compute idempotency fingerprint (same user + photo bytes + prompts + settings within 10s)
        foto_hash = hashlib.sha256(foto_bytes).hexdigest()[:24]
        idem_raw = json.dumps(
            {
                "u": user_id,
                "f": foto_hash,
                "p": clean_prompts,
                "r": rasio,
                "d": durasi,
                "m": model or "",
            },
            sort_keys=True,
        )
        idem_key = hashlib.sha256(idem_raw.encode("utf-8")).hexdigest()[:40]

        app_state.load_catalog()

        async with credit_lock:
            async with AsyncSessionLocal() as session:
                async with session.begin():
                    # 1. Check idempotency window (10 seconds) to prevent double-click duplicates
                    cutoff_idem = now() - timedelta(seconds=10)
                    idem_stmt = (
                        select(Batch)
                        .where(
                            and_(
                                Batch.user_id == user_id,
                                Batch.idempotency_key == idem_key,
                                Batch.created_at >= cutoff_idem,
                            )
                        )
                        .order_by(Batch.created_at.desc())
                        .limit(1)
                    )
                    existing_batch = (await session.execute(idem_stmt)).scalar_one_or_none()
                    if existing_batch:
                        logger.info(f"Idempotent duplicate batch submission detected for {user_id}, returning {existing_batch.id}")
                        return await _serialize_batch(session, existing_batch, include_tasks=True)

                    # 2. Resolve model according to division settings (lock to office model if locked)
                    div = await session.get(Division, kantor_id)
                    allowed_keys: List[str] = []
                    default_video_key = get_setting("DEFAULT_VIDEO_MODEL", "veo")
                    if div:
                        if div.allowed_models_json:
                            try:
                                allowed_keys = json.loads(div.allowed_models_json)
                            except Exception:
                                allowed_keys = []
                        if div.default_video_model:
                            default_video_key = div.default_video_model

                    allowed_video_models = [
                        m for m in app_state.models
                        if m.get("enabled", True)
                        and m.get("type") == "video"
                        and (not allowed_keys or m.get("key") in allowed_keys)
                    ]
                    if not allowed_video_models:
                        raise HTTPException(
                            status_code=400,
                            detail="Tidak ada model video aktif yang diizinkan untuk kantor Anda."
                        )

                    # If office is locked to exactly 1 video model, always use that model regardless of request
                    if len(allowed_video_models) == 1 and not is_super:
                        chosen_model_obj = allowed_video_models[0]
                    elif model:
                        found = next((m for m in allowed_video_models if m.get("key") == model), None)
                        if not found and is_super:
                            found = app_state.get_model(model)
                        if not found:
                            raise HTTPException(
                                status_code=status.HTTP_403_FORBIDDEN,
                                detail="Model yang dipilih tidak diizinkan untuk kantor Anda."
                            )
                        chosen_model_obj = found
                    else:
                        chosen_model_obj = (
                            next((m for m in allowed_video_models if m.get("key") == default_video_key), None)
                            or allowed_video_models[0]
                        )

                    chosen_model_key = chosen_model_obj["key"]
                    kr_per_video = int(chosen_model_obj.get("credits", 4))
                    total_outputs = len(clean_prompts)
                    total_kr = kr_per_video * total_outputs

                    # 3. Validate user daily output quota
                    quota_status = await get_user_quota_status(user_id, kantor_id)
                    if quota_status["limit"] > 0 and quota_status["remaining"] < total_outputs:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Kuota harian tidak mencukupi (sisa: {quota_status['remaining']}, butuh: {total_outputs})."
                        )

                    # 4. Check & reserve KR balance BEFORE saving photo or tasks
                    batch_id = f"batch_{uuid.uuid4().hex[:10]}"
                    batch_name = (nama or "").strip()[:120] or _default_batch_name()
                    await reserve_credits_in_session(
                        session=session,
                        user_id=user_id,
                        kantor_id=kantor_id,
                        batch_id=batch_id,
                        task_id=None,
                        amount_kr=total_kr,
                        alasan=f"Cadangkan KR batch '{batch_name}' ({total_outputs} video × {kr_per_video} KR)",
                    )

                    # 5. Validate & save photo ONCE
                    foto_rel_path, _ = validate_and_save_uploaded_image(foto_bytes)

                    # 6. Create Batch row
                    created_ts = now()
                    batch_row = Batch(
                        id=batch_id,
                        user_id=user_id,
                        kantor_id=kantor_id,
                        nama=batch_name,
                        foto_path=foto_rel_path,
                        model=chosen_model_key,
                        rasio=rasio,
                        durasi=int(durasi),
                        status="berjalan",
                        total_kr=total_kr,
                        idempotency_key=idem_key,
                        created_at=created_ts,
                    )
                    session.add(batch_row)

                    # 7. Create N Task rows in the same transaction
                    est_sec = app_state.get_effective_est_seconds(chosen_model_key)
                    options_dict = {"aspect": rasio, "duration": int(durasi)}
                    options_str = json.dumps(options_dict)
                    created_task_dicts: List[Dict[str, Any]] = []
                    task_ids: List[str] = []

                    for idx, p_text in enumerate(clean_prompts, start=1):
                        tid = f"task_{uuid.uuid4().hex[:12]}"
                        task_ids.append(tid)
                        t_row = Task(
                            task_id=tid,
                            user_id=user_id,
                            division_id=kantor_id,
                            batch_id=batch_id,
                            urutan=idx,
                            status="queued",
                            prompt=p_text,
                            prompt_index=idx - 1,
                            total_prompts=total_outputs,
                            copy_index=0,
                            image_path=foto_rel_path,
                            image_mode="shared",
                            model_key=chosen_model_key,
                            media_type="video",
                            options_json=options_str,
                            credit_cost=kr_per_video,
                            kr_biaya=kr_per_video,
                            kr_reserved=kr_per_video,
                            credit_estimated=kr_per_video,
                            credit_used=0,
                            provider_pct=0,
                            progress=0,
                            est_seconds=est_sec,
                            task_retries=0,
                            percobaan=0,
                            created_at=created_ts,
                            updated_at=created_ts,
                        )
                        session.add(t_row)

                        created_task_dicts.append({
                            "task_id": tid,
                            "user_id": user_id,
                            "division_id": kantor_id,
                            "batch_id": batch_id,
                            "urutan": idx,
                            "status": "queued",
                            "prompt": p_text,
                            "prompt_index": idx - 1,
                            "total_prompts": total_outputs,
                            "copy_index": 0,
                            "image_path": foto_rel_path,
                            "image_mode": "shared",
                            "model_key": chosen_model_key,
                            "media_type": "video",
                            "options": options_dict,
                            "credit_cost": kr_per_video,
                            "kr_biaya": kr_per_video,
                            "credit_estimated": kr_per_video,
                            "credit_used": 0,
                            "provider_pct": 0,
                            "progress": 0,
                            "est_seconds": est_sec,
                            "created_at": created_ts.isoformat(),
                            "updated_at": created_ts.isoformat(),
                        })

            # Outside session.begin() (transaction committed):
            await consume_quota(user_id, task_ids, credits=kr_per_video)

            async with app_state.lock:
                q = app_state.division_queues.setdefault(kantor_id, [])
                for td in created_task_dicts:
                    app_state.tasks[td["task_id"]] = td
                    q.append(td["task_id"])

            get_or_create_worker(kantor_id)

            async with AsyncSessionLocal() as read_session:
                b_obj = await read_session.get(Batch, batch_id)
                return await _serialize_batch(read_session, b_obj, include_tasks=True)


@router.get("/batches/aktif")
async def get_active_batches(current_user: dict = Depends(get_current_user)):
    """Return user's currently running batch(es) so UI recovers seamlessly after refresh."""
    user_id = current_user["id"]
    async with AsyncSessionLocal() as session:
        async with session.begin():
            stmt = (
                select(Batch)
                .where(and_(Batch.user_id == user_id, Batch.status == "berjalan"))
                .order_by(Batch.created_at.desc())
            )
            batches = (await session.execute(stmt)).scalars().all()
            active_list = []
            for b in batches:
                serialized = await _serialize_batch(session, b, include_tasks=True)
                if serialized["status"] == "berjalan":
                    active_list.append(serialized)

            return {
                "batch": active_list[0] if active_list else None,
                "batches": active_list,
            }


@router.get("/batches")
async def list_batches(
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=50),
    current_user: dict = Depends(get_current_user),
):
    """List batch history (user sees own batches; division admin sees office batches; super admin sees all)."""
    user_id = current_user["id"]
    role = current_user.get("role", "DIVISION_MEMBER")
    kantor_id = current_user.get("division_id", "kantor_a")

    async with AsyncSessionLocal() as session:
        async with session.begin():
            query = select(Batch)
            if role == "SUPER_ADMIN":
                pass
            elif role == "DIVISION_ADMIN":
                query = query.where(Batch.kantor_id == kantor_id)
            else:
                query = query.where(Batch.user_id == user_id)

            count_stmt = select(func.count()).select_from(query.subquery())
            total = (await session.execute(count_stmt)).scalar() or 0

            offset = (page - 1) * limit
            stmt = query.order_by(Batch.created_at.desc()).offset(offset).limit(limit)
            rows = (await session.execute(stmt)).scalars().all()

            items = [await _serialize_batch(session, b, include_tasks=True) for b in rows]
            return {
                "batches": items,
                "total": total,
                "page": page,
                "limit": limit,
                "total_pages": max(1, (total + limit - 1) // limit),
            }


@router.get("/batches/{batch_id}")
async def get_batch_detail(
    batch_id: str,
    current_user: dict = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        async with session.begin():
            batch = await session.get(Batch, batch_id)
            if not batch:
                raise HTTPException(status_code=404, detail="Batch tidak ditemukan.")
            _check_batch_access(batch, current_user)
            return await _serialize_batch(session, batch, include_tasks=True)


@router.post("/batch-tasks/{task_id}/retry")
async def retry_batch_task(
    task_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Retry a single failed/cancelled task in a batch."""
    async with credit_lock:
        async with AsyncSessionLocal() as session:
            async with session.begin():
                t = await session.get(Task, task_id)
                if not t or not t.batch_id:
                    raise HTTPException(status_code=404, detail="Tugas batch tidak ditemukan.")

                batch = await session.get(Batch, t.batch_id)
                if not batch:
                    raise HTTPException(status_code=404, detail="Batch tidak ditemukan.")
                _check_batch_access(batch, current_user)

                cur_status = map_task_status_id(t.status)
                if cur_status not in ("gagal", "dibatalkan"):
                    raise HTTPException(
                        status_code=400,
                        detail="Hanya tugas yang gagal atau dibatalkan yang dapat dicoba ulang."
                    )

                cost = t.kr_biaya or t.credit_cost or 0
                await reserve_credits_in_session(
                    session=session,
                    user_id=t.user_id,
                    kantor_id=t.division_id,
                    batch_id=t.batch_id,
                    task_id=t.task_id,
                    amount_kr=cost,
                    alasan=f"Cadangkan ulang KR untuk retry tugas #{t.urutan}",
                )

                t.status = "queued"
                t.kr_reserved = cost
                t.credit_used = 0
                t.provider_job_id = None
                t.provider_pct = 0
                t.progress = 0
                t.error = None
                t.error_message = None
                t.result_url = None
                t.video_path = None
                t.started_at = None
                t.finished_at = None
                t.task_retries = 0
                t.percobaan = 0
                t.updated_at = now()

                batch.status = "berjalan"
                batch.finished_at = None
                await recalculate_batch_status_in_session(session, batch.id)

                opts = json.loads(t.options_json) if t.options_json else {}
                t_dict = {
                    "task_id": t.task_id,
                    "user_id": t.user_id,
                    "division_id": t.division_id,
                    "batch_id": t.batch_id,
                    "urutan": t.urutan,
                    "status": "queued",
                    "prompt": t.prompt,
                    "image_path": t.image_path,
                    "model_key": t.model_key,
                    "media_type": t.media_type,
                    "options": opts,
                    "credit_cost": cost,
                    "kr_biaya": cost,
                    "provider_job_id": None,
                    "provider_pct": 0,
                    "progress": 0,
                    "est_seconds": t.est_seconds,
                    "error": None,
                    "error_message": None,
                    "result_url": None,
                    "video_path": None,
                }
                division_id = t.division_id
                uid = t.user_id

        await consume_quota(uid, [task_id], credits=cost)

        async with app_state.lock:
            app_state.tasks[task_id] = t_dict
            q = app_state.division_queues.setdefault(division_id, [])
            if task_id not in q:
                q.append(task_id)

        get_or_create_worker(division_id)

        async with AsyncSessionLocal() as read_session:
            async with read_session.begin():
                b_obj = await read_session.get(Batch, batch.id)
                return await _serialize_batch(read_session, b_obj, include_tasks=True)


@router.post("/batch-tasks/{task_id}/cancel")
async def cancel_batch_task(
    task_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Cancel a single unfinished task and refund its reserved KR."""
    async with AsyncSessionLocal() as session:
        t = await session.get(Task, task_id)
        if not t or not t.batch_id:
            raise HTTPException(status_code=404, detail="Tugas tidak ditemukan.")
        batch = await session.get(Batch, t.batch_id)
        if not batch:
            raise HTTPException(status_code=404, detail="Batch tidak ditemukan.")
        _check_batch_access(batch, current_user)
        division_id = t.division_id
        batch_id = batch.id
        urutan = t.urutan
        cur_status = map_task_status_id(t.status)

    if cur_status in ("antre", "memproses"):
        async with app_state.lock:
            q = app_state.division_queues.get(division_id, [])
            if task_id in q:
                q.remove(task_id)
        worker = division_workers.get(division_id)
        if worker:
            worker.cancel_active_task(task_id)

        await app_state.update_task_status(
            task_id,
            "cancelled",
            finished_at=now().isoformat(),
        )
        await refund_task_credit(task_id, alasan=f"Tugas #{urutan} dibatalkan")
        await refund_quota(task_id)

    async with AsyncSessionLocal() as read_session:
        async with read_session.begin():
            b_obj = await read_session.get(Batch, batch_id)
            return await _serialize_batch(read_session, b_obj, include_tasks=True)


@router.post("/batches/{batch_id}/cancel")
async def cancel_entire_batch(
    batch_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Cancel all remaining unfinished tasks in a batch and refund their reserved KR."""
    async with AsyncSessionLocal() as session:
        batch = await session.get(Batch, batch_id)
        if not batch:
            raise HTTPException(status_code=404, detail="Batch tidak ditemukan.")
        _check_batch_access(batch, current_user)
        stmt = select(Task).where(Task.batch_id == batch_id).order_by(Task.urutan.asc())
        tasks = (await session.execute(stmt)).scalars().all()
        unfinished = [
            (t.task_id, t.division_id, t.urutan)
            for t in tasks
            if map_task_status_id(t.status) in ("antre", "memproses")
        ]

    for tid, div_id, urutan in unfinished:
        async with app_state.lock:
            q = app_state.division_queues.get(div_id, [])
            if tid in q:
                q.remove(tid)
        worker = division_workers.get(div_id)
        if worker:
            worker.cancel_active_task(tid)

        await app_state.update_task_status(
            tid,
            "cancelled",
            finished_at=now().isoformat(),
        )
        await refund_task_credit(tid, alasan=f"Batch dibatalkan (tugas #{urutan})")
        await refund_quota(tid)

    async with AsyncSessionLocal() as read_session:
        async with read_session.begin():
            b_obj = await read_session.get(Batch, batch_id)
            return await _serialize_batch(read_session, b_obj, include_tasks=True)


def _resolve_user_from_request_or_token(request: Request, token: Optional[str]) -> dict:
    raw_token = token
    if not raw_token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            raw_token = auth_header.split(" ", 1)[1].strip()
    if not raw_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Autentikasi diperlukan.")

    verified = verify_token(raw_token, expected_purpose="session") or verify_token(raw_token, expected_purpose="media")
    if not verified:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token tidak valid atau telah kedaluwarsa.")

    user_id, _, _ = verified
    return {"id": user_id}


@router.get("/batches/{batch_id}/zip")
async def download_batch_zip(
    batch_id: str,
    request: Request,
    token: Optional[str] = Query(None),
):
    """Download all completed videos in a batch as a single ZIP archive."""
    caller = _resolve_user_from_request_or_token(request, token)
    from server.db import User

    async with AsyncSessionLocal() as session:
        u_obj = await session.get(User, caller["id"])
        if not u_obj or not u_obj.is_active:
            raise HTTPException(status_code=401, detail="User tidak aktif.")
        user_dict = {"id": u_obj.id, "role": u_obj.role, "division_id": u_obj.division_id}

        batch = await session.get(Batch, batch_id)
        if not batch:
            raise HTTPException(status_code=404, detail="Batch tidak ditemukan.")
        _check_batch_access(batch, user_dict)

        stmt = (
            select(Task)
            .where(and_(Task.batch_id == batch_id, Task.status.in_(["completed", "selesai"])))
            .order_by(Task.urutan.asc())
        )
        tasks = (await session.execute(stmt)).scalars().all()

    if not tasks:
        raise HTTPException(status_code=400, detail="Belum ada video selesai di batch ini untuk diunduh.")

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for t in tasks:
            rel_url = (t.video_path or t.result_url or "").lstrip("/")
            if not rel_url:
                continue
            local_file = DATA_DIR / rel_url
            if local_file.exists():
                arcname = f"prompt_{t.urutan:02d}_{local_file.name}"
                zf.write(local_file, arcname=arcname)

    zip_buffer.seek(0)
    safe_batch = "".join(c if c.isalnum() or c in ("-", "_") else "_" for c in batch.nama)[:40] or batch.id
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="kurmaflow_{safe_batch}.zip"'},
    )


@router.get("/batches/{batch_id}/events")
async def batch_sse_events(
    batch_id: str,
    request: Request,
    token: Optional[str] = Query(None),
):
    """SSE stream for batch progress updates."""
    caller = _resolve_user_from_request_or_token(request, token)
    user_id = caller["id"]
    queue = await sse_broker.connect(user_id)

    async def event_generator():
        yield f"retry: 2500\nevent: connected\ndata: {json.dumps({'batch_id': batch_id})}\n\n"
        while not queue.empty():
            try:
                yield queue.get_nowait()
            except asyncio.QueueEmpty:
                break

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
