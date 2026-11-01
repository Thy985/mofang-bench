"""失败归因：把 episode 失败拆成「模型侧」与「环境/体系侧」，并给出可操作的信号。

方法论（README「失败归因」一节同步维护）：
- harness 本身的正确性由 selfcheck（runner/selfcheck.py）证明——参照解走同一条
  工具链必须解出，解不出就是 harness bug，与模型无关。
- 这里的分类回答另一半问题：一次具体的失败，责任更可能在哪边。
  provider_error / timeout / interrupted 属于环境侧（网络、服务端、限流、进程中断）；
  stopped_unsolved / budget_exceeded / protocol_error 属于模型侧（协议内正常结束但没解出）。
- 信号用于纠正两边的误判：接近解出的失败可能是预算配置过紧（harness 侧可调），
  大量协议错误可能是提示词/工具描述不清（harness 侧可改进），零进展则是模型侧证据。
"""

from __future__ import annotations

from collections import Counter
from typing import Any

from ..runner.episode import EpisodeResult

ENV_FAILURE_CODES = {"provider_error", "timeout", "interrupted"}
MODEL_FAILURE_CODES = {"stopped_unsolved", "budget_exceeded", "protocol_error"}


def classify_failure(result: EpisodeResult) -> dict[str, Any]:
    """把单个失败 episode 归到一侧，并附上可读信号。cancelled 单独标记。"""
    code = result.failure_code or "unknown"
    if code == "cancelled":
        side = "user"
    elif code in ENV_FAILURE_CODES:
        side = "env"
    else:
        side = "model"

    signals: list[str] = []
    if result.provider_errors > 0:
        signals.append("本局发生网络/服务端错误或重试")
    if result.moves_used == 0:
        signals.append("模型未执行任何操作")
    if result.progress_ratio == 0 and code not in ("provider_error", "timeout"):
        signals.append("模型未取得任何进展（progress=0）")
    if result.progress_ratio >= 0.5:
        signals.append(
            "接近解出（progress≥0.5），预算可能偏紧，可尝试调大 max_moves/max_seconds"
        )
    if result.protocol_errors >= 3:
        signals.append(
            "工具调用格式错误较多，提示词/工具描述可能需要优化（harness 侧可改进）"
        )
    if code == "timeout":
        signals.append("单轮或整局超时，可能是网络或服务端过慢")
    return {"side": side, "code": code, "signals": signals}


def attribution_summary(
    tasks: list, results: list[EpisodeResult]
) -> dict[str, Any]:
    """对一批 episode 做归因汇总；tasks 与 results 按位置一一对应。"""
    items: list[dict[str, Any]] = []
    for task, result in zip(tasks, results):
        if result.solved:
            continue
        items.append({"task_id": task.id, **classify_failure(result)})
    counted = [item for item in items if item["side"] != "user"]
    return {
        "failed": len(items),
        "env": sum(1 for item in counted if item["side"] == "env"),
        "model": sum(1 for item in counted if item["side"] == "model"),
        "codes": dict(Counter(item["code"] for item in counted)),
        "signals": dict(
            Counter(signal for item in items for signal in item["signals"])
        ),
        "items": items,
    }
