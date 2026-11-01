from mofang.cube.moves import apply_moves
from mofang.cube.solver import FakeSolver
from mofang.cube.state import CubeState
from mofang.cube.table2x2 import Table2x2Solver, build_table
from mofang.runner.selfcheck import run_selfcheck
from mofang.tasks.models import Task


def make_task(moves: list[str], task_id: str = "t1") -> Task:
    state = apply_moves(CubeState.solved(2), moves)
    return Task(
        id=task_id,
        cube="2x2",
        scramble=moves,
        scramble_depth=len(moves),
        state=state.to_json(),
        reference_length=len(moves),
        reference_kind="exact",
        bin="test",
    )


def test_selfcheck_passes_with_reference_solver() -> None:
    solver = Table2x2Solver(build_table(max_depth=3))
    tasks = [make_task(["R"], "t1"), make_task(["R", "U"], "t2")]
    items = run_selfcheck(tasks, solver)
    assert [item.ok for item in items] == [True, True]
    assert [item.moves for item in items] == [1, 2]


def test_selfcheck_catches_wrong_solution_as_harness_signal() -> None:
    # 模拟「参照解经工具链执行后未还原」：solver 给出合法但错误的解
    task = make_task(["R"])
    state = CubeState.from_json(task.state)
    solver = FakeSolver(solutions={state.key(): ["U", "D"]})
    items = run_selfcheck([task], solver)
    assert items[0].ok is False
    assert "未还原" in items[0].detail


def test_selfcheck_catches_solver_failure() -> None:
    task = make_task(["R"])
    solver = FakeSolver()  # 无解表 -> SolverError
    items = run_selfcheck([task], solver)
    assert items[0].ok is False
    assert "参照求解器失败" in items[0].detail
