from importlib import import_module
from sqlalchemy.ext.asyncio import AsyncEngine

_m001 = import_module("migrations.001_batches_and_credit_logs")


async def run_all_migrations(engine: AsyncEngine) -> None:
    await _m001.run_migration(engine)

