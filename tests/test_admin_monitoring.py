"""Admin Monitoring tests (run against a separate test DB, never production).

1. Total on the summary card = sum of the per-user table rows.
2. A user's numbers in the table = number of rows in their detail history.
3. Pabrik batch of 3 prompts, 1 failed -> 3 generate, 2 berhasil, 1 gagal;
   after "Coba lagi" succeeds -> 3 berhasil, total stays 3.
4. Regular user -> 403; Kantor A admin cannot see Kantor B (incl. video files).
"""
import asyncio
import os
import sys
from datetime import timedelta
from unittest.mock import patch

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy import delete

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config.clock import now
from server.main import app
from server.db import init_db, AsyncSessionLocal, User, Division, ProviderAccount, Batch, Task, CreditLog, QuotaUsage
from server.auth import hash_password, create_token
from server.crypto import encrypt_api_key
from server.state import app_state
from server.config import app_config, DATA_DIR
from server.client import SnapgenAPIError
from server.worker import stop_all_workers

KA, KB = "mon_kantor_a", "mon_kantor_b"
USERS = [
    # id, name, role, kantor
    ("mon_super", "Mon Super", "SUPER_ADMIN", KA),
    ("mon_admin_a", "Mon Admin A", "DIVISION_ADMIN", KA),
    ("mon_admin_b", "Mon Admin B", "DIVISION_ADMIN", KB),
    ("mon_a1", "Andi A1", "DIVISION_MEMBER", KA),
    ("mon_a2", "Budi A2 Nol", "DIVISION_MEMBER", KA),
    ("mon_b1", "Citra B1", "DIVISION_MEMBER", KB),
]
USER_IDS = [u[0] for u in USERS]
VALID_JPEG_BYTES = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00" + b"\x00" * 64 + b"\xff\xd9"


def H(uid: str) -> dict:
    return {"Authorization": f"Bearer {create_token(uid, purpose='session', token_version=1)}"}


async def _cleanup():
    async with AsyncSessionLocal() as s:
        async with s.begin():
            await s.execute(delete(CreditLog).where(CreditLog.kantor_id.in_([KA, KB])))
            await s.execute(delete(Task).where(Task.user_id.in_(USER_IDS)))
            await s.execute(delete(Batch).where(Batch.kantor_id.in_([KA, KB])))
            await s.execute(delete(QuotaUsage).where(QuotaUsage.user_id.in_(USER_IDS)))
            await s.execute(delete(ProviderAccount).where(ProviderAccount.division_id.in_([KA, KB])))
            await s.execute(delete(User).where(User.id.in_(USER_IDS)))
            await s.execute(delete(Division).where(Division.id.in_([KA, KB])))


def _task(tid, uid, kantor, status, *, batch=None, kr=20, credit_used=0, minutes_ago=5, err=None, days_ago=0):
    t0 = now() - timedelta(days=days_ago, minutes=minutes_ago)
    done = status in ("completed", "failed")
    return Task(
        task_id=tid, user_id=uid, division_id=kantor, batch_id=batch, status=status,
        prompt=f"prompt {tid} " + "x" * 200, model_key="seedance", media_type="video",
        kr_biaya=kr, credit_used=credit_used, created_at=t0, updated_at=t0,
        started_at=t0 + timedelta(seconds=10) if status != "queued" else None,
        finished_at=t0 + timedelta(seconds=130) if done else None,
        video_path=f"/videos/{uid}/{tid}.mp4" if status == "completed" else None,
        result_url=f"/videos/{uid}/{tid}.mp4" if status == "completed" else None,
        error_message=err,
    )


@pytest_asyncio.fixture(autouse=True)
async def env():
    await init_db()
    app_state.load_catalog()
    await stop_all_workers()
    saved = {k: app_config.get(k) for k in ("POLL_INTERVAL_SEC", "SUBMIT_GAP_SEC", "RETRY_BACKOFF_BASE_SEC", "USER_QUOTA_OUTPUTS")}
    app_config.update(POLL_INTERVAL_SEC=0.02, SUBMIT_GAP_SEC=0.01, RETRY_BACKOFF_BASE_SEC=0.02, USER_QUOTA_OUTPUTS=100)
    await _cleanup()
    async with AsyncSessionLocal() as s:
        async with s.begin():
            for kid, name in [(KA, "Mon Kantor A"), (KB, "Mon Kantor B")]:
                s.add(Division(id=kid, name=name, allowed_models_json='["seedance"]', default_video_model="seedance"))
                s.add(ProviderAccount(
                    id=f"acc_{kid}", label=f"Key {kid}", api_key_enc=encrypt_api_key("sk-test-monitoring"),
                    division_id=kid, slot="primary", status="active", credits_cached=500, credits_reserved=0,
                ))
            for uid, name, role, kantor in USERS:
                ph, salt = hash_password("Password123!")
                s.add(User(id=uid, name=name, password_hash=ph, salt=salt, role=role,
                           division_id=kantor, is_active=True, token_version=1))
    app_state.tasks.clear()
    for k in (KA, KB):
        app_state.division_queues.pop(k, None)
    app_state.user_in_flight.clear()
    yield
    await stop_all_workers()
    await _cleanup()
    app_config.update(saved)


async def _seed_mixed():
    """Kantor A: a1 has 6 today (+1 yesterday, +1 cancelled), a2 has none. Kantor B: b1 has 3."""
    async with AsyncSessionLocal() as s:
        async with s.begin():
            s.add_all([
                _task("mon_t1", "mon_a1", KA, "completed", kr=20),
                _task("mon_t2", "mon_a1", KA, "completed", kr=0, credit_used=24),  # legacy: fallback credit_used
                _task("mon_t3", "mon_a1", KA, "failed", err="Prompt ditolak filter (422)"),
                _task("mon_t4", "mon_a1", KA, "generating"),
                _task("mon_t5", "mon_a1", KA, "queued"),
                _task("mon_t6", "mon_a1", KA, "cancelled"),
                _task("mon_t7", "mon_a1", KA, "completed", days_ago=1),  # outside "hari_ini"
                _task("mon_t8", "mon_b1", KB, "completed"),
                _task("mon_t9", "mon_b1", KB, "failed", err="Timeout provider"),
                _task("mon_t10", "mon_b1", KB, "failed", err="Saldo habis"),
            ])


async def _all_user_rows(ac, headers, params):
    rows, page = [], 1
    while True:
        r = await ac.get("/api/admin/monitoring/users", headers=headers, params={**params, "page": page, "limit": 2})
        assert r.status_code == 200, r.text
        body = r.json()
        rows += body["items"]
        if page >= body["total_pages"]:
            return rows, body["total"]
        page += 1


@pytest.mark.asyncio
async def test_1_ringkasan_equals_sum_of_user_rows():
    await _seed_mixed()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        for params in (
            {"kantor": KA},
            {"kantor": KA, "rentang": "7_hari"},
            {"kantor": KB},
            {"kantor": KA, "sumber": "studio"},
            {"kantor": KA, "sumber": "pabrik"},
        ):
            s = (await ac.get("/api/admin/monitoring/ringkasan", headers=H("mon_super"), params=params)).json()["ringkasan"]
            rows, n_rows = await _all_user_rows(ac, H("mon_super"), params)
            assert len(rows) == n_rows
            for key in ("total", "berhasil", "gagal", "berjalan", "dibatalkan", "kr_terpakai"):
                assert s[key] == sum(r[key] for r in rows), (params, key)
            g = (await ac.get("/api/admin/monitoring/generate", headers=H("mon_super"), params=params)).json()
            assert g["total"] == s["total"]

        s = (await ac.get("/api/admin/monitoring/ringkasan", headers=H("mon_super"), params={"kantor": KA})).json()["ringkasan"]
        # today, kantor A: 6 rows (t1..t6); cancelled counted separately
        assert (s["total"], s["berhasil"], s["gagal"], s["berjalan"], s["dibatalkan"]) == (6, 2, 1, 2, 1)
        assert s["pct_berhasil"] == round(100 * 2 / 3, 1)
        assert s["kr_terpakai"] == 20 + 24  # kr_biaya, fallback credit_used when kr_biaya = 0

        # users with 0 generate still listed, default sort = most generate first
        rows, _ = await _all_user_rows(ac, H("mon_super"), {"kantor": KA})
        assert [r["user_id"] for r in rows][0] == "mon_a1"
        assert any(r["user_id"] == "mon_a2" and r["total"] == 0 for r in rows)

        # CSV export has header + one line per user
        csv_res = await ac.get("/api/admin/monitoring/users.csv", headers=H("mon_super"), params={"kantor": KA})
        assert csv_res.status_code == 200
        assert csv_res.headers["content-type"].startswith("text/csv")
        assert len(csv_res.text.strip().splitlines()) == 1 + len(rows)


@pytest.mark.asyncio
async def test_2_user_numbers_equal_detail_history():
    await _seed_mixed()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        for params in ({}, {"rentang": "7_hari"}, {"sumber": "studio"}):
            rows, _ = await _all_user_rows(ac, H("mon_super"), params)
            assert {r["user_id"] for r in rows} >= {"mon_a1", "mon_a2", "mon_b1"}
            for r in rows:
                if r["user_id"] not in USER_IDS:
                    continue
                d = (await ac.get(f"/api/admin/monitoring/users/{r['user_id']}", headers=H("mon_super"), params=params)).json()
                assert d["ringkasan"]["total"] == r["total"] == len(d["riwayat"]) == d["riwayat_total"]
                for key in ("berhasil", "gagal", "berjalan", "dibatalkan"):
                    assert d["ringkasan"][key] == r[key] == sum(1 for t in d["riwayat"] if t["status"] == key)
                assert sum(x["total"] for x in d["harian"]) == r["total"]

        d = (await ac.get("/api/admin/monitoring/users/mon_a1", headers=H("mon_super"))).json()
        failed = [t for t in d["riwayat"] if t["status"] == "gagal"]
        assert failed and failed[0]["alasan_gagal"] == "Prompt ditolak filter (422)"
        ok = [t for t in d["riwayat"] if t["status"] == "berhasil"]
        assert all(t["media_url"] and t["durasi_detik"] == 120 for t in ok)
        assert len(d["riwayat"][0]["prompt"]) <= 160


@pytest.mark.asyncio
async def test_3_batch_three_prompts_one_failed_then_retry():
    fail_now = True
    submitted = []

    async def mock_submit(self, endpoint, body_type, params, files, api_key):
        p = params.get("prompt", "")
        submitted.append(p)
        if "GAGAL_DISENGAJA" in p and fail_now:
            raise SnapgenAPIError("Prompt ditolak oleh filter keamanan AI (422)", status_code=422)
        return {"uuid": f"job_mon_{len(submitted)}", "status": 1, "status_percentage": 30, "estimated_credit": 20}

    async def mock_poll(self, uuid, api_key):
        return {"uuid": uuid, "status": 2, "status_percentage": 100, "used_credit": 20,
                "generated_video": [{"video_url": f"https://cdn.snapgen.ai/{uuid}.mp4"}]}

    async def mock_download(self, file_url, dest_path):
        with open(dest_path, "wb") as fh:
            fh.write(b"\x00\x00\x00\x18ftypmp42" + b"M" * 64)
        return 72

    async def wait_done(ac, bid):
        for _ in range(200):
            b = (await ac.get(f"/api/batches/{bid}", headers=H("mon_a1"))).json()
            if b["status"] != "berjalan":
                return b
            await asyncio.sleep(0.05)
        return b

    async def mon(ac):
        p = {"kantor": KA, "sumber": "pabrik"}
        s = (await ac.get("/api/admin/monitoring/ringkasan", headers=H("mon_admin_a"), params=p)).json()["ringkasan"]
        rows, _ = await _all_user_rows(ac, H("mon_admin_a"), p)
        a1 = next(r for r in rows if r["user_id"] == "mon_a1")
        return s, a1

    with patch("server.client.SnapgenClient.submit_task", new=mock_submit), \
         patch("server.client.SnapgenClient.poll_history", new=mock_poll), \
         patch("server.client.SnapgenClient.download_file", new=mock_download):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            res = await ac.post("/api/batches", headers=H("mon_a1"),
                                data={"prompts[]": ["Prompt 1 ok", "Prompt 2 GAGAL_DISENGAJA", "Prompt 3 ok"],
                                      "rasio": "9:16", "durasi": "8"},
                                files=[("foto", ("m.jpg", VALID_JPEG_BYTES, "image/jpeg"))])
            assert res.status_code == 200, res.text
            bid = res.json()["id"]
            b = await wait_done(ac, bid)
            assert (b["selesai_count"], b["gagal_count"]) == (2, 1)

            s, a1 = await mon(ac)
            assert (s["total"], s["berhasil"], s["gagal"]) == (3, 2, 1)
            assert (a1["total"], a1["berhasil"], a1["gagal"]) == (3, 2, 1)

            fail_now = False
            failed = next(t for t in b["tasks"] if t["status"] == "gagal")
            r = await ac.post(f"/api/batch-tasks/{failed['id']}/retry", headers=H("mon_a1"))
            assert r.status_code == 200, r.text
            b = await wait_done(ac, bid)
            assert b["selesai_count"] == 3

            s, a1 = await mon(ac)
            assert (s["total"], s["berhasil"], s["gagal"]) == (3, 3, 0)
            assert (a1["total"], a1["berhasil"], a1["gagal"]) == (3, 3, 0)
            assert s["pct_berhasil"] == 100.0


@pytest.mark.asyncio
async def test_4_access_control():
    await _seed_mixed()
    # real video files so the media route answers 200 when allowed
    for uid, tid in (("mon_a1", "mon_t1"), ("mon_b1", "mon_t8")):
        d = DATA_DIR / "videos" / uid
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{tid}.mp4").write_bytes(b"\x00\x00\x00\x18ftypmp42")

    endpoints = ["ringkasan", "users", "users/mon_a1", "generate", "users.csv"]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # regular user -> 403 everywhere, no auth -> 401
        for ep in endpoints:
            assert (await ac.get(f"/api/admin/monitoring/{ep}", headers=H("mon_a1"))).status_code == 403, ep
            assert (await ac.get(f"/api/admin/monitoring/{ep}")).status_code == 401, ep

        # Kantor A admin: only Kantor A
        r = await ac.get("/api/admin/monitoring/ringkasan", headers=H("mon_admin_a"))
        assert r.status_code == 200
        assert r.json()["filter"]["kantor"] == KA
        assert [k["id"] for k in r.json()["kantor_opsi"]] == [KA]
        for ep in endpoints:
            assert (await ac.get(f"/api/admin/monitoring/{ep}", headers=H("mon_admin_a"), params={"kantor": KB})).status_code == 403, ep
        rows, _ = await _all_user_rows(ac, H("mon_admin_a"), {})
        assert rows and all(x["kantor"] == KA for x in rows)
        g = (await ac.get("/api/admin/monitoring/generate", headers=H("mon_admin_a"))).json()
        assert g["items"] and all(x["kantor"] == KA for x in g["items"])
        assert (await ac.get("/api/admin/monitoring/users/mon_b1", headers=H("mon_admin_a"))).status_code == 403
        csv_text = (await ac.get("/api/admin/monitoring/users.csv", headers=H("mon_admin_a"))).text
        assert "mon_b1" not in csv_text and "mon_a1" in csv_text

        # video access goes through the existing media route, scoped per kantor
        assert (await ac.get("/videos/mon_a1/mon_t1.mp4", headers=H("mon_admin_a"))).status_code == 200
        assert (await ac.get("/videos/mon_b1/mon_t8.mp4", headers=H("mon_admin_a"))).status_code == 403
        assert (await ac.get("/videos/mon_b1/mon_t8.mp4", headers=H("mon_admin_b"))).status_code == 200

        # Kantor B admin mirrors it
        assert (await ac.get("/api/admin/monitoring/users/mon_a1", headers=H("mon_admin_b"))).status_code == 403

        # super admin sees both kantor
        r = (await ac.get("/api/admin/monitoring/ringkasan", headers=H("mon_super"))).json()
        assert {KA, KB} <= {k["id"] for k in r["kantor_opsi"]}
        assert r["bisa_semua_kantor"] is True
        assert (await ac.get("/api/admin/monitoring/users/mon_b1", headers=H("mon_super"))).status_code == 200

    for uid, tid in (("mon_a1", "mon_t1"), ("mon_b1", "mon_t8")):
        (DATA_DIR / "videos" / uid / f"{tid}.mp4").unlink(missing_ok=True)
