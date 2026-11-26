from __future__ import annotations

import asyncio
import json
import os
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncIterator, TextIO


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


def event_payload(event: Event) -> dict[str, Any]:
    return {
        "id": event.id,
        "type": event.type,
        "run_id": event.run_id,
        "episode_id": event.episode_id,
        "ts": event.ts,
        "data": event.data,
    }


def format_sse(event: Event) -> str:
    data = json.dumps(
        event_payload(event), ensure_ascii=False, separators=(",", ":")
    )
    return f"id: {event.id}\nevent: {event.type}\ndata: {data}\n\n"


class EventJournal:
    """把事件流逐条追加到 events-<run_id>.jsonl。

    每条写完立即 flush，进程被强杀时文件里保留"到崩溃为止"的完整前缀；
    fsync 默认关闭，因为逐条 fsync 会显著拖慢长跑，需要时再打开。
    """

    def __init__(self, directory: Path, *, fsync: bool = False) -> None:
        self.directory = Path(directory)
        self.fsync = fsync
        self._handles: dict[str, TextIO] = {}

    def file_path(self, run_id: str) -> Path:
        return self.directory / f"events-{run_id}.jsonl"

    def write(self, event: Event) -> None:
        handle = self._handles.get(event.run_id)
        if handle is None:
            self.directory.mkdir(parents=True, exist_ok=True)
            handle = self.file_path(event.run_id).open("a", encoding="utf-8")
            self._handles[event.run_id] = handle
        line = json.dumps(
            event_payload(event), ensure_ascii=False, separators=(",", ":")
        )
        handle.write(line + "\n")
        handle.flush()
        if self.fsync:
            os.fsync(handle.fileno())

    def close(self) -> None:
        for handle in self._handles.values():
            handle.close()
        self._handles.clear()


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
    def __init__(self, journal: EventJournal | None = None) -> None:
        self._channels: dict[str, _RunChannel] = defaultdict(_RunChannel)
        self._journal = journal

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
        if self._journal is not None:
            # 先落盘再通知订阅者：即使下游出错，崩溃前缀里也有这条事件。
            self._journal.write(event)
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
