from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any


@dataclass
class TurnRecord:
    assistant: dict[str, Any]
    tool_results: list[dict[str, Any]] = field(default_factory=list)


PROMPT_VERSION = "v1"


def system_prompt() -> str:
    return (
        "你是被评测的魔方操作者。目标是把魔方还原到六面同色。"
        "你只能通过工具操作魔方，不能直接修改状态，也不要使用外部求解器或凭记忆猜测。\n\n"
        "状态格式：工具返回 JSON，形如 "
        '{"cube":"2x2","faces":{"U":[[...]],...}}。'
        "faces 的键为 U R F D L B；每个面是矩阵，行从上到下、列从左到右"
        "（从该面外侧看）；颜色为 white/yellow/green/blue/red/orange。\n\n"
        "记法：U/R/F/D/L/B 表示该面顺时针 90°（从该面外侧看），"
        "后缀 ' 表示逆时针 90°，2 表示 180°。\n\n"
        "工具：\n"
        "- turn(face, amount)：转一层，amount=1/2/3 对应顺时针 90°/180°/逆时针 90°。\n"
        "- apply_moves(moves)：原子执行一串走法，任一非法则整批不生效；单次最多 30 步。\n"
        "- get_state()：读取当前局面、已用步数与剩余预算。\n"
        "- check_solved()：检查是否已还原。\n"
        "每次工具调用都会返回最新状态；以工具结果为准，不要凭记忆推断。"
        "调用示例：turn {\"face\":\"R\",\"amount\":3} 等价于 R'。\n\n"
        "预算：步数与工具调用次数有限，超限会立即结束本局。已还原时停止调用工具。"
        "如果局面反复回到同一状态，说明当前策略无效，应改用不同思路。"
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
