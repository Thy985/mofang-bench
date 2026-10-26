from pathlib import Path

from mofang.cube.moves import apply_moves
from mofang.cube.state import CubeState
from mofang.store.benchmarks import (
    get_benchmark,
    get_task_ids,
    list_benchmarks,
    save_benchmark,
)
from mofang.store.db import Database
from mofang.tasks.models import Benchmark, Task


def make_benchmark() -> Benchmark:
    state = apply_moves(CubeState.solved(2), ["R"])
    task = Task(
        id="2x2-1-1",
        cube="2x2",
        scramble=["R"],
        scramble_depth=1,
        state=state.to_json(),
        reference_length=1,
        reference_kind="exact",
        bin="1",
    )
    bench = Benchmark(id="bench-1", name="demo", cube="2x2", tasks=[task])
    bench.content_hash = bench.compute_hash()
    return bench


def test_benchmark_round_trip(tmp_path: Path) -> None:
    db = Database(tmp_path / "t.db")
    db.initialize()
    bench = make_benchmark()
    save_benchmark(db, bench, {"seed": 1})
    save_benchmark(db, bench, {"seed": 1})
    loaded = get_benchmark(db, "bench-1")
    assert loaded is not None
    assert loaded.content_hash == bench.content_hash
    assert loaded.tasks[0].state == bench.tasks[0].state
    assert get_task_ids(db, "bench-1") == ["bench-1:2x2-1-1"]
    listed = list_benchmarks(db)
    assert len(listed) == 1
    assert listed[0]["content_hash"] == bench.content_hash


def test_missing_benchmark(tmp_path: Path) -> None:
    db = Database(tmp_path / "t.db")
    db.initialize()
    assert get_benchmark(db, "nope") is None
    assert get_task_ids(db, "nope") == []
