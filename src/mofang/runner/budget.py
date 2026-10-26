from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Budget:
    max_moves: int = 100
    max_tool_calls: int = 150
    max_tokens: int = 1_000_000
    max_seconds: float = 900.0
    turn_timeout: float = 120.0
    max_usd: float | None = None
