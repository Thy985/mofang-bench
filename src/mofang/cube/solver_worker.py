"""GPL boundary: imports RubikTwoPhase (GPLv3+).

The main backend talks to this process over JSON lines and never imports
twophase itself. Keep this file free of project imports.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

TABLE_FILES = ("phase1_prun", "phase2_prun", "phase2_cornsliceprun")


def missing_tables(base: Path) -> list[str]:
    folder = base / "twophase"
    return [name for name in TABLE_FILES if not (folder / name).is_file()]


def parse_result(result: str) -> tuple[list[str], int]:
    text = result.strip()
    if not text:
        return [], 0
    tokens = text.split()
    if tokens[0].startswith("Error"):
        raise RuntimeError(text)
    if tokens[-1].startswith("("):
        tokens = tokens[:-1]
    return tokens, len(tokens)


def main() -> None:
    protocol = sys.stdout
    sys.stdout = sys.stderr  # GPL 求解器会向 stdout 打印进度，不能污染协议流
    missing = missing_tables(Path.cwd())
    setup_error = None
    solver = None
    if missing:
        setup_error = (
            "3x3 tables missing: "
            + ", ".join(f"twophase/{name}" for name in missing)
            + "; run scripts/build_3x3_tables.py from the project root"
        )
    else:
        import twophase.solver as solver

    for line in sys.stdin:
        try:
            request = json.loads(line)
            if setup_error:
                raise RuntimeError(setup_error)
            result = solver.solve(request["facelets"], 20, 10)
            moves, length = parse_result(result)
            print(
                json.dumps({"ok": True, "moves": moves, "length": length}),
                file=protocol,
                flush=True,
            )
        except Exception as exc:  # worker must stay alive for the next request
            print(
                json.dumps({"ok": False, "error": str(exc)}),
                file=protocol,
                flush=True,
            )


if __name__ == "__main__":
    main()
