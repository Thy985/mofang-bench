from fastapi.testclient import TestClient

from mofang.api.app import create_app
from mofang.models.provider import FakeProvider
from mofang.store.db import Database


def make_client(tmp_path, provider_factory=None):
    db = Database(tmp_path / "t.db")
    app = create_app(
        db=db,
        provider_factory=provider_factory
        or (lambda record: FakeProvider([])),
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


def test_create_with_stored_key_masks_it(tmp_path) -> None:
    client, db = make_client(tmp_path)
    with client:
        response = client.post(
            "/api/providers",
            json={
                "name": "local",
                "base_url": "http://localhost:1/v1",
                "model": "m",
                "api_key": "sk-secret",
            },
        )
        assert response.status_code == 201
        body = response.json()
        assert body["key_configured"] is True
        assert body["key_stored"] is True
        assert "sk-secret" not in response.text
        listed = client.get("/api/providers")
        assert "sk-secret" not in listed.text
        assert listed.json()[0]["api_key_ref"] == ""
        from mofang.store.providers import get_provider

        assert get_provider(db, body["id"]).api_key == "sk-secret"


def test_create_requires_key_or_ref(tmp_path) -> None:
    client, _ = make_client(tmp_path)
    with client:
        response = client.post(
            "/api/providers",
            json={
                "name": "local",
                "base_url": "http://localhost:1/v1",
                "model": "m",
                "api_key_ref": "",
            },
        )
        assert response.status_code == 400
        assert "api_key" in response.json()["detail"]


def test_set_and_clear_stored_key(tmp_path) -> None:
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
        stored = client.put(
            f"/api/providers/{created['id']}/key",
            json={"api_key": "sk-new"},
        )
        assert stored.status_code == 200
        assert stored.json()["key_stored"] is True
        assert "sk-new" not in stored.text

        cleared = client.delete(f"/api/providers/{created['id']}/key")
        assert cleared.status_code == 200
        assert cleared.json()["key_stored"] is False
        assert cleared.json()["key_configured"] is True
        assert client.put(
            "/api/providers/nope/key", json={"api_key": "x"}
        ).status_code == 404
        assert client.delete("/api/providers/nope/key").status_code == 404


def test_probe_uses_stored_key(tmp_path) -> None:
    seen = []

    def factory(record):
        seen.append(record)
        return FakeProvider([])

    client, _ = make_client(tmp_path, provider_factory=factory)
    with client:
        created = client.post(
            "/api/providers",
            json={
                "name": "local",
                "base_url": "http://localhost:1/v1",
                "model": "m",
                "api_key": "sk-secret",
            },
        ).json()
        assert client.post(
            f"/api/providers/{created['id']}/probe"
        ).status_code == 200
        assert seen[0].api_key == "sk-secret"
