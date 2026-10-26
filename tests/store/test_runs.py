import json
from pathlib import Path

from mofang.cube.state import CubeState
from mofang.runner.episode import EpisodeResult, EpisodeStatus, StepRecord
from mofang.store.db import Database
from mofang.store.providers import create_provider
from mofang.store.runs import (
    add_steps,
    create_episode,
    create_run,
    finish_episode,
    get_episode,
    get_run,
    get_run_episodes,
    get_steps,
    list_runs,
    mark_running_interrupted,
    set_run_status,
)


def setup(tmp_path: Path) -> tuple[Database, str, str]:
    db = Database(tmp_path / "t.db")
    db.initialize()
    provider = create_provider(
        db,
        name="p",
        base_url="http://localhost:1/v1",
        model="m",
        api_key_ref="KEY",
    )
    with db.transaction() as conn:
        conn.execute(
            "INSERT INTO benchmarks VALUES (?,?,?,?,?,?,?,?)",
            ("b1", "demo", "v1", "frozen", "2x2", "{}", "hash", "now"),
        )
        conn.execute(
            "INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?)",
            (
                "b1:t1", "b1", "t1", "2x2", '["R"]', 1,
                json.dumps(CubeState.solved(2).to_json()), 1, "exact", "1",
            ),
        )
    run_id = create_run(
        db,
        provider_id=provider.id,
        benchmark_id="b1",
        tool_mode="both",
        prompt_version="v1",
        params={"temperature": 0.0},
        budget={"max_moves": 10},
    )
    return db, provider.id, run_id


def test_run_and_episode_lifecycle(tmp_path: Path) -> None:
    db, _, run_id = setup(tmp_path)
    assert get_run(db, run_id)["status"] == "queued"
    set_run_status(db, run_id, "running", started=True)
    episode_id = create_episode(
        db, run_id=run_id, task_row_id="b1:t1", reference_length=1, started_at="now"
    )
    result = EpisodeResult(
        status=EpisodeStatus.SOLVED,
        solved=True,
        moves_used=1,
        reference_length=1,
        efficiency=1.0,
        progress_ratio=1.0,
        invalid_calls=0,
        protocol_errors=0,
        tokens_in=10,
        tokens_out=5,
        latency_ms=100,
        final_state=CubeState.solved(2).to_json(),
        failure_code=None,
        error=None,
        steps=[],
    )
    finish_episode(db, episode_id, result)
    add_steps(
        db,
        episode_id,
        [
            StepRecord(
                seq=0,
                kind="tool",
                tool_name="turn",
                arguments={"face": "R", "amount": 1},
                result={"ok": True},
                state=result.final_state,
                reference_length_after=0,
            )
        ],
    )
    set_run_status(db, run_id, "finished", totals={"tasks": 1}, finished=True)
    run = get_run(db, run_id)
    assert run["status"] == "finished"
    assert run["totals"]["tasks"] == 1
    episode = get_episode(db, episode_id)
    assert episode["solved"] == 1
    assert episode["efficiency"] == 1.0
    steps = get_steps(db, episode_id)
    assert steps[0]["tool_name"] == "turn"
    assert steps[0]["kind"] == "tool_result"
    assert steps[0]["state"]["cube"] == "2x2"
    assert len(get_run_episodes(db, run_id)) == 1
    assert list_runs(db)[0]["id"] == run_id


def test_mark_running_interrupted(tmp_path: Path) -> None:
    db, _, run_id = setup(tmp_path)
    set_run_status(db, run_id, "running", started=True)
    episode_id = create_episode(
        db, run_id=run_id, task_row_id="b1:t1", reference_length=1, started_at="now"
    )
    assert mark_running_interrupted(db) == 1
    assert get_episode(db, episode_id)["status"] == "interrupted"
    assert get_run(db, run_id)["status"] == "interrupted"
