from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any


@dataclass
class TurnRecord:
    assistant: dict[str, Any]
    tool_results: list[dict[str, Any]] = field(default_factory=list)


def system_prompt() -> str:
    return (
        "你是被评测的魔方操作者。目标是把当前魔方还原到六面同色。"
        "你只能通过提供的工具操作魔方；每次操作后工具会返回最新状态。"
        "不要猜，不要使用外部求解器。按需调用 get_state 或 check_solved。"
        "当魔方已解出时停止调用工具。"
    )


def task_message(max_moves: int) -> str:
    return (
        f"任务：用不超过 {max_moves} 步还原魔方。"
        "标准记法：U/R/F/D/L/B，后缀 ' 表示逆时针 90°，2 表示 180°。"
        "只使用工具；不要输出无法执行的计划。"
    )


class ContextBuilder:
    def __init__(self, system: str, task: str, keep_turns: int = 6) -> None:
        self.system = system
        self.task = task
        self.keep_turns = keep_turns

    def build(
        self,
        state_json: dict[str, Any],
        move_history: list[str],
        records: list[TurnRecord],
        nudge: str | None = None,
    ) -> list[dict[str, Any]]:
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": self.system},
            {"role": "user", "content": self.task},
        ]
        for record in records[-self.keep_turns :]:
            messages.append(record.assistant)
            messages.extend(record.tool_results)
        state_text = (
            "当前局面（JSON）：\n"
            + json.dumps(state_json, ensure_ascii=False, separators=(",", ":"))
            + "\n已完成走法："
            + (" ".join(move_history) if move_history else "无")
        )
        messages.append({"role": "user", "content": state_text})
        if nudge:
            messages.append({"role": "user", "content": nudge})
        return messages
