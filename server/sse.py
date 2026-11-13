import asyncio
import json
import logging
from typing import Dict, Set, Any
from fastapi import Request
from starlette.responses import StreamingResponse

logger = logging.getLogger("snapgen.sse")

class SSEBroker:
    def __init__(self):
        # Persistent per-user mailbox queues so events are never lost between polls
        self._user_mailboxes: Dict[str, asyncio.Queue] = {}
        # Maps user_id -> set of active asyncio.Queue
        self._user_queues: Dict[str, Set[asyncio.Queue]] = {}
        # Admin broadcast queues (SUPER_ADMIN and DIVISION_ADMIN)
        self._admin_queues: Set[asyncio.Queue] = set()
        self._lock: Any = None
        self._loop: Any = None

    def _ensure_loop(self) -> asyncio.Lock:
        loop = asyncio.get_running_loop()
        if self._lock is None or self._loop is not loop:
            self._lock = asyncio.Lock()
            self._user_mailboxes = {}
            self._user_queues = {}
            self._admin_queues = set()
            self._loop = loop
        return self._lock

    async def get_mailbox(self, user_id: str) -> asyncio.Queue:
        async with self._ensure_loop():
            if user_id not in self._user_mailboxes:
                self._user_mailboxes[user_id] = asyncio.Queue(maxsize=100)
            return self._user_mailboxes[user_id]

    async def connect(self, user_id: str, is_admin: bool = False) -> asyncio.Queue:
        return await self.get_mailbox(user_id)

    async def disconnect(self, user_id: str, queue: asyncio.Queue, is_admin: bool = False):
        pass

    async def broadcast_user(self, user_id: str, event_type: str, data: Any):
        """Send event to a specific user's mailbox."""
        payload = f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
        q = await self.get_mailbox(user_id)
        if q.full():
            try:
                q.get_nowait()
            except asyncio.QueueEmpty:
                pass
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            pass

    async def broadcast_admin(self, event_type: str, data: Any):
        """Send event to all user mailboxes."""
        await self.broadcast_all(event_type, data)

    async def broadcast_all(self, event_type: str, data: Any):
        """Broadcast event to every user mailbox."""
        payload = f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
        async with self._ensure_loop():
            queues = list(self._user_mailboxes.values())
        for q in queues:
            if q.full():
                try:
                    q.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                pass

sse_broker = SSEBroker()

