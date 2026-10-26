from __future__ import annotations

from typing import Protocol

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
