import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Query, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse

from server.config import ALLOWED_ORIGINS, DATA_DIR
from server.db import init_db
from server.db_writer import db_writer
from server.state import app_state
from server.auth import verify_token
from server.sse import sse_broker
from server.routers import (
    auth_router, models_router, tasks_router, admin_router
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("snapgen.main")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting SnapGen Studio Backend Engine...")
    # 1. Initialize database models & engine
    await init_db()
    # 2. Start background DB writer
    db_writer.start()
    # 3. Load models catalog
    app_state.load_catalog()
    yield
    logger.info("Shutting down SnapGen Studio Backend Engine...")
    await db_writer.stop()

app = FastAPI(
    title="SnapGen Studio API",
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

# Include Routers
app.include_router(auth_router.router)
app.include_router(models_router.router)
app.include_router(tasks_router.router)
app.include_router(admin_router.router)

# Mount media directories
app.mount("/videos", StaticFiles(directory=str(DATA_DIR / "videos")), name="videos")
app.mount("/images", StaticFiles(directory=str(DATA_DIR / "images")), name="images")
app.mount("/uploads", StaticFiles(directory=str(DATA_DIR / "uploads")), name="uploads")

@app.get("/api/health")
async def health_check():
    return {"status": "ok", "version": "1.6.0"}

@app.get("/api/events")
async def sse_events(request: Request, token: str = Query(...)):
    """Server-Sent Events endpoint authenticated via media/session token query param."""
    verified = verify_token(token, expected_purpose="media")
    if not verified:
        # Also allow session token for flexibility
        verified = verify_token(token, expected_purpose="session")
    if not verified:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token media tidak valid atau telah kedaluwarsa."
        )

    user_id, _, _ = verified
    queue = await sse_broker.connect(user_id)

    async def event_generator():
        try:
            # Send initial ping & retry interval so EventSource seamlessly reconnects
            yield "retry: 1500\nevent: ping\ndata: {\"status\": \"connected\"}\n\n"
            for _ in range(10):
                if await request.is_disconnected():
                    break
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=1.5)
                    yield payload
                except asyncio.TimeoutError:
                    continue
            yield "event: ping\ndata: {}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            await sse_broker.disconnect(user_id, queue)

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

