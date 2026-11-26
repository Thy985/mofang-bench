"""阶段判定：只用 executor 的真实 CubeState，不做字符串启发。

仅对 skill != none 的局启用；skill=none 时调用方必须完全不碰这些字段，
以保证旧行为逐字不变。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..cube.state import CubeState
from .skills import SKILL_NONE

OPPOSITE = {
    "white": "yellow",
    "yellow": "white",
    "red": "orange",
    "orange": "red",
    "green": "blue",
    "blue": "green",
}

SIDE_FACES = ("R", "F", "L", "B")

STAGE_LABELS = {
    "D_face": "第一面（D 面单色）",
    "U_face": "U 面单色（顶层定向）",
}


@dataclass(frozen=True)
class StageReport:
    phase: str
    stages: dict[str, bool]
    d_color: str | None
    u_target: str | None
    u_counts: dict[str, int]
    bar_faces: tuple[str, ...]
    solved: bool


def _uniform(state: CubeState, face: str) -> bool:
    grid = state.face(face)
    first = grid[0][0]
    return all(cell == first for row in grid for cell in row)


def _bar_faces(state: CubeState) -> tuple[str, ...]:
    """U 层 bar：四个侧面的最上一行（2x2 为两格）是否同色。"""
    if state.size != 2:
        return ()
    bars = []
    for name in SIDE_FACES:
        grid = state.face(name)
        if grid[0][0] == grid[0][1]:
            bars.append(name)
    return tuple(bars)


def probe(state: CubeState, skill: str) -> StageReport:
    if skill == SKILL_NONE:
        return StageReport("none", {}, None, None, {}, (), state.is_solved())
    d_uniform = _uniform(state, "D")
    u_uniform = _uniform(state, "U")
    d_first = state.face("D")[0][0].value
    u_target = OPPOSITE.get(d_first)
    u_counts: dict[str, int] = {}
    for row in state.face("U"):
        for cell in row:
            u_counts[cell.value] = u_counts.get(cell.value, 0) + 1
    if state.is_solved():
        phase = "done"
    elif not d_uniform:
        phase = "D-face"
    elif not u_uniform:
        phase = "OLL" if state.size == 2 else "last-layer"
    else:
        phase = "PBL" if state.size == 2 else "align"
    return StageReport(
        phase=phase,
        stages={"D_face": d_uniform, "U_face": u_uniform},
        d_color=d_first if d_uniform else None,
        u_target=u_target,
        u_counts=u_counts,
        bar_faces=_bar_faces(state),
        solved=state.is_solved(),
    )


def phase_payload(report: StageReport) -> dict[str, Any]:
    return {
        "phase": report.phase,
        "d_face_uniform": report.stages.get("D_face", False),
        "u_face_uniform": report.stages.get("U_face", False),
    }


def oll_payload(report: StageReport, target: str | None) -> dict[str, Any]:
    same = report.u_counts.get(target, 0) if target else None
    return {
        "phase": report.phase,
        "target_color": target,
        "same_color_corners": same,
        "u_face_counts": dict(report.u_counts),
        "bar_faces": list(report.bar_faces),
        "bar_count": len(report.bar_faces),
        "d_intact": report.stages.get("D_face", False),
    }
