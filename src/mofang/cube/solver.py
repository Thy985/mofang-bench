from __future__ import annotations

import json
import subprocess
import sys
from typing import Protocol

from .colors import FACE_COLOR, FACE_ORDER
from .state import CubeState


class SolverError(RuntimeError):
    pass


class ReferenceSolver(Protocol):
    reference_kind: str

    def solve(self, state: CubeState) -> list[str]: ...

    def distance(self, state: CubeState) -> int | None: ...


class FakeSolver:
    reference_kind = "fake"

    def __init__(
        self,
        distances: dict[str, int] | None = None,
        solutions: dict[str, list[str]] | None = None,
    ) -> None:
        self.distances = distances or {}
        self.solutions = solutions or {}

    def distance(self, state: CubeState) -> int | None:
        return self.distances.get(state.key())

    def solve(self, state: CubeState) -> list[str]:
        try:
            return list(self.solutions[state.key()])
        except KeyError as exc:
            raise SolverError("no fake solution for state") from exc


def facelets_3x3(state: CubeState) -> str:
    if state.size != 3:
        raise ValueError("3x3 state required")
    letter = {FACE_COLOR[face]: face for face in FACE_ORDER}
    return "".join(
        letter[color] for grid in state.faces for row in grid for color in row
    )


class RubikTwoPhaseClient:
    reference_kind = "near_optimal"

    def __init__(self, python: str | None = None) -> None:
        self._process = subprocess.Popen(
            [python or sys.executable, "-m", "mofang.cube.solver_worker"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )

    def _request(self, payload: dict) -> dict:
        if self._process.stdin is None or self._process.stdout is None:
            raise SolverError("solver worker is not running")
        self._process.stdin.write(json.dumps(payload) + "\n")
        self._process.stdin.flush()
        line = self._process.stdout.readline()
        if not line:
            stderr = self._process.stderr.read() if self._process.stderr else ""
            raise SolverError(f"solver worker exited: {stderr}")
        return json.loads(line)

    def solve(self, state: CubeState) -> list[str]:
        response = self._request({"facelets": facelets_3x3(state)})
        if not response.get("ok"):
            raise SolverError(str(response.get("error", "solver error")))
        return list(response["moves"])

    def distance(self, state: CubeState) -> int | None:
        try:
            return len(self.solve(state))
        except SolverError:
            return None

    def close(self) -> None:
        if self._process.poll() is None:
            self._process.terminate()
            try:
                self._process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._process.kill()

    def __enter__(self) -> "RubikTwoPhaseClient":
        return self

    def __exit__(self, *args: object) -> None:
        self.close()
