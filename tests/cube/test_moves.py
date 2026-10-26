import pytest
from hypothesis import given, strategies as st

from mofang.cube.geometry import move_permutation, position_to_sticker, sticker_geometry
from mofang.cube.moves import (
    InvalidMove,
    apply_moves,
    format_move,
    invert_moves,
    parse_move,
    turn,
)
from mofang.cube.solver import facelets_3x3
from mofang.cube.state import CubeState

FACES = ["U", "R", "F", "D", "L", "B"]

STANDARD_AFTER_TURN = {
    "U": "UUUUUUUUUBBBRRRRRRRRRFFFFFFDDDDDDDDDFFFLLLLLLLLLBBBBBB",
    "R": "UUFUUFUUFRRRRRRRRRFFDFFDFFDDDBDDBDDBLLLLLLLLLUBBUBBUBB",
    "F": "UUUUUULLLURRURRURRFFFFFFFFFRRRDDDDDDLLDLLDLLDBBBBBBBBB",
    "D": "UUUUUUUUURRRRRRFFFFFFFFFLLLDDDDDDDDDLLLLLLBBBBBBBBBRRR",
    "L": "BUUBUUBUURRRRRRRRRUFFUFFUFFFDDFDDFDDLLLLLLLLLBBDBBDBBD",
    "B": "RRRUUUUUURRDRRDRRDFFFFFFFFFDDDDDDLLLULLULLULLBBBBBBBBB",
}


@pytest.mark.parametrize("face", FACES)
def test_facelet_convention_matches_singmaster(face: str) -> None:
    assert facelets_3x3(turn(CubeState.solved(3), face, 1)) == STANDARD_AFTER_TURN[face]


@pytest.mark.parametrize("size", [2, 3])
@pytest.mark.parametrize("face", FACES)
def test_face_turn_order_four(size: int, face: str) -> None:
    state = CubeState.solved(size)
    for _ in range(4):
        state = turn(state, face, 1)
    assert state.is_solved()


@pytest.mark.parametrize("size", [2, 3])
@pytest.mark.parametrize("face", FACES)
@pytest.mark.parametrize("amount", [1, 2, 3])
def test_permutation_is_bijection(size: int, face: str, amount: int) -> None:
    perm = move_permutation(size, face, amount)
    assert sorted(perm) == list(range(6 * size * size))


@pytest.mark.parametrize("size", [2, 3])
def test_geometry_round_trip(size: int) -> None:
    for face in FACES:
        for row in range(size):
            for col in range(size):
                pos, normal = sticker_geometry(face, row, col, size)
                assert position_to_sticker(pos, normal, size) == (face, row, col)


def test_turn_and_inverse() -> None:
    moves = ["R", "U", "F'", "D2"]
    state = apply_moves(CubeState.solved(3), moves)
    assert apply_moves(state, invert_moves(moves)).is_solved()


def test_apply_moves_does_not_mutate() -> None:
    state = CubeState.solved(3)
    apply_moves(state, ["R"])
    assert state.is_solved()


def test_invalid_move() -> None:
    with pytest.raises(InvalidMove):
        apply_moves(CubeState.solved(3), ["M"])


def test_parse_move_variants() -> None:
    assert parse_move("R") == ("R", 1)
    assert parse_move("R'") == ("R", 3)
    assert parse_move("R\u2019") == ("R", 3)
    assert parse_move("R2") == ("R", 2)
    assert format_move("R", 3) == "R'"


@pytest.mark.parametrize("size,expected", [(2, 8), (3, 12)])
def test_turn_changes_expected_sticker_count(size: int, expected: int) -> None:
    before = CubeState.solved(size)
    after = turn(before, "R", 1)
    changed = sum(
        a != b
        for ga, gb in zip(before.faces, after.faces)
        for ra, rb in zip(ga, gb)
        for a, b in zip(ra, rb)
    )
    assert changed == expected


@given(st.lists(st.sampled_from(["U", "R", "F", "D", "L", "B", "U'", "R2"]), min_size=1, max_size=8))
def test_random_sequence_inverse(moves: list[str]) -> None:
    state = apply_moves(CubeState.solved(3), moves)
    assert apply_moves(state, invert_moves(moves)).is_solved()
