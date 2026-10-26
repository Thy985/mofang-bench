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


def test_serve_parser_defaults() -> None:
    from mofang.cli import build_parser

    args = build_parser().parse_args(["serve"])
    assert args.command == "serve"
    assert args.host == "127.0.0.1"
    assert args.port == 8000
    assert args.db == "data/mofang.db"
    assert args.table == "data/cache/2x2_distances.pkl"
