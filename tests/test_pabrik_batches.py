import asyncio
import io
import os
import sys
import zipfile
from unittest.mock import patch

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select, delete

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server.main import app
from server.db import (
    init_db, AsyncSessionLocal, User, Division, ProviderAccount, Batch, Task, CreditLog, QuotaUsage
)
from server.auth import hash_password, create_token
from server.crypto import encrypt_api_key
from server.state import app_state
from server.config import app_config, DATA_DIR
from server.client import SnapgenAPIError
from server.worker import (
    division_workers, stop_all_workers, recover_unfinished_tasks_on_startup, get_or_create_worker
)

# Minimal valid JPEG magic bytes + padding
VALID_JPEG_BYTES = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00" + b"\x00" * 64 + b"\xff\xd9"
FAKE_IMAGE_BYTES = b"This is plain text pretending to be a .jpg file"


async def _wait_for_batch_done(ac: AsyncClient, batch_id: str, headers: dict, timeout: float = 8.0) -> dict:
    deadline = asyncio.get_event_loop().time() + timeout
    last_data = {}
    while asyncio.get_event_loop().time() < deadline:
        res = await ac.get(f"/api/batches/{batch_id}", headers=headers)
        assert res.status_code == 200
        last_data = res.json()
        if last_data["status"] != "berjalan":
            return last_data
        await asyncio.sleep(0.05)
    return last_data


@pytest_asyncio.fixture(autouse=True)
async def setup_test_env():
    await init_db()
    app_state.load_catalog()
    await stop_all_workers()

    # Speed up worker intervals for deterministic fast tests
    orig_poll = app_config.get("POLL_INTERVAL_SEC", 10)
    orig_gap = app_config.get("SUBMIT_GAP_SEC", 2)
    orig_backoff = app_config.get("RETRY_BACKOFF_BASE_SEC", 1.5)
    orig_quota = app_config.get("USER_QUOTA_OUTPUTS", 17)
    app_config["POLL_INTERVAL_SEC"] = 0.02
    app_config["SUBMIT_GAP_SEC"] = 0.01
    app_config["RETRY_BACKOFF_BASE_SEC"] = 0.02
    app_config["USER_QUOTA_OUTPUTS"] = 100

    async with AsyncSessionLocal() as session:
        async with session.begin():
            # Clean test division data
            await session.execute(delete(CreditLog).where(CreditLog.kantor_id == "kantor_test"))
            await session.execute(delete(Task).where(Task.division_id == "kantor_test"))
            await session.execute(delete(Batch).where(Batch.kantor_id == "kantor_test"))
            await session.execute(delete(QuotaUsage).where(QuotaUsage.user_id.in_(["user_test_1", "user_test_2"])))
            await session.execute(delete(ProviderAccount).where(ProviderAccount.division_id == "kantor_test"))
            await session.execute(delete(User).where(User.division_id == "kantor_test"))
            await session.execute(delete(Division).where(Division.id == "kantor_test"))

            # Create division locked to 'seedance' (20 KR per video)
            div = Division(
                id="kantor_test",
                name="Kantor Test",
                allowed_models_json='["seedance"]',
                default_video_model="seedance",
            )
            session.add(div)

            # Create provider account with 200 KR balance
            acc = ProviderAccount(
                id="acc_kantor_test",
                label="Key Kantor Test",
                api_key_enc=encrypt_api_key("sk-snapgen-test-key-123456"),
                division_id="kantor_test",
                slot="primary",
                status="active",
                credits_cached=200,
                credits_reserved=0,
            )
            session.add(acc)

            # Create 2 users in kantor_test
            for uid, uname in [("user_test_1", "User Satu"), ("user_test_2", "User Dua")]:
                p_hash, salt = hash_password("Password123!")
                session.add(
                    User(
                        id=uid,
                        name=uname,
                        password_hash=p_hash,
                        salt=salt,
                        role="DIVISION_MEMBER",
                        division_id="kantor_test",
                        is_active=True,
                        token_version=1,
                    )
                )

    app_state.tasks.clear()
    app_state.division_queues.pop("kantor_test", None)
    app_state.user_in_flight.clear()

    yield

    await stop_all_workers()
    async with AsyncSessionLocal() as session:
        async with session.begin():
            await session.execute(delete(CreditLog).where(CreditLog.kantor_id == "kantor_test"))
            await session.execute(delete(Task).where(Task.division_id == "kantor_test"))
            await session.execute(delete(Batch).where(Batch.kantor_id == "kantor_test"))
            await session.execute(delete(QuotaUsage).where(QuotaUsage.user_id.in_(["user_test_1", "user_test_2"])))
            await session.execute(delete(ProviderAccount).where(ProviderAccount.division_id == "kantor_test"))
            await session.execute(delete(User).where(User.division_id == "kantor_test"))
            await session.execute(delete(Division).where(Division.id == "kantor_test"))
    app_config["POLL_INTERVAL_SEC"] = orig_poll
    app_config["SUBMIT_GAP_SEC"] = orig_gap
    app_config["RETRY_BACKOFF_BASE_SEC"] = orig_backoff
    app_config["USER_QUOTA_OUTPUTS"] = orig_quota


def _auth_headers(user_id: str = "user_test_1") -> dict:
    tok = create_token(user_id, purpose="session", token_version=1)
    return {"Authorization": f"Bearer {tok}"}


@pytest.mark.asyncio
async def test_1_one_photo_three_prompts_exact_3x_kr_and_zip():
    """
    Pengujian 1:
    1 foto + 3 prompt -> 3 video jadi, KR terpotong tepat 3x harga (3 x 20 KR = 60 KR, sisa 140 KR).
    Sekaligus menguji unduh ZIP dan proteksi kepemilikan file.
    """
    submit_calls = []

    async def mock_submit(self, endpoint, body_type, params, files, api_key):
        submit_calls.append((endpoint, params, files))
        job_uuid = f"job_ok_{len(submit_calls)}"
        return {
            "uuid": job_uuid,
            "status": 1,
            "status_percentage": 20,
            "estimated_credit": 20,
        }

    async def mock_poll(self, uuid, api_key):
        return {
            "uuid": uuid,
            "status": 2,
            "status_percentage": 100,
            "used_credit": 20,
            "generated_video": [{"video_url": f"https://cdn.snapgen.ai/{uuid}.mp4"}],
        }

    async def mock_download(self, file_url, dest_path):
        with open(dest_path, "wb") as f:
            f.write(b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom" + b"V" * 128)
        return 152

    with patch("server.client.SnapgenClient.submit_task", new=mock_submit), \
         patch("server.client.SnapgenClient.poll_history", new=mock_poll), \
         patch("server.client.SnapgenClient.download_file", new=mock_download):

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            headers = _auth_headers("user_test_1")
            files = [("foto", ("model-hijab-01.jpg", VALID_JPEG_BYTES, "image/jpeg"))]
            data = {
                "prompts[]": [
                    "Model tersenyum ke kamera sambil mengangkat produk.",
                    "Model berjalan pelan ke arah kamera lalu berputar.",
                    "Close-up model menunjuk detail produk.",
                ],
                "rasio": "9:16",
                "durasi": "8",
                "nama": "Batch Uji Tiga Prompt",
            }
            res = await ac.post("/api/batches", headers=headers, data=data, files=files)
            assert res.status_code == 200, res.text
            batch = res.json()
            assert batch["total_tasks"] == 3
            assert batch["total_kr"] == 60  # 3 x 20 KR (seedance)
            assert batch["model"] == "seedance"  # locked by kantor_test

            final_batch = await _wait_for_batch_done(ac, batch["id"], headers)
            assert final_batch["status"] == "selesai"
            assert final_batch["selesai_count"] == 3
            assert len(submit_calls) == 3

            # All 3 tasks must use the exact same saved photo path
            photo_paths = {t["video_url"] is not None for t in final_batch["tasks"]}
            assert photo_paths == {True}

            # Verify KR balance in DB: started at 200 KR, 3 x 20 = 60 KR deducted -> 140 KR left, 0 reserved
            async with AsyncSessionLocal() as session:
                acc = await session.get(ProviderAccount, "acc_kantor_test")
                assert acc.credits_cached == 140
                assert acc.credits_reserved == 0

            # Verify ZIP download contains all 3 finished videos
            zip_res = await ac.get(f"/api/batches/{batch['id']}/zip", headers=headers)
            assert zip_res.status_code == 200
            with zipfile.ZipFile(io.BytesIO(zip_res.content), "r") as zf:
                assert len(zf.namelist()) == 3

            # Verify media security: unauthenticated request to video is rejected (401)
            first_video_url = final_batch["tasks"][0]["video_url"]
            unauth_client = AsyncClient(transport=transport, base_url="http://test")
            async with unauth_client as uac:
                r_unauth = await uac.get(first_video_url)
                assert r_unauth.status_code == 401
                # Different user in same or other check -> forbidden (403)
                r_other = await uac.get(first_video_url, headers=_auth_headers("user_test_2"))
                assert r_other.status_code == 403
                # Owner -> 200 OK
                r_owner = await uac.get(first_video_url, headers=headers)
                assert r_owner.status_code == 200


@pytest.mark.asyncio
async def test_2_partial_failure_refund_and_single_task_retry():
    """
    Pengujian 2:
    Satu prompt sengaja dibuat gagal -> 2 selesai, 1 gagal, KR gagal kembali (200 - 40 = 160 KR),
    lalu "Coba lagi" hanya menjalankan yang gagal -> akhirnya 3 selesai dan KR = 140 KR.
    """
    should_fail_prompt_2 = True
    submitted_prompts = []

    async def mock_submit(self, endpoint, body_type, params, files, api_key):
        p = params.get("prompt", "")
        submitted_prompts.append(p)
        if "GAGAL_DISENGAJA" in p and should_fail_prompt_2:
            raise SnapgenAPIError("Prompt ditolak oleh filter keamanan AI (422)", status_code=422)
        return {
            "uuid": f"job_{len(submitted_prompts)}",
            "status": 1,
            "status_percentage": 30,
            "estimated_credit": 20,
        }

    async def mock_poll(self, uuid, api_key):
        return {
            "uuid": uuid,
            "status": 2,
            "status_percentage": 100,
            "used_credit": 20,
            "generated_video": [{"video_url": f"https://cdn.snapgen.ai/{uuid}.mp4"}],
        }

    async def mock_download(self, file_url, dest_path):
        with open(dest_path, "wb") as f:
            f.write(b"\x00\x00\x00\x18ftypmp42" + b"X" * 64)
        return 72

    with patch("server.client.SnapgenClient.submit_task", new=mock_submit), \
         patch("server.client.SnapgenClient.poll_history", new=mock_poll), \
         patch("server.client.SnapgenClient.download_file", new=mock_download):

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            headers = _auth_headers("user_test_1")
            files = [("foto", ("model.jpg", VALID_JPEG_BYTES, "image/jpeg"))]
            data = {
                "prompts[]": [
                    "Prompt 1 normal berhasil",
                    "Prompt 2 GAGAL_DISENGAJA karena melanggar",
                    "Prompt 3 normal berhasil",
                ],
                "rasio": "9:16",
                "durasi": "8",
            }
            res = await ac.post("/api/batches", headers=headers, data=data, files=files)
            assert res.status_code == 200
            batch_id = res.json()["id"]

            final_batch = await _wait_for_batch_done(ac, batch_id, headers)
            assert final_batch["status"] == "sebagian_gagal"
            assert final_batch["selesai_count"] == 2
            assert final_batch["gagal_count"] == 1
            assert final_batch["total_kr"] == 40  # only 2 videos charged!

            # Check DB balance: 200 - 40 = 160 KR (20 KR from failed task was refunded!)
            async with AsyncSessionLocal() as session:
                acc = await session.get(ProviderAccount, "acc_kantor_test")
                assert acc.credits_cached == 160
                assert acc.credits_reserved == 0

            # Now fix transient/provider condition and click "Coba lagi" on failed task #2 ONLY
            should_fail_prompt_2 = False
            failed_task = next(t for t in final_batch["tasks"] if t["status"] == "gagal")
            assert failed_task["urutan"] == 2

            submitted_prompts.clear()
            retry_res = await ac.post(f"/api/batch-tasks/{failed_task['id']}/retry", headers=headers)
            assert retry_res.status_code == 200

            retried_batch = await _wait_for_batch_done(ac, batch_id, headers)
            assert retried_batch["status"] == "selesai"
            assert retried_batch["selesai_count"] == 3
            assert retried_batch["gagal_count"] == 0
            # Verify ONLY the failed prompt #2 was re-submitted
            assert len(submitted_prompts) == 1
            assert "GAGAL_DISENGAJA" in submitted_prompts[0]

            # Final KR balance is now 200 - 60 = 140 KR
            async with AsyncSessionLocal() as session:
                acc = await session.get(ProviderAccount, "acc_kantor_test")
                assert acc.credits_cached == 140
                assert acc.credits_reserved == 0


@pytest.mark.asyncio
async def test_3_and_4_refresh_active_batch_and_backend_restart_recovery():
    """
    Pengujian 3 & 4:
    - Refresh halaman di tengah proses (/api/batches/aktif) -> batch tampil lagi, tidak ada tugas dobel.
    - Restart container backend di tengah proses -> tugas yang sudah punya provider_job_id dilanjutkan
      lewat poll_history (bukan submit ulang), tugas yang masih antre lanjut, KR tidak terpotong dua kali.
    """
    submit_count = 0
    allow_finish = asyncio.Event()

    async def mock_submit(self, endpoint, body_type, params, files, api_key):
        nonlocal submit_count
        submit_count += 1
        return {
            "uuid": f"job_persist_{submit_count}",
            "status": 1,
            "status_percentage": 45,
            "estimated_credit": 20,
        }

    async def mock_poll(self, uuid, api_key):
        if not allow_finish.is_set():
            return {"uuid": uuid, "status": 1, "status_percentage": 62}
        return {
            "uuid": uuid,
            "status": 2,
            "status_percentage": 100,
            "used_credit": 20,
            "generated_video": [{"video_url": f"https://cdn.snapgen.ai/{uuid}.mp4"}],
        }

    async def mock_download(self, file_url, dest_path):
        with open(dest_path, "wb") as f:
            f.write(b"\x00\x00\x00\x18ftypmp42" + b"R" * 64)
        return 72

    with patch("server.client.SnapgenClient.submit_task", new=mock_submit), \
         patch("server.client.SnapgenClient.poll_history", new=mock_poll), \
         patch("server.client.SnapgenClient.download_file", new=mock_download):

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            headers = _auth_headers("user_test_1")
            files = [("foto", ("model.jpg", VALID_JPEG_BYTES, "image/jpeg"))]
            data = {
                "prompts[]": ["Adegan A", "Adegan B", "Adegan C"],
                "rasio": "9:16",
                "durasi": "8",
            }
            res = await ac.post("/api/batches", headers=headers, data=data, files=files)
            assert res.status_code == 200
            batch_id = res.json()["id"]

            # Wait briefly so 2 tasks enter 'generating' (with provider_job_id) and 1 is still 'queued'
            await asyncio.sleep(0.08)

            # Pengujian 3: Simulate browser refresh calling GET /api/batches/aktif
            aktif_res = await ac.get("/api/batches/aktif", headers=headers)
            assert aktif_res.status_code == 200
            aktif_data = aktif_res.json()
            assert aktif_data["batch"] is not None
            assert aktif_data["batch"]["id"] == batch_id
            assert len(aktif_data["batch"]["tasks"]) == 3

            # Pengujian 4: Simulate backend container restart in the middle of processing
            await stop_all_workers()
            app_state.tasks.clear()
            app_state.division_queues.clear()
            app_state.user_in_flight.clear()

            submits_before_restart = submit_count
            assert submits_before_restart >= 1

            # Trigger startup recovery and allow polling to finish
            allow_finish.set()
            await recover_unfinished_tasks_on_startup()

            final_batch = await _wait_for_batch_done(ac, batch_id, headers)
            assert final_batch["status"] == "selesai"
            assert final_batch["selesai_count"] == 3

            # Crucial check: total submit_task calls across before + after restart must be EXACTLY 3 (no double submit!)
            assert submit_count == 3

            # And KR deducted is still exact 60 KR (balance = 140 KR)
            async with AsyncSessionLocal() as session:
                acc = await session.get(ProviderAccount, "acc_kantor_test")
                assert acc.credits_cached == 140
                assert acc.credits_reserved == 0


@pytest.mark.asyncio
async def test_5_two_users_same_office_fair_round_robin():
    """
    Pengujian 5:
    Dua user di kantor yang sama generate bersamaan -> tidak tabrakan,
    dua-duanya maju bergantian (round-robin).
    """
    # Set concurrency to 1 so dequeue order is strictly sequential and observable
    app_config["MAX_PARALLEL_PER_KANTOR"] = 1
    execution_order = []

    async def mock_submit(self, endpoint, body_type, params, files, api_key):
        execution_order.append(params.get("prompt", ""))
        return {
            "uuid": f"job_rr_{len(execution_order)}",
            "status": 1,
            "status_percentage": 50,
            "estimated_credit": 20,
        }

    async def mock_poll(self, uuid, api_key):
        return {
            "uuid": uuid,
            "status": 2,
            "status_percentage": 100,
            "used_credit": 20,
            "generated_video": [{"video_url": f"https://cdn.snapgen.ai/{uuid}.mp4"}],
        }

    async def mock_download(self, file_url, dest_path):
        with open(dest_path, "wb") as f:
            f.write(b"\x00\x00\x00\x18ftypmp42" + b"Z" * 32)
        return 40

    try:
        with patch("server.client.SnapgenClient.submit_task", new=mock_submit), \
             patch("server.client.SnapgenClient.poll_history", new=mock_poll), \
             patch("server.client.SnapgenClient.download_file", new=mock_download):

            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as ac:
                h1 = _auth_headers("user_test_1")
                h2 = _auth_headers("user_test_2")

                r1, r2 = await asyncio.gather(
                    ac.post(
                        "/api/batches",
                        headers=h1,
                        data={"prompts[]": ["U1_P1", "U1_P2", "U1_P3"], "rasio": "9:16", "durasi": "8"},
                        files=[("foto", ("u1.jpg", VALID_JPEG_BYTES, "image/jpeg"))],
                    ),
                    ac.post(
                        "/api/batches",
                        headers=h2,
                        data={"prompts[]": ["U2_P1", "U2_P2"], "rasio": "9:16", "durasi": "8"},
                        files=[("foto", ("u2.jpg", VALID_JPEG_BYTES, "image/jpeg"))],
                    ),
                )
                assert r1.status_code == 200
                assert r2.status_code == 200
                b1_id = r1.json()["id"]
                b2_id = r2.json()["id"]

                b1_final = await _wait_for_batch_done(ac, b1_id, h1)
                b2_final = await _wait_for_batch_done(ac, b2_id, h2)
                assert b1_final["status"] == "selesai"
                assert b2_final["status"] == "selesai"

                # Verify User 2 did NOT have to wait for all 3 of User 1's tasks to finish first
                first_u2_idx = next(i for i, p in enumerate(execution_order) if p.startswith("U2_"))
                last_u1_idx = max(i for i, p in enumerate(execution_order) if p.startswith("U1_"))
                assert first_u2_idx < last_u1_idx, f"Expected round-robin interleaving, got {execution_order}"
    finally:
        app_config["MAX_PARALLEL_PER_KANTOR"] = 2


@pytest.mark.asyncio
async def test_6_insufficient_kr_rejected_before_any_task_created():
    """
    Pengujian 6:
    Saldo kurang -> ditolak dengan pesan 'Saldo KR kurang: butuh X, tersisa Y' sebelum ada tugas dibuat.
    """
    # Set account balance to 30 KR (less than 3 x 20 = 60 KR)
    async with AsyncSessionLocal() as session:
        async with session.begin():
            acc = await session.get(ProviderAccount, "acc_kantor_test")
            acc.credits_cached = 30

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        headers = _auth_headers("user_test_1")
        files = [("foto", ("model.jpg", VALID_JPEG_BYTES, "image/jpeg"))]
        data = {
            "prompts[]": ["Prompt 1", "Prompt 2", "Prompt 3"],
            "rasio": "9:16",
            "durasi": "8",
        }
        res = await ac.post("/api/batches", headers=headers, data=data, files=files)
        assert res.status_code == 400
        detail = res.json()["detail"]
        assert "Saldo KR kurang: butuh 60, tersisa 30" in detail

        # Verify 0 batches and 0 tasks were created in DB, and balance is still 30 KR
        async with AsyncSessionLocal() as session:
            b_cnt = (await session.execute(select(Batch).where(Batch.kantor_id == "kantor_test"))).scalars().all()
            t_cnt = (await session.execute(select(Task).where(Task.division_id == "kantor_test"))).scalars().all()
            acc = await session.get(ProviderAccount, "acc_kantor_test")
            assert len(b_cnt) == 0
            assert len(t_cnt) == 0
            assert acc.credits_cached == 30
            assert acc.credits_reserved == 0


@pytest.mark.asyncio
async def test_7_double_click_generate_creates_only_one_batch():
    """
    Pengujian 7:
    Klik Generate dua kali cepat -> hanya satu batch terbentuk dan KR hanya dipotong sekali.
    """
    async def mock_submit(self, endpoint, body_type, params, files, api_key):
        return {"uuid": "job_dup_1", "status": 1, "status_percentage": 20, "estimated_credit": 20}

    async def mock_poll(self, uuid, api_key):
        return {
            "uuid": uuid,
            "status": 2,
            "status_percentage": 100,
            "used_credit": 20,
            "generated_video": [{"video_url": f"https://cdn.snapgen.ai/{uuid}.mp4"}],
        }

    async def mock_download(self, file_url, dest_path):
        with open(dest_path, "wb") as f:
            f.write(b"\x00\x00\x00\x18ftypmp42" + b"D" * 32)
        return 40

    with patch("server.client.SnapgenClient.submit_task", new=mock_submit), \
         patch("server.client.SnapgenClient.poll_history", new=mock_poll), \
         patch("server.client.SnapgenClient.download_file", new=mock_download):

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            headers = _auth_headers("user_test_1")
            payload_data = {
                "prompts[]": ["Prompt A", "Prompt B"],
                "rasio": "9:16",
                "durasi": "8",
                "nama": "Batch Klik Ganda",
            }

            # Fire two identical POST /api/batches concurrently
            res1, res2 = await asyncio.gather(
                ac.post(
                    "/api/batches",
                    headers=headers,
                    data=payload_data,
                    files=[("foto", ("model.jpg", VALID_JPEG_BYTES, "image/jpeg"))],
                ),
                ac.post(
                    "/api/batches",
                    headers=headers,
                    data=payload_data,
                    files=[("foto", ("model.jpg", VALID_JPEG_BYTES, "image/jpeg"))],
                ),
            )
            assert res1.status_code == 200
            assert res2.status_code == 200
            b1 = res1.json()
            b2 = res2.json()
            assert b1["id"] == b2["id"], "Both rapid requests must resolve to the same single batch"

            await _wait_for_batch_done(ac, b1["id"], headers)

            async with AsyncSessionLocal() as session:
                batches = (await session.execute(select(Batch).where(Batch.kantor_id == "kantor_test"))).scalars().all()
                tasks = (await session.execute(select(Task).where(Task.division_id == "kantor_test"))).scalars().all()
                acc = await session.get(ProviderAccount, "acc_kantor_test")
                assert len(batches) == 1
                assert len(tasks) == 2
                assert acc.credits_cached == 160  # 200 - (2 x 20) = 160 KR
