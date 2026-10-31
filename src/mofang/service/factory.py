from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Callable, Mapping

from ..cube.solver import ReferenceSolver, RubikTwoPhaseClient
from ..cube.table2x2 import Table2x2Solver, load_table
from ..models.openai_compat import OpenAICompatibleAdapter
from ..models.provider import ModelParams
from ..runner.budget import Budget
from ..store.providers import ProviderRecord

DEFAULT_BUDGETS = {
    "2x2": {
        "max_moves": 30,
        "max_seconds": 300.0,
        "max_tool_calls": 50,
        "max_tokens": 300_000,
        "turn_timeout": 120.0,
    },
    "3x3": {
        "max_moves": 100,
        "max_seconds": 900.0,
        "max_tool_calls": 150,
        "max_tokens": 1_000_000,
        "turn_timeout": 120.0,
    },
}


class ProviderConfigError(RuntimeError):
    pass


def build_adapter(
    record: ProviderRecord,
    env: Mapping[str, str] | None = None,
) -> OpenAICompatibleAdapter:
    values = os.environ if env is None else env
    key = record.api_key or values.get(record.api_key_ref, "")
    if not key:
        raise ProviderConfigError(
            "no API key configured: save one on the provider "
            "or set its environment variable"
        )
    # params 是用户输入边界：retry_delay 只接受正数，坏值回落默认，
    # 避免一个手误让所有 run 在构造 adapter 时崩掉。
    try:
        retry_delay = float(record.params.get("retry_delay", 1.0))
    except (TypeError, ValueError):
        retry_delay = 1.0
    if not retry_delay > 0:
        retry_delay = 1.0
    return OpenAICompatibleAdapter(
        base_url=record.base_url,
        api_key=key,
        model=record.model,
        retry_delay=retry_delay,
        stream=bool(record.params.get("stream", True)),
    )


def budget_for(cube: str, overrides: Mapping[str, Any]) -> Budget:
    values = dict(DEFAULT_BUDGETS[cube])
    values.update(overrides)
    return Budget(**values)


def model_params_for(
    record: ProviderRecord, overrides: Mapping[str, Any]
) -> ModelParams:
    values = dict(record.params)
    values.update(overrides)
    extra = values.pop("extra", {})
    return ModelParams(
        temperature=float(values.get("temperature", 0.0)),
        max_tokens=int(values.get("max_tokens", 4096)),
        extra=dict(extra),
    )


def make_solver_factory(
    table_path: Path,
) -> Callable[[str], ReferenceSolver]:
    def factory(cube: str) -> ReferenceSolver:
        if cube == "2x2":
            return Table2x2Solver(load_table(table_path))
        return RubikTwoPhaseClient()

    return factory
