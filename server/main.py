import asyncio
import logging
from pathlib import Path
from typing import Optional
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Query, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from sqlalchemy import select, or_

from server.config import ALLOWED_ORIGINS, DATA_DIR
from server.db import init_db, AsyncSessionLocal, User, Task, Batch
from server.db_writer import db_writer
from server.state import app_state
from server.auth import verify_token
from server.sse import sse_broker
from server.worker import stop_all_workers, recover_unfinished_tasks_on_startup
from server.routers import (
    auth_router, models_router, tasks_router, admin_router, batches_router
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("snapgen.main")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting KurmaFlow Backend Engine...")
    # 1. Initialize database models, migrations & engine
    await init_db()
    # 2. Start background DB writer
    db_writer.start()
    # 3. Load models catalog
    app_state.load_catalog()
    # 4. Recover unfinished queued/generating tasks from DB
    await recover_unfinished_tasks_on_startup()
    yield
    logger.info("Shutting down KurmaFlow Backend Engine...")
    await stop_all_workers()
    await db_writer.stop()

app = FastAPI(
    title="KurmaFlow API",
    version="1.6.0",
    lifespan=lifespan
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def sync_media_cookie_middleware(request: Request, call_next):
    """Sync bearer token into an HttpOnly cookie so browser <video>/<img> tags authenticate seamlessly."""
    auth_header = request.headers.get("Authorization", "")
    bearer_tok = None
    if auth_header.startswith("Bearer "):
        bearer_tok = auth_header.split(" ", 1)[1].strip()
    response = await call_next(request)
    if bearer_tok and request.cookies.get("snapgen_media_token") != bearer_tok:
        response.set_cookie(
            key="snapgen_media_token",
            value=bearer_tok,
            httponly=True,
            samesite="lax",
            path="/",
        )
    return response


# Include Routers
app.include_router(auth_router.router)
app.include_router(models_router.router)
app.include_router(tasks_router.router)
app.include_router(batches_router.router)
app.include_router(admin_router.router)


async def _authenticate_media_request(request: Request, token: Optional[str]) -> dict:
    raw_token = token
    if not raw_token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            raw_token = auth_header.split(" ", 1)[1].strip()
    if not raw_token:
        raw_token = request.cookies.get("snapgen_media_token")
    if not raw_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Autentikasi diperlukan untuk mengakses file media."
        )

    verified = verify_token(raw_token, expected_purpose="media") or verify_token(raw_token, expected_purpose="session")
    if not verified:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token media tidak valid atau telah kedaluwarsa."
        )

    user_id, token_ver, _ = verified
    async with AsyncSessionLocal() as session:
        u = await session.get(User, user_id)
        if not u or not u.is_active or u.token_version != token_ver:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Sesi pengguna tidak valid."
            )
        return {
            "id": u.id,
            "role": u.role,
            "division_id": u.division_id,
        }


def _check_media_owner(owner_id: str, owner_division: Optional[str], caller: dict) -> None:
    if caller["role"] == "SUPER_ADMIN":
        return
    if caller["role"] == "DIVISION_ADMIN" and owner_division and owner_division == caller["division_id"]:
        return
    if caller["id"] == owner_id:
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Akses file media ditolak.")


@app.get("/videos/{user_id}/{filename}")
async def serve_video(
    user_id: str,
    filename: str,
    request: Request,
    token: Optional[str] = Query(None),
):
    caller = await _authenticate_media_request(request, token)
    safe_name = Path(filename).name
    file_path = DATA_DIR / "videos" / Path(user_id).name / safe_name

    owner_div = None
    async with AsyncSessionLocal() as session:
        owner_u = await session.get(User, user_id)
        if owner_u:
            owner_div = owner_u.division_id

    _check_media_owner(user_id, owner_div, caller)
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File video tidak ditemukan.")
    return FileResponse(file_path, media_type="video/mp4")


@app.get("/images/{user_id}/{filename}")
async def serve_image(
    user_id: str,
    filename: str,
    request: Request,
    token: Optional[str] = Query(None),
):
    caller = await _authenticate_media_request(request, token)
    safe_name = Path(filename).name
    file_path = DATA_DIR / "images" / Path(user_id).name / safe_name

    owner_div = None
    async with AsyncSessionLocal() as session:
        owner_u = await session.get(User, user_id)
        if owner_u:
            owner_div = owner_u.division_id

    _check_media_owner(user_id, owner_div, caller)
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File gambar tidak ditemukan.")
    return FileResponse(file_path)


@app.get("/uploads/{filename}")
async def serve_upload(
    filename: str,
    request: Request,
    token: Optional[str] = Query(None),
):
    caller = await _authenticate_media_request(request, token)
    safe_name = Path(filename).name
    rel_path = f"uploads/{safe_name}"
    file_path = DATA_DIR / "uploads" / safe_name
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File foto tidak ditemukan.")

    # Verify ownership via Batch or Task referencing this upload
    async with AsyncSessionLocal() as session:
        b_stmt = select(Batch).where(Batch.foto_path == rel_path).limit(1)
        b_obj = (await session.execute(b_stmt)).scalar_one_or_none()
        if b_obj:
            _check_media_owner(b_obj.user_id, b_obj.kantor_id, caller)
        else:
            t_stmt = select(Task).where(Task.image_path == rel_path).limit(1)
            t_obj = (await session.execute(t_stmt)).scalar_one_or_none()
            if t_obj:
                _check_media_owner(t_obj.user_id, t_obj.division_id, caller)

    return FileResponse(file_path)


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "version": "1.6.0"}


@app.get("/api/events")
async def sse_events(request: Request, token: str = Query(...)):
    """Server-Sent Events endpoint authenticated via media/session token query param."""
    verified = verify_token(token, expected_purpose="media")
    if not verified:
        verified = verify_token(token, expected_purpose="session")
    if not verified:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token media tidak valid atau telah kedaluwarsa."
        )

    user_id, _, _ = verified
    queue = await sse_broker.connect(user_id)

    async def event_generator():
        yield "retry: 2500\nevent: ping\ndata: {\"status\": \"connected\"}\n\n"
        while not queue.empty():
            try:
                payload = queue.get_nowait()
                yield payload
            except asyncio.QueueEmpty:
                break

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server.main:app", host="127.0.0.1", port=8005, reload=True)
