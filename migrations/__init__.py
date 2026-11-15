from importlib import import_module
from sqlalchemy.ext.asyncio import AsyncEngine

_m001 = import_module("migrations.001_batches_and_credit_logs")
_m002 = import_module("migrations.002_monitoring_indexes")


async def run_all_migrations(engine: AsyncEngine) -> None:
    await _m001.run_migration(engine)
    await _m002.run_migration(engine)

