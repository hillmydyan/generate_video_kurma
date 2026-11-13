import logging
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

logger = logging.getLogger("snapgen.migrations")

MIGRATION_ID = "001_batches_and_credit_logs"


async def run_migration(engine: AsyncEngine) -> None:
    """
    Idempotent schema migration for:
    - schema_migrations tracking table
    - batches table
    - credit_logs table
    - new columns on tasks (urutan, progress, video_path, error_message, kr_biaya, percobaan, kr_reserved)
    - new column on provider_accounts (credits_reserved)
    """
    async with engine.begin() as conn:
        dialect = conn.dialect.name

        # 1. Create schema_migrations table
        await conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version VARCHAR(128) PRIMARY KEY,
                    applied_at TIMESTAMP NOT NULL
                )
                """
            )
        )

        # 2. Ensure batches table exists
        await conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS batches (
                    id VARCHAR(64) PRIMARY KEY,
                    user_id VARCHAR(64) NOT NULL,
                    kantor_id VARCHAR(64) NOT NULL,
                    nama VARCHAR(128) NOT NULL,
                    foto_path VARCHAR(256) NOT NULL,
                    model VARCHAR(64) NOT NULL,
                    rasio VARCHAR(32) NOT NULL DEFAULT '9:16',
                    durasi INTEGER NOT NULL DEFAULT 8,
                    status VARCHAR(32) NOT NULL DEFAULT 'berjalan',
                    total_kr INTEGER NOT NULL DEFAULT 0,
                    idempotency_key VARCHAR(128),
                    created_at TIMESTAMP NOT NULL,
                    finished_at TIMESTAMP
                )
                """
            )
        )

        # 3. Ensure credit_logs table exists
        if dialect == "postgresql":
            await conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS credit_logs (
                        id SERIAL PRIMARY KEY,
                        user_id VARCHAR(64) NOT NULL,
                        kantor_id VARCHAR(64) NOT NULL,
                        batch_id VARCHAR(64),
                        task_id VARCHAR(64),
                        delta_kr INTEGER NOT NULL,
                        balance_after INTEGER NOT NULL,
                        alasan TEXT NOT NULL,
                        created_at TIMESTAMP NOT NULL
                    )
                    """
                )
            )
        else:
            await conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS credit_logs (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id VARCHAR(64) NOT NULL,
                        kantor_id VARCHAR(64) NOT NULL,
                        batch_id VARCHAR(64),
                        task_id VARCHAR(64),
                        delta_kr INTEGER NOT NULL,
                        balance_after INTEGER NOT NULL,
                        alasan TEXT NOT NULL,
                        created_at TIMESTAMP NOT NULL
                    )
                    """
                )
            )

        # 4. Expand tasks table with batch_tasks columns if missing
        task_columns = [
            ("urutan", "INTEGER NOT NULL DEFAULT 1"),
            ("progress", "INTEGER NOT NULL DEFAULT 0"),
            ("video_path", "VARCHAR(512)"),
            ("error_message", "TEXT"),
            ("kr_biaya", "INTEGER NOT NULL DEFAULT 0"),
            ("percobaan", "INTEGER NOT NULL DEFAULT 0"),
            ("kr_reserved", "INTEGER NOT NULL DEFAULT 0"),
        ]
        await _add_columns_if_missing(conn, dialect, "tasks", task_columns)

        # 5. Expand provider_accounts table with credits_reserved if missing
        account_columns = [
            ("credits_reserved", "INTEGER NOT NULL DEFAULT 0"),
        ]
        await _add_columns_if_missing(conn, dialect, "provider_accounts", account_columns)

        # 6. Expand batches table with idempotency_key if missing
        batch_columns = [
            ("idempotency_key", "VARCHAR(128)"),
        ]
        await _add_columns_if_missing(conn, dialect, "batches", batch_columns)

        # 7. Backfill tasks columns from legacy fields where needed
        await conn.execute(
            text(
                """
                UPDATE tasks
                SET urutan = COALESCE(prompt_index, 0) + 1,
                    progress = COALESCE(provider_pct, 0),
                    video_path = COALESCE(video_path, result_url),
                    error_message = COALESCE(error_message, error),
                    kr_biaya = COALESCE(credit_cost, 0),
                    percobaan = COALESCE(task_retries, 0)
                WHERE kr_biaya = 0 AND credit_cost > 0
                """
            )
        )


async def _add_columns_if_missing(conn, dialect: str, table_name: str, columns: list[tuple[str, str]]) -> None:
    if dialect == "postgresql":
        for col_name, col_type in columns:
            await conn.execute(
                text(f"ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS {col_name} {col_type}")
            )
    else:
        res = await conn.execute(text(f"PRAGMA table_info({table_name})"))
        existing_cols = {row[1] for row in res.fetchall()}
        for col_name, col_type in columns:
            if col_name not in existing_cols:
                await conn.execute(
                    text(f"ALTER TABLE {table_name} ADD COLUMN {col_name} {col_type}")
                )
                logger.info(f"Migrated column {table_name}.{col_name}")
