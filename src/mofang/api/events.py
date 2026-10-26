from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, AsyncIterator


@dataclass(frozen=True)
class Event:
    id: int
    type: str
    run_id: str
    episode_id: str | None
    ts: str
    data: dict[str, Any]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def format_sse(event: Event) -> str:
    payload = {
        "id": event.id,
        "type": event.type,
        "run_id": event.run_id,
        "episode_id": event.episode_id,
        "ts": event.ts,
        "data": event.data,
    }
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return f"id: {event.id}\nevent: {event.type}\ndata: {data}\n\n"


def parse_last_event_id(value: str | None) -> int:
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def effective_after(last_event_id: str | None, after: int | None) -> int:
    return max(parse_last_event_id(last_event_id), after or 0)


@dataclass
class _RunChannel:
    history: list[Event] = field(default_factory=list)
    subscribers: set[asyncio.Queue[Event]] = field(default_factory=set)


class RunEventBus:
    def __init__(self) -> None:
        self._channels: dict[str, _RunChannel] = defaultdict(_RunChannel)

    def publish(
        self,
        run_id: str,
        type: str,
        data: dict[str, Any],
        episode_id: str | None = None,
    ) -> Event:
        channel = self._channels[run_id]
        event = Event(
            id=len(channel.history) + 1,
            type=type,
            run_id=run_id,
            episode_id=episode_id,
            ts=_now(),
            data=data,
        )
        channel.history.append(event)
        for queue in list(channel.subscribers):
            queue.put_nowait(event)
        return event

    def history(self, run_id: str, after: int = 0) -> list[Event]:
        return [
            event for event in self._channels[run_id].history if event.id > after
        ]

    async def stream(
        self, run_id: str, after: int = 0, heartbeat: float = 15.0
    ) -> AsyncIterator[str]:
        channel = self._channels[run_id]
        queue: asyncio.Queue[Event] = asyncio.Queue()
        channel.subscribers.add(queue)
        last = after
        try:
            for event in self.history(run_id, after):
                last = event.id
                yield format_sse(event)
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=heartbeat)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                    continue
                if event.id <= last:
                    continue
                last = event.id
                yield format_sse(event)
        finally:
            channel.subscribers.discard(queue)
