from __future__ import annotations

import random

from .colors import FACE_ORDER
from .moves import format_move


def generate_scramble(
    size: int, depth: int, rng: random.Random | None = None
) -> list[str]:
    if size not in (2, 3):
        raise ValueError("size must be 2 or 3")
    if depth < 0:
        raise ValueError("depth must be >= 0")
    generator = rng or random.Random()
    moves: list[str] = []
    previous_face: str | None = None
    for _ in range(depth):
        choices = [face for face in FACE_ORDER if face != previous_face]
        face = generator.choice(choices)
        amount = generator.choice((1, 2, 3))
        moves.append(format_move(face, amount))
        previous_face = face
    return moves
