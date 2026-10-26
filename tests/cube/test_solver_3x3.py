import pytest

from mofang.cube.moves import apply_moves
from mofang.cube.solver import RubikTwoPhaseClient, facelets_3x3
from mofang.cube.state import CubeState


def test_solved_facelets() -> None:
    assert facelets_3x3(CubeState.solved(3)) == (
        "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB"
    )


def test_facelets_after_one_move() -> None:
    state = apply_moves(CubeState.solved(3), ["R"])
    value = facelets_3x3(state)
    assert len(value) == 54
    assert value.count("U") == 9
    assert value.count("R") == 9
    assert value != facelets_3x3(CubeState.solved(3))


@pytest.mark.slow
def test_rubik_two_phase_solves() -> None:
    client = RubikTwoPhaseClient()
    try:
        state = apply_moves(CubeState.solved(3), ["R", "U", "F'"])
        solution = client.solve(state)
        assert apply_moves(state, solution).is_solved()
    finally:
        client.close()
