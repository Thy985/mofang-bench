from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable, Mapping

from ..cube.solver import ReferenceSolver, RubikTwoPhaseClient
from ..cube.table2x2 import Table2x2Solver, load_table
from ..models.openai_compat import OpenAICompatibleAdapter
from ..models.provider import ModelParams
from ..runner.budget import Budget
from ..store.providers import ProviderRecord

# turn_timeout 是"整轮"上限，包含 429 重试与两次重试之间的退避，也必须
# 覆盖 reasoning 模型的单轮长思考（实测 2x2 d1 单轮可达 285-600s）。
# 单次 HTTP 尝试默认 120s（openai_compat.DEFAULT_TIMEOUT），默认退避
# 2+4+8=14s；2x2 取 600s，3x3 思考更久取 900s。
DEFAULT_BUDGETS = {
    "2x2": {
        "max_moves": 30,
        "max_seconds": 1800.0,
        "max_tool_calls": 50,
        "max_tokens": 300_000,
        "turn_timeout": 600.0,
    },
    "3x3": {
        "max_moves": 100,
        "max_seconds": 2400.0,
        "max_tool_calls": 150,
        "max_tokens": 1_000_000,
        "turn_timeout": 900.0,
    },
}


# skill 模式只抬高 max_moves，其余预算沿用 DEFAULT_BUDGETS。
# 2x2 Ortega 典型 20–28 步，最坏路径更长，30 步没有纠错余量；
# 上一批验跑出现过 34/36 几乎顶格，本批放宽到 40（3x3 不动）。
# 3x3 LBL 典型 85–110 步，100 步会系统性不够，200 是建议值（220 为上限）。
SKILL_MAX_MOVES: dict[str, int] = {
    "ortega": 40,
    "lbl": 200,
}
SKILL_MAX_MOVES_CAP: dict[str, int] = {
    "lbl": 220,
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
    # 默认 2s 是为了覆盖网关 8-10s 的 429 reset 窗口：4 次尝试的退避为
    # 2+4+8=14s（这些 sleep 计入 Budget.turn_timeout，见 DEFAULT_BUDGETS）。
    try:
        retry_delay = float(record.params.get("retry_delay", 2.0))
    except (TypeError, ValueError):
        retry_delay = 2.0
    if not retry_delay > 0:
        retry_delay = 2.0
    return OpenAICompatibleAdapter(
        base_url=record.base_url,
        api_key=key,
        model=record.model,
        retry_delay=retry_delay,
        stream=bool(record.params.get("stream", True)),
    )


def budget_for(
    cube: str, overrides: Mapping[str, Any], *, skill: str = "none"
) -> Budget:
    values = dict(DEFAULT_BUDGETS[cube])
    floor = SKILL_MAX_MOVES.get(skill)
    if floor is not None:
        values["max_moves"] = min(floor, SKILL_MAX_MOVES_CAP.get(skill, floor))
    # 显式覆盖永远优先，不在这里偷偷改写用户输入。
    values.update(overrides)
    return Budget(**values)


def skill_budget_warning(skill: str, max_moves: int) -> str | None:
    """显式 max_moves 低于 skill 模式建议下限时，给结果附一条可读提示。"""
    floor = SKILL_MAX_MOVES.get(skill)
    if floor is None or max_moves >= floor:
        return None
    return (
        f"显式 max_moves={max_moves} 低于 skill={skill} 模式建议下限 "
        f"{floor}，本 run 的局更容易被判死（未改写用户输入）"
    )


def model_params_for(
    record: ProviderRecord, overrides: Mapping[str, Any]
) -> ModelParams:
    values = dict(record.params)
    values.update(overrides)
    extra = values.pop("extra", {})
    return ModelParams(
        temperature=float(values.get("temperature", 0.0)),
        max_tokens=int(values.get("max_tokens", 32000)),
        extra=dict(extra),
    )


def make_solver_factory(
    table_path: Path,
) -> Callable[[str], ReferenceSolver]:
    # 2x2 距离表是只读的（Table2x2Solver 只做 dict.get），
    # 并行 run 各建一个 solver 时缓存加载结果，避免 pickle 表重复占内存。
    @lru_cache(maxsize=1)
    def load_table_cached(path: str):
        return load_table(Path(path))

    def factory(cube: str) -> ReferenceSolver:
        if cube == "2x2":
            return Table2x2Solver(load_table_cached(str(table_path)))
        return RubikTwoPhaseClient()

    return factory
