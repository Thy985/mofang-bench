import asyncio
from pathlib import Path

from mofang.api.events import RunEventBus
from mofang.cube.moves import apply_moves
from mofang.cube.state import CubeState
from mofang.cube.table2x2 import Table2x2Solver, build_table
from mofang.models.provider import FakeProvider, ModelTurn, ToolCall
from mofang.service.runs import RunService
from mofang.store.benchmarks import save_benchmark
from mofang.store.db import Database
from mofang.store.providers import create_provider
from mofang.store.runs import (
    create_run,
    get_episode,
    get_run,
    get_run_episodes,
)
from mofang.tasks.models import Benchmark, Task


def seed_run(tmp_path: Path) -> tuple[Database, str]:
    db = Database(tmp_path / "t.db")
    db.initialize()
    provider = create_provider(
        db,
        name="p",
        base_url="http://localhost:1/v1",
        model="m",
        api_key_ref="KEY",
    )
    state = apply_moves(CubeState.solved(2), ["R"])
    task = Task(
        id="t1",
        cube="2x2",
        scramble=["R"],
        scramble_depth=1,
        state=state.to_json(),
        reference_length=1,
        reference_kind="exact",
        bin="1",
    )
    bench = Benchmark(id="b1", name="demo", cube="2x2", tasks=[task])
    bench.content_hash = bench.compute_hash()
    save_benchmark(db, bench, {"seed": 1})
    run_id = create_run(
        db,
        provider_id=provider.id,
        benchmark_id="b1",
        tool_mode="both",
        prompt_version="v1",
        params={},
        budget={"max_moves": 10},
    )
    return db, run_id


def solver_factory(_cube: str) -> Table2x2Solver:
    return Table2x2Solver(build_table(max_depth=2))


async def test_executes_run_and_persists(tmp_path: Path) -> None:
    db, run_id = seed_run(tmp_path)
    bus = RunEventBus()
    provider = FakeProvider(
        [
            ModelTurn(
                tool_calls=[
                    ToolCall(id="c1", name="apply_moves", arguments={"moves": ["R'"]})
                ]
            )
        ]
    )
    service = RunService(
        db,
        bus,
        provider_factory=lambda record: provider,
        solver_factory=solver_factory,
    )
    service.start(run_id)
    await service.wait(run_id)
    run = get_run(db, run_id)
    assert run["status"] == "finished"
    assert run["totals"]["totals"]["solved"] == 1
    episodes = get_run_episodes(db, run_id)
    assert episodes[0]["status"] == "solved"
    assert get_episode(db, episodes[0]["id"])["moves_used"] == 1
    kinds = [event.type for event in bus.history(run_id)]
    assert kinds[0] == "run.started"
    assert "tool.call" in kinds
    assert "tool.result" in kinds
    assert "move.applied" in kinds
    assert kinds[-1] == "run.finished"


async def test_cancel_marks_run_cancelled(tmp_path: Path) -> None:
    db, run_id = seed_run(tmp_path)
    bus = RunEventBus()

    class SlowProvider:
        async def probe_tools(self) -> bool:
            return True

        async def chat(self, messages, tools, params):
            await asyncio.sleep(10)
            raise AssertionError("should not return")

    service = RunService(
        db,
        bus,
        provider_factory=lambda record: SlowProvider(),
        solver_factory=solver_factory,
    )
    service.start(run_id)
    await asyncio.sleep(0.05)
    assert await service.cancel(run_id) is True
    await service.wait(run_id)
    assert get_run(db, run_id)["status"] == "cancelled"
    assert all(
        item["status"] != "solved" for item in get_run_episodes(db, run_id)
    )


async def test_provider_factory_error_marks_run_failed(tmp_path: Path) -> None:
    db, run_id = seed_run(tmp_path)
    bus = RunEventBus()

    def broken_factory(record):
        raise RuntimeError("no key")

    service = RunService(
        db,
        bus,
        provider_factory=broken_factory,
        solver_factory=solver_factory,
    )
    service.start(run_id)
    await service.wait(run_id)
    run = get_run(db, run_id)
    assert run["status"] == "failed"
    assert "no key" in run["error"]
    assert [event.type for event in bus.history(run_id)][-1] == "run.error"


async def test_chat_crash_interrupts_inflight_episode(tmp_path: Path) -> None:
    db, run_id = seed_run(tmp_path)
    bus = RunEventBus()

    class BoomProvider:
        async def probe_tools(self) -> bool:
            return True

        async def chat(self, messages, tools, params):
            raise RuntimeError("boom")

    service = RunService(
        db,
        bus,
        provider_factory=lambda record: BoomProvider(),
        solver_factory=solver_factory,
    )
    service.start(run_id)
    await service.wait(run_id)
    assert get_run(db, run_id)["status"] == "failed"
    episodes = get_run_episodes(db, run_id)
    assert episodes
    assert all(item["status"] == "interrupted" for item in episodes)
    assert "running" not in [item["status"] for item in episodes]
    assert episodes[0]["error"] == "boom"
    assert bus.history(run_id)[-1].type == "run.error"


class GateProvider:
    """第一个请求等到第二个请求进入才放行：只有真并行才能解开，串行会超时。"""

    def __init__(self) -> None:
        self.calls = 0
        self.max_inflight = 0
        self._gate = asyncio.Event()

    async def probe_tools(self) -> bool:
        return True

    async def chat(self, messages, tools, params):
        self.calls += 1
        self.max_inflight = max(self.max_inflight, self.calls)
        if self.calls == 1:
            await asyncio.wait_for(self._gate.wait(), timeout=2.0)
        else:
            self._gate.set()
            await asyncio.sleep(0.01)
        self.calls -= 1
        return ModelTurn(
            tool_calls=[
                ToolCall(id="c1", name="apply_moves", arguments={"moves": ["R'"]})
            ]
        )


async def test_two_runs_execute_in_parallel(tmp_path: Path) -> None:
    db, first = seed_run(tmp_path)
    provider = create_provider(
        db,
        name="p2",
        base_url="http://localhost:2/v1",
        model="m",
        api_key_ref="KEY",
    )
    second = create_run(
        db,
        provider_id=provider.id,
        benchmark_id="b1",
        tool_mode="both",
        prompt_version="v1",
        params={},
        budget={"max_moves": 10},
    )
    bus = RunEventBus()
    gate = GateProvider()
    service = RunService(
        db,
        bus,
        provider_factory=lambda record: gate,
        solver_factory=solver_factory,
    )
    service.start(first)
    service.start(second)
    await asyncio.gather(service.wait(first), service.wait(second))
    assert get_run(db, first)["status"] == "finished"
    assert get_run(db, second)["status"] == "finished"
    assert gate.max_inflight == 2


async def test_episode_semaphore_bounds_cross_run_concurrency(
    tmp_path: Path,
) -> None:
    db, first = seed_run(tmp_path)
    provider = create_provider(
        db,
        name="p2",
        base_url="http://localhost:2/v1",
        model="m",
        api_key_ref="KEY",
    )
    second = create_run(
        db,
        provider_id=provider.id,
        benchmark_id="b1",
        tool_mode="both",
        prompt_version="v1",
        params={},
        budget={"max_moves": 10},
    )
    bus = RunEventBus()

    class TrackingProvider:
        def __init__(self) -> None:
            self.inflight = 0
            self.max_inflight = 0

        async def probe_tools(self) -> bool:
            return True

        async def chat(self, messages, tools, params):
            self.inflight += 1
            self.max_inflight = max(self.max_inflight, self.inflight)
            await asyncio.sleep(0.05)
            self.inflight -= 1
            return ModelTurn(
                tool_calls=[
                    ToolCall(
                        id="c1", name="apply_moves", arguments={"moves": ["R'"]}
                    )
                ]
            )

    tracking = TrackingProvider()
    service = RunService(
        db,
        bus,
        provider_factory=lambda record: tracking,
        solver_factory=solver_factory,
        max_parallel_episodes=1,
    )
    service.start(first)
    service.start(second)
    await asyncio.gather(service.wait(first), service.wait(second))
    assert get_run(db, first)["status"] == "finished"
    assert get_run(db, second)["status"] == "finished"
    assert tracking.max_inflight == 1


async def test_task_subset_only_runs_selected_tasks(tmp_path: Path) -> None:
    db = Database(tmp_path / "t.db")
    db.initialize()
    provider = create_provider(
        db,
        name="p",
        base_url="http://localhost:1/v1",
        model="m",
        api_key_ref="KEY",
    )
    state1 = apply_moves(CubeState.solved(2), ["R"])
    state2 = apply_moves(CubeState.solved(2), ["R", "U"])
    tasks = [
        Task(
            id="t1", cube="2x2", scramble=["R"], scramble_depth=1,
            state=state1.to_json(), reference_length=1,
            reference_kind="exact", bin="1",
        ),
        Task(
            id="t2", cube="2x2", scramble=["R", "U"], scramble_depth=2,
            state=state2.to_json(), reference_length=2,
            reference_kind="exact", bin="2",
        ),
    ]
    bench = Benchmark(id="b1", name="demo", cube="2x2", tasks=tasks)
    bench.content_hash = bench.compute_hash()
    save_benchmark(db, bench, {"seed": 1})
    run_id = create_run(
        db,
        provider_id=provider.id,
        benchmark_id="b1",
        tool_mode="both",
        prompt_version="v1",
        params={},
        budget={"max_moves": 10},
        task_keys=["t2"],
    )
    bus = RunEventBus()
    provider_stub = FakeProvider(
        [
            ModelTurn(
                tool_calls=[
                    ToolCall(
                        id="c1", name="apply_moves", arguments={"moves": ["U'", "R'"]}
                    )
                ]
            )
        ]
    )
    service = RunService(
        db,
        bus,
        provider_factory=lambda record: provider_stub,
        solver_factory=solver_factory,
    )
    service.start(run_id)
    await service.wait(run_id)
    run = get_run(db, run_id)
    assert run["status"] == "finished"
    episodes = get_run_episodes(db, run_id)
    assert [item["task_id"] for item in episodes] == ["b1:t2"]
    assert run["totals"]["benchmark_total_tasks"] == 2
    assert run["totals"]["partial"] is True
    assert run["totals"]["totals"]["solved"] == 1
    # 子集必须按位置对齐：bin 统计来自 t2（bin="2"），不能错位到 t1
    assert set(run["totals"]["by_bin"]) == {"2"}

