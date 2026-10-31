"""In-process WebSocket fan-out: one channel per project plus one per user (inbox).

Sync request handlers run in a threadpool, so `publish` hands the coroutine to
the event loop captured at startup. For multi-instance deployments swap this
for Redis pub/sub behind the same interface.
"""
from __future__ import annotations

import asyncio
import json
from collections import defaultdict

from fastapi import WebSocket


class Hub:
    def __init__(self) -> None:
        self.channels: dict[int | str, set[WebSocket]] = defaultdict(set)
        self.loop: asyncio.AbstractEventLoop | None = None

    async def join(self, project_id: int | str, ws: WebSocket) -> None:
        self.loop = asyncio.get_running_loop()
        self.channels[project_id].add(ws)

    def leave(self, project_id: int | str, ws: WebSocket) -> None:
        self.channels[project_id].discard(ws)

    async def _send(self, project_id: int | str, message: str) -> None:
        dead = []
        for ws in list(self.channels.get(project_id, ())):
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.leave(project_id, ws)

    def publish(self, project_id: int | str, event: str, payload: dict, actor_id: int | None = None) -> None:
        if not self.channels.get(project_id) or self.loop is None:
            return
        message = json.dumps({"event": event, "actor_id": actor_id, "data": payload}, default=str)
        try:
            asyncio.run_coroutine_threadsafe(self._send(project_id, message), self.loop)
        except RuntimeError:
            pass

    def publish_user(self, user_id: int, event: str, payload: dict) -> None:
        self.publish(f"user:{user_id}", event, payload)


hub = Hub()
