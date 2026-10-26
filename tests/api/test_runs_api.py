import time
from pathlib import Path

from fastapi.testclient import TestClient

from mofang.api.app import create_app
from mofang.cube.moves import apply_moves
from mofang.cube.state import CubeState
from mofang.cube.table2x2 import Table2x2Solver, build_table
from mofang.models.provider import FakeProvider, ModelTurn, ToolCall
from mofang.store.benchmarks import save_benchmark
from mofang.store.db import Database
from mofang.tasks.models import Benchmark, Task


def make_app(tmp_path: Path, turns) -> tuple[TestClient, str]:
    db = Database(tmp_path / "t.db")
    db.initialize()
    state = apply_moves(CubeState.solved(2), ["R"])
    benchmark = Benchmark(
        id="bench",
        name="demo",
        cube="2x2",
        tasks=[
            Task(
                id="t1", cube="2x2", scramble=["R"], scramble_depth=1,
                state=state.to_json(), reference_length=1,
                reference_kind="exact", bin="1",
            )
        ],
    )
    save_benchmark(db, benchmark, {"seed": 3})
    provider = FakeProvider(turns)
    app = create_app(
        db=db,
        provider_factory=lambda record: provider,
        solver_factory=lambda cube: Table2x2Solver(build_table(max_depth=2)),
        env={},
    )
    return TestClient(app), benchmark.id


def wait_finished(client: TestClient, run_id: str, timeout: float = 10.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        run = client.get(f"/api/runs/{run_id}").json()["run"]
        if run["status"] not in ("queued", "running"):
            return run
        time.sleep(0.05)
    raise AssertionError("run did not finish")


def seed(client: TestClient) -> str:
    provider = client.post(
        "/api/providers",
        json={
            "name": "p", "base_url": "http://localhost:1/v1",
            "model": "m", "api_key_ref": "KEY",
        },
    ).json()
    return provider["id"]


def test_run_lifecycle_report_and_export(tmp_path: Path) -> None:
    client, benchmark_id = make_app(
        tmp_path,
        [
            ModelTurn(
                tool_calls=[
                    ToolCall(id="c1", name="apply_moves", arguments={"moves": ["R'"]})
                ]
            )
        ],
    )
    with client:
        provider_id = seed(client)
        response = client.post(
            "/api/runs",
            json={"provider_id": provider_id, "benchmark_id": benchmark_id},
        )
        assert response.status_code == 202
        run_id = response.json()["id"]
        run = wait_finished(client, run_id)
        assert run["budget"]["max_moves"] == 30
        assert run["budget"]["turn_timeout"] == 120.0
        assert run["status"] == "finished"
        episodes = client.get(f"/api/runs/{run_id}").json()["episodes"]
        assert episodes[0]["solved"] is True
        report = client.get(f"/api/runs/{run_id}/report").json()
        assert report["totals"]["solved"] == 1
        steps = client.get(f"/api/episodes/{episodes[0]['id']}/steps").json()
        assert any(step["tool_name"] == "apply_moves" for step in steps)
        assert any(step["kind"] == "model_message" for step in steps)
        snapshot = client.get(f"/api/runs/{run_id}/snapshot").json()
        assert snapshot["last_event_id"] >= 1
        csv = client.get(f"/api/runs/{run_id}/export?format=csv")
        assert csv.status_code == 200
        assert "apply_moves" not in csv.text
        assert "task_id,status,solved" in csv.text
        md = client.get(f"/api/runs/{run_id}/export?format=md")
        assert md.status_code == 200
        assert "| task_id |" in md.text
        bad = client.get(f"/api/runs/{run_id}/export?format=xml")
        assert bad.status_code == 400


def test_sse_replays_and_finishes(tmp_path: Path) -> None:
    client, benchmark_id = make_app(
        tmp_path,
        [
            ModelTurn(
                tool_calls=[
                    ToolCall(id="c1", name="apply_moves", arguments={"moves": ["R'"]})
                ]
            )
        ],
    )
    with client:
        provider_id = seed(client)
        run_id = client.post(
            "/api/runs",
            json={"provider_id": provider_id, "benchmark_id": benchmark_id},
        ).json()["id"]
        wait_finished(client, run_id)
        seen = []
        with client.stream("GET", f"/api/runs/{run_id}/events") as response:
            assert response.status_code == 200
            for line in response.iter_lines():
                if line.startswith("event: "):
                    seen.append(line.split(": ", 1)[1])
                    if line.endswith("run.finished"):
                        break
        assert "run.started" in seen
        assert "tool.call" in seen
        assert seen[-1] == "run.finished"


def test_cancel_and_missing(tmp_path: Path) -> None:
    client, _ = make_app(tmp_path, [])
    with client:
        assert client.get("/api/runs/nope").status_code == 404
        assert client.get("/api/runs/nope/events").status_code == 404
        assert client.post("/api/runs/nope/cancel").status_code == 404
