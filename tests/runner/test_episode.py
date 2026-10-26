import asyncio

import pytest

from mofang.cube.moves import apply_moves, invert_moves
from mofang.cube.state import CubeState
from mofang.cube.table2x2 import Table2x2Solver, build_table
from mofang.models.provider import (
    FakeProvider,
    ModelTurn,
    ProviderError,
    ToolCall,
)
from mofang.runner.budget import Budget
from mofang.runner.episode import EpisodeRunner, EpisodeStatus
from mofang.tasks.models import Task


class RaisingProvider:
    def __init__(self, kind: str) -> None:
        self.kind = kind

    async def chat(self, messages, tools, params):
        raise ProviderError(self.kind, f"{self.kind} boom")


@pytest.fixture(scope="module")
def table_solver() -> Table2x2Solver:
    return Table2x2Solver(build_table(max_depth=3))


def make_task(solver: Table2x2Solver, moves: list[str]) -> Task:
    state = apply_moves(CubeState.solved(2), moves)
    return Task(
        id="t1",
        cube="2x2",
        scramble=moves,
        scramble_depth=len(moves),
        state=state.to_json(),
        reference_length=solver.distance(state) or 999,
        reference_kind="exact",
        bin="test",
    )


def test_solves_one_move_task(table_solver: Table2x2Solver) -> None:
    task = make_task(table_solver, ["R"])
    solution = invert_moves(task.scramble)
    provider = FakeProvider(
        [
            ModelTurn(
                tool_calls=[
                    ToolCall(
                        id="c1",
                        name="apply_moves",
                        arguments={"moves": solution},
                    )
                ]
            ),
            ModelTurn(content="done"),
        ]
    )
    result = asyncio.run(
        EpisodeRunner(
            provider=provider, solver=table_solver, budget=Budget(max_moves=10)
        ).run(task)
    )
    assert result.status == EpisodeStatus.SOLVED
    assert result.solved
    assert result.moves_used == 1


def test_stops_when_model_gives_up(table_solver: Table2x2Solver) -> None:
    task = make_task(table_solver, ["R"])
    provider = FakeProvider(
        [ModelTurn(content="I cannot solve it") for _ in range(3)]
    )
    result = asyncio.run(
        EpisodeRunner(
            provider=provider, solver=table_solver, budget=Budget(max_moves=10)
        ).run(task)
    )
    assert result.status == EpisodeStatus.STOPPED_UNSOLVED


def test_budget_exceeded(table_solver: Table2x2Solver) -> None:
    task = make_task(table_solver, ["R"])
    turns = [
        ModelTurn(
            tool_calls=[
                ToolCall(
                    id=f"c{i}",
                    name="turn",
                    arguments={"face": "U", "amount": 1},
                )
            ]
        )
        for i in range(5)
    ]
    result = asyncio.run(
        EpisodeRunner(
            provider=FakeProvider(turns),
            solver=table_solver,
            budget=Budget(max_moves=2),
        ).run(task)
    )
    assert result.status == EpisodeStatus.BUDGET_EXCEEDED
    assert result.moves_used == 2


def test_rotated_uniform_state_counts_as_solved(
    table_solver: Table2x2Solver,
) -> None:
    # L2 打乱后执行 R2：六面同色但整体转向，2x2 应判已解出
    task = make_task(table_solver, ["L2"])
    provider = FakeProvider(
        [
            ModelTurn(
                tool_calls=[
                    ToolCall(
                        id="c1",
                        name="apply_moves",
                        arguments={"moves": ["R2"]},
                    )
                ]
            )
        ]
    )
    result = asyncio.run(
        EpisodeRunner(
            provider=provider, solver=table_solver, budget=Budget(max_moves=10)
        ).run(task)
    )
    assert result.status == EpisodeStatus.SOLVED
    assert result.solved


@pytest.mark.parametrize(
    "kind,expected",
    [("timeout", EpisodeStatus.TIMEOUT), ("auth", EpisodeStatus.PROVIDER_ERROR)],
)
def test_provider_errors_are_classified_and_reported(
    kind: str, expected: EpisodeStatus, table_solver: Table2x2Solver
) -> None:
    task = make_task(table_solver, ["R"])
    result = asyncio.run(
        EpisodeRunner(
            provider=RaisingProvider(kind),
            solver=table_solver,
            budget=Budget(max_moves=10),
        ).run(task)
    )
    assert result.status == expected
    assert result.error == f"{kind} boom"
