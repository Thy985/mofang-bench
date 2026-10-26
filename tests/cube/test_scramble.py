import random

import pytest

from mofang.cube.moves import apply_moves, invert_moves
from mofang.cube.scramble import generate_scramble
from mofang.cube.state import CubeState


@pytest.mark.parametrize("size", [2, 3])
def test_scramble_length_and_faces(size: int) -> None:
    moves = generate_scramble(size, 10, random.Random(42))
    assert len(moves) == 10
    for previous, current in zip(moves, moves[1:]):
        assert previous[0] != current[0]


def test_scramble_is_deterministic() -> None:
    a = generate_scramble(3, 8, random.Random(7))
    b = generate_scramble(3, 8, random.Random(7))
    assert a == b


def test_scramble_inverse_solves() -> None:
    moves = generate_scramble(3, 12, random.Random(1))
    state = apply_moves(CubeState.solved(3), moves)
    assert not state.is_solved()
    assert apply_moves(state, invert_moves(moves)).is_solved()
