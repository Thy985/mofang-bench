import json
import os
import subprocess
import sys
from pathlib import Path

TABLE_FILES = ("phase1_prun", "phase2_prun", "phase2_cornsliceprun")


def _run_worker(cwd: Path, facelets: str = "U" * 54) -> subprocess.CompletedProcess[str]:
    env = dict(os.environ)
    src = Path(__file__).resolve().parents[2] / "src"
    env["PYTHONPATH"] = str(src) + os.pathsep + env.get("PYTHONPATH", "")
    return subprocess.run(
        [sys.executable, "-m", "mofang.cube.solver_worker"],
        input=json.dumps({"facelets": facelets}) + "\n",
        capture_output=True,
        text=True,
        cwd=cwd,
        env=env,
        timeout=120,
    )


def test_worker_reports_missing_tables_without_starting_generation(tmp_path: Path) -> None:
    proc = _run_worker(tmp_path)

    lines = [line for line in proc.stdout.splitlines() if line.strip()]
    assert len(lines) == 1
    payload = json.loads(lines[0])
    assert payload["ok"] is False
    assert "phase1_prun" in payload["error"]


def test_worker_keeps_solver_chatter_off_protocol_stream(tmp_path: Path) -> None:
    package = tmp_path / "twophase"
    package.mkdir()
    (package / "__init__.py").write_text("", encoding="utf-8")
    for name in TABLE_FILES:
        (package / name).write_bytes(b"")
    (package / "solver.py").write_text(
        "print('creating tables...', flush=True)\n"
        "def solve(facelets, max_length, timeout):\n"
        "    print('searching....', flush=True)\n"
        "    return \"R U (3f)\"\n",
        encoding="utf-8",
    )

    proc = _run_worker(tmp_path)

    lines = [line for line in proc.stdout.splitlines() if line.strip()]
    assert len(lines) == 1
    assert json.loads(lines[0]) == {"ok": True, "moves": ["R", "U"], "length": 2}
    assert "creating tables..." in proc.stderr
    assert "searching...." in proc.stderr
