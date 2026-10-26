from fastapi.testclient import TestClient

from mofang.api.app import create_app
from mofang.models.provider import FakeProvider
from mofang.store.db import Database


def make_client(tmp_path):
    db = Database(tmp_path / "t.db")
    app = create_app(
        db=db,
        provider_factory=lambda record: FakeProvider([]),
        solver_factory=lambda cube: None,
        env={"LOCAL_KEY": "secret"},
    )
    return TestClient(app), db


def test_create_and_list_provider_masks_key(tmp_path) -> None:
    client, _ = make_client(tmp_path)
    with client:
        response = client.post(
            "/api/providers",
            json={
                "name": "local",
                "base_url": "http://localhost:20128/v1",
                "model": "m",
                "api_key_ref": "LOCAL_KEY",
                "params": {"max_tokens": 128},
            },
        )
        assert response.status_code == 201
        assert "secret" not in response.text
        body = response.json()
        assert body["key_configured"] is True
        listed = client.get("/api/providers").json()
        assert listed[0]["api_key_ref"] == "LOCAL_KEY"
        assert "secret" not in str(listed)


def test_probe_provider(tmp_path) -> None:
    client, _ = make_client(tmp_path)
    with client:
        created = client.post(
            "/api/providers",
            json={
                "name": "local",
                "base_url": "http://localhost:1/v1",
                "model": "m",
                "api_key_ref": "LOCAL_KEY",
            },
        ).json()
        response = client.post(f"/api/providers/{created['id']}/probe")
        assert response.status_code == 200
        assert response.json() == {"ok": True, "tool_calling": True}


def test_probe_missing_provider(tmp_path) -> None:
    client, _ = make_client(tmp_path)
    with client:
        assert client.post("/api/providers/nope/probe").status_code == 404
