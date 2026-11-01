from pathlib import Path

from mofang.store.db import Database
from mofang.store.providers import (
    create_provider,
    delete_provider,
    get_provider,
    list_providers,
    set_provider_key,
    update_provider,
)


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


def test_stored_key_round_trip_and_clear(tmp_path: Path) -> None:
    db = Database(tmp_path / "t.db")
    db.initialize()
    record = create_provider(
        db,
        name="local",
        base_url="http://localhost:1/v1",
        model="m",
        api_key_ref="",
        api_key="sk-stored",
    )
    assert record.api_key == "sk-stored"
    assert get_provider(db, record.id).api_key == "sk-stored"

    updated = set_provider_key(db, record.id, "sk-new")
    assert updated is not None
    assert updated.api_key == "sk-new"

    cleared = set_provider_key(db, record.id, None)
    assert cleared is not None
    assert cleared.api_key is None
    assert set_provider_key(db, "missing", "sk-x") is None


def test_update_provider_merges_params_and_keeps_key(tmp_path: Path) -> None:
    db = Database(tmp_path / "t.db")
    db.initialize()
    record = create_provider(
        db,
        name="local",
        base_url="http://localhost:1/v1",
        model="m",
        api_key_ref="",
        api_key="sk-stored",
        params={"temperature": 0.5, "max_tokens": 16384, "stream": False},
    )
    # 编辑表单只提交 temperature/max_tokens/extra，浅合并应保留 stream
    updated = update_provider(
        db,
        record.id,
        name="renamed",
        base_url="http://localhost:2/v1/",
        model="m2",
        api_key_ref="NEW_REF",
        params={"temperature": 0.9},
    )
    assert updated is not None
    assert updated.name == "renamed"
    assert updated.base_url == "http://localhost:2/v1"  # 去尾斜杠
    assert updated.model == "m2"
    assert updated.api_key_ref == "NEW_REF"
    assert updated.api_key == "sk-stored"  # key 不经编辑改动
    assert updated.params["temperature"] == 0.9
    assert updated.params["max_tokens"] == 16384
    assert updated.params["stream"] is False


def test_update_provider_missing(tmp_path: Path) -> None:
    db = Database(tmp_path / "t.db")
    db.initialize()
    assert (
        update_provider(
            db,
            "missing",
            name="n",
            base_url="http://x/v1",
            model="m",
            api_key_ref="",
        )
        is None
    )


def test_delete_provider(tmp_path: Path) -> None:
    db = Database(tmp_path / "t.db")
    db.initialize()
    record = create_provider(
        db,
        name="local",
        base_url="http://localhost:1/v1",
        model="m",
        api_key_ref="",
    )
    assert delete_provider(db, record.id) is True
    assert get_provider(db, record.id) is None
    assert delete_provider(db, record.id) is False
    assert delete_provider(db, "missing") is False
