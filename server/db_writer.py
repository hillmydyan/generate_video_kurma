import asyncio
import logging
from typing import Any, Callable, Coroutine
from server.db import AsyncSessionLocal

logger = logging.getLogger("snapgen.db_writer")

class DBWriter:
    def __init__(self):
        self._queue: asyncio.Queue = asyncio.Queue()
        self._running: bool = False
        self._task: asyncio.Task = None

    def start(self):
        if not self._running:
            self._running = True
            self._task = asyncio.create_task(self._worker_loop())
            logger.info("DBWriter background worker started")

    async def stop(self):
        self._running = False
        if self._task:
            await self._queue.put(None)  # Sentinel to stop
            await self._task

    def enqueue(self, write_func: Callable[[Any], Coroutine]):
        """Enqueue an async function that takes an AsyncSession and commits."""
        self._queue.put_nowait(write_func)

    async def _worker_loop(self):
        while self._running:
            try:
                item = await self._queue.get()
                if item is None:
                    break
                if AsyncSessionLocal:
                    async with AsyncSessionLocal() as session:
                        async with session.begin():
                            await item(session)
                self._queue.task_done()
            except Exception as e:
                logger.error(f"Error in DBWriter worker: {e}", exc_info=True)
                await asyncio.sleep(0.5)

db_writer = DBWriter()

