"""Admin Monitoring (/api/admin/monitoring).

Reads the existing `tasks` table only (Studio = batch_id NULL, Pabrik = batch_id set);
no extra bookkeeping. 1 task row = 1 requested video, and "Coba lagi" reuses the same
row, so counts always reflect the final status. All aggregates run in SQL.

Access: SUPER_ADMIN sees every kantor, DIVISION_ADMIN only its own kantor,
other roles get 403. Kantor is taken from users.division_id so the summary
cards and the per-user table always describe the same set of rows.
"""
import csv
import io
import math
from datetime import datetime, timedelta, date
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, case, func, literal, or_, select
from sqlalchemy.sql.elements import ColumnElement

from config.clock import now
from server.db import AsyncSessionLocal, Division, Task, User
from server.dependencies import get_current_user

router = APIRouter(prefix="/api/admin/monitoring", tags=["admin-monitoring"])

ADMIN_ROLES = ("SUPER_ADMIN", "DIVISION_ADMIN")

STATUS_BERHASIL = ("completed", "selesai")
STATUS_GAGAL = ("failed", "gagal")
STATUS_BERJALAN = ("queued", "generating", "downloading", "antre", "memproses")
STATUS_DIBATALKAN = ("cancelled", "dibatalkan")

STATUS_FILTERS = {
    "berhasil": STATUS_BERHASIL,
    "gagal": STATUS_GAGAL,
    "berjalan": STATUS_BERJALAN,
    "dibatalkan": STATUS_DIBATALKAN,
}

MAX_RANGE_DAYS = 366


# --------------------------------------------------------------------------- access

async def require_monitoring_admin(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Monitoring answers 403 (not the 404 used by older admin endpoints)."""
    if user["role"] not in ADMIN_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Akses monitoring hanya untuk admin.")
    return user


def _scope_kantor(admin: Dict[str, Any], kantor: Optional[str]) -> Optional[str]:
    """Return the kantor id to filter on (None = all kantor, super admin only)."""
    kantor = (kantor or "").strip() or None
    if admin["role"] == "SUPER_ADMIN":
        return kantor
    own = admin["division_id"]
    if kantor and kantor != own:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin kantor hanya dapat melihat kantornya sendiri.")
    return own


# --------------------------------------------------------------------------- filters

def _date_range(rentang: str, mulai: Optional[str], sampai: Optional[str]) -> Tuple[datetime, datetime]:
    """Return [start, end) as naive WIB datetimes (tasks.created_at is naive WIB)."""
    today = now().date()
    if rentang == "hari_ini":
        start_d, end_d = today, today
    elif rentang == "7_hari":
        start_d, end_d = today - timedelta(days=6), today
    elif rentang == "30_hari":
        start_d, end_d = today - timedelta(days=29), today
    elif rentang == "kustom":
        try:
            start_d = date.fromisoformat(mulai) if mulai else today
            end_d = date.fromisoformat(sampai) if sampai else start_d
        except ValueError:
            raise HTTPException(status_code=400, detail="Format tanggal harus YYYY-MM-DD.")
        if end_d < start_d:
            raise HTTPException(status_code=400, detail="Tanggal akhir harus setelah tanggal mulai.")
        if (end_d - start_d).days + 1 > MAX_RANGE_DAYS:
            raise HTTPException(status_code=400, detail=f"Rentang maksimal {MAX_RANGE_DAYS} hari.")
    else:
        raise HTTPException(status_code=400, detail="Rentang tidak dikenal.")
    start = datetime.combine(start_d, datetime.min.time())
    end = datetime.combine(end_d + timedelta(days=1), datetime.min.time())
    return start, end


class Filters:
    def __init__(
        self,
        admin: Dict[str, Any],
        rentang: str,
        mulai: Optional[str],
        sampai: Optional[str],
        kantor: Optional[str],
        sumber: Optional[str],
        q: Optional[str],
    ):
        self.start, self.end = _date_range(rentang, mulai, sampai)
        self.rentang = rentang
        self.kantor = _scope_kantor(admin, kantor)
        sumber = (sumber or "").strip().lower() or None
        if sumber not in (None, "studio", "pabrik"):
            raise HTTPException(status_code=400, detail="Sumber harus studio atau pabrik.")
        self.sumber = sumber
        self.q = (q or "").strip() or None

    def task_conditions(self) -> List[ColumnElement]:
        conds: List[ColumnElement] = [Task.created_at >= self.start, Task.created_at < self.end]
        if self.sumber == "studio":
            conds.append(Task.batch_id.is_(None))
        elif self.sumber == "pabrik":
            conds.append(Task.batch_id.is_not(None))
        return conds

    def user_conditions(self) -> List[ColumnElement]:
        conds: List[ColumnElement] = []
        if self.kantor:
            conds.append(User.division_id == self.kantor)
        if self.q:
            pat = f"%{self.q.lower()}%"
            conds.append(or_(func.lower(User.name).like(pat), func.lower(User.id).like(pat)))
        return conds

    def describe(self) -> Dict[str, Any]:
        return {
            "rentang": self.rentang,
            "mulai": self.start.date().isoformat(),
            "sampai": (self.end - timedelta(days=1)).date().isoformat(),
            "kantor": self.kantor,
            "sumber": self.sumber,
            "q": self.q,
        }


def get_filters(
    admin: Dict[str, Any] = Depends(require_monitoring_admin),
    rentang: str = Query("hari_ini", description="hari_ini | 7_hari | 30_hari | kustom"),
    mulai: Optional[str] = Query(None, description="YYYY-MM-DD (kustom)"),
    sampai: Optional[str] = Query(None, description="YYYY-MM-DD (kustom)"),
    kantor: Optional[str] = Query(None),
    sumber: Optional[str] = Query(None, description="studio | pabrik"),
    q: Optional[str] = Query(None, description="cari nama user"),
) -> Filters:
    return Filters(admin, rentang, mulai, sampai, kantor, sumber, q)


# --------------------------------------------------------------------------- SQL pieces

def _count_in(statuses: Tuple[str, ...]):
    return func.count(Task.task_id).filter(Task.status.in_(statuses))


def _kr_expr():
    """KR terpakai: kr_biaya of successful tasks, falling back to credit_used when kr_biaya is 0."""
    per_row = case((Task.kr_biaya > 0, Task.kr_biaya), else_=func.coalesce(Task.credit_used, 0))
    return func.coalesce(func.sum(per_row).filter(Task.status.in_(STATUS_BERHASIL)), 0)


def _agg_columns():
    return (
        func.count(Task.task_id).label("total"),
        _count_in(STATUS_BERHASIL).label("berhasil"),
        _count_in(STATUS_GAGAL).label("gagal"),
        _count_in(STATUS_BERJALAN).label("berjalan"),
        _count_in(STATUS_DIBATALKAN).label("dibatalkan"),
        _kr_expr().label("kr_terpakai"),
        func.max(Task.created_at).label("terakhir"),
    )


def _pct(berhasil: int, gagal: int) -> Optional[float]:
    denom = (berhasil or 0) + (gagal or 0)
    if denom == 0:
        return None
    return round(100.0 * berhasil / denom, 1)


def _iso(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    if isinstance(dt, str):
        return dt
    return dt.isoformat()


def _agg_dict(row) -> Dict[str, Any]:
    berhasil = int(row.berhasil or 0)
    gagal = int(row.gagal or 0)
    return {
        "total": int(row.total or 0),
        "berhasil": berhasil,
        "gagal": gagal,
        "berjalan": int(row.berjalan or 0),
        "dibatalkan": int(row.dibatalkan or 0),
        "pct_berhasil": _pct(berhasil, gagal),
        "kr_terpakai": int(row.kr_terpakai or 0),
        "terakhir": _iso(row.terakhir),
    }


def _status_group(raw: str) -> str:
    if raw in STATUS_BERHASIL:
        return "berhasil"
    if raw in STATUS_GAGAL:
        return "gagal"
    if raw in STATUS_DIBATALKAN:
        return "dibatalkan"
    return "berjalan"


def _serialize_task(t: Task, user_name: Optional[str], kantor: Optional[str]) -> Dict[str, Any]:
    grp = _status_group(t.status)
    durasi = None
    if t.started_at and t.finished_at:
        durasi = max(0, int((t.finished_at - t.started_at).total_seconds()))
    kr = (t.kr_biaya or 0) if (t.kr_biaya or 0) > 0 else (t.credit_used or 0)
    media_url = (t.video_path or t.result_url) if grp == "berhasil" else None
    return {
        "task_id": t.task_id,
        "user_id": t.user_id,
        "user_name": user_name,
        "kantor": kantor,
        "sumber": "pabrik" if t.batch_id else "studio",
        "batch_id": t.batch_id,
        "prompt": (t.prompt or "")[:160],
        "model": t.model_key,
        "media_type": t.media_type,
        "status": grp,
        "raw_status": t.status,
        "kr": int(kr) if grp == "berhasil" else 0,
        "durasi_detik": durasi,
        "created_at": _iso(t.created_at),
        "finished_at": _iso(t.finished_at),
        "media_url": media_url,
        "alasan_gagal": (t.error_message or t.error) if grp == "gagal" else None,
    }


SORT_KEYS = {"nama", "kantor", "total", "berhasil", "gagal", "berjalan", "pct", "kr", "terakhir"}


def _users_stmt(f: Filters, sort: str, order: str):
    join_on = and_(Task.user_id == User.id, *f.task_conditions())
    cols = _agg_columns()
    stmt = (
        select(User.id, User.name, User.division_id, User.role, User.is_active, *cols)
        .select_from(User)
        .outerjoin(Task, join_on)
        .where(*f.user_conditions())
        .group_by(User.id, User.name, User.division_id, User.role, User.is_active)
    )
    sort = sort if sort in SORT_KEYS else "total"
    desc = order != "asc"
    total_c, berhasil_c, gagal_c, berjalan_c, _batal_c, kr_c, terakhir_c = cols
    pct_c = case(
        ((berhasil_c + gagal_c) > 0, (berhasil_c * literal(1.0)) / (berhasil_c + gagal_c)),
        else_=None,
    )
    sort_col = {
        "nama": func.lower(User.name),
        "kantor": User.division_id,
        "total": total_c,
        "berhasil": berhasil_c,
        "gagal": gagal_c,
        "berjalan": berjalan_c,
        "pct": pct_c,
        "kr": kr_c,
        "terakhir": terakhir_c,
    }[sort]
    primary = sort_col.desc().nulls_last() if desc else sort_col.asc().nulls_last()
    return stmt.order_by(primary, func.lower(User.name).asc(), User.id.asc())


def _user_row_dict(r) -> Dict[str, Any]:
    d = _agg_dict(r)
    d.update({"user_id": r.id, "nama": r.name, "kantor": r.division_id, "role": r.role, "aktif": bool(r.is_active)})
    return d


# --------------------------------------------------------------------------- endpoints

@router.get("/ringkasan")
async def ringkasan(f: Filters = Depends(get_filters), admin: dict = Depends(require_monitoring_admin)):
    async with AsyncSessionLocal() as session:
        stmt = (
            select(*_agg_columns())
            .select_from(Task)
            .join(User, User.id == Task.user_id)
            .where(*f.task_conditions(), *f.user_conditions())
        )
        row = (await session.execute(stmt)).one()

        div_stmt = select(Division.id, Division.name).order_by(Division.id)
        if admin["role"] != "SUPER_ADMIN":
            div_stmt = div_stmt.where(Division.id == admin["division_id"])
        kantor_opsi = [{"id": d.id, "nama": d.name} for d in (await session.execute(div_stmt)).all()]

    return {
        "filter": f.describe(),
        "ringkasan": _agg_dict(row),
        "kantor_opsi": kantor_opsi,
        "bisa_semua_kantor": admin["role"] == "SUPER_ADMIN",
        "diperbarui": now().isoformat(),
    }


@router.get("/users")
async def users(
    f: Filters = Depends(get_filters),
    sort: str = Query("total"),
    order: str = Query("desc"),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=200),
):
    base = _users_stmt(f, sort, order)
    async with AsyncSessionLocal() as session:
        total_rows = (await session.execute(select(func.count()).select_from(base.order_by(None).subquery()))).scalar() or 0
        rows = (await session.execute(base.offset((page - 1) * limit).limit(limit))).all()
    return {
        "filter": f.describe(),
        "items": [_user_row_dict(r) for r in rows],
        "total": int(total_rows),
        "page": page,
        "limit": limit,
        "total_pages": max(1, math.ceil(total_rows / limit)),
    }


@router.get("/users.csv")
async def users_csv(
    f: Filters = Depends(get_filters),
    sort: str = Query("total"),
    order: str = Query("desc"),
):
    async with AsyncSessionLocal() as session:
        rows = (await session.execute(_users_stmt(f, sort, order))).all()

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([
        "Nama", "User ID", "Kantor", "Total generate", "Berhasil", "Gagal", "Sedang berjalan",
        "Dibatalkan", "% berhasil", "KR terpakai", "Generate terakhir (WIB)",
    ])
    for r in rows:
        d = _user_row_dict(r)
        w.writerow([
            d["nama"], d["user_id"], d["kantor"], d["total"], d["berhasil"], d["gagal"], d["berjalan"],
            d["dibatalkan"], "" if d["pct_berhasil"] is None else d["pct_berhasil"], d["kr_terpakai"],
            (d["terakhir"] or "").replace("T", " ")[:19],
        ])
    desc = f.describe()
    fname = f"monitoring_users_{desc['mulai']}_{desc['sampai']}.csv"
    return StreamingResponse(
        iter(["\ufeff" + buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.get("/users/{user_id}")
async def user_detail(
    user_id: str,
    f: Filters = Depends(get_filters),
    admin: dict = Depends(require_monitoring_admin),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=500),
):
    async with AsyncSessionLocal() as session:
        u = await session.get(User, user_id)
        if not u:
            raise HTTPException(status_code=404, detail="User tidak ditemukan.")
        if admin["role"] != "SUPER_ADMIN" and u.division_id != admin["division_id"]:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User ini berada di kantor lain.")
        if f.kantor and u.division_id != f.kantor:
            raise HTTPException(status_code=404, detail="User tidak ada di kantor yang dipilih.")

        conds = [Task.user_id == user_id, *f.task_conditions()]
        agg = (await session.execute(select(*_agg_columns()).where(*conds))).one()

        day_col = func.date(Task.created_at)
        harian_rows = (await session.execute(
            select(
                day_col.label("tanggal"),
                func.count(Task.task_id).label("total"),
                _count_in(STATUS_BERHASIL).label("berhasil"),
                _count_in(STATUS_GAGAL).label("gagal"),
            ).where(*conds).group_by(day_col).order_by(day_col)
        )).all()

        tasks = (await session.execute(
            select(Task).where(*conds)
            .order_by(Task.created_at.desc(), Task.task_id.desc())
            .offset((page - 1) * limit).limit(limit)
        )).scalars().all()

    by_day = {str(r.tanggal)[:10]: r for r in harian_rows}
    harian = []
    d = f.start.date()
    while d < f.end.date():
        r = by_day.get(d.isoformat())
        harian.append({
            "tanggal": d.isoformat(),
            "total": int(r.total) if r else 0,
            "berhasil": int(r.berhasil) if r else 0,
            "gagal": int(r.gagal) if r else 0,
        })
        d += timedelta(days=1)

    summary = _agg_dict(agg)
    return {
        "filter": f.describe(),
        "user": {"user_id": u.id, "nama": u.name, "kantor": u.division_id, "role": u.role, "aktif": bool(u.is_active)},
        "ringkasan": summary,
        "harian": harian,
        "riwayat": [_serialize_task(t, u.name, u.division_id) for t in tasks],
        "riwayat_total": summary["total"],
        "page": page,
        "limit": limit,
        "total_pages": max(1, math.ceil(summary["total"] / limit)),
    }


@router.get("/generate")
async def all_generate(
    f: Filters = Depends(get_filters),
    status_f: Optional[str] = Query(None, alias="status", description="berhasil | gagal | berjalan | dibatalkan"),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=200),
):
    conds = [*f.task_conditions(), *f.user_conditions()]
    if status_f:
        if status_f not in STATUS_FILTERS:
            raise HTTPException(status_code=400, detail="Status tidak dikenal.")
        conds.append(Task.status.in_(STATUS_FILTERS[status_f]))
    async with AsyncSessionLocal() as session:
        total = (await session.execute(
            select(func.count(Task.task_id)).select_from(Task).join(User, User.id == Task.user_id).where(*conds)
        )).scalar() or 0
        rows = (await session.execute(
            select(Task, User.name, User.division_id)
            .join(User, User.id == Task.user_id)
            .where(*conds)
            .order_by(Task.created_at.desc(), Task.task_id.desc())
            .offset((page - 1) * limit).limit(limit)
        )).all()
    return {
        "filter": f.describe(),
        "items": [_serialize_task(t, name, div) for t, name, div in rows],
        "total": int(total),
        "page": page,
        "limit": limit,
        "total_pages": max(1, math.ceil(total / limit)),
    }
