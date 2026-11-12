import asyncio
import os
import time
import logging
from datetime import datetime, timedelta
from typing import Dict, Any, Optional
from sqlalchemy import select, update
from server.config import get_setting, DATA_DIR
from server.db import AsyncSessionLocal, ProviderAccount, Task, PromptBehavior
from server.db_writer import db_writer
from server.crypto import decrypt_api_key
from server.client import SnapgenClient, SnapgenAPIError
from server.state import app_state
from server.quota import refund_quota
from config.clock import now

logger = logging.getLogger("snapgen.worker")

class DivisionWorker:
    def __init__(self, division_id: str):
        self.division_id = division_id
        self.client = SnapgenClient()
        self.running = False
        self._task: Optional[asyncio.Task] = None
        # Track inflight jobs per account: account_id -> count
        self.inflight_per_account: Dict[str, int] = {}
        # Track active polling tasks: task_id -> asyncio.Task
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
        for p in self.active_polls.values():
            p.cancel()

    async def get_available_account(self) -> Optional[Dict[str, Any]]:
        """
        Get primary account if healthy & has capacity, else secondary if available.
        Key is strictly isolated per division (PRD §5).
        """
        max_inflight = get_setting("MAX_INFLIGHT_PER_ACCOUNT", 2)
        if not AsyncSessionLocal:
            return None

        async with AsyncSessionLocal() as session:
            stmt = (
                select(ProviderAccount)
                .where(ProviderAccount.division_id == self.division_id)
                .order_by(ProviderAccount.slot.asc())  # 'primary' comes before 'secondary'
            )
            res = await session.execute(stmt)
            accounts = res.scalars().all()

        if not accounts:
            return None

        # Check breaker status
        current_time = now()
        for acc in accounts:
            if acc.status in ("disabled", "expired", "depleted"):
                continue

            # Check circuit breaker
            breaker_until = app_state.circuit_breakers.get(acc.id)
            if breaker_until and current_time < breaker_until:
                continue

            # Check capacity
            active_count = self.inflight_per_account.get(acc.id, 0)
            if active_count < max_inflight:
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
                # 1. Fetch next task from queue in round-robin fashion
                task_id = await self._dequeue_next_task()
                if not task_id:
                    await asyncio.sleep(1.0)
                    continue

                # 2. Get available account for this division
                account = await self.get_available_account()
                if not account:
                    # No available account right now; requeue task and pause
                    async with app_state.lock:
                        q = app_state.division_queues.setdefault(self.division_id, [])
                        if task_id not in q:
                            q.insert(0, task_id)
                    await asyncio.sleep(3.0)
                    continue

                # 3. Submit task to provider
                account_id = account["id"]
                api_key = account["api_key"]
                self.inflight_per_account[account_id] = self.inflight_per_account.get(account_id, 0) + 1

                # Start execution asynchronously so other tasks can proceed
                asyncio.create_task(self._process_task(task_id, account_id, api_key))

                # Rate gap between submits
                submit_gap = get_setting("SUBMIT_GAP_SEC", 2)
                await asyncio.sleep(submit_gap)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in worker loop ({self.division_id}): {e}", exc_info=True)
                await asyncio.sleep(2.0)

    async def _dequeue_next_task(self) -> Optional[str]:
        """Round-robin fair scheduling across users in this division."""
        async with app_state.lock:
            q = app_state.division_queues.get(self.division_id, [])
            if not q:
                return None

            # Group queue items by user_id
            user_tasks: Dict[str, List[str]] = {}
            for tid in q:
                t = app_state.tasks.get(tid)
                if t:
                    user_tasks.setdefault(t["user_id"], []).append(tid)

            if not user_tasks:
                return None

            # Pick user with lowest in-flight count
            chosen_user = min(user_tasks.keys(), key=lambda uid: app_state.user_in_flight.get(uid, 0))
            chosen_task_id = user_tasks[chosen_user][0]
            q.remove(chosen_task_id)

            app_state.user_in_flight[chosen_user] = app_state.user_in_flight.get(chosen_user, 0) + 1
            return chosen_task_id

    async def _process_task(self, task_id: str, account_id: str, api_key: str):
        t = app_state.tasks.get(task_id)
        if not t:
            if AsyncSessionLocal:
                try:
                    import json
                    async with AsyncSessionLocal() as session:
                        task_obj = await session.get(Task, task_id)
                        if task_obj:
                            t = {
                                "task_id": task_obj.task_id,
                                "user_id": task_obj.user_id,
                                "division_id": task_obj.division_id,
                                "status": task_obj.status,
                                "prompt": task_obj.prompt,
                                "image_path": task_obj.image_path,
                                "model_key": task_obj.model_key,
                                "media_type": task_obj.media_type,
                                "options": json.loads(task_obj.options_json) if task_obj.options_json else {},
                                "credit_cost": task_obj.credit_cost,
                                "est_seconds": task_obj.est_seconds,
                            }
                            app_state.tasks[task_id] = t
                except Exception as ex:
                    logger.warning(f"Could not load task {task_id} from DB: {ex}")

        if not t:
            self._release_account(account_id)
            return

        user_id = t["user_id"]
        model_key = t["model_key"]
        app_state.load_catalog()
        model = app_state.get_model(model_key)
        start_time = time.time()

        try:
            await app_state.update_task_status(
                task_id,
                "generating",
                account_id=account_id,
                started_at=now().isoformat()
            )

            # Prepare parameters
            endpoint = model.get("endpoint", "/uapi/v1/video-gen/veo") if model else "/uapi/v1/video-gen/veo"
            body_type = model.get("body", "multipart") if model else "multipart"
            provider_params = dict(model.get("provider_params", {})) if model else {}

            params = {
                "prompt": t["prompt"],
                "model": model.get("provider_model_id", "veo-3.1-fast") if model else "veo-3.1-fast",
                **provider_params
            }
            # Add options
            opts = t.get("options", {})
            if "aspect" in opts:
                aspect = opts["aspect"]
                # Grok mapping as per PRD: 9:16 -> portrait, 16:9 -> landscape, 1:1 -> square
                if "grok" in model_key:
                    aspect_map = {"9:16": "portrait", "16:9": "landscape", "1:1": "square"}
                    params["aspect_ratio"] = aspect_map.get(aspect, aspect)
                    params["orientation"] = aspect_map.get(aspect, aspect)
                else:
                    params["aspect_ratio"] = aspect
            if "duration" in opts and opts["duration"]:
                params["duration"] = opts["duration"]

            files = None
            if t.get("image_path"):
                local_img = DATA_DIR / t["image_path"]
                if local_img.exists():
                    files = {"files": (local_img.name, open(local_img, "rb"), "image/jpeg")}

            # Submit to SnapGen
            resp = await self.client.submit_task(endpoint, body_type, params, files, api_key)
            uuid = resp.get("uuid")
            est_credit = resp.get("estimated_credit", t.get("credit_cost", 0))

            await app_state.update_task_status(
                task_id,
                "generating",
                provider_job_id=uuid,
                credit_estimated=est_credit,
                provider_pct=resp.get("status_percentage", 1)
            )
            await self._sync_account_credits(account_id, api_key, increment_output=False)

            # Start polling loop
            poll_interval = get_setting("POLL_INTERVAL_SEC", 10)
            completed_data = None

            while True:
                await asyncio.sleep(poll_interval)
                history = await self.client.poll_history(uuid, api_key)
                status_code = history.get("status")  # 1: generating, 2: completed, 3: failed
                pct = history.get("status_percentage", 1)

                await app_state.update_task_status(task_id, "generating", provider_pct=pct)

                if status_code == 2:
                    completed_data = history
                    break
                elif status_code == 3:
                    err_msg = history.get("error_message") or "Provider generation failed"
                    raise SnapgenAPIError(err_msg, status_code=500)

            # Download asset
            await app_state.update_task_status(task_id, "downloading")
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
                raise SnapgenAPIError("Completed task has no downloadable URL")

            await self.client.download_file(download_url, dest_path)
            gen_sec = round(time.time() - start_time, 1)
            used_credit = completed_data.get("used_credit", est_credit)
            result_url = f"/{'videos' if media_type == 'video' else 'images'}/{user_id}/{dest_filename}"

            await app_state.update_task_status(
                task_id,
                "completed",
                result_url=result_url,
                credit_used=used_credit,
                provider_pct=100,
                finished_at=now().isoformat(),
                gen_sec=gen_sec
            )
            await self._sync_account_credits(account_id, api_key, increment_output=True)

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
                            created_at=now()
                        )
                        session.add(pb)
                    db_writer.enqueue(_record_behavior)
            except Exception as ex:
                logger.warning(f"Failed to enqueue behavior log for {task_id}: {ex}")

        except SnapgenAPIError as e:
            logger.error(f"Task {task_id} API error: {e}")
            if e.status_code == 429:
                self.trigger_circuit_breaker(account_id)
            await self._handle_task_failure(task_id, str(e))
        except Exception as e:
            logger.error(f"Task {task_id} execution error: {e}", exc_info=True)
            await self._handle_task_failure(task_id, str(e))
        finally:
            self._release_account(account_id)
            async with app_state.lock:
                app_state.user_in_flight[user_id] = max(0, app_state.user_in_flight.get(user_id, 1) - 1)

    async def _sync_account_credits(self, account_id: str, api_key: str, increment_output: bool = False):
        """Fetch live credit balance from SnapGen and update cached DB record."""
        try:
            info = await self.client.get_account(api_key)
            avail = info.get("user_credit", {}).get("available_credit")
            if avail is not None and AsyncSessionLocal:
                async with AsyncSessionLocal() as session:
                    acc = await session.get(ProviderAccount, account_id)
                    if acc:
                        acc.credits_cached = int(avail)
                        acc.credits_checked_at = now()
                        acc.last_used_at = now()
                        if increment_output:
                            acc.outputs_today = (acc.outputs_today or 0) + 1
                            acc.outputs_total = (acc.outputs_total or 0) + 1
                        floor = get_setting("CREDIT_BALANCE_FLOOR", 300)
                        if avail <= 0:
                            acc.status = "depleted"
                        elif avail < floor:
                            acc.status = "credits_low"
                        elif acc.status in ("credits_low", "depleted"):
                            acc.status = "active"
                        await session.commit()
        except Exception as ex:
            logger.warning(f"Failed to sync credits for account {account_id}: {ex}")

    async def _handle_task_failure(self, task_id: str, error_message: str):
        await app_state.update_task_status(
            task_id,
            "failed",
            error=error_message,
            finished_at=now().isoformat()
        )
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

