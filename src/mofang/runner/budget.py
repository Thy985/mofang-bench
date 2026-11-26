from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Budget:
    max_moves: int = 100
    max_tool_calls: int = 150
    max_tokens: int = 1_000_000
    max_seconds: float = 1800.0
    # 整轮（含 429 重试、退避与长 thinking）上限。必须 >= 单次 HTTP timeout
    # + 退避总时长；reasoning 模型的单轮思考可能长达数分钟，default 取 600s。
    # 见 service/factory.py 默认预算与 openai_compat.py 的重试注释。
    turn_timeout: float = 600.0
    max_usd: float | None = None
