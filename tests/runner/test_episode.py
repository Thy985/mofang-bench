import asyncio

import pytest

from mofang.cube.moves import apply_moves, invert_moves
from mofang.cube.state import CubeState
from mofang.cube.table2x2 import Table2x2Solver, build_table
from mofang.models.provider import (
    FakeProvider,
    ModelTurn,
    ProviderError,
    ToolCall,
    Usage,
)
from mofang.runner.budget import Budget
from mofang.runner.episode import EpisodeRunner, EpisodeStatus
from mofang.tasks.models import Task


class RaisingProvider:
    def __init__(self, kind: str) -> None:
        self.kind = kind

    async def chat(self, messages, tools, params):
        raise ProviderError(self.kind, f"{self.kind} boom")


@pytest.fixture(scope="module")
def table_solver() -> Table2x2Solver:
    return Table2x2Solver(build_table(max_depth=3))


def make_task(solver: Table2x2Solver, moves: list[str]) -> Task:
    state = apply_moves(CubeState.solved(2), moves)
    return Task(
        id="t1",
        cube="2x2",
        scramble=moves,
        scramble_depth=len(moves),
        state=state.to_json(),
        reference_length=solver.distance(state) or 999,
        reference_kind="exact",
        bin="test",
    )


def test_solves_one_move_task(table_solver: Table2x2Solver) -> None:
    task = make_task(table_solver, ["R"])
    solution = invert_moves(task.scramble)
    provider = FakeProvider(
        [
            ModelTurn(
                tool_calls=[
                    ToolCall(
                        id="c1",
                        name="apply_moves",
                        arguments={"moves": solution},
                    )
                ]
            ),
            ModelTurn(content="done"),
        ]
    )
    result = asyncio.run(
        EpisodeRunner(
            provider=provider, solver=table_solver, budget=Budget(max_moves=10)
        ).run(task)
    )
    assert result.status == EpisodeStatus.SOLVED
    assert result.solved
    assert result.moves_used == 1


def test_stops_when_model_gives_up(table_solver: Table2x2Solver) -> None:
    task = make_task(table_solver, ["R"])
    provider = FakeProvider(
        [ModelTurn(content="I cannot solve it") for _ in range(3)]
    )
    result = asyncio.run(
        EpisodeRunner(
            provider=provider, solver=table_solver, budget=Budget(max_moves=10)
        ).run(task)
    )
    assert result.status == EpisodeStatus.STOPPED_UNSOLVED


def test_budget_exceeded(table_solver: Table2x2Solver) -> None:
    task = make_task(table_solver, ["R"])
    turns = [
        ModelTurn(
            tool_calls=[
                ToolCall(
                    id=f"c{i}",
                    name="turn",
                    arguments={"face": "U", "amount": 1},
                )
            ]
        )
        for i in range(5)
    ]
    result = asyncio.run(
        EpisodeRunner(
            provider=FakeProvider(turns),
            solver=table_solver,
            budget=Budget(max_moves=2),
        ).run(task)
    )
    assert result.status == EpisodeStatus.BUDGET_EXCEEDED
    assert result.moves_used == 2


def test_rotated_uniform_state_counts_as_solved(
    table_solver: Table2x2Solver,
) -> None:
    # L2 打乱后执行 R2：六面同色但整体转向，2x2 应判已解出
    task = make_task(table_solver, ["L2"])
    provider = FakeProvider(
        [
            ModelTurn(
                tool_calls=[
                    ToolCall(
                        id="c1",
                        name="apply_moves",
                        arguments={"moves": ["R2"]},
                    )
                ]
            )
        ]
    )
    result = asyncio.run(
        EpisodeRunner(
            provider=provider, solver=table_solver, budget=Budget(max_moves=10)
        ).run(task)
    )
    assert result.status == EpisodeStatus.SOLVED
    assert result.solved


@pytest.mark.parametrize(
    "kind,expected",
    [("timeout", EpisodeStatus.TIMEOUT), ("auth", EpisodeStatus.PROVIDER_ERROR)],
)
def test_provider_errors_are_classified_and_reported(
    kind: str, expected: EpisodeStatus, table_solver: Table2x2Solver
) -> None:
    task = make_task(table_solver, ["R"])
    result = asyncio.run(
        EpisodeRunner(
            provider=RaisingProvider(kind),
            solver=table_solver,
            budget=Budget(max_moves=10),
        ).run(task)
    )
    assert result.status == expected
    assert result.error == f"{kind} boom"


def test_emits_tool_events_and_move_state(
    table_solver: Table2x2Solver,
) -> None:
    task = make_task(table_solver, ["R"])
    provider = FakeProvider(
        [
            ModelTurn(
                tool_calls=[
                    ToolCall(
                        id="c1", name="apply_moves", arguments={"moves": ["R'"]}
                    )
                ]
            )
        ]
    )
    events: list[tuple[str, dict]] = []

    def emit(kind: str, payload: dict) -> None:
        events.append((kind, payload))

    result = asyncio.run(
        EpisodeRunner(
            provider=provider, solver=table_solver, budget=Budget(max_moves=10)
        ).run(task, emit=emit)
    )
    kinds = [kind for kind, _ in events]
    assert "tool.call" in kinds
    assert "tool.result" in kinds
    move_events = [payload for kind, payload in events if kind == "move.applied"]
    assert move_events[-1]["moves"] == ["R'"]
    assert move_events[-1]["state"]["cube"] == "2x2"
    assert result.status == EpisodeStatus.SOLVED
    assert any(step.kind == "model_message" for step in result.steps)


def test_cancelled_before_first_turn(table_solver: Table2x2Solver) -> None:
    task = make_task(table_solver, ["R"])
    provider = FakeProvider([ModelTurn(content="never")])
    cancel = asyncio.Event()
    cancel.set()
    result = asyncio.run(
        EpisodeRunner(
            provider=provider, solver=table_solver, budget=Budget(max_moves=10)
        ).run(task, cancel=cancel)
    )
    assert result.status == EpisodeStatus.CANCELLED
    assert result.error == "cancelled"
    assert provider.calls == []


async def test_cancel_interrupts_inflight_chat(
    table_solver: Table2x2Solver,
) -> None:
    class SlowProvider:
        async def chat(self, messages, tools, params):
            await asyncio.sleep(10)
            raise AssertionError("cancelled chat should not return")

        async def probe_tools(self) -> bool:
            return True

    task = make_task(table_solver, ["R"])
    cancel = asyncio.Event()
    runner = EpisodeRunner(
        provider=SlowProvider(),
        solver=table_solver,
        budget=Budget(max_moves=10),
    )
    run_task = asyncio.create_task(runner.run(task, cancel=cancel))
    await asyncio.sleep(0.05)
    cancel.set()
    result = await asyncio.wait_for(run_task, timeout=2)
    assert result.status == EpisodeStatus.CANCELLED
    assert result.error == "cancelled"


async def test_tool_mode_filters_tools(table_solver: Table2x2Solver) -> None:
    class RecordingProvider:
        def __init__(self) -> None:
            self.tools: list[dict] = []

        async def chat(self, messages, tools, params):
            self.tools = tools
            return ModelTurn(content="done")

        async def probe_tools(self) -> bool:
            return True

    provider = RecordingProvider()
    task = make_task(table_solver, ["R"])
    await EpisodeRunner(
        provider=provider,
        solver=table_solver,
        budget=Budget(max_moves=10),
        tool_mode="batch_only",
    ).run(task)
    names = {tool["function"]["name"] for tool in provider.tools}
    assert names == {"apply_moves", "get_state", "check_solved"}


async def test_events_include_progress_and_usage(table_solver: Table2x2Solver) -> None:
    task = make_task(table_solver, ["R"])
    provider = FakeProvider(
        [
            ModelTurn(
                tool_calls=[
                    ToolCall(
                        id="c1",
                        name="apply_moves",
                        arguments={"moves": ["R'"]},
                    )
                ],
                usage=Usage(prompt_tokens=11, completion_tokens=7),
            )
        ]
    )
    events: list[tuple[str, dict]] = []

    def emit(kind: str, payload: dict) -> None:
        events.append((kind, payload))

    result = await EpisodeRunner(
        provider=provider,
        solver=table_solver,
        budget=Budget(max_moves=10),
    ).run(task, emit=emit)

    message = [payload for kind, payload in events if kind == "model.message"][-1]
    assert message["usage"] == {
        "prompt_tokens": 11,
        "completion_tokens": 7,
    }
    move = [payload for kind, payload in events if kind == "move.applied"][-1]
    assert move["reference_length_after"] == 0
    assert result.status == EpisodeStatus.SOLVED


async def test_plan_mode_nudges_but_does_not_kill_episode(
    table_solver: Table2x2Solver,
) -> None:
    task = make_task(table_solver, ["R", "U"])
    provider = FakeProvider(
        [
            # 不提交计划，先空转一步（R U R，仍在深度 3 表内）
            ModelTurn(
                tool_calls=[
                    ToolCall(id="c1", name="apply_moves", arguments={"moves": ["R"]})
                ]
            ),
            ModelTurn(
                tool_calls=[
                    ToolCall(
                        id="c2",
                        name="apply_moves",
                        arguments={"moves": ["R'", "U'", "R'"]},
                    )
                ]
            ),
        ]
    )
    result = await EpisodeRunner(
        provider=provider,
        solver=table_solver,
        budget=Budget(max_moves=10),
        require_plan=True,
    ).run(task)
    assert result.solved
    assert result.plan is None


async def test_plan_mode_records_plan_and_replays_in_context(
    table_solver: Table2x2Solver,
) -> None:
    task = make_task(table_solver, ["R"])
    plan = {"goal": "还原魔方", "phases": [{"name": "第一步", "approach": "逆转打乱"}]}
    provider = FakeProvider(
        [
            ModelTurn(
                tool_calls=[
                    ToolCall(
                        id="c1",
                        name="submit_plan",
                        arguments={
                            "goal": plan["goal"],
                            "phases": plan["phases"],
                        },
                    )
                ]
            ),
            ModelTurn(
                tool_calls=[
                    ToolCall(
                        id="c2",
                        name="apply_moves",
                        arguments={"moves": ["R'"]},
                    )
                ]
            ),
        ]
    )
    events: list[tuple[str, dict]] = []

    def emit(kind: str, payload: dict) -> None:
        events.append((kind, payload))

    result = await EpisodeRunner(
        provider=provider,
        solver=table_solver,
        budget=Budget(max_moves=10),
        require_plan=True,
    ).run(task, emit=emit)
    assert result.solved
    assert result.plan == plan
    updated = [payload for kind, payload in events if kind == "plan.updated"]
    assert updated and updated[0]["plan"] == plan
    assert updated[0]["revisions"] == 0
    # 计划要穿越 keep_turns 截断：第二轮上下文的最后一条用户消息带计划块
    second_call = provider.calls[-1]
    assert "当前计划——目标：还原魔方" in second_call[-1]["content"]


async def test_plan_tool_absent_without_plan_mode(
    table_solver: Table2x2Solver,
) -> None:
    runner = EpisodeRunner(
        provider=FakeProvider([]),
        solver=table_solver,
        budget=Budget(max_moves=10),
    )
    assert "submit_plan" not in [
        tool["function"]["name"] for tool in runner._tools()
    ]
    runner_plan = EpisodeRunner(
        provider=FakeProvider([]),
        solver=table_solver,
        budget=Budget(max_moves=10),
        require_plan=True,
    )
    assert "submit_plan" in [
        tool["function"]["name"] for tool in runner_plan._tools()
    ]


async def test_provider_errors_counted_from_stats_delta(
    table_solver: Table2x2Solver,
) -> None:
    class StatsProvider:
        def __init__(self) -> None:
            self.stats = {"requests": 0, "retries": 0, "errors": 0}

        async def probe_tools(self) -> bool:
            return True

        async def chat(self, messages, tools, params):
            self.stats["requests"] += 1
            # 模拟一次 429/5xx 退避重试
            self.stats["retries"] += 1
            return ModelTurn(
                tool_calls=[
                    ToolCall(
                        id="c1",
                        name="apply_moves",
                        arguments={"moves": ["R'"]},
                    )
                ]
            )

    task = make_task(table_solver, ["R"])
    provider = StatsProvider()
    result = await EpisodeRunner(
        provider=provider,
        solver=table_solver,
        budget=Budget(max_moves=10),
    ).run(task)
    assert result.solved
    assert result.provider_errors == 1
