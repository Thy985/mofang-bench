from pathlib import Path

from mofang.cube.moves import apply_moves
from mofang.cube.state import CubeState
from mofang.eval.compare import bootstrap_diff_ci, compare_runs
from mofang.runner.episode import EpisodeResult, EpisodeStatus
from mofang.store.benchmarks import save_benchmark, task_row_id
from mofang.store.db import Database
from mofang.store.providers import create_provider
from mofang.store.runs import create_episode, create_run, finish_episode
from mofang.tasks.models import Benchmark, Task


def test_bootstrap_deterministic_and_bounded() -> None:
    observed, low, high = bootstrap_diff_ci([1.0, 0.0, 1.0, 1.0], n=500, seed=7)
    assert observed == 0.75
    assert low <= observed <= high
    assert 0.0 <= low <= high <= 1.0


def test_bootstrap_empty() -> None:
    assert bootstrap_diff_ci([]) == (0.0, 0.0, 0.0)


def _seed_run(db: Database, provider_id: str, skill: str) -> str:
    run_id = create_run(
        db,
        provider_id=provider_id,
        benchmark_id="b",
        tool_mode="both",
        prompt_version="v1",
        params={},
        budget={"max_moves": 30},
        skill=skill,
    )
    episode_id = create_episode(
        db,
        run_id=run_id,
        task_row_id=task_row_id("b", "t1"),
        reference_length=1,
        started_at="now",
        skill=skill,
    )
    finish_episode(
        db,
        episode_id,
        EpisodeResult(
            status=EpisodeStatus.SOLVED,
            solved=True,
            moves_used=1,
            reference_length=1,
            efficiency=1.0,
            progress_ratio=1.0,
            invalid_calls=0,
            protocol_errors=0,
            tokens_in=0,
            tokens_out=0,
            latency_ms=0,
            final_state=CubeState.solved(2).to_json(),
            failure_code=None,
        ),
    )
    return run_id


def test_compare_carries_skill_axis(tmp_path: Path) -> None:
    db = Database(tmp_path / "c.db")
    db.initialize()
    state = apply_moves(CubeState.solved(2), ["R"])
    save_benchmark(
        db,
        Benchmark(
            id="b",
            name="b",
            cube="2x2",
            tasks=[
                Task(
                    id="t1",
                    cube="2x2",
                    scramble=["R"],
                    scramble_depth=1,
                    state=state.to_json(),
                    reference_length=1,
                    reference_kind="exact",
                    bin="1",
                )
            ],
        ),
        {},
    )
    provider = create_provider(
        db, name="p", base_url="http://localhost:1/v1",
        model="m", api_key_ref="KEY",
    )
    none_run = _seed_run(db, provider.id, "none")
    ortega_run = _seed_run(db, provider.id, "ortega")
    mixed = compare_runs(db, [none_run, ortega_run])
    assert mixed["skill_first"] == "none"
    assert mixed["skill_second"] == "ortega"
    assert mixed["same_skill"] is False

    other = _seed_run(db, provider.id, "ortega")
    same = compare_runs(db, [ortega_run, other])
    assert same["skill_first"] == "ortega"
    assert same["skill_second"] == "ortega"
    assert same["same_skill"] is True
