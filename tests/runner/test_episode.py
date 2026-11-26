import asyncio
import time

import pytest

from mofang.cube.moves import apply_moves, invert_moves
from mofang.cube.state import CubeState
from mofang.cube.solver import SolverError
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


class RecordingProvider:
    def __init__(self, inner: FakeProvider) -> None:
        self.inner = inner
        self.seen: list[list[dict]] = []

    async def chat(self, messages, tools, params):
        self.seen.append(messages)
        return await self.inner.chat(messages, tools, params)


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


def test_skill_pack_enters_episode_system_prompt(
    table_solver: Table2x2Solver,
) -> None:
    from mofang.runner.context import system_prompt

    task = make_task(table_solver, ["R"])
    inner = FakeProvider(
        [
            ModelTurn(
                tool_calls=[
                    ToolCall(
                        id="c1",
                        name="apply_moves",
                        arguments={"moves": ["R'"]},
                    )
                ]
            )
        ]
    )
    provider = RecordingProvider(inner)
    result = asyncio.run(
        EpisodeRunner(
            provider=provider,
            solver=table_solver,
            budget=Budget(max_moves=10),
            skill="ortega",
        ).run(task)
    )
    assert result.solved
    system = provider.seen[0][0]["content"]
    assert "Ortega" in system
    assert "PBL" in system

    inner = FakeProvider(
        [
            ModelTurn(
                tool_calls=[
                    ToolCall(
                        id="c1",
                        name="apply_moves",
                        arguments={"moves": ["R'"]},
                    )
                ]
            )
        ]
    )
    provider = RecordingProvider(inner)
    asyncio.run(
        EpisodeRunner(
            provider=provider, solver=table_solver, budget=Budget(max_moves=10)
        ).run(task)
    )
    # 默认 skill=none：system prompt 与不带 pack 时逐字一致
    assert provider.seen[0][0]["content"] == system_prompt()


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


async def test_nudges_reset_after_successful_tool_call(
    table_solver: Table2x2Solver,
) -> None:
    # 第 1 次纯思考计 1；第 2 次成功走法清零；随后两次纯思考只累计到 2，
    # 不应在最后一次解出前被 STOPPED_UNSOLVED 截断。
    task = make_task(table_solver, ["R"])
    provider = FakeProvider(
        [
            ModelTurn(content="先想一步"),
            ModelTurn(
                tool_calls=[
                    ToolCall(
                        id="c1",
                        name="apply_moves",
                        arguments={"moves": ["U"]},
                    )
                ]
            ),
            ModelTurn(content="再想一步"),
            ModelTurn(content="再想一步"),
            ModelTurn(
                tool_calls=[
                    ToolCall(
                        id="c2",
                        name="apply_moves",
                        arguments={"moves": ["U'", "R'"]},
                    )
                ]
            ),
        ]
    )
    result = await EpisodeRunner(
        provider=provider, solver=table_solver, budget=Budget(max_moves=10)
    ).run(task)
    assert result.status == EpisodeStatus.SOLVED
    assert result.solved


async def test_finish_reason_length_does_not_count_as_nudge(
    table_solver: Table2x2Solver,
) -> None:
    task = make_task(table_solver, ["R"])
    provider = FakeProvider(
        [
            ModelTurn(content="思考被截断", finish_reason="length"),
            ModelTurn(content="思考 1"),
            ModelTurn(content="思考 2"),
            ModelTurn(
                tool_calls=[
                    ToolCall(
                        id="c1",
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
        provider=provider, solver=table_solver, budget=Budget(max_moves=10)
    ).run(task, emit=emit)
    assert result.status == EpisodeStatus.SOLVED
    assert any(kind == "model.truncated" for kind, _ in events)


def test_truncation_nudge_is_an_imperative() -> None:
    text = EpisodeRunner.TRUNCATION_NUDGE
    assert "必须先发起一个合法工具调用" in text
    assert "apply_moves" in text
    assert "把思考压到最少" in text


async def test_repeated_truncation_ends_as_model_truncation_loop(
    table_solver: Table2x2Solver,
) -> None:
    task = make_task(table_solver, ["R"])
    provider = FakeProvider(
        [ModelTurn(content="x", finish_reason="length") for _ in range(3)]
    )
    result = await EpisodeRunner(
        provider=provider, solver=table_solver, budget=Budget(max_moves=10)
    ).run(task)
    assert result.status == EpisodeStatus.MODEL_TRUNCATION_LOOP
    assert result.failure_code == "model_truncation_loop"
    assert "finish_reason=length" in (result.error or "")


async def test_real_token_overflow_still_budget_exceeded(
    table_solver: Table2x2Solver,
) -> None:
    task = make_task(table_solver, ["R"])
    provider = FakeProvider(
        [ModelTurn(content="x", usage=Usage(prompt_tokens=50, completion_tokens=50))]
    )
    result = await EpisodeRunner(
        provider=provider,
        solver=table_solver,
        budget=Budget(max_moves=10, max_tokens=10),
    ).run(task)
    assert result.status == EpisodeStatus.BUDGET_EXCEEDED
    assert result.failure_code == "budget_exceeded"


async def test_overflow_tool_calls_are_reported_not_fatal(
    table_solver: Table2x2Solver,
) -> None:
    task = make_task(table_solver, ["R"])
    calls = [
        ToolCall(id=f"g{i}", name="get_state", arguments={}) for i in range(10)
    ]
    provider = FakeProvider(
        [
            ModelTurn(tool_calls=calls),
            ModelTurn(
                tool_calls=[
                    ToolCall(
                        id="solve", name="apply_moves", arguments={"moves": ["R'"]}
                    )
                ]
            ),
        ]
    )
    events: list[tuple[str, dict]] = []

    def emit(kind: str, payload: dict) -> None:
        events.append((kind, payload))

    result = await EpisodeRunner(
        provider=provider, solver=table_solver, budget=Budget(max_moves=10)
    ).run(task, emit=emit)
    assert result.status == EpisodeStatus.SOLVED
    assert result.protocol_errors == 0
    overflow = [
        payload
        for kind, payload in events
        if kind == "tool.result"
        and payload.get("payload", {}).get("error") == "too_many_tool_calls"
    ]
    assert len(overflow) == 5
    tool_results = [
        message for message in provider.calls[-1] if message.get("role") == "tool"
    ]
    assert len(tool_results) == 10
    assert (
        sum("too_many_tool_calls" in message["content"] for message in tool_results)
        == 5
    )


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


async def test_solve_tool_assist_returns_executable_optimal_moves(
    table_solver: Table2x2Solver,
) -> None:
    task = make_task(table_solver, ["R"])
    state = CubeState.from_json(task.state)
    expected = table_solver.solve(state)
    assert apply_moves(state, expected).is_solved()

    provider = FakeProvider(
        [
            ModelTurn(
                tool_calls=[ToolCall(id="s1", name="solve", arguments={})]
            ),
            ModelTurn(
                tool_calls=[
                    ToolCall(
                        id="a1",
                        name="apply_moves",
                        arguments={"moves": expected},
                    )
                ]
            ),
        ]
    )
    events: list[tuple[str, dict]] = []

    result = await EpisodeRunner(
        provider=provider,
        solver=table_solver,
        budget=Budget(max_moves=10),
        solver_mode="assist",
    ).run(task, emit=lambda kind, payload: events.append((kind, payload)))

    assert result.status == EpisodeStatus.SOLVED
    assert result.moves_used == len(expected)
    solve_result = next(
        payload
        for kind, payload in events
        if kind == "tool.result" and payload.get("tool") == "solve"
    )
    assert solve_result["ok"] is True
    assert solve_result["payload"]["moves"] == expected
    # 工具只给建议，不自动落地：solve 之后 moves_used 仍为 0。
    assert solve_result["payload"]["moves_used"] == 0


async def test_solve_tool_reports_unavailable_instead_of_success() -> None:
    class UnavailableSolver:
        def distance(self, state):
            return None

        def solve(self, state):
            raise SolverError("twophase worker is not running")

    state = apply_moves(CubeState.solved(3), ["R"])
    task = Task(
        id="t3",
        cube="3x3",
        scramble=["R"],
        scramble_depth=1,
        state=state.to_json(),
        reference_length=1,
        reference_kind="exact",
        bin="test",
    )
    provider = FakeProvider(
        [ModelTurn(tool_calls=[ToolCall(id="s1", name="solve", arguments={})])]
    )
    events: list[tuple[str, dict]] = []

    await EpisodeRunner(
        provider=provider,
        solver=UnavailableSolver(),
        budget=Budget(max_moves=10),
        solver_mode="assist",
    ).run(task, emit=lambda kind, payload: events.append((kind, payload)))

    solve_result = next(
        payload
        for kind, payload in events
        if kind == "tool.result" and payload.get("tool") == "solve"
    )
    assert solve_result["ok"] is False
    assert solve_result["payload"]["error"] == "solver_unavailable"
    assert "not running" in solve_result["payload"]["detail"]


async def test_solve_tool_absent_and_rejected_when_off(
    table_solver: Table2x2Solver,
) -> None:
    task = make_task(table_solver, ["R"])
    runner = EpisodeRunner(
        provider=FakeProvider([]),
        solver=table_solver,
        budget=Budget(max_moves=10),
    )
    assert "solve" not in [tool["function"]["name"] for tool in runner._tools()]

    events: list[tuple[str, dict]] = []
    provider = FakeProvider(
        [
            ModelTurn(tool_calls=[ToolCall(id="s1", name="solve", arguments={})]),
            ModelTurn(content="not going to move"),
            ModelTurn(content="still thinking"),
            ModelTurn(content="give up"),
        ]
    )
    result = await EpisodeRunner(
        provider=provider,
        solver=table_solver,
        budget=Budget(max_moves=10),
    ).run(task, emit=lambda kind, payload: events.append((kind, payload)))

    solve_result = next(
        payload
        for kind, payload in events
        if kind == "tool.result" and payload.get("tool") == "solve"
    )
    assert solve_result["ok"] is False
    assert solve_result["payload"]["error"] == "tool_not_enabled"
    # 幻觉调用 solve 不算协议错误，也不推进棋面。
    assert result.protocol_errors == 0
    assert result.moves_used == 0
    assert result.status == EpisodeStatus.STOPPED_UNSOLVED
    assert not [payload for kind, payload in events if kind == "move.applied"]


async def test_solve_timeout_discards_worker_and_next_rebuild_failure_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class TimeoutThenBrokenSolver:
        def __init__(self) -> None:
            self.calls = 0
            self.resets = 0

        def distance(self, state):
            return None

        def solve(self, state):
            self.calls += 1
            if self.calls == 1:
                time.sleep(0.3)
                return ["R'"]
            raise SolverError("failed to start solver worker")

        def reset(self) -> None:
            self.resets += 1

    monkeypatch.setattr(EpisodeRunner, "SOLVE_TIMEOUT", 0.05)
    state = apply_moves(CubeState.solved(3), ["R"])
    task = Task(
        id="t3",
        cube="3x3",
        scramble=["R"],
        scramble_depth=1,
        state=state.to_json(),
        reference_length=1,
        reference_kind="exact",
        bin="test",
    )
    solver = TimeoutThenBrokenSolver()
    events: list[tuple[str, dict]] = []
    provider = FakeProvider(
        [
            ModelTurn(tool_calls=[ToolCall(id="s1", name="solve", arguments={})]),
            ModelTurn(tool_calls=[ToolCall(id="s2", name="solve", arguments={})]),
            ModelTurn(content="stop"),
            ModelTurn(content="stop"),
            ModelTurn(content="stop"),
        ]
    )
    result = await EpisodeRunner(
        provider=provider,
        solver=solver,
        budget=Budget(max_moves=10),
        solver_mode="assist",
    ).run(task, emit=lambda kind, payload: events.append((kind, payload)))

    solve_errors = [
        payload["payload"].get("error")
        for kind, payload in events
        if kind == "tool.result" and payload.get("tool") == "solve"
    ]
    assert solve_errors == ["solver_timeout", "solver_unavailable"]
    assert solver.resets == 1
    assert result.moves_used == 0
    assert result.status == EpisodeStatus.STOPPED_UNSOLVED
    assert not [payload for kind, payload in events if kind == "move.applied"]


async def test_solve_unavailable_on_2x2_table_miss_does_not_advance() -> None:
    small = Table2x2Solver(build_table(max_depth=1))
    task = make_task(small, ["R", "U"])
    assert small.distance(CubeState.from_json(task.state)) is None
    events: list[tuple[str, dict]] = []
    provider = FakeProvider(
        [
            ModelTurn(tool_calls=[ToolCall(id="s1", name="solve", arguments={})]),
            ModelTurn(content="stop"),
            ModelTurn(content="stop"),
            ModelTurn(content="stop"),
        ]
    )
    result = await EpisodeRunner(
        provider=provider,
        solver=small,
        budget=Budget(max_moves=10),
        solver_mode="assist",
    ).run(task, emit=lambda kind, payload: events.append((kind, payload)))

    solve_result = next(
        payload
        for kind, payload in events
        if kind == "tool.result" and payload.get("tool") == "solve"
    )
    assert solve_result["payload"]["error"] == "solver_unavailable"
    assert "distance table" in solve_result["payload"]["detail"]
    assert result.moves_used == 0
    assert result.status == EpisodeStatus.STOPPED_UNSOLVED
    assert not [payload for kind, payload in events if kind == "move.applied"]


async def test_repeated_solve_without_apply_only_consumes_tool_budget(
    table_solver: Table2x2Solver,
) -> None:
    class SolveLoopProvider:
        def __init__(self) -> None:
            self.calls = 0

        async def chat(self, messages, tools, params):
            self.calls += 1
            return ModelTurn(
                tool_calls=[
                    ToolCall(id=f"s{self.calls}", name="solve", arguments={})
                ]
            )

    task = make_task(table_solver, ["R"])
    provider = SolveLoopProvider()
    events: list[tuple[str, dict]] = []
    result = await EpisodeRunner(
        provider=provider,
        solver=table_solver,
        budget=Budget(max_moves=10, max_tool_calls=2),
        solver_mode="assist",
    ).run(task, emit=lambda kind, payload: events.append((kind, payload)))

    solve_outcomes = [
        payload["payload"]
        for kind, payload in events
        if kind == "tool.result" and payload.get("tool") == "solve"
    ]
    assert [item.get("error") for item in solve_outcomes] == [
        None,
        None,
        "budget_exceeded",
    ]
    assert all(
        item["moves_used"] == 0
        for item in solve_outcomes
        if item.get("error") is None
    )
    assert result.moves_used == 0
    # tool-call 预算耗尽会像其它工具一样直接结束为 budget_exceeded。
    assert result.status == EpisodeStatus.BUDGET_EXCEEDED
    assert provider.calls == 3


async def test_successful_solve_resets_nudge_counter(
    table_solver: Table2x2Solver,
) -> None:
    class AlternatingProvider:
        def __init__(self) -> None:
            self.calls = 0

        async def chat(self, messages, tools, params):
            self.calls += 1
            if self.calls in (2, 4):
                return ModelTurn(
                    tool_calls=[
                        ToolCall(id=f"s{self.calls}", name="solve", arguments={})
                    ]
                )
            return ModelTurn(content="thinking only")

    task = make_task(table_solver, ["R"])
    provider = AlternatingProvider()
    result = await EpisodeRunner(
        provider=provider,
        solver=table_solver,
        budget=Budget(max_moves=10),
        solver_mode="assist",
    ).run(task)

    # turn1/3/5 是纯思考，若 solve 成功不清零，第 5 轮就会因 nudge 超限停止；
    # 清零后能走到第 7 轮（turn5 之后还需要 3 次 no-tool 才再次超限）。
    assert provider.calls == 7
    assert result.moves_used == 0
    assert result.status == EpisodeStatus.STOPPED_UNSOLVED


class ScriptedProvider:
    """按脚本返回 turn 或抛错；脚本用尽后重复最后一项。"""

    def __init__(self, script):
        self.script = list(script)
        self.calls = 0

    async def chat(self, messages, tools, params):
        item = self.script[min(self.calls, len(self.script) - 1)]
        self.calls += 1
        if isinstance(item, Exception):
            raise item
        return item


def test_retryable_provider_error_resumes_and_solves(
    table_solver: Table2x2Solver, monkeypatch
) -> None:
    monkeypatch.setattr(EpisodeRunner, "PROVIDER_RETRY_DELAYS", (0.0, 0.0))
    task = make_task(table_solver, ["R"])
    provider = ScriptedProvider(
        [
            ProviderError("rate_limit", "429 too many requests", retryable=True),
            ModelTurn(
                tool_calls=[
                    ToolCall(
                        id="c1",
                        name="apply_moves",
                        arguments={"moves": invert_moves(task.scramble)},
                    )
                ]
            ),
        ]
    )
    result = asyncio.run(
        EpisodeRunner(
            provider=provider, solver=table_solver, budget=Budget(max_moves=10)
        ).run(task)
    )
    assert result.status == EpisodeStatus.SOLVED
    assert result.solved
    assert provider.calls == 2


def test_retry_preserves_progress(table_solver: Table2x2Solver, monkeypatch) -> None:
    monkeypatch.setattr(EpisodeRunner, "PROVIDER_RETRY_DELAYS", (0.0, 0.0))
    task = make_task(table_solver, ["R", "U"])
    solution = invert_moves(["R", "U"])
    provider = ScriptedProvider(
        [
            ModelTurn(
                tool_calls=[
                    ToolCall(
                        id="c1", name="apply_moves", arguments={"moves": [solution[0]]}
                    )
                ]
            ),
            ProviderError("rate_limit", "429 too many requests", retryable=True),
            ModelTurn(
                tool_calls=[
                    ToolCall(
                        id="c2", name="apply_moves", arguments={"moves": [solution[1]]}
                    )
                ]
            ),
        ]
    )
    result = asyncio.run(
        EpisodeRunner(
            provider=provider, solver=table_solver, budget=Budget(max_moves=10)
        ).run(task)
    )
    # 断点续跑：第一步的 move 与对话记录保留，重试后完成第二步
    assert result.status == EpisodeStatus.SOLVED
    assert result.moves_used == 2
    assert provider.calls == 3


def test_retry_exhaustion_marks_provider_error(
    table_solver: Table2x2Solver, monkeypatch
) -> None:
    monkeypatch.setattr(EpisodeRunner, "PROVIDER_RETRY_DELAYS", (0.0, 0.0))
    task = make_task(table_solver, ["R"])
    provider = ScriptedProvider(
        [ProviderError("rate_limit", "429 too many requests", retryable=True)]
    )
    result = asyncio.run(
        EpisodeRunner(
            provider=provider, solver=table_solver, budget=Budget(max_moves=10)
        ).run(task)
    )
    assert result.status == EpisodeStatus.PROVIDER_ERROR
    assert provider.calls == EpisodeRunner.MAX_PROVIDER_RETRIES + 1


def test_non_retryable_auth_error_fails_immediately(
    table_solver: Table2x2Solver,
) -> None:
    task = make_task(table_solver, ["R"])
    provider = ScriptedProvider([ProviderError("auth", "invalid api key")])
    result = asyncio.run(
        EpisodeRunner(
            provider=provider, solver=table_solver, budget=Budget(max_moves=10)
        ).run(task)
    )
    assert result.status == EpisodeStatus.PROVIDER_ERROR
    assert provider.calls == 1

