import json
import subprocess
import sys
from pathlib import Path

from mofang.store.runs import (
    fail_running_episodes,
    get_episode,
    get_run,
    get_run_episodes,
    get_steps,
    set_run_status,
)

ROOT = Path(__file__).resolve().parents[2]

CHILD = r"""
import asyncio
import sys
sys.path.insert(0, sys.argv[1])
from pathlib import Path

from mofang.api.events import EventJournal, RunEventBus
from mofang.cube.moves import apply_moves
from mofang.cube.state import CubeState
from mofang.cube.table2x2 import Table2x2Solver, build_table
from mofang.models.provider import ModelTurn, ToolCall
from mofang.service.runs import RunService
from mofang.store.benchmarks import save_benchmark
from mofang.store.db import Database
from mofang.store.providers import create_provider
from mofang.store.runs import create_run
from mofang.tasks.models import Benchmark, Task


class SimulatedCrash(BaseException):
    pass


class CrashProvider:
    def __init__(self):
        self.calls = 0

    async def probe_tools(self):
        return True

    async def chat(self, messages, tools, params):
        self.calls += 1
        if self.calls == 1:
            return ModelTurn(
                tool_calls=[
                    ToolCall(id="c1", name="apply_moves", arguments={"moves": ["U"]})
                ]
            )
        if self.calls == 2:
            return ModelTurn(
                tool_calls=[
                    ToolCall(id="c2", name="apply_moves", arguments={"moves": ["F"]})
                ]
            )
        raise SimulatedCrash


def solver_factory(_cube):
    return Table2x2Solver(build_table(max_depth=2))


async def main(db_path, out_dir):
    db = Database(Path(db_path))
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
    bench = Benchmark(id="b1", name="crash", cube="2x2", tasks=[task])
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
    bus = RunEventBus(EventJournal(Path(out_dir)))
    service = RunService(
        db,
        bus,
        provider_factory=lambda record: CrashProvider(),
        solver_factory=solver_factory,
    )
    service.start(run_id)
    try:
        await service.wait(run_id)
    except SimulatedCrash:
        pass
    print(run_id)


asyncio.run(main(sys.argv[2], sys.argv[3]))
"""


def test_crash_keeps_completed_turns_in_events_and_steps(
    tmp_path: Path,
) -> None:
    db_path = tmp_path / "crash.db"
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    proc = subprocess.run(
        [
            sys.executable,
            "-c",
            CHILD,
            str(ROOT / "src"),
            str(db_path),
            str(out_dir),
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, proc.stderr
    run_id = proc.stdout.strip().splitlines()[-1]

    # 崩溃发生在第 3 轮：前两轮的事件必须已经完整落盘。
    path = out_dir / f"events-{run_id}.jsonl"
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    events = [json.loads(line) for line in lines]
    assert text.endswith("\n")
    kinds = [event["type"] for event in events]
    assert kinds.count("model.message") == 2
    assert kinds.count("tool.call") == 2
    assert kinds.count("tool.result") == 2
    assert kinds.count("move.applied") == 2
    assert "episode.finished" not in kinds
    assert kinds[-1] == "model.turn.started"

    # 前两轮的 step 已逐轮写库，episode 进度也已更新。
    from mofang.store.db import Database

    db = Database(db_path)
    episodes = get_run_episodes(db, run_id)
    assert len(episodes) == 1
    steps = get_steps(db, episodes[0]["id"])
    assert len(steps) == 4
    assert [step["seq"] for step in steps] == [0, 1, 2, 3]
    episode = get_episode(db, episodes[0]["id"])
    assert episode["moves_used"] == 2
    assert episode["status"] == "running"

    # 真实进程退出时由 atexit 走这条路径：把僵尸状态收尾。
    fail_running_episodes(db, run_id, "process exited before completion")
    set_run_status(
        db, run_id, "failed", error="process exited before completion", finished=True
    )
    assert get_episode(db, episodes[0]["id"])["status"] == "interrupted"
    assert get_run(db, run_id)["status"] == "failed"
