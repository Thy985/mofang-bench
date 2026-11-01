from __future__ import annotations

from collections import defaultdict
from typing import Any

from ..runner.episode import EpisodeResult
from ..tasks.models import Benchmark
from .attribution import attribution_summary
from .scorer import wilson_interval


def aggregate_report(
    benchmark: Benchmark,
    tasks: list,
    results: list[EpisodeResult],
) -> dict[str, Any]:
    # tasks 是实际执行的题目列表（可能是选题子集），必须与 results
    # 一一对应；全集/子集都要按位置配对而不是 zip benchmark.tasks。
    solved = sum(1 for result in results if result.solved)
    total = len(results)
    by_bin: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"total": 0, "solved": 0, "moves": []}
    )
    for result, task in zip(results, tasks):
        bucket = by_bin[task.bin]
        bucket["total"] += 1
        bucket["solved"] += int(result.solved)
        bucket["moves"].append(result.moves_used)
    bins = {}
    for name, bucket in by_bin.items():
        low, high = wilson_interval(bucket["solved"], bucket["total"])
        bins[name] = {
            "total": bucket["total"],
            "solved": bucket["solved"],
            "solve_rate": bucket["solved"] / bucket["total"],
            "ci95": [low, high],
            "mean_moves": sum(bucket["moves"]) / len(bucket["moves"]),
        }
    return {
        "benchmark_id": benchmark.id,
        "benchmark_hash": benchmark.content_hash,
        "benchmark_total_tasks": len(benchmark.tasks),
        "partial": total < len(benchmark.tasks),
        "totals": {
            "tasks": total,
            "solved": solved,
            "solve_rate": solved / total if total else 0.0,
            "ci95": list(wilson_interval(solved, total)),
        },
        "by_bin": bins,
        "attribution": attribution_summary(tasks, results),
        "episodes": [
            {
                "task_id": task.id,
                "status": result.status.value,
                "solved": result.solved,
                "moves_used": result.moves_used,
                "reference_length": result.reference_length,
                "efficiency": result.efficiency,
                "progress_ratio": result.progress_ratio,
                "protocol_errors": result.protocol_errors,
                "tokens_in": result.tokens_in,
                "tokens_out": result.tokens_out,
                "latency_ms": result.latency_ms,
                "failure_code": result.failure_code,
                "error": result.error,
            }
            for task, result in zip(tasks, results)
        ],
    }
