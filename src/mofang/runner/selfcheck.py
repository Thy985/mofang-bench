"""Harness 自检：用参照求解器的解走同一条工具链，证明引擎/工具/打分没 bug。

这是「agent 失败到底是模型问题还是 harness 问题」的最硬证据：如果参照解
经过 ToolExecutor 都不能还原（或效率/进度打分异常），问题在 harness 侧；
全部通过则说明这套评测工具链对"正确的解题者"是可行的。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..cube.solver import ReferenceSolver, SolverError
from ..cube.state import CubeState
from .tools import MAX_BATCH_MOVES, ToolExecutor


@dataclass
class SelfcheckItem:
    task_id: str
    ok: bool
    moves: int = 0
    detail: str = ""


def _check_task(task: Any, solver: ReferenceSolver) -> SelfcheckItem:
    try:
        state = CubeState.from_json(task.state)
        solution = solver.solve(state)
    except SolverError as exc:
        return SelfcheckItem(
            task.id, False, detail=f"参照求解器失败: {exc}"
        )
    except Exception as exc:  # noqa: BLE001 - 自检要把任何 harness 异常暴露出来
        return SelfcheckItem(task.id, False, detail=f"异常: {exc!r}")

    if not solution:
        return SelfcheckItem(task.id, False, detail="参照解为空")

    # 与 episode 相同的执行入口：分批 apply_moves，任一批失败即记失败
    executor = ToolExecutor(state, max_moves=max(len(solution), 1), max_tool_calls=10)
    for start in range(0, len(solution), MAX_BATCH_MOVES):
        outcome = executor.execute(
            "apply_moves", {"moves": solution[start : start + MAX_BATCH_MOVES]}
        )
        if not outcome.ok:
            return SelfcheckItem(
                task.id,
                False,
                moves=executor.moves_used,
                detail=f"工具链执行失败: {outcome.payload.get('error')}",
            )
    if not executor.state.is_solved():
        return SelfcheckItem(
            task.id,
            False,
            moves=executor.moves_used,
            detail="参照解经工具链执行后未还原（状态引擎或工具链有 bug）",
        )
    if executor.moves_used != len(solution):
        return SelfcheckItem(
            task.id,
            False,
            moves=executor.moves_used,
            detail=f"步数记账不一致: 实际 {executor.moves_used} != 参照 {len(solution)}",
        )
    return SelfcheckItem(task.id, True, moves=executor.moves_used)


def run_selfcheck(tasks: list, solver: ReferenceSolver) -> list[SelfcheckItem]:
    return [_check_task(task, solver) for task in tasks]
