from __future__ import annotations

import random

from ..store.benchmarks import get_benchmark
from ..store.db import Database
from ..store.runs import get_run, get_run_episodes


def bootstrap_diff_ci(
    diffs: list[float], n: int = 2000, seed: int = 0
) -> tuple[float, float, float]:
    if not diffs:
        return 0.0, 0.0, 0.0
    observed = sum(diffs) / len(diffs)
    rng = random.Random(seed)
    samples = []
    for _ in range(n):
        total = 0.0
        for _ in diffs:
            total += diffs[rng.randrange(len(diffs))]
        samples.append(total / len(diffs))
    samples.sort()
    low = samples[int(0.025 * (n - 1))]
    high = samples[int(0.975 * (n - 1))]
    return observed, low, high


def compare_runs(db: Database, run_ids: list[str]) -> dict:
    if len(run_ids) != 2:
        raise ValueError("exactly two runs required")
    runs = [get_run(db, run_id) for run_id in run_ids]
    if any(run is None for run in runs):
        raise LookupError("run not found")
    first, second = runs
    assert first is not None and second is not None
    if first["benchmark_id"] != second["benchmark_id"]:
        raise ValueError("runs use different benchmarks")
    first_bench = get_benchmark(db, first["benchmark_id"])
    second_bench = get_benchmark(db, second["benchmark_id"])
    if first_bench is None or second_bench is None:
        raise ValueError("benchmark not found")
    if first_bench.content_hash != second_bench.content_hash:
        raise ValueError("benchmark content hash mismatch")
    first_eps = {
        item["task_id"]: item for item in get_run_episodes(db, first["id"])
    }
    second_eps = {
        item["task_id"]: item for item in get_run_episodes(db, second["id"])
    }
    keys = sorted(set(first_eps) & set(second_eps))
    pairs = []
    diffs = []
    for key in keys:
        a, b = first_eps[key], second_eps[key]
        delta = int(b["solved"]) - int(a["solved"])
        diffs.append(float(delta))
        pairs.append(
            {
                "task_id": key.split(":", 1)[-1],
                "first_solved": bool(a["solved"]),
                "second_solved": bool(b["solved"]),
                "delta": delta,
            }
        )
    observed, low, high = bootstrap_diff_ci(diffs)
    return {
        "benchmark_id": first["benchmark_id"],
        "content_hash": first_bench.content_hash,
        "tasks": len(keys),
        "runs": run_ids,
        # solver 口径随对比固化；same_solver=false 表示 off/assist 被混比，
        # 前端可据此提示，不把两种口径的 solved 直接等同。
        "solver_first": first.get("solver", "off"),
        "solver_second": second.get("solver", "off"),
        "same_solver": first.get("solver", "off")
        == second.get("solver", "off"),
        # skill 口径与 solver 同级：none/ortega/lbl 不同组合不得直接混统计。
        "skill_first": first.get("skill", "none"),
        "skill_second": second.get("skill", "none"),
        "same_skill": first.get("skill", "none")
        == second.get("skill", "none"),
        "solve_rate_first": (
            sum(1 for item in keys if first_eps[item]["solved"]) / len(keys)
            if keys
            else 0.0
        ),
        "solve_rate_second": (
            sum(1 for item in keys if second_eps[item]["solved"]) / len(keys)
            if keys
            else 0.0
        ),
        "solve_rate_diff": observed,
        "ci95": [low, high],
        "pairs": pairs,
    }
