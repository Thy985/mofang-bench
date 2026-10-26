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
