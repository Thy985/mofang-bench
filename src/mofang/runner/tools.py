from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from ..cube.colors import FACE_ORDER
from ..cube.moves import InvalidMove, apply_moves, format_move, parse_move, turn
from ..cube.state import CubeState
from .skills import SKILL_NONE
from .stage import OPPOSITE, STAGE_LABELS, oll_payload, probe

MAX_BATCH_MOVES = 30
MAX_PLAN_PHASES = 8
# 计划允许的提交次数：首次 + 3 次修订
MAX_PLAN_SUBMISSIONS = 4

PLAN_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "submit_plan",
        "description": (
            "Submit (or revise) your goal and phased plan before/while "
            f"solving. Provide a short goal and at most {MAX_PLAN_PHASES} "
            "phases, each with a name and an optional approach. "
            "Submitting again replaces the previous plan."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "goal": {"type": "string"},
                "phases": {
                    "type": "array",
                    "maxItems": MAX_PLAN_PHASES,
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "approach": {"type": "string"},
                        },
                        "required": ["name"],
                        "additionalProperties": False,
                    },
                },
            },
            "required": ["goal", "phases"],
            "additionalProperties": False,
        },
    },
}

SOLVE_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "solve",
        "description": (
            "Return a move sequence (standard notation) that solves the "
            "CURRENT cube state. It does NOT modify the cube: you must call "
            "apply_moves (or turn) yourself to execute the returned moves. "
            "Returns {ok:true,moves:[...],length:n}; if the solver is "
            "unavailable, fails or times out, returns {ok:false,error:...}."
        ),
        "parameters": {
            "type": "object",
            "properties": {},
            "additionalProperties": False,
        },
    },
}

PROBE_OLL_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "probe_oll",
        "description": (
            "Read-only OLL counting for the 2x2 Ortega skill. Returns the "
            "machine count of U-face stickers matching the target color, "
            "which side faces have a U-layer bar, and the current phase. "
            "It never returns a move sequence or a formula choice."
        ),
        "parameters": {
            "type": "object",
            "properties": {},
            "additionalProperties": False,
        },
    },
}

TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "turn",
            "description": (
                "Rotate one face. amount 1 = clockwise 90 degrees, "
                "2 = 180 degrees, 3 = counterclockwise 90 degrees "
                "(viewed from outside that face). Returns the new state."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "face": {"type": "string", "enum": list(FACE_ORDER)},
                    "amount": {"type": "integer", "enum": [1, 2, 3]},
                },
                "required": ["face", "amount"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "apply_moves",
            "description": (
                "Apply a batch of standard cube moves atomically, e.g. "
                "['R', \"U'\", 'F2']. If any move is invalid, none are applied. "
                f"Maximum {MAX_BATCH_MOVES} moves per call."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "moves": {
                        "type": "array",
                        "items": {"type": "string"},
                        "maxItems": MAX_BATCH_MOVES,
                    }
                },
                "required": ["moves"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_state",
            "description": (
                "Return the current cube state, solved flag, moves used "
                "and remaining budget."
            ),
            "parameters": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_solved",
            "description": "Return whether the cube is currently solved.",
            "parameters": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
        },
    },
    SOLVE_TOOL,
]
TOOLS.append(PROBE_OLL_TOOL)

_PROTOCOL_ERRORS = {
    "invalid_face",
    "invalid_amount",
    "invalid_move",
    "invalid_arguments",
    "unknown_tool",
    "too_many_moves",
}


@dataclass
class ToolOutcome:
    ok: bool
    payload: dict[str, Any]
    protocol_error: bool = False
    budget_exhausted: bool = False
    applied: list[str] = field(default_factory=list)


class ToolExecutor:
    def __init__(
        self,
        state: CubeState,
        max_moves: int = 100,
        max_tool_calls: int = 150,
        skill: str = SKILL_NONE,
    ) -> None:
        self.state = state
        self.max_moves = max_moves
        self.max_tool_calls = max_tool_calls
        self.moves_used = 0
        self.tool_calls = 0
        self.invalid_calls = 0
        self.protocol_errors = 0
        self.plan: dict[str, Any] | None = None
        self.plan_submissions = 0
        # 阶段守卫（仅 skill != none）：记录各阶段首次成立的轮次与颜色。
        self.skill = skill
        self.turn_index = 0
        self.stage_established: dict[str, dict[str, Any]] = {}
        # OLL 强制先 probe：记录最近一次 probe_oll 成功时的轮次。
        self.probe_turn: int | None = None
        # 起始局面就已完成的阶段也要被守卫（轮次记 0 = 起始局面）。
        self._stage_after()

    def begin_call(self) -> ToolOutcome | None:
        """占用一次工具调用额度；超限时返回错误，调用方直接使用该结果。"""
        self.tool_calls += 1
        if self.tool_calls > self.max_tool_calls:
            return self._error(
                "budget_exceeded", "tool call budget exhausted", budget=True
            )
        return None

    def execute(self, name: str, arguments: dict[str, Any] | None) -> ToolOutcome:
        exceeded = self.begin_call()
        if exceeded is not None:
            return exceeded
        if arguments is None:
            return self._error("invalid_arguments", "could not parse tool arguments")
        if name in ("turn", "apply_moves"):
            blocked = self._oll_probe_gate()
            if blocked is not None:
                return blocked
        if name == "turn":
            return self._turn(arguments)
        if name == "apply_moves":
            return self._apply_moves(arguments)
        if name == "get_state":
            return self._get_state()
        if name == "check_solved":
            return self._check_solved()
        if name == "probe_oll":
            return self._probe_oll()
        if name == "submit_plan":
            return self._submit_plan(arguments)
        return self._error("unknown_tool", f"unknown tool: {name}")

    def _turn(self, arguments: dict[str, Any]) -> ToolOutcome:
        face = arguments.get("face")
        amount = arguments.get("amount")
        if face not in FACE_ORDER:
            return self._error("invalid_face", f"invalid face: {face!r}")
        if amount not in (1, 2, 3):
            return self._error("invalid_amount", f"invalid amount: {amount!r}")
        if self.moves_used + 1 > self.max_moves:
            return self._error("budget_exceeded", "move budget exhausted", budget=True)
        oll_before = self._oll_snapshot()
        self.state = turn(self.state, face, amount)
        self.moves_used += 1
        move = format_move(face, amount)
        extra = {"applied": [move]}
        extra.update(self._stage_after())
        delta = self._oll_delta(oll_before)
        if delta is not None:
            extra["oll_delta"] = delta
        return self._ok(extra, applied=[move])

    def _apply_moves(self, arguments: dict[str, Any]) -> ToolOutcome:
        moves = arguments.get("moves")
        if not isinstance(moves, list) or any(
            not isinstance(move, str) for move in moves
        ):
            return self._error("invalid_arguments", "moves must be a list of strings")
        if len(moves) > MAX_BATCH_MOVES:
            return self._error(
                "too_many_moves", f"at most {MAX_BATCH_MOVES} moves per call"
            )
        try:
            for move in moves:
                parse_move(move)
        except InvalidMove as exc:
            return self._error("invalid_move", str(exc))
        if self.moves_used + len(moves) > self.max_moves:
            return self._error("budget_exceeded", "move budget exhausted", budget=True)
        oll_before = self._oll_snapshot()
        self.state = apply_moves(self.state, moves)
        self.moves_used += len(moves)
        extra = {"applied": list(moves)}
        extra.update(self._stage_after())
        delta = self._oll_delta(oll_before)
        if delta is not None:
            extra["oll_delta"] = delta
        return self._ok(extra, applied=list(moves))

    def _stage_after(self) -> dict[str, Any]:
        """落地后按真实状态判定阶段：已完成的阶段被破坏时立即回告。"""
        if self.skill == SKILL_NONE:
            return {}
        report = probe(self.state, self.skill)
        broken: list[dict[str, Any]] = []
        for name in list(self.stage_established):
            if report.stages.get(name):
                continue
            info = self.stage_established.pop(name)
            broken.append(
                {
                    "stage": name,
                    "label": STAGE_LABELS[name],
                    "established_turn": info["turn"],
                    "color": info["color"],
                    "current_phase": report.phase,
                }
            )
        for name, ok in report.stages.items():
            if ok and name not in self.stage_established:
                color = (
                    report.d_color
                    if name == "D_face"
                    else report.u_target
                )
                self.stage_established[name] = {
                    "turn": self.turn_index,
                    "color": color,
                }
        payload: dict[str, Any] = {
            "phase": report.phase,
            "stage_completed": sorted(self.stage_established),
        }
        if broken:
            first = broken[0]
            color = f"（{first['color']}）" if first["color"] else ""
            since = first["established_turn"]
            origin = "起始局面" if since == 0 else f"第 {since} 轮"
            payload["stage_broken"] = {
                "stage": first["stage"],
                "label": first["label"],
                "established_turn": since,
                "current_phase": first["current_phase"],
                "detail": (
                    f"本次走法打散了{origin}已完成的"
                    f"{first['label']}{color}；当前退回阶段 {first['current_phase']}。"
                    "请先恢复该阶段，再继续后续步骤。"
                ),
                "all": broken,
            }
        return payload

    def _oll_target(self, report) -> str | None:
        # 目标色以第 1 步定下的 D 面颜色为准，避免当前 D 面颜色漂移。
        established = self.stage_established.get("D_face")
        if established and established.get("color"):
            return OPPOSITE.get(established["color"]) or report.u_target
        return report.u_target

    def _oll_probe_gate(self) -> ToolOutcome | None:
        """OLL 阶段强制先 probe：本轮未 probe 就落地时直接拦截。

        只在 ortega + 2x2 + 当前阶段为 OLL 时生效；skill=none / lbl 完全不触发。
        """
        if self.skill != "ortega" or self.state.size != 2:
            return None
        report = probe(self.state, self.skill)
        if report.phase != "OLL":
            return None
        if self.probe_turn == self.turn_index:
            return None
        return self._error(
            "probe_oll_required",
            (
                "当前处于 OLL 阶段，本轮落地类工具（turn/apply_moves）必须"
                "先调用一次 probe_oll；本次调用未执行，也不会消耗步数。"
                "请先 probe_oll，再按返回的计数直接选分支并落地。"
            ),
        )

    def _oll_snapshot(self) -> dict[str, Any] | None:
        """落地前的 OLL 计数快照；非 OLL 阶段返回 None。"""
        if self.skill != "ortega" or self.state.size != 2:
            return None
        report = probe(self.state, self.skill)
        if report.phase != "OLL":
            return None
        target = self._oll_target(report)
        if target is None:
            return None
        return {"target": target, "same": report.u_counts.get(target, 0)}

    def _oll_delta(self, before: dict[str, Any] | None) -> dict[str, Any] | None:
        """动作前后同色角数差，随落地回执返回，模型照抄即可。"""
        if before is None:
            return None
        report = probe(self.state, self.skill)
        target = before["target"]
        after = report.u_counts.get(target, 0)
        return {
            "target_color": target,
            "before": before["same"],
            "after": after,
            "delta": after - before["same"],
            "phase_after": report.phase,
        }

    def _probe_oll(self) -> ToolOutcome:
        # 只读计数：不返回公式、不返回走法，避免退化成"状态→走法查表"。
        if self.skill != "ortega" or self.state.size != 2:
            return self._error(
                "tool_not_enabled",
                "probe_oll is only available for the 2x2 Ortega skill",
            )
        report = probe(self.state, self.skill)
        target = self._oll_target(report)
        payload = oll_payload(report, target)
        payload["ok"] = True
        payload["state"] = self.state.to_json()
        payload["moves_used"] = self.moves_used
        payload["moves_remaining"] = self.max_moves - self.moves_used
        payload["note"] = (
            "Read-only counts. Do not treat this as a move recommendation; "
            "choose the branch yourself, state the conclusion line once, "
            "then land the move. The landing receipt will carry oll_delta."
        )
        # 本轮已 probe：后续落地类工具放行（下一轮需要重新 probe）。
        self.probe_turn = self.turn_index
        return ToolOutcome(ok=True, payload=payload)

    def _submit_plan(self, arguments: dict[str, Any]) -> ToolOutcome:
        # 计划超限只回普通错误（不记协议错误），且保留原计划——
        # 模型反复改计划不该直接把整局判死。
        if self.plan is not None and self.plan_submissions >= MAX_PLAN_SUBMISSIONS:
            return self._error(
                "plan_limit_reached",
                f"plan can be submitted at most {MAX_PLAN_SUBMISSIONS} times; keep the current plan",
            )
        goal = arguments.get("goal")
        phases = arguments.get("phases")
        if not isinstance(goal, str) or not goal.strip():
            return self._error("invalid_arguments", "goal must be a non-empty string")
        if (
            not isinstance(phases, list)
            or not phases
            or len(phases) > MAX_PLAN_PHASES
            or any(
                not isinstance(phase, dict)
                or not isinstance(phase.get("name"), str)
                or not phase["name"].strip()
                for phase in phases
            )
        ):
            return self._error(
                "invalid_arguments",
                f"phases must be 1..{MAX_PLAN_PHASES} objects, each with a non-empty name",
            )
        self.plan = {
            "goal": goal.strip(),
            "phases": [
                {
                    "name": phase["name"].strip(),
                    "approach": str(phase.get("approach", "") or "").strip(),
                }
                for phase in phases
            ],
        }
        self.plan_submissions += 1
        return self._ok({"plan": dict(self.plan)})

    def _get_state(self) -> ToolOutcome:
        return self._ok({})

    def _check_solved(self) -> ToolOutcome:
        return ToolOutcome(
            ok=True,
            payload={
                "ok": True,
                "solved": self.state.is_solved(),
                "moves_used": self.moves_used,
                "moves_remaining": self.max_moves - self.moves_used,
            },
        )

    def solve_ok(self, moves: list[str]) -> ToolOutcome:
        # 只给建议，不下场：applied 保持为空，不产生 move.applied。
        return ToolOutcome(
            ok=True,
            payload={
                "ok": True,
                "solver": "assist",
                "moves": list(moves),
                "length": len(moves),
                "note": (
                    "These moves have NOT been applied. "
                    "Call apply_moves (or turn, if batch tools are disabled) "
                    "to execute them."
                ),
                "state": self.state.to_json(),
                "moves_used": self.moves_used,
                "moves_remaining": self.max_moves - self.moves_used,
            },
        )

    def solve_error(self, code: str, detail: str) -> ToolOutcome:
        # 求解器失败/超时/不可用一律走这里，绝不伪装成成功。
        return ToolOutcome(
            ok=False,
            payload={
                "ok": False,
                "error": code,
                "detail": detail,
                "note": (
                    "The solver did not return a usable solution. "
                    "Continue with your own reasoning or another approach."
                ),
                "state": self.state.to_json(),
                "moves_used": self.moves_used,
                "moves_remaining": self.max_moves - self.moves_used,
            },
        )

    def _ok(
        self, extra: dict[str, Any], applied: list[str] | None = None
    ) -> ToolOutcome:
        payload = {
            "ok": True,
            "state": self.state.to_json(),
            "solved": self.state.is_solved(),
            "moves_used": self.moves_used,
            "moves_remaining": self.max_moves - self.moves_used,
        }
        payload.update(extra)
        return ToolOutcome(ok=True, payload=payload, applied=applied or [])

    def _error(self, code: str, detail: str, budget: bool = False) -> ToolOutcome:
        protocol = code in _PROTOCOL_ERRORS
        if protocol:
            self.invalid_calls += 1
            self.protocol_errors += 1
        return ToolOutcome(
            ok=False,
            payload={
                "ok": False,
                "error": code,
                "detail": detail,
                "state": self.state.to_json(),
                "moves_used": self.moves_used,
                "moves_remaining": self.max_moves - self.moves_used,
            },
            protocol_error=protocol,
            budget_exhausted=budget,
        )


def serialize_tool_result(outcome: ToolOutcome) -> str:
    return json.dumps(outcome.payload, ensure_ascii=False)
