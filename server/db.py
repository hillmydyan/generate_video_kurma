import logging
from datetime import datetime
from typing import Optional
from sqlalchemy import (
    Column, String, Integer, Float, Boolean, Text, DateTime, ForeignKey, Index
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from server.config import POSTGRES_URL, DATA_DIR
from config.clock import now

logger = logging.getLogger("snapgen.db")
Base = declarative_base()

class User(Base):
    __tablename__ = "users"

    id = Column(String(64), primary_key=True)
    name = Column(String(128), nullable=False)
    password_hash = Column(String(256), nullable=False)
    salt = Column(String(64), nullable=False)
    role = Column(String(32), nullable=False, default="DIVISION_MEMBER")  # SUPER_ADMIN, DIVISION_ADMIN, DIVISION_MEMBER
    division_id = Column(String(64), nullable=False, default="kantor_a")
    is_active = Column(Boolean, nullable=False, default=True)
    token_version = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime, nullable=False, default=now)

class Division(Base):
    __tablename__ = "divisions"

    id = Column(String(64), primary_key=True)
    name = Column(String(128), nullable=False)
    allowed_models_json = Column(Text, nullable=False, default="[]")  # JSON list of model keys, empty = all
    default_video_model = Column(String(64), nullable=True)
    default_image_model = Column(String(64), nullable=True)
    quota_outputs = Column(Integer, nullable=True)  # null = follow global
    quota_window_days = Column(Integer, nullable=True)  # null = follow global
    created_at = Column(DateTime, nullable=False, default=now)

class ProviderAccount(Base):
    __tablename__ = "provider_accounts"

    id = Column(String(64), primary_key=True)
    label = Column(String(128), nullable=False)
    api_key_enc = Column(Text, nullable=False)
    plan = Column(String(64), nullable=False, default="Premium")
    division_id = Column(String(64), nullable=False)
    slot = Column(String(32), nullable=False, default="primary")  # primary, secondary
    status = Column(String(32), nullable=False, default="active")  # active, credits_low, depleted, rate_limited, expired, disabled
    breaker_until = Column(DateTime, nullable=True)
    credits_cached = Column(Integer, nullable=False, default=0)
    credits_reserved = Column(Integer, nullable=False, default=0)
    credits_checked_at = Column(DateTime, nullable=True)
    outputs_today = Column(Integer, nullable=False, default=0)
    outputs_total = Column(Integer, nullable=False, default=0)
    last_used_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=now)

class Batch(Base):
    __tablename__ = "batches"

    id = Column(String(64), primary_key=True)
    user_id = Column(String(64), nullable=False, index=True)
    kantor_id = Column(String(64), nullable=False, index=True)
    nama = Column(String(128), nullable=False)
    foto_path = Column(String(256), nullable=False)
    model = Column(String(64), nullable=False)
    rasio = Column(String(32), nullable=False, default="9:16")
    durasi = Column(Integer, nullable=False, default=8)
    status = Column(String(32), nullable=False, default="berjalan", index=True)  # berjalan, selesai, sebagian_gagal, dibatalkan
    total_kr = Column(Integer, nullable=False, default=0)
    idempotency_key = Column(String(128), nullable=True, index=True)
    created_at = Column(DateTime, nullable=False, default=now, index=True)
    finished_at = Column(DateTime, nullable=True)

class CreditLog(Base):
    __tablename__ = "credit_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(64), nullable=False, index=True)
    kantor_id = Column(String(64), nullable=False, index=True)
    batch_id = Column(String(64), nullable=True, index=True)
    task_id = Column(String(64), nullable=True, index=True)
    delta_kr = Column(Integer, nullable=False)
    balance_after = Column(Integer, nullable=False)
    alasan = Column(Text, nullable=False)
    created_at = Column(DateTime, nullable=False, default=now, index=True)

class Task(Base):
    __tablename__ = "tasks"

    task_id = Column(String(64), primary_key=True)
    user_id = Column(String(64), nullable=False, index=True)
    division_id = Column(String(64), nullable=False, index=True)
    batch_id = Column(String(64), nullable=True, index=True)
    urutan = Column(Integer, nullable=False, default=1)
    status = Column(String(32), nullable=False, default="queued", index=True)  # queued, generating, downloading, completed, failed, cancelled
    prompt = Column(Text, nullable=False)
    prompt_index = Column(Integer, default=0)
    total_prompts = Column(Integer, default=1)
    group_index = Column(Integer, default=0)
    copy_index = Column(Integer, default=0)
    image_path = Column(String(256), nullable=True)
    image_mode = Column(String(32), nullable=False, default="none")  # shared, per_entry, none
    model_key = Column(String(64), nullable=False)
    media_type = Column(String(32), nullable=False, default="video")  # video, image
    options_json = Column(Text, nullable=False, default="{}")
    credit_cost = Column(Integer, nullable=False, default=0)
    kr_biaya = Column(Integer, nullable=False, default=0)
    kr_reserved = Column(Integer, nullable=False, default=0)
    credit_estimated = Column(Integer, nullable=False, default=0)
    credit_used = Column(Integer, nullable=False, default=0)
    provider_job_id = Column(String(128), nullable=True, index=True)
    provider_pct = Column(Integer, nullable=False, default=0)
    progress = Column(Integer, nullable=False, default=0)
    provider_expired_at = Column(DateTime, nullable=True)
    account_id = Column(String(64), nullable=True)
    est_seconds = Column(Integer, nullable=False, default=180)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    result_url = Column(String(512), nullable=True)
    video_path = Column(String(512), nullable=True)
    error = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    task_retries = Column(Integer, nullable=False, default=0)
    percobaan = Column(Integer, nullable=False, default=0)
    requeued_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=now, index=True)
    updated_at = Column(DateTime, nullable=False, default=now)

class QuotaUsage(Base):
    __tablename__ = "quota_usage"

    task_id = Column(String(64), primary_key=True)
    user_id = Column(String(64), nullable=False, index=True)
    credits = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, nullable=False, default=now, index=True)

class PromptBehavior(Base):
    __tablename__ = "prompt_behavior"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(64), nullable=False)
    division_id = Column(String(64), nullable=False)
    model_key = Column(String(64), nullable=False)
    options_hash = Column(String(64), nullable=True)
    prompt_hash = Column(String(64), nullable=True)
    prompt_len = Column(Integer, default=0)
    has_image = Column(Boolean, default=False)
    result = Column(String(32), default="completed")
    gen_sec = Column(Float, nullable=False, default=0.0)
    account_id = Column(String(64), nullable=True)
    created_at = Column(DateTime, nullable=False, default=now)

class FactoryBatch(Base):
    __tablename__ = "factory_batches"

    batch_id = Column(String(64), primary_key=True)
    user_id = Column(String(64), nullable=False, index=True)
    division_id = Column(String(64), nullable=False, index=True)
    name = Column(String(128), nullable=False)
    mode = Column(String(32), nullable=False)  # multi_prompt, multi_asset, csv
    status = Column(String(32), nullable=False, default="queued")
    paused = Column(Boolean, nullable=False, default=False)
    config = Column(Text, nullable=False)  # JSON configuration
    total_tasks = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, nullable=False, default=now)
    finished_at = Column(DateTime, nullable=True)

# Engine & Session setup
engine = None
_session_maker = None

class _AsyncSessionLocalProxy:
    def __call__(self, *args, **kwargs):
        global _session_maker
        if _session_maker is None:
            raise RuntimeError("Database is not initialized. Call await init_db() first.")
        return _session_maker(*args, **kwargs)

    def __bool__(self):
        return True

AsyncSessionLocal = _AsyncSessionLocalProxy()

async def init_db():
    global engine, _session_maker
    if engine is not None:
        try:
            await engine.dispose()
        except Exception:
            pass
    target_url = POSTGRES_URL
    use_postgres = True

    if "localhost" in target_url or "127.0.0.1" in target_url:
        import socket
        try:
            with socket.create_connection(("127.0.0.1", 5432), timeout=0.2):
                pass
        except OSError:
            use_postgres = False

    if use_postgres:
        try:
            engine = create_async_engine(target_url, echo=False)
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            from migrations import run_all_migrations
            await run_all_migrations(engine)
            logger.info(f"Connected to PostgreSQL database at {target_url}")
        except Exception as e:
            logger.warning(f"PostgreSQL connection failed ({e}). Falling back to local SQLite.")
            use_postgres = False

    if not use_postgres:
        fallback_path = DATA_DIR / "snapgen_dev.db"
        fallback_url = f"sqlite+aiosqlite:///{fallback_path}"
        engine = create_async_engine(fallback_url, echo=False)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        from migrations import run_all_migrations
        await run_all_migrations(engine)
        logger.info(f"Initialized local SQLite database at {fallback_url}")

    _session_maker = async_sessionmaker(
        bind=engine,
        class_=AsyncSession,
        expire_on_commit=False
    )
