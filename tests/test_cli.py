from pathlib import Path

from mofang.cli import main
from mofang.cube.table2x2 import Table2x2Solver, build_table, save_table
from mofang.tasks.generator import generate_benchmark


def test_fake_run_end_to_end(tmp_path: Path) -> None:
    solver = Table2x2Solver(build_table(max_depth=2))
    benchmark = generate_benchmark(
        name="demo",
        cube="2x2",
        depths=[1, 2],
        per_depth=1,
        seed=3,
        solver=solver,
    )
    bench_path = tmp_path / "bench.json"
    table_path = tmp_path / "table.pkl"
    report_path = tmp_path / "report.json"
    benchmark.save(bench_path)
    save_table(solver.table, table_path)

    exit_code = main(
        [
            "run",
            "--provider",
            "fake",
            "--benchmark",
            str(bench_path),
            "--table",
            str(table_path),
            "--out",
            str(report_path),
        ]
    )
    assert exit_code == 0
    assert report_path.exists()
    text = report_path.read_text(encoding="utf-8")
    assert '"solve_rate": 1.0' in text
    assert '"skill": "none"' in text


def test_run_budget_defaults_match_factory() -> None:
    from mofang.cli import _budget_from_args, build_parser
    from mofang.service.factory import DEFAULT_BUDGETS

    base = [
        "run",
        "--provider",
        "fake",
        "--benchmark",
        "bench.json",
        "--out",
        "report.json",
    ]
    for cube, expected in DEFAULT_BUDGETS.items():
        budget = _budget_from_args(build_parser().parse_args(base), cube)
        assert budget.max_moves == expected["max_moves"]
        assert budget.max_tool_calls == expected["max_tool_calls"]
        assert budget.max_tokens == expected["max_tokens"]
        assert budget.max_seconds == expected["max_seconds"]
        assert budget.turn_timeout == expected["turn_timeout"]


def test_run_budget_explicit_overrides_win() -> None:
    from mofang.cli import _budget_from_args, build_parser

    args = build_parser().parse_args(
        [
            "run",
            "--provider",
            "fake",
            "--benchmark",
            "bench.json",
            "--out",
            "report.json",
            "--max-seconds",
            "120",
            "--turn-timeout",
            "60",
            "--max-moves",
            "8",
        ]
    )
    budget = _budget_from_args(args, "2x2")
    assert budget.max_seconds == 120.0
    assert budget.turn_timeout == 60.0
    assert budget.max_moves == 8


def test_serve_parser_defaults() -> None:
    from mofang.cli import build_parser

    args = build_parser().parse_args(["serve"])
    assert args.command == "serve"
    assert args.host == "127.0.0.1"
    assert args.port == 8000
    assert args.db == "data/mofang.db"
    assert args.table == "data/cache/2x2_distances.pkl"
    assert args.web_dir == "frontend/dist"
