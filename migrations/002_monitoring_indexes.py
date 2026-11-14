import logging
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

logger = logging.getLogger("snapgen.migrations")

MIGRATION_ID = "002_monitoring_indexes"

# Indexes for Admin Monitoring (date range per kantor / per user). Idempotent.
INDEXES = [
    ("ix_tasks_division_created", "tasks (division_id, created_at)"),
    ("ix_tasks_user_created", "tasks (user_id, created_at)"),
]


async def run_migration(engine: AsyncEngine) -> None:
    async with engine.begin() as conn:
        for name, target in INDEXES:
            await conn.execute(text(f"CREATE INDEX IF NOT EXISTS {name} ON {target}"))
