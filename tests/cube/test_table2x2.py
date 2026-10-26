from pathlib import Path

import pytest

from mofang.cube.moves import apply_moves, turn
from mofang.cube.state import CubeState
from mofang.cube.table2x2 import (
    Table2x2Solver,
    build_table,
    load_table,
    state_key_2x2,
)


@pytest.fixture(scope="module")
def small_table() -> dict[bytes, int]:
    return build_table(max_depth=3)


def test_solved_distance_is_zero(small_table: dict[bytes, int]) -> None:
    solver = Table2x2Solver(small_table)
    assert solver.distance(CubeState.solved(2)) == 0


def test_one_move_distance_is_one(small_table: dict[bytes, int]) -> None:
    solver = Table2x2Solver(small_table)
    state = turn(CubeState.solved(2), "R", 1)
    assert solver.distance(state) == 1
    assert solver.solve(state) == ["R'"]


def test_solve_returns_optimal_sequence(small_table: dict[bytes, int]) -> None:
    solver = Table2x2Solver(small_table)
    state = apply_moves(CubeState.solved(2), ["R", "U", "F"])
    solution = solver.solve(state)
    assert len(solution) <= 3
    assert apply_moves(state, solution).is_solved()


def test_state_key_is_stable() -> None:
    state = CubeState.solved(2)
    assert state_key_2x2(state) == state_key_2x2(state)


@pytest.mark.slow
def test_full_table_counts() -> None:
    path = Path("data/cache/2x2_distances.pkl")
    if not path.exists():
        pytest.skip("full 2x2 table not built")
    table = load_table(path)
    assert len(table) == 3_674_160
    assert max(table.values()) == 11
