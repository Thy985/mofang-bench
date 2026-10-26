from pathlib import Path

from fastapi.testclient import TestClient

from mofang.api.app import create_app
from mofang.store.db import Database


def test_compare_requires_two_runs(tmp_path: Path) -> None:
    app = create_app(db=Database(tmp_path / "t.db"), env={})
    with TestClient(app) as client:
        assert client.get("/api/compare?run_ids=a").status_code == 400
        assert client.get("/api/compare?run_ids=a,b").status_code == 404
