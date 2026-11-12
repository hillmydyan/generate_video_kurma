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
from server.db import User, Division, ProviderAccount, Task, PromptBehavior, QuotaUsage, FactoryBatch
from server.db_writer import db_writer
from server.sse import sse_broker
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
        # Lock for thread-safety across async tasks
        self.lock = asyncio.Lock()
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
        """Update task in memory, broadcast via SSE, and enqueue DB write."""
        async with self.lock:
            task = self.tasks.get(task_id)
            if task:
                task["status"] = new_status
                task["updated_at"] = now().isoformat()
                for k, v in kwargs.items():
                    task[k] = v

        if task:
            # Broadcast update to user
            await sse_broker.broadcast_user(task["user_id"], "task_update", task)
            # Broadcast to admins
            await sse_broker.broadcast_admin("task_update", task)

        # Enqueue async DB write regardless of whether task was cached in memory
        async def _write(session):
            stmt = (
                update(Task)
                .where(Task.task_id == task_id)
                .values(
                    status=new_status,
                    updated_at=now(),
                    **{k: v for k, v in kwargs.items() if hasattr(Task, k)}
                )
            )
            await session.execute(stmt)

        db_writer.enqueue(_write)

app_state = AppState()

