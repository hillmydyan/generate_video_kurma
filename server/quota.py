import logging
from datetime import datetime, timedelta
from typing import Dict, Any, Tuple
from sqlalchemy import select, func, and_
from server.db import AsyncSessionLocal, QuotaUsage, Division
from server.config import get_setting
from config.clock import now

logger = logging.getLogger("snapgen.quota")


def period_start(window_days: int = 1, at: datetime | None = None) -> datetime:
    """Awal periode kuota: 00:00 WIB hari ini, mundur (window_days - 1) hari."""
    ref = at or now()
    midnight = ref.replace(hour=0, minute=0, second=0, microsecond=0)
    return midnight - timedelta(days=max(1, int(window_days or 1)) - 1)

async def get_user_quota_status(user_id: str, division_id: str) -> Dict[str, Any]:
    """Kuota user per periode harian (reset 00:00 WIB)."""
    window_days = get_setting("USER_QUOTA_WINDOW_DAYS", 1)
    limit = get_setting("USER_QUOTA_OUTPUTS", 35)
    retention_days = get_setting("HISTORY_RETENTION_DAYS", 3)

    if AsyncSessionLocal:
        async with AsyncSessionLocal() as session:
            # Check division override
            div = await session.get(Division, division_id)
            if div:
                if div.quota_outputs is not None:
                    limit = div.quota_outputs
                if div.quota_window_days is not None:
                    window_days = div.quota_window_days

            # Reset harian jam 00:00 WIB (bukan jendela 24 jam bergulir).
            # window_days > 1: periode = hari ini + (window_days - 1) hari sebelumnya.
            cutoff = period_start(window_days)
            # Count consumed outputs in window
            stmt = (
                select(func.count(QuotaUsage.task_id))
                .where(and_(QuotaUsage.user_id == user_id, QuotaUsage.created_at >= cutoff))
            )
            result = await session.execute(stmt)
            used = result.scalar() or 0

            # Kuota kembali penuh di awal periode berikutnya (00:00 WIB).
            next_free_at = (cutoff + timedelta(days=max(1, window_days))).isoformat() if used else None
    else:
        used = 0
        next_free_at = None

    remaining = max(0, limit - used) if limit > 0 else 999999

    return {
        "used": used,
        "limit": limit,
        "remaining": remaining,
        "window_days": window_days,
        "next_free_at": next_free_at,
        "retention_days": retention_days,
    }

async def consume_quota(user_id: str, task_ids: list[str], credits: int = 1):
    if not AsyncSessionLocal:
        return
    async with AsyncSessionLocal() as session:
        async with session.begin():
            for tid in task_ids:
                q = QuotaUsage(
                    task_id=tid,
                    user_id=user_id,
                    credits=credits,
                    created_at=now()
                )
                session.add(q)

async def refund_quota(task_id: str):
    if not AsyncSessionLocal:
        return
    async with AsyncSessionLocal() as session:
        async with session.begin():
            stmt = select(QuotaUsage).where(QuotaUsage.task_id == task_id)
            res = await session.execute(stmt)
            entry = res.scalar_one_or_none()
            if entry:
                await session.delete(entry)
                logger.info(f"Refunded quota for failed task: {task_id}")

