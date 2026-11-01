import time
from pathlib import Path

from fastapi.testclient import TestClient

from mofang.api.app import create_app
from mofang.cube.moves import apply_moves
from mofang.cube.state import CubeState
from mofang.cube.table2x2 import Table2x2Solver, build_table
from mofang.models.provider import FakeProvider, ModelTurn, ToolCall
from mofang.store.benchmarks import save_benchmark, task_row_id
from mofang.store.db import Database
from mofang.store.providers import create_provider
from mofang.store.runs import create_episode, create_run
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
        with client.stream(
            "GET", f"/api/runs/{run_id}/events?after=abc"
        ) as response:
            assert response.status_code == 422


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


def test_sse_after_query_and_header_take_max(tmp_path: Path) -> None:
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
        total = client.get(f"/api/runs/{run_id}/snapshot").json()["last_event_id"]
        assert total >= 4

        def replayed_ids(headers: dict[str, str], after: int) -> list[int]:
            ids: list[int] = []
            with client.stream(
                "GET",
                f"/api/runs/{run_id}/events?after={after}",
                headers=headers,
            ) as response:
                assert response.status_code == 200
                for line in response.iter_lines():
                    if line.startswith("id: "):
                        ids.append(int(line.split(": ", 1)[1]))
                    if line.startswith("event: run.finished"):
                        break
            return ids

        assert replayed_ids({}, total - 2) == [total - 1, total]
        assert replayed_ids({"Last-Event-ID": str(total - 1)}, total - 2) == [total]
        assert replayed_ids({"Last-Event-ID": str(total - 2)}, total - 1) == [total]


def test_cancel_and_missing(tmp_path: Path) -> None:
    client, _ = make_app(tmp_path, [])
    with client:
        assert client.get("/api/runs/nope").status_code == 404
        assert client.get("/api/runs/nope/events").status_code == 404
        assert client.post("/api/runs/nope/cancel").status_code == 404


def test_snapshot_returns_live_state_from_events(tmp_path: Path) -> None:
    db = Database(tmp_path / "snap.db")
    state = apply_moves(CubeState.solved(2), ["R"])
    live = apply_moves(CubeState.solved(2), ["U"])
    benchmark = Benchmark(
        id="snap-bench",
        name="snap",
        cube="2x2",
        tasks=[
            Task(
                id="t1", cube="2x2", scramble=["R"], scramble_depth=1,
                state=state.to_json(), reference_length=1,
                reference_kind="exact", bin="1",
            )
        ],
    )
    app = create_app(
        db=db,
        provider_factory=lambda record: FakeProvider([]),
        solver_factory=lambda cube: None,
        env={},
    )
    with TestClient(app) as client:
        save_benchmark(db, benchmark, {})
        provider = create_provider(
            db, name="p", base_url="http://localhost:1/v1",
            model="m", api_key_ref="KEY",
        )
        run_id = create_run(
            db, provider_id=provider.id, benchmark_id=benchmark.id,
            tool_mode="both", prompt_version="v1", params={}, budget={},
        )
        episode_id = create_episode(
            db, run_id=run_id,
            task_row_id=task_row_id(benchmark.id, "t1"),
            reference_length=1,
            started_at="2026-10-26T00:00:00+00:00",
        )
        app.state.events.publish(
            run_id,
            "move.applied",
            {"moves": ["U"], "state": live.to_json(), "moves_used": 1},
            episode_id=episode_id,
        )
        response = client.get(f"/api/runs/{run_id}/snapshot")
        assert response.status_code == 200
        assert response.json()["current_state"] == live.to_json()


def test_snapshot_falls_back_to_task_state(tmp_path: Path) -> None:
    db = Database(tmp_path / "snap2.db")
    state = apply_moves(CubeState.solved(2), ["R"])
    benchmark = Benchmark(
        id="snap-bench-2",
        name="snap2",
        cube="2x2",
        tasks=[
            Task(
                id="t1", cube="2x2", scramble=["R"], scramble_depth=1,
                state=state.to_json(), reference_length=1,
                reference_kind="exact", bin="1",
            )
        ],
    )
    app = create_app(
        db=db,
        provider_factory=lambda record: FakeProvider([]),
        solver_factory=lambda cube: None,
        env={},
    )
    with TestClient(app) as client:
        save_benchmark(db, benchmark, {})
        provider = create_provider(
            db, name="p", base_url="http://localhost:1/v1",
            model="m", api_key_ref="KEY",
        )
        run_id = create_run(
            db, provider_id=provider.id, benchmark_id=benchmark.id,
            tool_mode="both", prompt_version="v1", params={}, budget={},
        )
        create_episode(
            db, run_id=run_id,
            task_row_id=task_row_id(benchmark.id, "t1"),
            reference_length=1,
            started_at="2026-10-26T00:00:00+00:00",
        )
        response = client.get(f"/api/runs/{run_id}/snapshot")
        assert response.json()["current_state"] == state.to_json()


def test_snapshot_uses_tool_result_payload_state(tmp_path: Path) -> None:
    db = Database(tmp_path / "snap-tool.db")
    task_state = apply_moves(CubeState.solved(2), ["R"])
    live_state = apply_moves(CubeState.solved(2), ["F"])
    benchmark = Benchmark(
        id="snap-bench-tool",
        name="snap-tool",
        cube="2x2",
        tasks=[
            Task(
                id="t1", cube="2x2", scramble=["R"], scramble_depth=1,
                state=task_state.to_json(), reference_length=1,
                reference_kind="exact", bin="1",
            )
        ],
    )
    app = create_app(
        db=db,
        provider_factory=lambda record: FakeProvider([]),
        solver_factory=lambda cube: None,
        env={},
    )
    with TestClient(app) as client:
        save_benchmark(db, benchmark, {})
        provider = create_provider(
            db, name="p", base_url="http://localhost:1/v1",
            model="m", api_key_ref="KEY",
        )
        run_id = create_run(
            db, provider_id=provider.id, benchmark_id=benchmark.id,
            tool_mode="both", prompt_version="v1", params={}, budget={},
        )
        episode_id = create_episode(
            db, run_id=run_id,
            task_row_id=task_row_id(benchmark.id, "t1"),
            reference_length=1,
            started_at="2026-10-26T00:00:00+00:00",
        )
        app.state.events.publish(
            run_id,
            "tool.result",
            {
                "tool": "get_state",
                "ok": True,
                "payload": {"state": live_state.to_json()},
            },
            episode_id=episode_id,
        )
        response = client.get(f"/api/runs/{run_id}/snapshot")
        assert response.json()["current_state"] == live_state.to_json()


def test_snapshot_ignores_other_episodes_events(tmp_path: Path) -> None:
    db = Database(tmp_path / "snap-scope.db")
    task_state = apply_moves(CubeState.solved(2), ["R"])
    other_state = apply_moves(CubeState.solved(2), ["U"])
    benchmark = Benchmark(
        id="snap-bench-scope",
        name="snap-scope",
        cube="2x2",
        tasks=[
            Task(
                id="t1", cube="2x2", scramble=["R"], scramble_depth=1,
                state=task_state.to_json(), reference_length=1,
                reference_kind="exact", bin="1",
            )
        ],
    )
    app = create_app(
        db=db,
        provider_factory=lambda record: FakeProvider([]),
        solver_factory=lambda cube: None,
        env={},
    )
    with TestClient(app) as client:
        save_benchmark(db, benchmark, {})
        provider = create_provider(
            db, name="p", base_url="http://localhost:1/v1",
            model="m", api_key_ref="KEY",
        )
        run_id = create_run(
            db, provider_id=provider.id, benchmark_id=benchmark.id,
            tool_mode="both", prompt_version="v1", params={}, budget={},
        )
        first_episode = create_episode(
            db, run_id=run_id,
            task_row_id=task_row_id(benchmark.id, "t1"),
            reference_length=1,
            started_at="2026-10-26T00:00:00+00:00",
        )
        app.state.events.publish(
            run_id,
            "move.applied",
            {
                "moves": ["U"],
                "state": other_state.to_json(),
                "moves_used": 1,
            },
            episode_id=first_episode,
        )
        create_episode(
            db, run_id=run_id,
            task_row_id=task_row_id(benchmark.id, "t1"),
            reference_length=1,
            started_at="2026-10-26T00:00:01+00:00",
        )
        response = client.get(f"/api/runs/{run_id}/snapshot")
        assert response.json()["current_state"] == task_state.to_json()


def test_batch_create_runs_for_multiple_providers(tmp_path: Path) -> None:
    # make_app 里 factory 返回同一个 FakeProvider（有状态，逐次 pop），
    # 两个 run 各跑 1 个 episode，所以要给 2 个相同的解题回合。
    client, benchmark_id = make_app(
        tmp_path,
        [
            ModelTurn(
                tool_calls=[
                    ToolCall(id="c1", name="apply_moves", arguments={"moves": ["R'"]})
                ]
            ),
            ModelTurn(
                tool_calls=[
                    ToolCall(id="c1", name="apply_moves", arguments={"moves": ["R'"]})
                ]
            ),
        ],
    )
    with client:
        first = seed(client)
        second = client.post(
            "/api/providers",
            json={
                "name": "p2",
                "base_url": "http://localhost:2/v1",
                "model": "m2",
                "api_key_ref": "KEY",
            },
        ).json()["id"]
        response = client.post(
            "/api/runs",
            json={
                "provider_ids": [first, second],
                "benchmark_id": benchmark_id,
            },
        )
        assert response.status_code == 202
        body = response.json()
        assert body["id"] == body["runs"][0]["id"]
        assert [item["provider_id"] for item in body["runs"]] == [first, second]
        for item in body["runs"]:
            run = wait_finished(client, item["id"])
            assert run["status"] == "finished"
            assert run["totals"]["totals"]["solved"] == 1


def test_batch_create_with_task_subset(tmp_path: Path) -> None:
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
            json={
                "provider_id": provider_id,
                "benchmark_id": benchmark_id,
                "task_keys": ["t1"],
            },
        )
        assert response.status_code == 202
        run_id = response.json()["id"]
        wait_finished(client, run_id)
        episodes = client.get(f"/api/runs/{run_id}").json()["episodes"]
        assert [item["task_key"] for item in episodes] == ["t1"]
        run = client.get(f"/api/runs/{run_id}").json()["run"]
        # make_app 的题集只有 t1 一题，选题 t1 = 全集，partial 为 False；
        # 子集对齐断言在 service 层测试里覆盖（双题集选题 t2）。
        assert run["totals"]["partial"] is False


def test_batch_create_rejects_bad_task_keys_and_providers(tmp_path: Path) -> None:
    client, benchmark_id = make_app(tmp_path, [])
    with client:
        provider_id = seed(client)
        empty = client.post(
            "/api/runs",
            json={
                "provider_id": provider_id,
                "benchmark_id": benchmark_id,
                "task_keys": [],
            },
        )
        assert empty.status_code == 400
        invalid = client.post(
            "/api/runs",
            json={
                "provider_id": provider_id,
                "benchmark_id": benchmark_id,
                "task_keys": ["nope"],
            },
        )
        assert invalid.status_code == 400
        assert "nope" in invalid.json()["detail"]
        missing = client.post(
            "/api/runs",
            json={
                "provider_ids": [provider_id, "ghost"],
                "benchmark_id": benchmark_id,
            },
        )
        assert missing.status_code == 404
        assert "ghost" in missing.json()["detail"]
        none_given = client.post(
            "/api/runs",
            json={"benchmark_id": benchmark_id},
        )
        assert none_given.status_code == 400
