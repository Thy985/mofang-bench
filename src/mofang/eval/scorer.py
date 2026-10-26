from __future__ import annotations

from math import sqrt


def score_progress(start_length: int, final_length: int | None, solved: bool) -> float:
    if solved:
        return 1.0
    if start_length <= 0:
        return 0.0
    if final_length is None:
        return 0.0
    value = (start_length - final_length) / start_length
    return max(0.0, min(1.0, value))


def wilson_interval(successes: int, total: int, z: float = 1.96) -> tuple[float, float]:
    if total == 0:
        return (0.0, 0.0)
    p = successes / total
    denominator = 1 + z * z / total
    center = (p + z * z / (2 * total)) / denominator
    margin = (
        z * sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denominator
    )
    return (max(0.0, center - margin), min(1.0, center + margin))
