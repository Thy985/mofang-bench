"""GPL boundary: imports RubikTwoPhase (GPLv3+).

The main backend talks to this process over JSON lines and never imports
twophase itself. Keep this file free of project imports.
"""
from __future__ import annotations

import json
import sys


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
    import twophase.solver as solver

    for line in sys.stdin:
        try:
            request = json.loads(line)
            result = solver.solve(request["facelets"], 20, 10)
            moves, length = parse_result(result)
            print(
                json.dumps({"ok": True, "moves": moves, "length": length}),
                flush=True,
            )
        except Exception as exc:  # worker must stay alive for the next request
            print(json.dumps({"ok": False, "error": str(exc)}), flush=True)


if __name__ == "__main__":
    main()
