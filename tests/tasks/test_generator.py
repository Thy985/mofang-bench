import pytest

from mofang.cube.solver import FakeSolver
from mofang.cube.state import CubeState
from mofang.tasks.generator import bin_for_length, generate_benchmark
from mofang.tasks.models import Benchmark


def test_bin_for_length() -> None:
    assert bin_for_length(1) == "1"
    assert bin_for_length(4) == "4-5"
    assert bin_for_length(7) == "6-10"
    assert bin_for_length(18) == "11-20"


def test_generate_is_reproducible() -> None:
    solver = FakeSolver()
    solver.distance = lambda state: 3  # type: ignore[method-assign]
    first = generate_benchmark(
        name="demo", cube="2x2", depths=[1, 2], per_depth=2, seed=42, solver=solver
    )
    second = generate_benchmark(
        name="demo", cube="2x2", depths=[1, 2], per_depth=2, seed=42, solver=solver
    )
    assert [task.state for task in first.tasks] == [task.state for task in second.tasks]
    assert len(first.tasks) == 4


def test_generate_has_no_duplicate_states() -> None:
    solver = FakeSolver()
    solver.distance = lambda state: 2  # type: ignore[method-assign]
    benchmark = generate_benchmark(
        name="demo", cube="2x2", depths=[1, 2, 3], per_depth=3, seed=7, solver=solver
    )
    keys = [CubeState.from_json(task.state).key() for task in benchmark.tasks]
    assert len(keys) == len(set(keys))


def test_benchmark_hash_and_round_trip(tmp_path) -> None:
    solver = FakeSolver()
    solver.distance = lambda state: 1  # type: ignore[method-assign]
    benchmark = generate_benchmark(
        name="demo", cube="2x2", depths=[1], per_depth=1, seed=1, solver=solver
    )
    path = tmp_path / "bench.json"
    benchmark.save(path)
    loaded = Benchmark.load(path)
    assert loaded.content_hash == benchmark.content_hash
    assert loaded.tasks == benchmark.tasks
