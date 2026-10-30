from pathlib import Path

import pytest

from mofang.store.db import Database
from mofang.store.providers import (
    create_provider,
    get_provider,
    set_provider_param,
)


@pytest.fixture()
def db(tmp_path: Path) -> Database:
    db = Database(tmp_path / "t.db")
    db.initialize()
    return db


def test_set_provider_param_merges_and_persists(db) -> None:
    record = create_provider(
        db,
        name="p",
        base_url="http://127.0.0.1:9/v1",
        model="m",
        api_key_ref="K",
        params={"temperature": 0.5},
    )
    updated = set_provider_param(db, record.id, "stream", False)
    assert updated is not None
    assert updated.params == {"temperature": 0.5, "stream": False}
    assert get_provider(db, record.id).params["stream"] is False


def test_set_provider_param_missing_returns_none(db) -> None:
    assert set_provider_param(db, "nope", "stream", False) is None
