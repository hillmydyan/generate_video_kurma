import asyncio
import json
import time
import logging
from datetime import datetime, timedelta
from typing import Dict, Any, Optional, List
import httpx
from sqlalchemy import select, update

from server.config import get_setting, DATA_DIR
from server.db import AsyncSessionLocal, ProviderAccount, Task, PromptBehavior
from server.db_writer import db_writer
from server.crypto import decrypt_api_key
from server.client import SnapgenClient, SnapgenAPIError
from server.state import app_state
from server.quota import refund_quota
from server.credits import commit_task_credit, refund_task_credit
from server.media_security import get_file_mime_from_disk
from config.clock import now

logger = logging.getLogger("snapgen.worker")


def is_transient_error(exc: Exception) -> bool:
    """
    Classify whether an error is temporary (timeout, 429, 5xx) or permanent (400, 422, rejected prompt/image).
    """
    if isinstance(exc, (httpx.TimeoutException, httpx.NetworkError, httpx.TransportError, asyncio.TimeoutError)):
        return True
    if isinstance(exc, SnapgenAPIError):
        msg_lower = str(exc).lower()
        permanent_keywords = [
            "ditolak", "unsafe", "policy", "safety", "blocked",
            "invalid image", "gambar tidak valid", "unreadable", "422", "400"
        ]
        if any(k in msg_lower for k in permanent_keywords):
            return False
        if exc.status_code in (408, 429, 500, 502, 503, 504):
            return True
        if exc.status_code in (400, 401, 402, 403, 404, 422):
            return False
    msg = str(exc).lower()
    if any(k in msg for k in ("timeout", "timed out", "429", "502", "503", "504", "connection", "sementara")):
        return True
    return False


def humanize_provider_error(raw_err: str, status_code: int = 400) -> str:
    """Convert raw provider/API error into friendly Indonesian message for end users."""
    lower = (raw_err or "").lower()
    if "422" in lower or "policy" in lower or "unsafe" in lower or "safety" in lower or "ditolak" in lower or "blocked" in lower:
        return "Prompt atau foto ditolak oleh filter keamanan AI. Silakan ubah deskripsi prompt dan coba lagi."
    if "image" in lower and ("invalid" in lower or "corrupt" in lower or "format" in lower):
        return "Foto referensi tidak dapat diproses oleh model AI. Gunakan foto JPG/PNG yang jelas."
    if status_code == 429 or "429" in lower or "rate limit" in lower:
        return "Antrean server AI sedang sangat padat (batas kecepatan tercapai). Silakan coba lagi beberapa saat lagi."
    if status_code in (500, 502, 503, 504) or "maintenance" in lower or "503" in lower:
        return "Server penyedia video sedang mengalami gangguan sementara. Silakan klik Coba lagi."
    if "timeout" in lower or "batas waktu" in lower or "melebihi batas" in lower:
        return "Waktu pemrosesan video melebihi batas maksimal (10 menit). Silakan klik Coba lagi."
    # Clean up technical prefixes
    cleaned = raw_err.replace("Submit generate gagal:", "").replace("Status polling gagal:", "").strip()
    return cleaned or "Gagal memproses video di server penyedia. Silakan coba lagi."


class DivisionWorker:
    def __init__(self, division_id: str):
        self.division_id = division_id
        self.client = SnapgenClient()
        self.running = False
        self._task: Optional[asyncio.Task] = None
        # Track inflight jobs per account: account_id -> count
        self.inflight_per_account: Dict[str, int] = {}
        # Track active task coroutines: task_id -> asyncio.Task
        self.active_polls: Dict[str, asyncio.Task] = {}

    def start(self):
        if not self.running:
            self.running = True
            self._task = asyncio.create_task(self._run_loop())
            logger.info(f"Worker for division {self.division_id} started")

    async def stop(self):
        self.running = False
        if self._task:
            self._task.cancel()
        for p in list(self.active_polls.values()):
            p.cancel()
        self.active_polls.clear()

    def cancel_active_task(self, task_id: str):
        poll_task = self.active_polls.pop(task_id, None)
        if poll_task and not poll_task.done():
            poll_task.cancel()

    async def get_available_account(self) -> Optional[Dict[str, Any]]:
        """
        Get primary account if healthy & has capacity, else secondary if available.
        Key is strictly isolated per division (PRD §5).
        """
        max_parallel = get_setting("MAX_PARALLEL_PER_KANTOR", get_setting("MAX_INFLIGHT_PER_ACCOUNT", 2))
        if not AsyncSessionLocal:
            return None

        async with AsyncSessionLocal() as session:
            stmt = (
                select(ProviderAccount)
                .where(ProviderAccount.division_id == self.division_id)
                .order_by(ProviderAccount.slot.asc())
            )
            res = await session.execute(stmt)
            accounts = res.scalars().all()

        if not accounts:
            return None

        current_time = now()
        for acc in accounts:
            if acc.status in ("disabled", "expired"):
                continue

            breaker_until = app_state.circuit_breakers.get(acc.id)
            if breaker_until and current_time < breaker_until:
                continue

            active_count = self.inflight_per_account.get(acc.id, 0)
            if active_count < max_parallel:
                return {
                    "id": acc.id,
                    "slot": acc.slot,
                    "label": acc.label,
                    "api_key": decrypt_api_key(acc.api_key_enc),
                    "status": acc.status,
                }

        return None

    def trigger_circuit_breaker(self, account_id: str):
        """Exponential backoff on 429: 60s up to ACCOUNT_BREAKER_MAX_SEC (PRD §5)."""
        max_sec = get_setting("ACCOUNT_BREAKER_MAX_SEC", 1800)
        consec = app_state.breaker_consecutive_429.get(account_id, 0) + 1
        app_state.breaker_consecutive_429[account_id] = consec
        backoff_sec = min(60 * (2 ** (consec - 1)), max_sec)
        until = now() + timedelta(seconds=backoff_sec)
        app_state.circuit_breakers[account_id] = until
        logger.warning(f"Account {account_id} hit rate limit (429). Breaker active for {backoff_sec}s until {until}")

    async def _run_loop(self):
        while self.running:
            try:
                # 1. Check account capacity first before dequeuing
                account = await self.get_available_account()
                if not account:
                    await asyncio.sleep(0.25)
                    continue

                # 2. Fetch next task from queue in round-robin fashion across users
                task_id = await self._dequeue_next_task()
                if not task_id:
                    await asyncio.sleep(0.2)
                    continue

                account_id = account["id"]
                api_key = account["api_key"]
                self.inflight_per_account[account_id] = self.inflight_per_account.get(account_id, 0) + 1

                # Start execution asynchronously so other tasks can proceed up to MAX_PARALLEL_PER_KANTOR
                bg = asyncio.create_task(self._process_task(task_id, account_id, api_key, resume_only=False))
                self.active_polls[task_id] = bg

                submit_gap = get_setting("SUBMIT_GAP_SEC", 2)
                if submit_gap > 0:
                    await asyncio.sleep(submit_gap)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in worker loop ({self.division_id}): {e}", exc_info=True)
                await asyncio.sleep(1.0)

    async def _dequeue_next_task(self) -> Optional[str]:
        """
        Fair round-robin scheduling across users in this division:
        Alternates between active users so a user with 10 tasks never starves another user.
        """
        async with app_state.lock:
            q = app_state.division_queues.get(self.division_id, [])
            if not q:
                return None

            # Filter out cancelled tasks first
            valid_q: List[str] = []
            for tid in q:
                t = app_state.tasks.get(tid)
                if t and t.get("status") in ("cancelled", "dibatalkan"):
                    continue
                valid_q.append(tid)
            app_state.division_queues[self.division_id] = valid_q
            if not valid_q:
                return None

            # Group queue items by user_id preserving user appearance order
            user_tasks: Dict[str, List[str]] = {}
            user_order: List[str] = []
            for tid in valid_q:
                t = app_state.tasks.get(tid)
                uid = t["user_id"] if t else "unknown"
                if uid not in user_tasks:
                    user_tasks[uid] = []
                    user_order.append(uid)
                user_tasks[uid].append(tid)

            if not user_order:
                return None

            last_user = app_state.last_user_per_division.get(self.division_id)
            if len(user_order) == 1:
                chosen_user = user_order[0]
            else:
                # Pick next user in round-robin rotation, breaking ties by lowest in-flight count
                if last_user in user_order:
                    idx = user_order.index(last_user)
                    rotated = user_order[idx + 1:] + user_order[:idx + 1]
                else:
                    rotated = user_order
                min_inflight = min(app_state.user_in_flight.get(u, 0) for u in rotated)
                candidates = [u for u in rotated if app_state.user_in_flight.get(u, 0) == min_inflight]
                chosen_user = candidates[0] if candidates else rotated[0]

            chosen_task_id = user_tasks[chosen_user][0]
            valid_q.remove(chosen_task_id)
            app_state.last_user_per_division[self.division_id] = chosen_user
            app_state.user_in_flight[chosen_user] = app_state.user_in_flight.get(chosen_user, 0) + 1
            return chosen_task_id

    async def _load_task_dict(self, task_id: str) -> Optional[Dict[str, Any]]:
        t = app_state.tasks.get(task_id)
        if t:
            return t
        if AsyncSessionLocal:
            try:
                async with AsyncSessionLocal() as session:
                    task_obj = await session.get(Task, task_id)
                    if task_obj:
                        t = {
                            "task_id": task_obj.task_id,
                            "user_id": task_obj.user_id,
                            "division_id": task_obj.division_id,
                            "batch_id": task_obj.batch_id,
                            "urutan": task_obj.urutan,
                            "status": task_obj.status,
                            "prompt": task_obj.prompt,
                            "image_path": task_obj.image_path,
                            "model_key": task_obj.model_key,
                            "media_type": task_obj.media_type,
                            "options": json.loads(task_obj.options_json) if task_obj.options_json else {},
                            "credit_cost": task_obj.credit_cost,
                            "kr_biaya": task_obj.kr_biaya or task_obj.credit_cost,
                            "provider_job_id": task_obj.provider_job_id,
                            "provider_pct": task_obj.provider_pct,
                            "est_seconds": task_obj.est_seconds,
                            "task_retries": task_obj.task_retries or 0,
                        }
                        app_state.tasks[task_id] = t
                        return t
            except Exception as ex:
                logger.warning(f"Could not load task {task_id} from DB: {ex}")
        return None

    async def _process_task(
        self,
        task_id: str,
        account_id: str,
        api_key: str,
        resume_only: bool = False,
    ):
        t = await self._load_task_dict(task_id)
        if not t:
            self._release_account(account_id)
            self.active_polls.pop(task_id, None)
            return

        # Check if task was cancelled before execution started
        if t.get("status") in ("cancelled", "dibatalkan"):
            self._release_account(account_id)
            self.active_polls.pop(task_id, None)
            async with app_state.lock:
                uid = t["user_id"]
                app_state.user_in_flight[uid] = max(0, app_state.user_in_flight.get(uid, 1) - 1)
            return

        user_id = t["user_id"]
        model_key = t["model_key"]
        app_state.load_catalog()
        model = app_state.get_model(model_key)
        start_time = time.time()
        timeout_sec = get_setting("TASK_TIMEOUT_SEC", 600)
        max_retries = 3
        backoff_base = get_setting("RETRY_BACKOFF_BASE_SEC", 1.5)

        try:
            uuid = t.get("provider_job_id")
            est_credit = t.get("kr_biaya") or t.get("credit_cost", 0)

            # STEP 1: Submit to SnapGen ONLY if we don't already have a provider_job_id
            if not (resume_only and uuid):
                await app_state.update_task_status(
                    task_id,
                    "generating",
                    account_id=account_id,
                    started_at=now().isoformat(),
                    provider_pct=max(1, t.get("provider_pct", 1)),
                )

                endpoint = model.get("endpoint", "/uapi/v1/video-gen/veo") if model else "/uapi/v1/video-gen/veo"
                body_type = model.get("body", "multipart") if model else "multipart"
                provider_params = dict(model.get("provider_params", {})) if model else {}

                params: Dict[str, Any] = {
                    "prompt": t["prompt"],
                    "model": model.get("provider_model_id", "veo-3.1-fast") if model else "veo-3.1-fast",
                    **provider_params,
                }
                opts = t.get("options", {})
                if "aspect" in opts:
                    aspect = opts["aspect"]
                    if "grok" in model_key:
                        aspect_map = {"9:16": "portrait", "16:9": "landscape", "1:1": "square"}
                        params["aspect_ratio"] = aspect_map.get(aspect, aspect)
                        params["orientation"] = aspect_map.get(aspect, aspect)
                    else:
                        params["aspect_ratio"] = aspect
                if "duration" in opts and opts["duration"]:
                    # Seedance and Kling expect string duration per PRD A.2, Veo/Grok accept int/str
                    if model_key in ("seedance", "kling"):
                        params["duration"] = str(opts["duration"])
                    else:
                        params["duration"] = opts["duration"]

                files_payload = None
                if t.get("image_path"):
                    rel_img = t["image_path"].lstrip("/")
                    local_img = DATA_DIR / rel_img
                    if not local_img.exists():
                        raise SnapgenAPIError("Gambar referensi tidak ditemukan di server.", status_code=400)
                    mime_type = get_file_mime_from_disk(local_img)
                    with open(local_img, "rb") as f:
                        img_bytes = f.read()
                    # PRD A.2: Seedance & Kling use 'ref_images'; Veo & Grok use 'files'
                    file_field = "ref_images" if ("seedance" in endpoint or "kling" in endpoint) else "files"
                    files_payload = {file_field: (local_img.name, img_bytes, mime_type)}
                    # When sending files, httpx uses multipart
                    body_type = "multipart"

                attempt = 0
                resp = None
                while True:
                    attempt += 1
                    try:
                        await app_state.update_task_status(
                            task_id,
                            "generating",
                            task_retries=attempt - 1,
                            percobaan=attempt,
                        )
                        resp = await self.client.submit_task(endpoint, body_type, params, files_payload, api_key)
                        break
                    except Exception as sub_err:
                        if isinstance(sub_err, SnapgenAPIError) and sub_err.status_code == 429:
                            self.trigger_circuit_breaker(account_id)
                        if is_transient_error(sub_err) and attempt <= max_retries:
                            wait_s = backoff_base * (2 ** (attempt - 1))
                            logger.warning(
                                f"Transient submit error on task {task_id} (attempt {attempt}/{max_retries}): {sub_err}. "
                                f"Retrying in {wait_s}s..."
                            )
                            await asyncio.sleep(wait_s)
                            continue
                        raise sub_err

                uuid = resp.get("uuid")
                est_credit = resp.get("estimated_credit", est_credit)

                await app_state.update_task_status(
                    task_id,
                    "generating",
                    provider_job_id=uuid,
                    credit_estimated=est_credit,
                    provider_pct=resp.get("status_percentage", 5),
                )
            else:
                logger.info(f"Resuming polling for in-flight task {task_id} (provider_job_id={uuid}) without re-submitting")

            # STEP 2: Poll history until completed (status == 2), failed (status == 3), or timeout
            poll_interval = get_setting("POLL_INTERVAL_SEC", 10)
            completed_data = None
            poll_failures = 0

            while True:
                if time.time() - start_time > timeout_sec:
                    raise SnapgenAPIError(
                        f"Waktu pemrosesan video melebihi batas maksimal ({int(timeout_sec // 60)} menit).",
                        status_code=408,
                    )

                await asyncio.sleep(poll_interval)

                # Check if cancelled while polling
                cur_task = app_state.tasks.get(task_id)
                if cur_task and cur_task.get("status") in ("cancelled", "dibatalkan"):
                    return

                try:
                    history = await self.client.poll_history(uuid, api_key)
                    poll_failures = 0
                except Exception as poll_err:
                    if is_transient_error(poll_err) and poll_failures < max_retries:
                        poll_failures += 1
                        wait_s = backoff_base * (2 ** (poll_failures - 1))
                        logger.warning(
                            f"Transient poll error on task {task_id} ({poll_failures}/{max_retries}): {poll_err}"
                        )
                        await asyncio.sleep(wait_s)
                        continue
                    raise poll_err

                status_code = history.get("status")  # 1: generating, 2: completed, 3: failed
                pct = history.get("status_percentage", 15)

                await app_state.update_task_status(task_id, "generating", provider_pct=pct)

                if status_code == 2:
                    completed_data = history
                    break
                elif status_code == 3:
                    err_msg = history.get("error_message") or history.get("error_code") or "Provider generation failed"
                    # Provider reported status 3 (failed)
                    raise SnapgenAPIError(err_msg, status_code=422)

            # STEP 3: Download video/image to local storage
            await app_state.update_task_status(task_id, "downloading", provider_pct=99)
            media_type = t.get("media_type", "video")
            user_media_dir = DATA_DIR / (f"videos/{user_id}" if media_type == "video" else f"images/{user_id}")
            user_media_dir.mkdir(parents=True, exist_ok=True)

            ext = ".mp4" if media_type == "video" else ".png"
            dest_filename = f"{task_id}{ext}"
            dest_path = str(user_media_dir / dest_filename)

            download_url = ""
            if media_type == "video":
                v_list = completed_data.get("generated_video", [])
                if v_list:
                    download_url = v_list[0].get("video_url", "")
            else:
                img_list = completed_data.get("generated_image", [])
                if img_list:
                    download_url = img_list[0].get("file_download_url") or img_list[0].get("image_url", "")

            if not download_url:
                raise SnapgenAPIError("Hasil render tidak memiliki URL video yang dapat diunduh.", status_code=500)

            dl_attempt = 0
            while True:
                dl_attempt += 1
                try:
                    await self.client.download_file(download_url, dest_path)
                    break
                except Exception as dl_err:
                    if dl_attempt <= max_retries:
                        await asyncio.sleep(backoff_base * dl_attempt)
                        continue
                    raise dl_err

            gen_sec = round(time.time() - start_time, 1)
            used_credit = t.get("kr_biaya") or t.get("credit_cost") or completed_data.get("used_credit", est_credit)
            result_url = f"/{'videos' if media_type == 'video' else 'images'}/{user_id}/{dest_filename}"

            await app_state.update_task_status(
                task_id,
                "completed",
                result_url=result_url,
                credit_used=used_credit,
                provider_pct=100,
                finished_at=now().isoformat(),
                gen_sec=gen_sec,
            )
            await commit_task_credit(task_id)

            # Record behavior for learning/estimation
            try:
                if AsyncSessionLocal:
                    async def _record_behavior(session):
                        pb = PromptBehavior(
                            user_id=user_id,
                            division_id=self.division_id,
                            model_key=model_key,
                            prompt_len=len(t["prompt"]),
                            has_image=bool(t.get("image_path")),
                            result="completed",
                            gen_sec=gen_sec,
                            account_id=account_id,
                            created_at=now(),
                        )
                        session.add(pb)
                    db_writer.enqueue(_record_behavior)
            except Exception as ex:
                logger.warning(f"Failed to enqueue behavior log for {task_id}: {ex}")

        except asyncio.CancelledError:
            logger.info(f"Task {task_id} execution cancelled")
        except SnapgenAPIError as e:
            logger.error(f"Task {task_id} API error: {e}")
            friendly = humanize_provider_error(str(e), e.status_code)
            await self._handle_task_failure(task_id, friendly)
        except Exception as e:
            logger.error(f"Task {task_id} execution error: {e}", exc_info=True)
            friendly = humanize_provider_error(str(e), 500)
            await self._handle_task_failure(task_id, friendly)
        finally:
            self._release_account(account_id)
            self.active_polls.pop(task_id, None)
            async with app_state.lock:
                app_state.user_in_flight[user_id] = max(0, app_state.user_in_flight.get(user_id, 1) - 1)

    async def _handle_task_failure(self, task_id: str, error_message: str):
        cur = app_state.tasks.get(task_id)
        if cur and cur.get("status") in ("cancelled", "dibatalkan"):
            return
        await app_state.update_task_status(
            task_id,
            "failed",
            error=error_message,
            finished_at=now().isoformat(),
        )
        await refund_task_credit(task_id, alasan=f"Gagal render: {error_message}")
        await refund_quota(task_id)

    def _release_account(self, account_id: str):
        self.inflight_per_account[account_id] = max(0, self.inflight_per_account.get(account_id, 1) - 1)


# Global registry of active division workers
division_workers: Dict[str, DivisionWorker] = {}


def get_or_create_worker(division_id: str) -> DivisionWorker:
    if division_id not in division_workers:
        worker = DivisionWorker(division_id)
        worker.start()
        division_workers[division_id] = worker
    return division_workers[division_id]


async def stop_all_workers():
    for w in list(division_workers.values()):
        await w.stop()
    division_workers.clear()


async def recover_unfinished_tasks_on_startup():
    """
    On backend startup/restart:
    1. Tasks in 'generating'/'downloading'/'memproses' WITH provider_job_id -> resume polling directly
       without re-submitting (so KR is never charged twice).
    2. Tasks in 'queued'/'antre' (or 'generating' without provider_job_id) -> re-enqueue to division queue
       and start worker.
    """
    if not AsyncSessionLocal:
        return

    async with AsyncSessionLocal() as session:
        stmt = (
            select(Task)
            .where(Task.status.in_(["queued", "antre", "generating", "downloading", "memproses"]))
            .order_by(Task.created_at.asc(), Task.urutan.asc())
        )
        unfinished = (await session.execute(stmt)).scalars().all()

    if not unfinished:
        return

    logger.info(f"Recovering {len(unfinished)} unfinished tasks from database after restart...")

    for t_obj in unfinished:
        t_dict = {
            "task_id": t_obj.task_id,
            "user_id": t_obj.user_id,
            "division_id": t_obj.division_id,
            "batch_id": t_obj.batch_id,
            "urutan": t_obj.urutan,
            "status": t_obj.status,
            "prompt": t_obj.prompt,
            "image_path": t_obj.image_path,
            "model_key": t_obj.model_key,
            "media_type": t_obj.media_type,
            "options": json.loads(t_obj.options_json) if t_obj.options_json else {},
            "credit_cost": t_obj.credit_cost,
            "kr_biaya": t_obj.kr_biaya or t_obj.credit_cost,
            "provider_job_id": t_obj.provider_job_id,
            "provider_pct": t_obj.provider_pct,
            "est_seconds": t_obj.est_seconds,
            "task_retries": t_obj.task_retries or 0,
        }
        app_state.tasks[t_obj.task_id] = t_dict
        worker = get_or_create_worker(t_obj.division_id)

        if t_obj.status in ("generating", "downloading", "memproses") and t_obj.provider_job_id:
            account = await worker.get_available_account()
            account_id = account["id"] if account else (t_obj.account_id or "default")
            api_key = account["api_key"] if account else ""
            worker.inflight_per_account[account_id] = worker.inflight_per_account.get(account_id, 0) + 1
            app_state.user_in_flight[t_obj.user_id] = app_state.user_in_flight.get(t_obj.user_id, 0) + 1
            bg = asyncio.create_task(
                worker._process_task(t_obj.task_id, account_id, api_key, resume_only=True)
            )
            worker.active_polls[t_obj.task_id] = bg
        else:
            # Ensure status is queued and place in division queue
            if t_obj.status != "queued":
                await app_state.update_task_status(t_obj.task_id, "queued")
            async with app_state.lock:
                q = app_state.division_queues.setdefault(t_obj.division_id, [])
                if t_obj.task_id not in q:
                    q.append(t_obj.task_id)
