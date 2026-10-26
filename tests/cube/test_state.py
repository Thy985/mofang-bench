import pytest

from mofang.cube.colors import Color
from mofang.cube.moves import apply_moves
from mofang.cube.state import CubeState


@pytest.mark.parametrize("size", [2, 3])
def test_solved_state(size: int) -> None:
    state = CubeState.solved(size)
    assert state.is_solved()
    assert len(state.key()) == 6 * size * size


def test_json_round_trip() -> None:
    state = CubeState.solved(3)
    assert CubeState.from_json(state.to_json()) == state


def test_json_has_color_names() -> None:
    data = CubeState.solved(2).to_json()
    assert data["cube"] == "2x2"
    assert data["faces"]["U"][0][0] == "white"


def test_wrong_color_count_is_rejected() -> None:
    data = CubeState.solved(2).to_json()
    data["faces"]["U"][0][0] = "yellow"
    with pytest.raises(ValueError):
        CubeState.from_json(data)


def test_wrong_face_set_is_rejected() -> None:
    data = CubeState.solved(2).to_json()
    del data["faces"]["B"]
    with pytest.raises(ValueError):
        CubeState.from_json(data)


def test_is_solved_requires_face_colors() -> None:
    state = CubeState.solved(2)
    assert state.face("U") == ((Color.WHITE, Color.WHITE), (Color.WHITE, Color.WHITE))


def test_is_solved_accepts_uniform_faces_after_rotation() -> None:
    # 2x2 没有中心块，六面同色但整体转向的局面同样算已还原
    state = apply_moves(CubeState.solved(2), ["L2", "R2"])
    assert all(len({color for row in grid for color in row}) == 1 for grid in state.faces)
    assert state.is_solved()
