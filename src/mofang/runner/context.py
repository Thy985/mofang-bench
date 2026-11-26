from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any


@dataclass
class TurnRecord:
    assistant: dict[str, Any]
    tool_results: list[dict[str, Any]] = field(default_factory=list)


PROMPT_VERSION = "v2"


def system_prompt(
    require_plan: bool = False,
    *,
    solver_assist: bool = False,
    skill_pack: str | None = None,
) -> str:
    if solver_assist:
        rules = (
            "你只能通过工具操作魔方，不能直接修改状态。"
            "可以使用 solve 工具获取建议走法，但 solve 不会替你执行，"
            "拿到走法后仍须自己调用 apply_moves（批量工具不可用时用 turn）执行。"
            "不要凭记忆猜测。\n\n"
        )
    else:
        rules = (
            "你只能通过工具操作魔方，不能直接修改状态，"
            "也不要使用外部求解器或凭记忆猜测。\n\n"
        )
    text = (
        "你是被评测的魔方操作者。目标是把魔方还原到六面同色。"
        + rules
        + "状态格式：工具返回 JSON，形如 "
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
        + (
            "- solve()：返回当前局面的建议走法（标准记法）；它不改变魔方状态，"
            "拿到后必须自己调用 apply_moves（批量工具不可用时用 turn）执行；"
            "失败或不可用会返回 ok=false。\n"
            if solver_assist
            else ""
        )
        + "- 每轮最多执行 5 个工具调用；第 6 个及以后会收到 too_many_tool_calls，"
        "且不会执行。需要连续走多步时，请优先把走法放进 apply_moves。\n"
        "每次工具调用都会返回最新状态；以工具结果为准，不要凭记忆推断。"
        "调用示例：turn {\"face\":\"R\",\"amount\":3} 等价于 R'。\n\n"
        "预算：步数与工具调用次数有限，超限会立即结束本局。已还原时停止调用工具。"
        "如果局面反复回到同一状态，说明当前策略无效，应改用不同思路。"
    )
    if require_plan:
        # 只约定计划的结构，不给任何还原法/阶段命名的领域提示，保证对不同模型公平。
        text += (
            "\n\n计划：在开始还原前，先调用 submit_plan 提交本次目标（goal）"
            "与分阶段计划（phases，每阶段含 name，可选 approach）。"
            "之后按阶段推进；如需调整可再次调用 submit_plan（最多 3 次修订）。"
            "计划不会替你执行任何操作，操作仍只能通过工具完成。"
        )
    if skill_pack:
        # skill 模式：方法 pack 静态追加在 system prompt 末尾；
        # none 时完全走上面的原文，不改动任何既有措辞。
        text += (
            "\n\n请严格按下面的方法分阶段推进：每完成一个阶段先用 get_state "
            "核对完成判据，确认后再进入下一阶段。\n\n" + skill_pack
        )
    return text


def task_message(max_moves: int, require_plan: bool = False) -> str:
    plan_line = (
        "请先调用 submit_plan 设定目标与分阶段计划，再开始还原。" if require_plan else ""
    )
    return (
        f"任务：用不超过 {max_moves} 步还原魔方。"
        "标准记法：U/R/F/D/L/B，后缀 ' 表示逆时针 90°，2 表示 180°。"
        "只使用工具；不要输出无法执行的计划。"
        + plan_line
    )


def plan_block(plan: dict[str, Any]) -> str:
    phases = plan.get("phases") or []
    lines = [
        f"{index}.{phase.get('name', '')}"
        + (f"（{phase['approach']}）" if phase.get("approach") else "")
        for index, phase in enumerate(phases, 1)
    ]
    return f"当前计划——目标：{plan.get('goal', '')}；阶段：{'；'.join(lines)}"


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
        plan: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": self.system},
            {"role": "user", "content": self.task},
        ]
        for record in records[-self.keep_turns :]:
            messages.append(record.assistant)
            messages.extend(record.tool_results)
        # 计划块拼进每轮状态消息：keep_turns 截断会丢掉早期提交的计划，
        # 每轮重放才能让模型始终带着自己的计划推进。
        plan_text = f"{plan_block(plan)}\n" if plan else ""
        state_text = (
            plan_text
            + "当前局面（JSON）：\n"
            + json.dumps(state_json, ensure_ascii=False, separators=(",", ":"))
            + "\n已完成走法："
            + (" ".join(move_history) if move_history else "无")
        )
        messages.append({"role": "user", "content": state_text})
        if nudge:
            messages.append({"role": "user", "content": nudge})
        return messages
