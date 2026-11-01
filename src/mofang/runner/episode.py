from __future__ import annotations

import asyncio
import contextlib
import json
import time
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Callable

from ..cube.solver import ReferenceSolver
from ..cube.state import CubeState
from ..eval.scorer import score_progress
from ..models.provider import (
    ModelParams,
    ModelTurn,
    ProviderAdapter,
    ProviderError,
)
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
    error: str | None = None
    steps: list[StepRecord] = field(default_factory=list)


class ThinkingThrottle:
    """把 token 级 thinking 增量按字符数/时间间隔合并成事件，防止事件总线膨胀。"""

    def __init__(
        self,
        notify: Callable[[str, dict[str, Any]], None],
        seq: int,
        max_chars: int = 64,
        max_interval: float = 0.15,
    ) -> None:
        self._notify = notify
        self._seq = seq
        self._max_chars = max_chars
        self._max_interval = max_interval
        self._pending: list[str] = []
        self._last = time.monotonic()

    def __call__(self, phase: str, text: str | None) -> None:
        if phase != "thinking" or not text:
            return
        self._pending.append(text)
        total = sum(len(part) for part in self._pending)
        if (
            total >= self._max_chars
            or time.monotonic() - self._last >= self._max_interval
        ):
            self.flush()

    def flush(self) -> None:
        if not self._pending:
            return
        text = "".join(self._pending)
        self._pending.clear()
        self._last = time.monotonic()
        self._notify("thinking.delta", {"seq": self._seq, "text": text})


class _EpisodeCancelled(Exception):
    pass


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
        tool_mode: str = "both",
    ) -> None:
        if tool_mode not in ("both", "turn_only", "batch_only"):
            raise ValueError(f"invalid tool_mode: {tool_mode}")
        self.provider = provider
        self.solver = solver
        self.budget = budget
        self.params = params or ModelParams()
        self.tool_mode = tool_mode

    def _tools(self) -> list[dict[str, Any]]:
        names = {"get_state", "check_solved"}
        if self.tool_mode in ("both", "turn_only"):
            names.add("turn")
        if self.tool_mode in ("both", "batch_only"):
            names.add("apply_moves")
        return [
            tool for tool in TOOLS if tool["function"]["name"] in names
        ]

    async def _distance(self, state: CubeState) -> int | None:
        # 3x3 参照求解器是同步子进程管道，直接调用会卡住事件循环，
        # 并行 run 的 SSE 流会被一次 distance 调用拖住；丢线程池执行。
        # 每个 run 持有独立 solver 实例且 run 内串行，线程安全。
        return await asyncio.to_thread(self.solver.distance, state)

    async def _chat(
        self,
        messages: list[dict[str, Any]],
        cancel: asyncio.Event | None,
        on_delta: Callable[[str, str], None] | None = None,
    ) -> ModelTurn:
        stream_chat = getattr(self.provider, "chat_stream", None)
        if stream_chat is not None and on_delta is not None:
            chat = asyncio.create_task(
                stream_chat(messages, self._tools(), self.params, on_delta)
            )
        else:
            chat = asyncio.create_task(
                self.provider.chat(messages, self._tools(), self.params)
            )
        if cancel is None:
            return await asyncio.wait_for(chat, timeout=self.budget.turn_timeout)
        stop = asyncio.create_task(cancel.wait())
        try:
            done, _ = await asyncio.wait(
                {chat, stop},
                timeout=self.budget.turn_timeout,
                return_when=asyncio.FIRST_COMPLETED,
            )
        finally:
            stop.cancel()
        if not done:
            chat.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await chat
            raise asyncio.TimeoutError
        if stop in done:
            chat.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await chat
            raise _EpisodeCancelled
        return chat.result()

    async def run(
        self,
        task: Task,
        emit: Callable[[str, dict[str, Any]], None] | None = None,
        cancel: asyncio.Event | None = None,
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
        error_message: str | None = None
        start_length = (await self._distance(initial)) or task.reference_length
        nudge: str | None = None

        def notify(kind: str, payload: dict[str, Any]) -> None:
            if emit is not None:
                emit(kind, payload)

        while True:
            if cancel is not None and cancel.is_set():
                status = EpisodeStatus.CANCELLED
                error_message = "cancelled"
                break
            if time.monotonic() - started > self.budget.max_seconds:
                status = EpisodeStatus.TIMEOUT
                error_message = f"episode timeout after {self.budget.max_seconds:g}s"
                break
            messages = builder.build(
                executor.state.to_json(), move_history, records, nudge=nudge
            )
            nudge = None
            throttle = ThinkingThrottle(notify, seq=len(records))
            notify("model.turn.started", {"moves_used": executor.moves_used})
            try:
                turn = await self._chat(messages, cancel, on_delta=throttle)
            except _EpisodeCancelled:
                status = EpisodeStatus.CANCELLED
                error_message = "cancelled"
                break
            except asyncio.TimeoutError:
                status = EpisodeStatus.TIMEOUT
                error_message = f"turn timeout after {self.budget.turn_timeout:g}s"
                break
            except ProviderError as exc:
                status = (
                    EpisodeStatus.TIMEOUT
                    if exc.kind == "timeout"
                    else EpisodeStatus.PROVIDER_ERROR
                )
                error_message = str(exc) or exc.kind
                break
            if cancel is not None and cancel.is_set():
                status = EpisodeStatus.CANCELLED
                error_message = "cancelled"
                break
            throttle.flush()
            tokens_in += turn.usage.prompt_tokens
            tokens_out += turn.usage.completion_tokens
            if tokens_in + tokens_out > self.budget.max_tokens:
                status = EpisodeStatus.BUDGET_EXCEEDED
                break
            notify(
                "model.message",
                {
                    "content": turn.content,
                    "thinking": turn.reasoning,
                    "tool_calls": len(turn.tool_calls),
                    "usage": {
                        "prompt_tokens": tokens_in,
                        "completion_tokens": tokens_out,
                    },
                },
            )
            assistant: dict[str, Any] = {
                "role": "assistant",
                "content": turn.content or "",
            }
            steps.append(
                StepRecord(
                    seq=len(steps),
                    kind="model_message",
                    arguments={
                        "tool_calls": [call.name for call in turn.tool_calls]
                    },
                    result={"content": turn.content, "thinking": turn.reasoning},
                    state=executor.state.to_json(),
                    reference_length_after=await self._distance(executor.state),
                )
            )
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
                    notify(
                        "tool.call",
                        {
                            "call_id": call.id,
                            "tool": call.name,
                            "arguments": call.arguments,
                        },
                    )
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
                    notify(
                        "tool.result",
                        {
                            "call_id": call.id,
                            "tool": call.name,
                            "ok": outcome.ok,
                            "payload": outcome.payload,
                        },
                    )
                    length_after = await self._distance(executor.state)
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
                    if outcome.applied:
                        notify(
                            "move.applied",
                            {
                                "moves": outcome.applied,
                                "state": executor.state.to_json(),
                                "moves_used": executor.moves_used,
                                "solved": executor.state.is_solved(),
                                "reference_length_after": length_after,
                            },
                        )
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
        final_length = await self._distance(final_state)
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
            error=error_message,
            steps=steps,
        )
        notify("episode.finished", {"status": status.value, "solved": result.solved})
        return result
