import asyncio
import logging
from typing import List, Optional, Tuple
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from server.db import AsyncSessionLocal, ProviderAccount, Batch, Task, CreditLog
from config.clock import now

logger = logging.getLogger("snapgen.credits")

class LoopAwareLock:
    """Async lock that rebinds automatically when the running event loop changes (Python 3.10 compatibility)."""
    def __init__(self):
        self._lock: Optional[asyncio.Lock] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def _get(self) -> asyncio.Lock:
        loop = asyncio.get_running_loop()
        if self._lock is None or self._loop is not loop:
            self._lock = asyncio.Lock()
            self._loop = loop
        return self._lock

    async def __aenter__(self):
        return await self._get().__aenter__()

    async def __aexit__(self, exc_type, exc, tb):
        return await self._get().__aexit__(exc_type, exc, tb)


# Process-wide lock to serialize credit checks, reservations, commits, and refunds
credit_lock = LoopAwareLock()


def map_task_status_id(raw_status: str) -> str:
    """Map internal task status to Indonesian batch_tasks status."""
    mapping = {
        "queued": "antre",
        "antre": "antre",
        "generating": "memproses",
        "downloading": "memproses",
        "memproses": "memproses",
        "completed": "selesai",
        "selesai": "selesai",
        "failed": "gagal",
        "gagal": "gagal",
        "cancelled": "dibatalkan",
        "dibatalkan": "dibatalkan",
    }
    return mapping.get(raw_status, raw_status)


async def get_division_accounts(session: AsyncSession, kantor_id: str) -> List[ProviderAccount]:
    stmt = (
        select(ProviderAccount)
        .where(ProviderAccount.division_id == kantor_id)
        .order_by(ProviderAccount.slot.asc())
    )
    res = await session.execute(stmt)
    return [a for a in res.scalars().all() if a.status not in ("disabled", "expired")]


async def get_kantor_available_kr(session: AsyncSession, kantor_id: str) -> int:
    accounts = await get_division_accounts(session, kantor_id)
    return sum(max(0, a.credits_cached or 0) for a in accounts)


async def reserve_credits_in_session(
    session: AsyncSession,
    user_id: str,
    kantor_id: str,
    batch_id: Optional[str],
    task_id: Optional[str],
    amount_kr: int,
    alasan: str,
) -> int:
    """
    Deducts amount_kr from credits_cached and adds to credits_reserved inside an active session.
    Raises HTTPException(400) if balance is insufficient.
    Returns remaining available balance after reservation.
    """
    accounts = await get_division_accounts(session, kantor_id)
    total_avail = sum(max(0, a.credits_cached or 0) for a in accounts)

    if total_avail < amount_kr:
        raise HTTPException(
            status_code=400,
            detail=f"Saldo KR kurang: butuh {amount_kr}, tersisa {total_avail}"
        )

    if amount_kr > 0 and accounts:
        remaining_to_deduct = amount_kr
        for acc in accounts:
            avail = max(0, acc.credits_cached or 0)
            if avail <= 0:
                continue
            take = min(avail, remaining_to_deduct)
            acc.credits_cached = avail - take
            acc.credits_reserved = (acc.credits_reserved or 0) + take
            remaining_to_deduct -= take
            if remaining_to_deduct <= 0:
                break

    new_balance = sum(max(0, a.credits_cached or 0) for a in accounts)
    log_entry = CreditLog(
        user_id=user_id,
        kantor_id=kantor_id,
        batch_id=batch_id,
        task_id=task_id,
        delta_kr=-amount_kr,
        balance_after=new_balance,
        alasan=alasan,
        created_at=now(),
    )
    session.add(log_entry)
    logger.info(
        f"[KR RESERVE] user={user_id} kantor={kantor_id} batch={batch_id} task={task_id} "
        f"delta=-{amount_kr} balance_after={new_balance} alasan={alasan}"
    )
    return new_balance


async def commit_task_credit(task_id: str) -> None:
    """Finalize reserved KR when a task completes."""
    if not AsyncSessionLocal:
        return
    async with credit_lock:
        async with AsyncSessionLocal() as session:
            async with session.begin():
                t = await session.get(Task, task_id)
                if not t:
                    return
                reserved = t.kr_reserved or 0
                cost = t.kr_biaya or t.credit_cost or reserved
                t.credit_used = cost
                t.kr_reserved = 0

                if reserved > 0:
                    accounts = await get_division_accounts(session, t.division_id)
                    target_acc = None
                    if t.account_id:
                        target_acc = next((a for a in accounts if a.id == t.account_id), None)
                    if not target_acc and accounts:
                        target_acc = accounts[0]
                    if target_acc:
                        target_acc.credits_reserved = max(0, (target_acc.credits_reserved or 0) - reserved)

                    balance_after = sum(max(0, a.credits_cached or 0) for a in accounts)
                    session.add(
                        CreditLog(
                            user_id=t.user_id,
                            kantor_id=t.division_id,
                            batch_id=t.batch_id,
                            task_id=t.task_id,
                            delta_kr=0,
                            balance_after=balance_after,
                            alasan=f"Potong tetap {cost} KR (tugas #{t.urutan} selesai)",
                            created_at=now(),
                        )
                    )
                    logger.info(
                        f"[KR COMMIT] user={t.user_id} kantor={t.division_id} batch={t.batch_id} "
                        f"task={t.task_id} committed={cost} balance_after={balance_after}"
                    )

                if t.batch_id:
                    await recalculate_batch_status_in_session(session, t.batch_id)


async def refund_task_credit(task_id: str, alasan: str = "Tugas gagal atau dibatalkan") -> int:
    """Refund reserved KR back to the kantor account when a task fails or is cancelled."""
    if not AsyncSessionLocal:
        return 0
    async with credit_lock:
        async with AsyncSessionLocal() as session:
            async with session.begin():
                t = await session.get(Task, task_id)
                if not t:
                    return 0
                reserved = t.kr_reserved or 0
                t.kr_reserved = 0
                t.credit_used = 0

                if reserved > 0:
                    stmt = (
                        select(ProviderAccount)
                        .where(ProviderAccount.division_id == t.division_id)
                        .order_by(ProviderAccount.slot.asc())
                    )
                    accounts = (await session.execute(stmt)).scalars().all()
                    target_acc = None
                    if t.account_id:
                        target_acc = next((a for a in accounts if a.id == t.account_id), None)
                    if not target_acc and accounts:
                        target_acc = accounts[0]

                    if target_acc:
                        target_acc.credits_cached = (target_acc.credits_cached or 0) + reserved
                        target_acc.credits_reserved = max(0, (target_acc.credits_reserved or 0) - reserved)
                        if target_acc.credits_cached > 0 and target_acc.status == "depleted":
                            target_acc.status = "active"

                    if t.batch_id:
                        batch = await session.get(Batch, t.batch_id)
                        if batch:
                            batch.total_kr = max(0, (batch.total_kr or 0) - reserved)

                    balance_after = sum(
                        max(0, a.credits_cached or 0)
                        for a in accounts
                        if a.status not in ("disabled", "expired")
                    )
                    session.add(
                        CreditLog(
                            user_id=t.user_id,
                            kantor_id=t.division_id,
                            batch_id=t.batch_id,
                            task_id=t.task_id,
                            delta_kr=reserved,
                            balance_after=balance_after,
                            alasan=f"Kembalikan {reserved} KR: {alasan}",
                            created_at=now(),
                        )
                    )
                    logger.info(
                        f"[KR REFUND] user={t.user_id} kantor={t.division_id} batch={t.batch_id} "
                        f"task={t.task_id} refund=+{reserved} balance_after={balance_after} alasan={alasan}"
                    )

                if t.batch_id:
                    await recalculate_batch_status_in_session(session, t.batch_id)

                return reserved


async def recalculate_batch_status_in_session(session: AsyncSession, batch_id: str) -> Optional[str]:
    """Recompute Batch.status based on its tasks' current statuses."""
    batch = await session.get(Batch, batch_id)
    if not batch:
        return None

    stmt = select(Task).where(Task.batch_id == batch_id).order_by(Task.urutan.asc())
    tasks = (await session.execute(stmt)).scalars().all()
    if not tasks:
        return batch.status

    statuses = [map_task_status_id(t.status) for t in tasks]
    if any(s in ("antre", "memproses") for s in statuses):
        batch.status = "berjalan"
        batch.finished_at = None
    else:
        selesai_cnt = sum(1 for s in statuses if s == "selesai")
        gagal_cnt = sum(1 for s in statuses if s == "gagal")
        batal_cnt = sum(1 for s in statuses if s == "dibatalkan")

        if selesai_cnt == len(statuses):
            batch.status = "selesai"
        elif gagal_cnt == 0 and batal_cnt > 0:
            batch.status = "dibatalkan"
        else:
            batch.status = "sebagian_gagal"

        if not batch.finished_at:
            batch.finished_at = now()

    # Sync total_kr = sum of kr_biaya for non-failed/non-cancelled tasks (or reserved + used)
    active_or_done_kr = sum(
        (t.kr_biaya or t.credit_cost or 0)
        for t in tasks
        if map_task_status_id(t.status) in ("antre", "memproses", "selesai")
    )
    batch.total_kr = active_or_done_kr
    return batch.status
