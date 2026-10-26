from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from .cube.moves import invert_moves
from .cube.table2x2 import Table2x2Solver, build_table, load_table
from .eval.aggregate import aggregate_report
from .models.provider import FakeProvider, ModelTurn, ProviderAdapter, ToolCall
from .runner.budget import Budget
from .runner.episode import EpisodeRunner
from .tasks.generator import generate_benchmark
from .tasks.models import Benchmark, Task


def _fake_turns(task: Task) -> list[ModelTurn]:
    solution = invert_moves(task.scramble)
    return [
        ModelTurn(
            tool_calls=[
                ToolCall(
                    id="fake-call-1",
                    name="apply_moves",
                    arguments={"moves": solution},
                )
            ]
        ),
        ModelTurn(content="solved"),
    ]


def _load_solver(args: argparse.Namespace):
    if args.solver == "table":
        table_path = Path(args.table)
        if not table_path.exists():
            raise SystemExit(
                f"2x2 table not found: {table_path}. "
                "Run: uv run python scripts/build_2x2_table.py"
            )
        return Table2x2Solver(load_table(table_path))
    if args.solver == "rubik":
        from .cube.solver import RubikTwoPhaseClient

        return RubikTwoPhaseClient()
    raise SystemExit(f"unsupported solver: {args.solver}")


async def _run(args: argparse.Namespace) -> int:
    benchmark = Benchmark.load(Path(args.benchmark))
    tasks = benchmark.tasks[: args.limit] if args.limit else benchmark.tasks
    solver = _load_solver(args)
    budget = Budget(
        max_moves=args.max_moves,
        max_tool_calls=args.max_tool_calls,
        max_tokens=args.max_tokens,
        max_seconds=args.max_seconds,
    )
    shared_provider: ProviderAdapter | None = None
    adapter_to_close = None
    if args.provider == "openai":
        import os

        from .models.openai_compat import OpenAICompatibleAdapter

        api_key = os.environ.get(args.api_key_env, "")
        if not api_key:
            raise SystemExit(f"missing API key env: {args.api_key_env}")
        adapter = OpenAICompatibleAdapter(
            base_url=args.base_url,
            api_key=api_key,
            model=args.model,
        )
        shared_provider = adapter
        adapter_to_close = adapter

    results = []
    try:
        for task in tasks:
            provider = shared_provider or FakeProvider(_fake_turns(task))
            runner = EpisodeRunner(provider=provider, solver=solver, budget=budget)
            result = await runner.run(task)
            results.append(result)
            print(
                f"{task.id}: {result.status.value} moves={result.moves_used}",
                flush=True,
            )
    finally:
        close = getattr(solver, "close", None)
        if close is not None:
            close()
        if adapter_to_close is not None:
            await adapter_to_close.close()

    report = aggregate_report(benchmark, results)
    report["provider"] = args.provider
    report["model"] = args.model
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"report: {args.out}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="mofang")
    sub = parser.add_subparsers(dest="command", required=True)

    bench = sub.add_parser("benchmark", help="generate a frozen benchmark")
    bench.add_argument("--name", default="demo")
    bench.add_argument("--cube", choices=["2x2", "3x3"], required=True)
    bench.add_argument("--depths", default="1,2,3")
    bench.add_argument("--per-depth", type=int, default=2)
    bench.add_argument("--seed", type=int, default=42)
    bench.add_argument("--out", required=True)
    bench.add_argument(
        "--solver", choices=["table", "fake", "rubik"], default="table"
    )
    bench.add_argument("--table", default="data/cache/2x2_distances.pkl")

    run = sub.add_parser("run", help="run a benchmark")
    run.add_argument("--provider", choices=["fake", "openai"], default="fake")
    run.add_argument("--benchmark", required=True)
    run.add_argument("--out", required=True)
    run.add_argument("--model", default="fake")
    run.add_argument("--base-url", default="https://api.openai.com/v1")
    run.add_argument("--api-key-env", default="OPENAI_API_KEY")
    run.add_argument("--limit", type=int, default=0)
    run.add_argument("--solver", choices=["table", "rubik"], default="table")
    run.add_argument("--table", default="data/cache/2x2_distances.pkl")
    run.add_argument("--max-moves", type=int, default=30)
    run.add_argument("--max-tool-calls", type=int, default=50)
    run.add_argument("--max-tokens", type=int, default=300_000)
    run.add_argument("--max-seconds", type=float, default=300.0)

    report = sub.add_parser("report", help="print a saved report summary")
    report.add_argument("--report", required=True)
    return parser


def _generate(args: argparse.Namespace) -> int:
    if args.solver == "table":
        table_path = Path(args.table)
        if not table_path.exists():
            raise SystemExit(
                f"2x2 table not found: {table_path}. "
                "Run: uv run python scripts/build_2x2_table.py"
            )
        solver = Table2x2Solver(load_table(table_path))
    elif args.solver == "rubik":
        from .cube.solver import RubikTwoPhaseClient

        solver = RubikTwoPhaseClient()
    else:
        from .cube.solver import FakeSolver

        solver = FakeSolver()
        solver.distance = lambda state: 1  # type: ignore[method-assign]
    try:
        depths = [int(value) for value in args.depths.split(",") if value.strip()]
        benchmark = generate_benchmark(
            name=args.name,
            cube=args.cube,
            depths=depths,
            per_depth=args.per_depth,
            seed=args.seed,
            solver=solver,
        )
        benchmark.save(Path(args.out))
    finally:
        close = getattr(solver, "close", None)
        if close is not None:
            close()
    print(f"benchmark: {args.out} ({len(benchmark.tasks)} tasks)")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "run":
        return asyncio.run(_run(args))
    if args.command == "benchmark":
        return _generate(args)
    if args.command == "report":
        report = json.loads(Path(args.report).read_text(encoding="utf-8"))
        print(json.dumps(report["totals"], ensure_ascii=False, indent=2))
        return 0
    parser.error("unknown command")
    return 2


if __name__ == "__main__":
    sys.exit(main())
