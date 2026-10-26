from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Callable

from ..cube.solver import ReferenceSolver
from ..cube.state import CubeState
from ..eval.scorer import score_progress
from ..models.provider import ModelParams, ProviderAdapter, ProviderError
from ..tasks.models import Task
from .budget import Budget
from .context import ContextBuilder, TurnRecord, system_prompt, task_message
from .tools import TOOLS, ToolExecutor, serialize_tool_result


class EpisodeStatus(StrEnum):
    SOLVED = "solved"
    STOPPED_UNSOLVED = "stopped_unsolved"
    BUDGET_EXCEEDED = "budget_exceeded"
    TIMEOUT = "timeout"
    PROTOCOL_ERROR = "protocol_error"
    PROVIDER_ERROR = "provider_error"
    CANCELLED = "cancelled"
    INTERRUPTED = "interrupted"


@dataclass
class StepRecord:
    seq: int
    kind: str
    tool_name: str | None = None
    arguments: dict[str, Any] | None = None
    result: dict[str, Any] | None = None
    state: dict[str, Any] | None = None
    reference_length_after: int | None = None


@dataclass
class EpisodeResult:
    status: EpisodeStatus
    solved: bool
    moves_used: int
    reference_length: int
    efficiency: float | None
    progress_ratio: float
    invalid_calls: int
    protocol_errors: int
    tokens_in: int
    tokens_out: int
    latency_ms: int
    final_state: dict[str, Any]
    failure_code: str | None
    steps: list[StepRecord] = field(default_factory=list)


class EpisodeRunner:
    MAX_PROTOCOL_ERRORS = 5
    MAX_TOOL_CALLS_PER_TURN = 5
    MAX_NUDGES = 2

    def __init__(
        self,
        provider: ProviderAdapter,
        solver: ReferenceSolver,
        budget: Budget,
        params: ModelParams | None = None,
    ) -> None:
        self.provider = provider
        self.solver = solver
        self.budget = budget
        self.params = params or ModelParams()

    async def run(
        self,
        task: Task,
        emit: Callable[[str, dict[str, Any]], None] | None = None,
    ) -> EpisodeResult:
        started = time.monotonic()
        initial = CubeState.from_json(task.state)
        executor = ToolExecutor(
            initial, self.budget.max_moves, self.budget.max_tool_calls
        )
        builder = ContextBuilder(
            system_prompt(), task_message(self.budget.max_moves)
        )
        records: list[TurnRecord] = []
        move_history: list[str] = []
        steps: list[StepRecord] = []
        tokens_in = 0
        tokens_out = 0
        nudges = 0
        status = EpisodeStatus.STOPPED_UNSOLVED
        start_length = self.solver.distance(initial) or task.reference_length
        nudge: str | None = None

        def notify(kind: str, payload: dict[str, Any]) -> None:
            if emit is not None:
                emit(kind, payload)

        while True:
            if time.monotonic() - started > self.budget.max_seconds:
                status = EpisodeStatus.TIMEOUT
                break
            messages = builder.build(
                executor.state.to_json(), move_history, records, nudge=nudge
            )
            nudge = None
            notify("model.turn.started", {"moves_used": executor.moves_used})
            try:
                turn = await asyncio.wait_for(
                    self.provider.chat(messages, TOOLS, self.params),
                    timeout=self.budget.turn_timeout,
                )
            except asyncio.TimeoutError:
                status = EpisodeStatus.TIMEOUT
                break
            except ProviderError:
                status = EpisodeStatus.PROVIDER_ERROR
                break
            tokens_in += turn.usage.prompt_tokens
            tokens_out += turn.usage.completion_tokens
            if tokens_in + tokens_out > self.budget.max_tokens:
                status = EpisodeStatus.BUDGET_EXCEEDED
                break
            notify(
                "model.message",
                {"content": turn.content, "tool_calls": len(turn.tool_calls)},
            )
            assistant: dict[str, Any] = {
                "role": "assistant",
                "content": turn.content or "",
            }
            if turn.tool_calls:
                calls = turn.tool_calls[: self.MAX_TOOL_CALLS_PER_TURN]
                overflow = turn.tool_calls[self.MAX_TOOL_CALLS_PER_TURN :]
                assistant["tool_calls"] = [
                    {
                        "id": call.id,
                        "type": "function",
                        "function": {
                            "name": call.name,
                            "arguments": call.raw_arguments
                            or json.dumps(call.arguments or {}),
                        },
                    }
                    for call in calls
                ]
                record = TurnRecord(assistant=assistant)
                records.append(record)
                for call in calls:
                    outcome = executor.execute(call.name, call.arguments)
                    record.tool_results.append(
                        {
                            "role": "tool",
                            "tool_call_id": call.id,
                            "content": serialize_tool_result(outcome),
                        }
                    )
                    if outcome.applied:
                        move_history.extend(outcome.applied)
                    length_after = self.solver.distance(executor.state)
                    steps.append(
                        StepRecord(
                            seq=len(steps),
                            kind="tool",
                            tool_name=call.name,
                            arguments=call.arguments,
                            result=outcome.payload,
                            state=executor.state.to_json(),
                            reference_length_after=length_after,
                        )
                    )
                    notify("move.applied", {"payload": outcome.payload})
                    if executor.state.is_solved():
                        status = EpisodeStatus.SOLVED
                        break
                    if (
                        outcome.budget_exhausted
                        or executor.moves_used >= self.budget.max_moves
                    ):
                        status = EpisodeStatus.BUDGET_EXCEEDED
                        break
                    if executor.protocol_errors >= self.MAX_PROTOCOL_ERRORS:
                        status = EpisodeStatus.PROTOCOL_ERROR
                        break
                if overflow:
                    executor.protocol_errors += len(overflow)
                if status in (
                    EpisodeStatus.SOLVED,
                    EpisodeStatus.BUDGET_EXCEEDED,
                    EpisodeStatus.PROTOCOL_ERROR,
                ):
                    break
                if executor.protocol_errors >= self.MAX_PROTOCOL_ERRORS:
                    status = EpisodeStatus.PROTOCOL_ERROR
                    break
            else:
                records.append(TurnRecord(assistant=assistant))
                if executor.state.is_solved():
                    status = EpisodeStatus.SOLVED
                    break
                nudges += 1
                if nudges > self.MAX_NUDGES:
                    status = EpisodeStatus.STOPPED_UNSOLVED
                    break
                nudge = (
                    "你还没有解出魔方。请继续调用工具；"
                    "如果确实无法继续，请明确说明。"
                )

        final_state = executor.state
        final_length = self.solver.distance(final_state)
        reference_length = start_length
        efficiency = (
            executor.moves_used / reference_length
            if reference_length and reference_length > 0
            else None
        )
        progress = score_progress(
            reference_length,
            final_length,
            final_state.is_solved(),
        )
        failure_code = None if status == EpisodeStatus.SOLVED else status.value
        result = EpisodeResult(
            status=status,
            solved=final_state.is_solved(),
            moves_used=executor.moves_used,
            reference_length=reference_length,
            efficiency=efficiency,
            progress_ratio=progress,
            invalid_calls=executor.invalid_calls,
            protocol_errors=executor.protocol_errors,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            latency_ms=int((time.monotonic() - started) * 1000),
            final_state=final_state.to_json(),
            failure_code=failure_code,
            steps=steps,
        )
        notify("episode.finished", {"status": status.value, "solved": result.solved})
        return result
