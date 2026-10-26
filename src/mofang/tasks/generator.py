from __future__ import annotations

import random

from ..cube.moves import apply_moves
from ..cube.scramble import generate_scramble
from ..cube.solver import ReferenceSolver
from ..cube.state import CubeState
from .models import Benchmark, Task


def bin_for_length(length: int) -> str:
    if length <= 3:
        return str(length)
    if length <= 5:
        return "4-5"
    if length <= 10:
        return "6-10"
    return "11-20"


def generate_benchmark(
    *,
    name: str,
    cube: str,
    depths: list[int],
    per_depth: int,
    seed: int,
    solver: ReferenceSolver,
) -> Benchmark:
    if cube not in ("2x2", "3x3"):
        raise ValueError("cube must be 2x2 or 3x3")
    size = 2 if cube == "2x2" else 3
    rng = random.Random(seed)
    tasks: list[Task] = []
    seen: set[str] = set()
    for depth in depths:
        created = 0
        attempts = 0
        while created < per_depth and attempts < per_depth * 200:
            attempts += 1
            scramble = generate_scramble(size, depth, rng)
            state = apply_moves(CubeState.solved(size), scramble)
            if state.is_solved():
                continue
            key = state.key()
            if key in seen:
                continue
            length = solver.distance(state)
            if length is None:
                continue
            seen.add(key)
            created += 1
            tasks.append(
                Task(
                    id=f"{cube}-{depth}-{created}",
                    cube=cube,
                    scramble=scramble,
                    scramble_depth=depth,
                    state=state.to_json(),
                    reference_length=length,
                    reference_kind=solver.reference_kind,
                    bin=bin_for_length(length),
                )
            )
        if created < per_depth:
            raise RuntimeError(
                f"could not generate {per_depth} unique tasks at depth {depth}"
            )
    return Benchmark(
        id=f"{name}-{cube}-{seed}",
        name=name,
        cube=cube,
        tasks=tasks,
    )
