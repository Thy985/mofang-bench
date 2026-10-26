from pathlib import Path

import pytest

from mofang.cube.state import CubeState
from mofang.cube.table2x2 import build_table, save_table
from mofang.service.factory import (
    ProviderConfigError,
    budget_for,
    build_adapter,
    make_solver_factory,
    model_params_for,
)
from mofang.store.db import Database
from mofang.store.providers import create_provider


def test_build_adapter_requires_env_key(tmp_path: Path) -> None:
    db = Database(tmp_path / "t.db")
    db.initialize()
    record = create_provider(
        db,
        name="p",
        base_url="http://localhost:1/v1",
        model="m",
        api_key_ref="MISSING_KEY",
    )
    with pytest.raises(ProviderConfigError):
        build_adapter(record, env={})


def test_build_adapter_uses_key_and_params(tmp_path: Path) -> None:
    db = Database(tmp_path / "t.db")
    db.initialize()
    record = create_provider(
        db,
        name="p",
        base_url="http://localhost:1/v1/",
        model="m",
        api_key_ref="KEY",
        params={"max_tokens": 123},
    )
    adapter = build_adapter(record, env={"KEY": "secret"})
    assert adapter.base_url == "http://localhost:1/v1"
    assert adapter.api_key == "secret"
    assert adapter.model == "m"
    assert model_params_for(record, {}).max_tokens == 123
    assert model_params_for(record, {"temperature": 1.0}).temperature == 1.0


def test_budget_defaults_and_overrides() -> None:
    assert budget_for("2x2", {}).max_moves == 30
    assert budget_for("2x2", {}).max_seconds == 300.0
    assert budget_for("3x3", {}).max_moves == 100
    assert budget_for("3x3", {}).max_tokens == 1_000_000
    assert budget_for("2x2", {"max_moves": 5}).max_moves == 5


def test_solver_factory_2x2(tmp_path: Path) -> None:
    table_path = tmp_path / "table.pkl"
    save_table(build_table(max_depth=2), table_path)
    solver = make_solver_factory(table_path)("2x2")
    assert solver.distance(CubeState.solved(2)) == 0
