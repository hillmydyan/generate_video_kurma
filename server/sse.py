import asyncio
import json
import logging
from typing import Dict, Set, Any
from fastapi import Request
from starlette.responses import StreamingResponse

logger = logging.getLogger("snapgen.sse")

class SSEBroker:
    def __init__(self):
        # Maps user_id -> set of asyncio.Queue
        self._user_queues: Dict[str, Set[asyncio.Queue]] = {}
        # Admin broadcast queues (SUPER_ADMIN and DIVISION_ADMIN)
        self._admin_queues: Set[asyncio.Queue] = set()
        self._lock = asyncio.Lock()

    async def connect(self, user_id: str, is_admin: bool = False) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=100)
        async with self._lock:
            if user_id not in self._user_queues:
                self._user_queues[user_id] = set()
            self._user_queues[user_id].add(queue)
            if is_admin:
                self._admin_queues.add(queue)
        logger.debug(f"SSE client connected: user={user_id}, admin={is_admin}")
        return queue

    async def disconnect(self, user_id: str, queue: asyncio.Queue, is_admin: bool = False):
        async with self._lock:
            if user_id in self._user_queues:
                self._user_queues[user_id].discard(queue)
                if not self._user_queues[user_id]:
                    del self._user_queues[user_id]
            if is_admin:
                self._admin_queues.discard(queue)
        logger.debug(f"SSE client disconnected: user={user_id}")

    async def broadcast_user(self, user_id: str, event_type: str, data: Any):
        """Send event to all active connections of a specific user."""
        payload = f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
        async with self._lock:
            queues = list(self._user_queues.get(user_id, []))
        for q in queues:
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                pass

    async def broadcast_admin(self, event_type: str, data: Any):
        """Send event to all admin connections."""
        payload = f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
        async with self._lock:
            queues = list(self._admin_queues)
        for q in queues:
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                pass

    async def broadcast_all(self, event_type: str, data: Any):
        """Broadcast event to every connected user."""
        payload = f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
        async with self._lock:
            all_queues = [q for set_q in self._user_queues.values() for q in set_q]
        for q in all_queues:
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                pass

sse_broker = SSEBroker()

