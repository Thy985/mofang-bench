from __future__ import annotations

import pickle
from functools import lru_cache
from pathlib import Path

from .colors import FACE_COLOR, FACE_ORDER, Color
from .geometry import (
    move_permutation,
    sticker_geometry,
    sticker_index,
    whole_rotations,
)
from .moves import format_move, turn
from .state import CubeState

_COLOR_INDEX = {color: index for index, color in enumerate(Color)}
_MOVES = tuple((face, amount) for face in FACE_ORDER for amount in (1, 2, 3))
_WHITE = _COLOR_INDEX[Color.WHITE]
_REFERENCE_COLORS = frozenset(
    {
        _COLOR_INDEX[Color.WHITE],
        _COLOR_INDEX[Color.RED],
        _COLOR_INDEX[Color.GREEN],
    }
)


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


def _inverse_perm(perm: tuple[int, ...]) -> tuple[int, ...]:
    inverse = [0] * len(perm)
    for target, source in enumerate(perm):
        inverse[source] = target
    return tuple(inverse)


@lru_cache(maxsize=None)
def _corner_groups(size: int) -> tuple[tuple[tuple[int, int, int], tuple[int, ...]], ...]:
    groups: dict[tuple[int, int, int], list[int]] = {}
    for face in FACE_ORDER:
        for row in range(size):
            for col in range(size):
                pos, _ = sticker_geometry(face, row, col, size)
                groups.setdefault(pos, []).append(sticker_index(face, row, col, size))
    corners = [
        (pos, tuple(indices))
        for pos, indices in groups.items()
        if len(indices) == 3
    ]
    return tuple(sorted(corners))


def _reference_corner(key: bytes, size: int) -> tuple[tuple[int, int, int], str]:
    for pos, indices in _corner_groups(size):
        if {key[index] for index in indices} == _REFERENCE_COLORS:
            white_index = next(
                index for index in indices if key[index] == _WHITE
            )
            face = FACE_ORDER[white_index // (size * size)]
            return pos, face
    raise ValueError("reference corner (white/red/green) not found")


@lru_cache(maxsize=None)
def _canonical_rotations(
    size: int,
) -> dict[tuple[tuple[int, int, int], str], tuple[int, ...]]:
    solved = _solved_key()
    mapping: dict[tuple[tuple[int, int, int], str], tuple[int, ...]] = {}
    for rotation in whole_rotations(size):
        rotated = _apply_perm(solved, rotation)
        pos, face = _reference_corner(rotated, size)
        mapping[(pos, face)] = _inverse_perm(rotation)
    if len(mapping) != 24:
        raise RuntimeError(
            f"expected 24 canonical rotations, got {len(mapping)}"
        )
    return mapping


def canonical_key_from_key(key: bytes, size: int = 2) -> bytes:
    pos, face = _reference_corner(key, size)
    rotation = _canonical_rotations(size)[(pos, face)]
    return _apply_perm(key, rotation)


def canonical_key_2x2(state: CubeState) -> bytes:
    return canonical_key_from_key(state_key_2x2(state), 2)


def build_table(max_depth: int = 11) -> dict[bytes, int]:
    solved = canonical_key_from_key(_solved_key())
    perms = [move_permutation(2, face, amount) for face, amount in _MOVES]
    distances: dict[bytes, int] = {solved: 0}
    frontier = [solved]
    depth = 0
    while frontier and depth < max_depth:
        depth += 1
        next_frontier: list[bytes] = []
        for key in frontier:
            for perm in perms:
                neighbor = canonical_key_from_key(_apply_perm(key, perm))
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
        return self.table.get(canonical_key_2x2(state))

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
