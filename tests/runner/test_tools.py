from mofang.cube.state import CubeState
from mofang.runner.tools import ToolExecutor


def test_turn_applies_and_reports_state() -> None:
    executor = ToolExecutor(CubeState.solved(2), max_moves=30, max_tool_calls=50)
    outcome = executor.execute("turn", {"face": "R", "amount": 1})
    assert outcome.ok
    assert outcome.payload["moves_used"] == 1
    assert outcome.payload["state"]["cube"] == "2x2"
    assert not outcome.payload["solved"]


def test_turn_inverse_solves() -> None:
    executor = ToolExecutor(CubeState.solved(2), max_moves=30, max_tool_calls=50)
    executor.execute("turn", {"face": "R", "amount": 1})
    outcome = executor.execute("turn", {"face": "R", "amount": 3})
    assert outcome.ok
    assert outcome.payload["solved"] is True


def test_apply_moves_is_atomic() -> None:
    executor = ToolExecutor(CubeState.solved(3), max_moves=100, max_tool_calls=150)
    before = executor.state
    outcome = executor.execute("apply_moves", {"moves": ["R", "M"]})
    assert not outcome.ok
    assert outcome.payload["error"] == "invalid_move"
    assert executor.state == before
    assert executor.protocol_errors == 1


def test_apply_moves_sequence() -> None:
    executor = ToolExecutor(CubeState.solved(2), max_moves=30, max_tool_calls=50)
    outcome = executor.execute("apply_moves", {"moves": ["R", "U'"]})
    assert outcome.ok
    assert outcome.payload["moves_used"] == 2


def test_get_state_and_check_solved() -> None:
    executor = ToolExecutor(CubeState.solved(2), max_moves=30, max_tool_calls=50)
    assert executor.execute("get_state", {}).payload["moves_used"] == 0
    assert executor.execute("check_solved", {}).payload["solved"] is True


def test_invalid_arguments_are_protocol_errors() -> None:
    executor = ToolExecutor(CubeState.solved(2), max_moves=30, max_tool_calls=50)
    outcome = executor.execute("turn", {"face": "X", "amount": 1})
    assert not outcome.ok
    assert outcome.payload["error"] == "invalid_face"
    assert executor.protocol_errors == 1


def test_malformed_arguments_are_protocol_errors() -> None:
    executor = ToolExecutor(CubeState.solved(2), max_moves=30, max_tool_calls=50)
    outcome = executor.execute("turn", None)
    assert not outcome.ok
    assert outcome.payload["error"] == "invalid_arguments"


def test_move_budget() -> None:
    executor = ToolExecutor(CubeState.solved(2), max_moves=1, max_tool_calls=50)
    assert executor.execute("turn", {"face": "R", "amount": 1}).ok
    outcome = executor.execute("turn", {"face": "U", "amount": 1})
    assert not outcome.ok
    assert outcome.payload["error"] == "budget_exceeded"


def test_unknown_tool() -> None:
    executor = ToolExecutor(CubeState.solved(2), max_moves=30, max_tool_calls=50)
    outcome = executor.execute("solve_it", {})
    assert not outcome.ok
    assert outcome.payload["error"] == "unknown_tool"
