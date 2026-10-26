import json

from mofang.api.events import (
    RunEventBus,
    format_sse,
    parse_last_event_id,
)


def test_publish_and_history() -> None:
    bus = RunEventBus()
    first = bus.publish("r1", "run.started", {"a": 1})
    second = bus.publish("r1", "episode.started", {}, episode_id="e1")
    assert (first.id, second.id) == (1, 2)
    assert [event.id for event in bus.history("r1", after=1)] == [2]
    assert bus.history("r1", after=99) == []


def test_format_sse_and_last_event_id() -> None:
    bus = RunEventBus()
    event = bus.publish("r1", "tool.call", {"tool": "turn"})
    text = format_sse(event)
    assert text.startswith("id: 1\nevent: tool.call\ndata: ")
    assert text.endswith("\n\n")
    payload = json.loads(text.split("data: ", 1)[1].strip())
    assert payload == {
        "id": 1,
        "type": "tool.call",
        "run_id": "r1",
        "episode_id": None,
        "ts": event.ts,
        "data": {"tool": "turn"},
    }
    assert parse_last_event_id("2") == 2
    assert parse_last_event_id(None) == 0
    assert parse_last_event_id("bad") == 0


async def test_stream_replays_and_receives_live_events() -> None:
    bus = RunEventBus()
    bus.publish("r1", "run.started", {})
    stream = bus.stream("r1", after=0, heartbeat=0.05)
    first = await anext(stream)
    assert "event: run.started" in first
    bus.publish("r1", "run.finished", {})
    second = await anext(stream)
    assert "event: run.finished" in second
    ping = await anext(stream)
    assert ping == ": ping\n\n"
    await stream.aclose()
