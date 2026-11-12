import asyncio
import os
import sys

# Add project root to sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from httpx import AsyncClient, ASGITransport
from server.main import app
from server.db import init_db
from server.state import app_state

async def test_api_full_flow():
    await init_db()
    app_state.load_catalog()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # 1. Health check
        res = await ac.get("/api/health")
        assert res.status_code == 200
        assert res.json()["status"] == "ok"

        # 2. Bootstrap check
        res = await ac.get("/api/auth/bootstrap")
        assert res.status_code == 200
        is_open = res.json()["open"]

        token = None
        user_id = "admin_test"

        if is_open:
            # Register initial super admin
            res = await ac.post("/api/auth/register", json={
                "username": user_id,
                "name": "Super Admin Test",
                "password": "Password123!"
            })
            assert res.status_code == 200
            data = res.json()
            assert "token" in data
            assert data["user"]["role"] == "SUPER_ADMIN"
            token = data["token"]
        else:
            # Login
            res = await ac.post("/api/auth/login", json={
                "username": user_id,
                "password": "Password123!"
            })
            if res.status_code == 200:
                token = res.json()["token"]

        if not token:
            return

        headers = {"Authorization": f"Bearer {token}"}

        # 3. Models list
        res = await ac.get("/api/models", headers=headers)
        assert res.status_code == 200
        models_data = res.json()
        assert len(models_data["models"]) > 0

        # 4. Admin Overview
        res = await ac.get("/api/admin/overview", headers=headers)
        assert res.status_code == 200

        # 5. Admin Divisions
        res = await ac.get("/api/admin/divisions", headers=headers)
        assert res.status_code == 200
        divs = res.json()["divisions"]
        assert any(d["id"] == "kantor_a" for d in divs)

        # 6. Admin Reset Code
        res = await ac.get("/api/admin/reset-code", headers=headers)
        assert res.status_code == 200
        code = res.json()["code"]
        assert len(code) == 9 and "-" in code

        # 7. Generate intake
        res = await ac.post(f"/api/users/{user_id}/generate", headers=headers, json={
            "model_key": "veo",
            "media_type": "video",
            "options": {"aspect": "9:16", "duration": 5},
            "entries": [{"prompt": "A cinematic shot of cosmetic bottle", "count": 1}],
            "image_mode": "none"
        })
        assert res.status_code == 200
        gen_data = res.json()
        assert gen_data["queued"] == 1
        assert len(gen_data["tasks"]) == 1
        assert gen_data["tasks"][0]["model_key"] == "veo"

        # 8. User tasks list
        res = await ac.get("/api/tasks", headers=headers)
        assert res.status_code == 200
        task_list = res.json()
        assert task_list["total"] >= 1

        # 9. User Quota
        res = await ac.get(f"/api/users/{user_id}/quota", headers=headers)
        assert res.status_code == 200
        q_data = res.json()
        assert q_data["used"] >= 1

        print("\nAll Core API + Generation Intake tests PASSED successfully!")

if __name__ == "__main__":
    asyncio.run(test_api_full_flow())
