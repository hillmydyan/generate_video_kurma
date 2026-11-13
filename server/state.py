import asyncio
import statistics
import logging
from typing import Dict, List, Any, Optional
from datetime import datetime, timedelta
from sqlalchemy import select, update
from server.config import (
    load_models_catalog, save_models_catalog, get_setting, DATA_DIR
)
from server.crypto import decrypt_api_key, mask_api_key
from server.db import AsyncSessionLocal, User, Division, ProviderAccount, Task, PromptBehavior, QuotaUsage, FactoryBatch
from server.sse import sse_broker
from server.credits import LoopAwareLock
from config.clock import now

logger = logging.getLogger("snapgen.state")

class AppState:
    def __init__(self):
        self.models: List[Dict[str, Any]] = []
        # In-memory task registry: task_id -> task dict
        self.tasks: Dict[str, Dict[str, Any]] = {}
        # Division queues: division_id -> list of queued task_ids
        self.division_queues: Dict[str, List[str]] = {}
        # User in-flight tracking for round-robin
        self.user_in_flight: Dict[str, int] = {}
        # Last served user index per division for strict round-robin fairness
        self.last_user_per_division: Dict[str, str] = {}
        # Lock for thread-safety across async tasks
        self.lock = LoopAwareLock()
        # Circuit breakers: account_id -> datetime until blocked
        self.circuit_breakers: Dict[str, datetime] = {}
        self.breaker_consecutive_429: Dict[str, int] = {}

    def load_catalog(self):
        self.models = load_models_catalog()
        logger.info(f"Loaded {len(self.models)} models into catalog")

    def get_model(self, model_key: str) -> Optional[Dict[str, Any]]:
        for m in self.models:
            if m.get("key") == model_key:
                return m
        return None

    def get_effective_est_seconds(self, model_key: str) -> int:
        """Calculate effective estimate from median of last 20 completed tasks (PRD §4)."""
        model = self.get_model(model_key)
        fallback = model.get("est_seconds", 180) if model else 180

        completed = [
            t.get("gen_sec")
            for t in self.tasks.values()
            if t.get("model_key") == model_key
            and t.get("status") == "completed"
            and t.get("gen_sec", 0) > 0
        ]
        if len(completed) >= 5:
            recent = completed[-20:]
            return int(statistics.median(recent))
        return fallback

    def get_models_for_division(self, allowed_models: List[str], is_super_admin: bool = False) -> List[Dict[str, Any]]:
        """Filter enabled models allowed for a division (PRD §3.4)."""
        result = []
        for m in self.models:
            if not m.get("enabled", True):
                continue
            key = m.get("key")
            if is_super_admin or not allowed_models or key in allowed_models:
                m_copy = dict(m)
                m_copy["est_seconds"] = self.get_effective_est_seconds(key)
                result.append(m_copy)
        return result

    async def update_task_status(self, task_id: str, new_status: str, **kwargs):
        """Update task in memory, persist synchronously to DB, and broadcast via SSE."""
        # Mirror alias fields between legacy Task and batch_tasks columns
        if "provider_pct" in kwargs and "progress" not in kwargs:
            kwargs["progress"] = kwargs["provider_pct"]
        elif "progress" in kwargs and "provider_pct" not in kwargs:
            kwargs["provider_pct"] = kwargs["progress"]

        if "result_url" in kwargs and "video_path" not in kwargs:
            kwargs["video_path"] = kwargs["result_url"]
        elif "video_path" in kwargs and "result_url" not in kwargs:
            kwargs["result_url"] = kwargs["video_path"]

        if "error" in kwargs and "error_message" not in kwargs:
            kwargs["error_message"] = kwargs["error"]
        elif "error_message" in kwargs and "error" not in kwargs:
            kwargs["error"] = kwargs["error_message"]

        if "task_retries" in kwargs and "percobaan" not in kwargs:
            kwargs["percobaan"] = kwargs["task_retries"]
        elif "percobaan" in kwargs and "task_retries" not in kwargs:
            kwargs["task_retries"] = kwargs["percobaan"]

        async with self.lock:
            task = self.tasks.get(task_id)
            if task:
                task["status"] = new_status
                task["updated_at"] = now().isoformat()
                for k, v in kwargs.items():
                    task[k] = v

        # Persist directly to DB so queries immediately see updated status
        if AsyncSessionLocal:
            try:
                async with AsyncSessionLocal() as session:
                    async with session.begin():
                        db_values = {}
                        for k, v in kwargs.items():
                            if hasattr(Task, k):
                                if k in ("started_at", "finished_at", "created_at", "updated_at", "requeued_at", "provider_expired_at") and isinstance(v, str):
                                    try:
                                        v = datetime.fromisoformat(v)
                                    except Exception:
                                        v = now()
                                db_values[k] = v

                        stmt = (
                            update(Task)
                            .where(Task.task_id == task_id)
                            .values(
                                status=new_status,
                                updated_at=now(),
                                **db_values
                            )
                        )
                        await session.execute(stmt)
            except Exception as ex:
                logger.error(f"Failed to persist task status for {task_id}: {ex}")

        if task:
            await sse_broker.broadcast_user(task["user_id"], "task_update", task)
            await sse_broker.broadcast_admin("task_update", task)

app_state = AppState()
