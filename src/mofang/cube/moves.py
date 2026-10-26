from __future__ import annotations

import re

from .colors import FACE_ORDER
from .geometry import move_permutation
from .state import CubeState


class InvalidMove(ValueError):
    pass


_MOVE_RE = re.compile(r"^([URFDLB])([2']?)$")
_TRANSLATE = str.maketrans({"\u2019": "'", "\u2032": "'"})
_AMOUNT_SUFFIX = {1: "", 2: "2", 3: "'"}


def format_move(face: str, amount: int) -> str:
    if face not in FACE_ORDER or amount not in (1, 2, 3):
        raise InvalidMove(f"invalid move: {face} {amount}")
    return f"{face}{_AMOUNT_SUFFIX[amount]}"


def parse_move(move: str) -> tuple[str, int]:
    text = move.strip().translate(_TRANSLATE)
    match = _MOVE_RE.fullmatch(text)
    if not match:
        raise InvalidMove(f"invalid move: {move!r}")
    face, suffix = match.groups()
    amount = 2 if suffix == "2" else 3 if suffix == "'" else 1
    return face, amount


def turn(state: CubeState, face: str, amount: int) -> CubeState:
    if face not in FACE_ORDER:
        raise InvalidMove(f"invalid face: {face!r}")
    if amount not in (1, 2, 3):
        raise InvalidMove(f"invalid amount: {amount!r}")
    perm = move_permutation(state.size, face, amount)
    flat = [color for grid in state.faces for row in grid for color in row]
    new_flat: list = [None] * len(flat)
    for target, source in enumerate(perm):
        new_flat[target] = flat[source]
    size = state.size
    faces = []
    cursor = 0
    for _ in range(6):
        grid = []
        for _ in range(size):
            grid.append(tuple(new_flat[cursor : cursor + size]))
            cursor += size
        faces.append(tuple(grid))
    return CubeState(size=size, faces=tuple(faces))


def apply_moves(state: CubeState, moves: list[str]) -> CubeState:
    current = state
    for move in moves:
        face, amount = parse_move(move)
        current = turn(current, face, amount)
    return current


def invert_moves(moves: list[str]) -> list[str]:
    result: list[str] = []
    for move in reversed(moves):
        face, amount = parse_move(move)
        inverse = {1: 3, 2: 2, 3: 1}[amount]
        result.append(format_move(face, inverse))
    return result
