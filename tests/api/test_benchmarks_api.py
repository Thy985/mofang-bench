from fastapi.testclient import TestClient

from mofang.api.app import create_app
from mofang.cube.table2x2 import Table2x2Solver, build_table
from mofang.store.db import Database


def make_client(tmp_path):
    db = Database(tmp_path / "t.db")
    app = create_app(
        db=db,
        provider_factory=lambda record: None,
        solver_factory=lambda cube: Table2x2Solver(build_table(max_depth=2)),
        env={},
    )
    return TestClient(app)


def test_generate_and_get_benchmark(tmp_path) -> None:
    client = make_client(tmp_path)
    with client:
        response = client.post(
            "/api/benchmarks",
            json={
                "name": "demo",
                "cube": "2x2",
                "depths": [1, 2],
                "per_depth": 1,
                "seed": 3,
                "solver": "table",
            },
        )
        assert response.status_code == 201
        body = response.json()
        assert body["task_count"] == 2
        listed = client.get("/api/benchmarks").json()
        assert listed[0]["id"] == body["id"]
        detail = client.get(f"/api/benchmarks/{body['id']}").json()
        assert len(detail["tasks"]) == 2
        assert detail["tasks"][0]["reference_kind"] == "exact"


def test_bad_benchmark_request(tmp_path) -> None:
    client = make_client(tmp_path)
    with client:
        response = client.post(
            "/api/benchmarks",
            json={"name": "x", "cube": "2x2", "depths": [], "per_depth": 1},
        )
        assert response.status_code == 400


def test_duplicate_benchmark_returns_conflict(tmp_path) -> None:
    client = make_client(tmp_path)
    payload = {
        "name": "dup",
        "cube": "2x2",
        "depths": [1],
        "per_depth": 1,
        "seed": 3,
    }
    with client:
        first = client.post("/api/benchmarks", json=payload)
        assert first.status_code == 201
        second = client.post("/api/benchmarks", json=payload)
        assert second.status_code == 409
        assert second.json()["detail"]["id"] == "dup-2x2-3"


def test_benchmark_name_with_path_characters_is_rejected(tmp_path) -> None:
    client = make_client(tmp_path)
    with client:
        for char in ("/", "#", "?"):
            response = client.post(
                "/api/benchmarks",
                json={
                    "name": f"bad{char}name",
                    "cube": "2x2",
                    "depths": [1],
                    "per_depth": 1,
                    "seed": 3,
                    "solver": "table",
                },
            )
            assert response.status_code == 400, char
            assert response.json()["detail"] == "name must not contain / # or ?"
            # 被拒的名字一条都没落库
            assert client.get("/api/benchmarks").json() == []
        # 对照用例：空格、中文、连字符都要放行——连字符本来就出现在每个拼出来的 id 里
        ok = client.post(
            "/api/benchmarks",
            json={
                "name": "demo 基准-v1",
                "cube": "2x2",
                "depths": [1],
                "per_depth": 1,
                "seed": 3,
                "solver": "table",
            },
        )
        assert ok.status_code == 201
        assert ok.json()["id"] == "demo 基准-v1-2x2-3"
