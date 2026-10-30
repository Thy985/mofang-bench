from mofang.models.provider import ModelTurn
from mofang.runner.budget import Budget
from mofang.runner.episode import EpisodeRunner
from test_episode import (  # noqa: F401  # 复用现有 runner 测试的任务/求解器 fixture
    make_task,
    table_solver,
)


class StreamingFakeProvider:
    def __init__(self) -> None:
        self.calls = 0

    async def chat(self, messages, tools, params) -> ModelTurn:
        raise AssertionError("streaming provider must use chat_stream")

    async def chat_stream(self, messages, tools, params, on_delta=None) -> ModelTurn:
        self.calls += 1
        if self.calls == 1:
            if on_delta is not None:
                on_delta("thinking", "aa")
                on_delta("thinking", "bb")
                on_delta("content", "hi")
            return ModelTurn(
                content="hi",
                reasoning="aabb",
                tool_calls=[],
            )
        if on_delta is not None:
            on_delta("thinking", "second turn thought")
        return ModelTurn(
            content=None,
            reasoning="second turn thought",
            tool_calls=[],
        )

    async def probe_tools(self) -> bool:
        return True


async def test_thinking_deltas_and_message_payload(table_solver) -> None:
    task = make_task(table_solver, ["R"])
    provider = StreamingFakeProvider()
    events: list[tuple[str, dict]] = []
    result = await EpisodeRunner(
        provider=provider, solver=table_solver, budget=Budget(max_moves=10)
    ).run(task, emit=lambda kind, payload: events.append((kind, payload)))
    kinds = [kind for kind, _ in events]
    assert "thinking.delta" in kinds
    deltas = [payload for kind, payload in events if kind == "thinking.delta"]
    assert deltas[0]["seq"] == 0
    # 后续 turn 也会发 thinking.delta，这里只校验第一个 turn 的增量拼合
    assert "".join(d["text"] for d in deltas if d["seq"] == 0) == "aabb"
    message = next(payload for kind, payload in events if kind == "model.message")
    assert message["thinking"] == "aabb"
    # 第二个 turn：无工具调用会触发 nudge，seq 递增
    message2 = [p for k, p in events if k == "model.message"][1]
    assert message2["thinking"] == "second turn thought"
    assert result.status.value == "stopped_unsolved"
    steps = result.steps
    assert steps[0].result["thinking"] == "aabb"
    assert steps[0].result["content"] == "hi"


def test_throttle_merges_small_deltas() -> None:
    from mofang.runner.episode import ThinkingThrottle

    out: list[dict] = []
    throttle = ThinkingThrottle(
        lambda kind, payload: out.append(payload), seq=3, max_chars=64
    )
    for ch in "abcdefgh":  # 8 次 1 字符增量，均低于 64 字符阈值
        throttle("thinking", ch)
    assert out == []
    throttle.flush()
    assert len(out) == 1
    assert out[0]["seq"] == 3
    assert out[0]["text"] == "abcdefgh"
