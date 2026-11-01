from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from ..cube.colors import FACE_ORDER
from ..cube.moves import InvalidMove, apply_moves, format_move, parse_move, turn
from ..cube.state import CubeState

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
]

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
        self, state: CubeState, max_moves: int = 100, max_tool_calls: int = 150
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

    def execute(self, name: str, arguments: dict[str, Any] | None) -> ToolOutcome:
        self.tool_calls += 1
        if self.tool_calls > self.max_tool_calls:
            return self._error(
                "budget_exceeded", "tool call budget exhausted", budget=True
            )
        if arguments is None:
            return self._error("invalid_arguments", "could not parse tool arguments")
        if name == "turn":
            return self._turn(arguments)
        if name == "apply_moves":
            return self._apply_moves(arguments)
        if name == "get_state":
            return self._get_state()
        if name == "check_solved":
            return self._check_solved()
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
        self.state = turn(self.state, face, amount)
        self.moves_used += 1
        move = format_move(face, amount)
        return self._ok({"applied": [move]}, applied=[move])

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
        self.state = apply_moves(self.state, moves)
        self.moves_used += len(moves)
        return self._ok({"applied": list(moves)}, applied=list(moves))

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
