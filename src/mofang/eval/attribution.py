"""失败归因：把 episode 失败拆成「模型侧」与「环境/体系侧」，并给出可操作的信号。

方法论（README「失败归因」一节同步维护）：
- harness 本身的正确性由 selfcheck（runner/selfcheck.py）证明——参照解走同一条
  工具链必须解出，解不出就是 harness bug，与模型无关。
- 这里的分类回答另一半问题：一次具体的失败，责任更可能在哪边。
  provider_error / timeout / interrupted 属于环境侧（网络、服务端、限流、进程中断）；
  stopped_unsolved / budget_exceeded / protocol_error 属于模型侧（协议内正常结束但没解出）。
- 信号用于纠正两边的误判：接近解出的失败可能是预算配置过紧（harness 侧可调），
  大量协议错误可能是提示词/工具描述不清（harness 侧可改进），零进展则是模型侧证据。
- 思考不算失败：模型可能思考完一次性给出动作，也可能 ReAct 多轮，只要没耗尽
  倒计时（turn_timeout / max_seconds）就不归因成「未执行任何操作」。失败由超时/预算/
  协议结果界定，而不是「有没有调用工具」。
- 计数类信息（provider 退避次数、协议错误次数）按整局汇总为结构化字段，不混入
  signals 文案，避免「本局共 N 次」变成不同信号而读不出总数。
"""

from __future__ import annotations

from collections import Counter
from typing import Any

from ..runner.episode import EpisodeResult

ENV_FAILURE_CODES = {"provider_error", "timeout", "interrupted"}
MODEL_FAILURE_CODES = {
    "stopped_unsolved",
    "budget_exceeded",
    "model_truncation_loop",
    "protocol_error",
}


_PROVIDER_KIND_SIGNALS: list[tuple[tuple[str, ...], str]] = [
    (
        ("429", "rate_limit", "too many requests"),
        "触发速率限制（HTTP 429）：降低并发、更换 key 或加大退避间隔",
    ),
    (
        ("401", "403", "auth", "credential", "api_key", "no active credentials"),
        "凭证无效或未配置：检查 provider 的 api_key_ref / 环境变量",
    ),
    (
        (
            "model_not_found",
            "does not exist",
            "unsupported model",
            "supported api model names",
            "but you passed",
        ),
        "模型名不被识别：检查 provider 的 model 是否写对",
    ),
    (
        ("5xx", "server_error", "internal server error"),
        "服务端 5xx：重试或更换 endpoint",
    ),
    (
        ("timeout", "timed out"),
        "请求超时：网络或服务端过慢，可调大 turn_timeout / max_seconds",
    ),
]


def _provider_error_count(value: Any) -> int:
    """provider_errors 字段兼容 int（现状）与旧结构（ProviderError 列表）。"""
    if isinstance(value, int):
        return value
    return len(value or [])


def _error_signals(text: str) -> list[str]:
    """把 provider/超时错误原文解析成一个主类别信号（限流/凭证/模型名/服务端/超时）。

    信号面向「改进 Harness」：给出具体类别与可尝试的动作，而不是笼统的
    「网络/服务端错误」。按优先级只取最相关的一条，避免同一错误重复报多个类别。
    """
    stripped = (text or "").strip()
    lowered = stripped.lower()
    for needles, signal in _PROVIDER_KIND_SIGNALS:
        if any(needle in lowered for needle in needles):
            return [signal]
    return [f"provider 错误：{stripped[:160] or '无错误详情'}"]


def classify_failure(result: EpisodeResult) -> dict[str, Any]:
    """把单个失败 episode 归到一侧，并附上可读信号。cancelled 单独标记。"""
    code = result.failure_code or "unknown"
    if code == "cancelled":
        side = "user"
    elif code in ENV_FAILURE_CODES:
        side = "env"
    else:
        side = "model"

    error_text = (result.error or "").strip()

    # signals 只放「类别/可操作」信号；每局计数（provider 退避、协议错误）
    # 由 attribution_summary 汇总成结构化字段，避免计数文案变成不同信号。
    #
    # 思考不算失败：模型可能思考完一次性给出动作，也可能 ReAct 多轮，
    # 只要没耗尽倒计时（turn_timeout / max_seconds）就不应归因成「未执行」。
    # 是否失败由超时/预算/协议结果界定，而不是「有没有调用工具」。
    signals: list[str] = []
    if code == "provider_error":
        signals.extend(_error_signals(error_text))
    if result.progress_ratio == 0 and code not in ("provider_error", "timeout"):
        signals.append("模型未取得任何进展（progress=0）")
    if result.progress_ratio >= 0.5:
        signals.append(
            "接近解出（progress≥0.5），预算可能偏紧，可尝试调大 max_moves/max_seconds"
        )
    if result.protocol_errors >= 3:
        signals.append(
            "工具调用格式错误较多："
            "提示词/工具描述可能需要优化（harness 侧可改进）"
        )
    if code == "timeout":
        if "turn timeout" in error_text:
            signals.append("单轮超时（模型响应慢）：可调大 turn_timeout")
        elif "episode timeout" in error_text:
            signals.append("整局超时（用时达到 max_seconds）：可适当调大 max_seconds")
        else:
            signals.append("超时：可能是网络或服务端过慢")
    if code == "model_truncation_loop":
        signals.append(
            "连续多轮 finish_reason=length 且无有效工具调用，模型未收敛到动作"
        )
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
    failed_results = [result for result in results if not result.solved]
    return {
        "failed": len(items),
        "env": sum(1 for item in counted if item["side"] == "env"),
        "model": sum(1 for item in counted if item["side"] == "model"),
        "codes": dict(Counter(item["code"] for item in counted)),
        "signals": dict(
            Counter(signal for item in items for signal in item["signals"])
        ),
        # 计数类信息按整局汇总（跨 episode 求和），而不是散落在 signals 文案里
        "provider_errors_total": sum(
            _provider_error_count(result.provider_errors) for result in failed_results
        ),
        "protocol_errors_total": sum(
            int(result.protocol_errors or 0) for result in failed_results
        ),
        "items": items,
    }
