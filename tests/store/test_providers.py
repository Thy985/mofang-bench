from pathlib import Path

from mofang.store.db import Database
from mofang.store.providers import create_provider, get_provider, list_providers


def test_provider_round_trip(tmp_path: Path) -> None:
    db = Database(tmp_path / "t.db")
    db.initialize()
    record = create_provider(
        db,
        name="local",
        base_url="http://localhost:20128/v1",
        model="ollama/gpt-oss:120b",
        api_key_ref="MOFANG_TEST_KEY",
        params={"temperature": 0.0, "max_tokens": 4096},
    )
    assert record.id
    assert record.params["max_tokens"] == 4096
    loaded = get_provider(db, record.id)
    assert loaded == record
    assert [item.id for item in list_providers(db)] == [record.id]


def test_provider_not_found(tmp_path: Path) -> None:
    db = Database(tmp_path / "t.db")
    db.initialize()
    assert get_provider(db, "missing") is None
