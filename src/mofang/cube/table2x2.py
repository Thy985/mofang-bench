from __future__ import annotations

import pickle
from pathlib import Path

from .colors import FACE_COLOR, FACE_ORDER, Color
from .geometry import move_permutation
from .moves import format_move, turn
from .state import CubeState

_COLOR_INDEX = {color: index for index, color in enumerate(Color)}
_MOVES = tuple((face, amount) for face in FACE_ORDER for amount in (1, 2, 3))


def state_key_2x2(state: CubeState) -> bytes:
    if state.size != 2:
        raise ValueError("2x2 state required")
    return bytes(
        _COLOR_INDEX[color]
        for grid in state.faces
        for row in grid
        for color in row
    )


def _solved_key() -> bytes:
    return bytes(
        _COLOR_INDEX[FACE_COLOR[face]]
        for face in FACE_ORDER
        for _ in range(4)
    )


def _apply_perm(key: bytes, perm: tuple[int, ...]) -> bytes:
    return bytes(key[source] for source in perm)


def build_table(max_depth: int = 11) -> dict[bytes, int]:
    solved = _solved_key()
    perms = [move_permutation(2, face, amount) for face, amount in _MOVES]
    distances: dict[bytes, int] = {solved: 0}
    frontier = [solved]
    depth = 0
    while frontier and depth < max_depth:
        depth += 1
        next_frontier: list[bytes] = []
        for key in frontier:
            for perm in perms:
                neighbor = _apply_perm(key, perm)
                if neighbor not in distances:
                    distances[neighbor] = depth
                    next_frontier.append(neighbor)
        frontier = next_frontier
        print(f"2x2 depth {depth}: {len(distances)} states", flush=True)
    return distances


def save_table(table: dict[bytes, int], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as handle:
        pickle.dump(table, handle, protocol=pickle.HIGHEST_PROTOCOL)


def load_table(path: Path) -> dict[bytes, int]:
    with path.open("rb") as handle:
        return pickle.load(handle)


class Table2x2Solver:
    reference_kind = "exact"

    def __init__(self, table: dict[bytes, int]) -> None:
        self.table = table

    def distance(self, state: CubeState) -> int | None:
        return self.table.get(state_key_2x2(state))

    def solve(self, state: CubeState) -> list[str]:
        current = state
        remaining = self.distance(current)
        if remaining is None:
            raise ValueError("state is not in the 2x2 distance table")
        moves: list[str] = []
        while remaining > 0:
            for face in FACE_ORDER:
                for amount in (1, 2, 3):
                    neighbor = turn(current, face, amount)
                    neighbor_distance = self.distance(neighbor)
                    if neighbor_distance == remaining - 1:
                        moves.append(format_move(face, amount))
                        current = neighbor
                        remaining = neighbor_distance
                        break
                else:
                    continue
                break
            else:
                raise RuntimeError("no distance-decreasing move")
        return moves
