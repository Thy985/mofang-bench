from __future__ import annotations

import asyncio
import contextlib
import json
import time
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Callable

from ..cube.solver import ReferenceSolver, SolverError
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
from .skills import pack_for
from .tools import PLAN_TOOL, TOOLS, ToolExecutor, ToolOutcome, serialize_tool_result


class EpisodeStatus(StrEnum):
    SOLVED = "solved"
    STOPPED_UNSOLVED = "stopped_unsolved"
    BUDGET_EXCEEDED = "budget_exceeded"
    # 连续被 finish_reason=length 截断且始终没有有效动作：模型侧行为，
    # 与真实的 token/时间预算超限分开记账。
    MODEL_TRUNCATION_LOOP = "model_truncation_loop"
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
    # 本局内 provider 退避重试 + ProviderError 总数（进出场差值）
    provider_errors: int = 0
    plan: dict[str, Any] | None = None
    steps: list[StepRecord] = field(default_factory=list)


def _provider_stats(provider: Any) -> dict[str, int]:
    """读取 adapter 的请求统计快照；无 stats 的 provider（Fake 等）视为全零。"""
    stats = getattr(provider, "stats", None)
    if not isinstance(stats, dict):
        return {}
    return {key: int(value) for key, value in stats.items()}


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
    # 单轮输出被 finish_reason=length 截断时，允许的连续截断轮数；
    # 超过后按超预算路径结束，避免无限重放。成功执行工具后清零。
    MAX_TRUNCATIONS = 2
    # 计划催促独立于 MAX_NUDGES：拒不交计划只提醒，不终止本局
    MAX_PLAN_NUDGES = 2
    # solve 工具在 assist 模式下的整次求解上限（3x3 子进程可能偶尔偏慢）
    SOLVE_TIMEOUT = 30.0
    # 可重试 provider 错误的轮级续跑（断点续跑）：保留 executor 状态、对话记录与
    # 已计 tokens，退避后重发本轮。429/网络抖动/服务端 5xx 属瞬时故障，不应让
    # 「只差两步」的 episode 直接判 0；auth/bad_request 不重试（重试无意义）。
    MAX_PROVIDER_RETRIES = 2
    PROVIDER_RETRY_DELAYS = (8.0, 20.0)  # 覆盖较长的 429 reset 窗口
    TRUNCATION_NUDGE = (
        "上一轮输出已被单轮 token 上限截断（finish_reason=length）。"
        "下一轮必须先发起一个合法工具调用：优先直接给出可执行的 apply_moves"
        "（或至少调用一个工具），把思考压到最少；不要继续展开整段分析。"
    )

    def __init__(
        self,
        provider: ProviderAdapter,
        solver: ReferenceSolver,
        budget: Budget,
        params: ModelParams | None = None,
        tool_mode: str = "both",
        require_plan: bool = False,
        solver_mode: str = "off",
        skill: str = "none",
    ) -> None:
        if tool_mode not in ("both", "turn_only", "batch_only"):
            raise ValueError(f"invalid tool_mode: {tool_mode}")
        if solver_mode not in ("off", "assist"):
            raise ValueError(f"invalid solver_mode: {solver_mode}")
        if skill not in ("none", "ortega", "lbl"):
            raise ValueError(f"invalid skill: {skill}")
        self.provider = provider
        self.solver = solver
        self.budget = budget
        self.params = params or ModelParams()
        self.tool_mode = tool_mode
        self.require_plan = require_plan
        self.solver_mode = solver_mode
        self.skill = skill

    def _tools(self) -> list[dict[str, Any]]:
        names = {"get_state", "check_solved"}
        if self.tool_mode in ("both", "turn_only"):
            names.add("turn")
        if self.tool_mode in ("both", "batch_only"):
            names.add("apply_moves")
        if self.require_plan:
            names.add("submit_plan")
        if self.solver_mode == "assist":
            names.add("solve")
        if self.skill == "ortega":
            names.add("probe_oll")
        tools = [
            tool for tool in TOOLS if tool["function"]["name"] in names
        ]
        if self.require_plan:
            tools.append(PLAN_TOOL)
        return tools

    async def _distance(self, state: CubeState) -> int | None:
        # 3x3 参照求解器是同步子进程管道，直接调用会卡住事件循环，
        # 并行 run 的 SSE 流会被一次 distance 调用拖住；丢线程池执行。
        # 每个 run 持有独立 solver 实例且 run 内串行，线程安全。
        return await asyncio.to_thread(self.solver.distance, state)

    async def _solve(self, executor: ToolExecutor) -> ToolOutcome:
        """执行 solve 工具：只返回建议走法，不改变 executor.state。"""
        exceeded = executor.begin_call()
        if exceeded is not None:
            return exceeded
        if self.solver_mode != "assist":
            return executor.solve_error(
                "tool_not_enabled", "solve is only available when solver=assist"
            )
        try:
            moves = await asyncio.wait_for(
                asyncio.to_thread(self.solver.solve, executor.state),
                timeout=self.SOLVE_TIMEOUT,
            )
        except asyncio.TimeoutError:
            await self._reset_solver_worker()
            return executor.solve_error(
                "solver_timeout",
                f"solver did not return within {self.SOLVE_TIMEOUT:g}s",
            )
        except (SolverError, ValueError) as exc:
            return executor.solve_error(
                "solver_unavailable", str(exc) or type(exc).__name__
            )
        except Exception as exc:  # 子进程/管道等运行期异常
            return executor.solve_error(
                "solver_unavailable", str(exc) or type(exc).__name__
            )
        if not moves:
            return executor.solve_error(
                "solver_unavailable", "solver returned an empty move sequence"
            )
        return executor.solve_ok(moves)

    async def _reset_solver_worker(self) -> None:
        """solve 超时后丢弃当前 worker，避免下一次调用读到迟到的旧响应。"""
        reset = getattr(self.solver, "reset", None)
        if reset is None:
            return
        try:
            await asyncio.to_thread(reset)
        except Exception:
            # 丢弃失败不能把 timeout 改写成别的错误；下一次调用重建失败时
            # 会由 _solve 的异常分支显式返回 solver_unavailable。
            pass

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
        on_turn: Callable[[dict[str, Any]], None] | None = None,
    ) -> EpisodeResult:
        started = time.monotonic()
        initial = CubeState.from_json(task.state)
        executor = ToolExecutor(
            initial, self.budget.max_moves, self.budget.max_tool_calls, skill=self.skill
        )
        builder = ContextBuilder(
            system_prompt(
                self.require_plan,
                solver_assist=self.solver_mode == "assist",
                skill_pack=pack_for(self.skill),
            ),
            task_message(self.budget.max_moves, self.require_plan),
        )
        records: list[TurnRecord] = []
        move_history: list[str] = []
        steps: list[StepRecord] = []
        tokens_in = 0
        tokens_out = 0
        nudges = 0
        truncations = 0
        plan_nudges = 0
        provider_retries = 0
        status = EpisodeStatus.STOPPED_UNSOLVED
        error_message: str | None = None
        start_length = (await self._distance(initial)) or task.reference_length
        nudge: str | None = None
        stats_start = _provider_stats(self.provider)
        persisted_steps = 0

        def notify(kind: str, payload: dict[str, Any]) -> None:
            if emit is not None:
                emit(kind, payload)

        def flush_turn_steps() -> None:
            """把上一轮新增的 step 交给调用方即时落库，不等 episode 结束。"""
            nonlocal persisted_steps
            if on_turn is None or persisted_steps >= len(steps):
                return
            pending = steps[persisted_steps:]
            persisted_steps = len(steps)
            on_turn(
                {
                    "steps": pending,
                    "moves_used": executor.moves_used,
                    "tokens_in": tokens_in,
                    "tokens_out": tokens_out,
                    "latency_ms": int((time.monotonic() - started) * 1000),
                    "final_state": executor.state.to_json(),
                }
            )

        while True:
            flush_turn_steps()
            if cancel is not None and cancel.is_set():
                status = EpisodeStatus.CANCELLED
                error_message = "cancelled"
                break
            if time.monotonic() - started > self.budget.max_seconds:
                status = EpisodeStatus.TIMEOUT
                error_message = f"episode timeout after {self.budget.max_seconds:g}s"
                break
            messages = builder.build(
                executor.state.to_json(),
                move_history,
                records,
                nudge=nudge,
                plan=executor.plan,
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
                if exc.retryable and provider_retries < self.MAX_PROVIDER_RETRIES:
                    provider_retries += 1
                    delay = self.PROVIDER_RETRY_DELAYS[
                        min(provider_retries - 1, len(self.PROVIDER_RETRY_DELAYS) - 1)
                    ]
                    notify(
                        "model.provider_retry",
                        {
                            "kind": exc.kind,
                            "attempt": provider_retries,
                            "max": self.MAX_PROVIDER_RETRIES,
                            "delay": delay,
                            "message": str(exc) or exc.kind,
                        },
                    )
                    await asyncio.sleep(delay)
                    # 断点续跑：回到循环顶部重发本轮（状态/记录/tokens 全部保留）
                    continue
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
                    "finish_reason": turn.finish_reason,
                    "usage": {
                        "prompt_tokens": tokens_in,
                        "completion_tokens": tokens_out,
                    },
                },
            )
            truncated = turn.finish_reason == "length"
            if truncated:
                # 截断不等于"模型不想动"：单独计数、单独提示，不进入 nudge 累计。
                truncations += 1
                notify(
                    "model.truncated",
                    {
                        "finish_reason": turn.finish_reason,
                        "truncations": truncations,
                        "max_truncations": self.MAX_TRUNCATIONS,
                        "completion_tokens": turn.usage.completion_tokens,
                        "max_tokens_dowgraded": bool(
                            getattr(self.provider, "max_tokens_dowgraded", False)
                        ),
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
                # assistant 消息必须包含本轮全部 tool_call；溢出调用也要配一条
                # too_many_tool_calls 的 tool result，模型才能看见它没有执行。
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
                    for call in turn.tool_calls
                ]
                record = TurnRecord(assistant=assistant)
                records.append(record)
                executor.turn_index = len(records)
                effective_action = False
                for call in calls:
                    notify(
                        "tool.call",
                        {
                            "call_id": call.id,
                            "tool": call.name,
                            "arguments": call.arguments,
                        },
                    )
                    if call.name == "solve":
                        outcome = await self._solve(executor)
                    else:
                        outcome = executor.execute(call.name, call.arguments)
                    if outcome.ok:
                        effective_action = True
                    if (
                        outcome.ok
                        and call.name == "submit_plan"
                        and isinstance(outcome.payload.get("plan"), dict)
                    ):
                        notify(
                            "plan.updated",
                            {
                                "plan": outcome.payload["plan"],
                                "revisions": executor.plan_submissions - 1,
                            },
                        )
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
                    if outcome.payload.get("stage_broken"):
                        notify(
                            "stage.broken",
                            {
                                "tool": call.name,
                                **outcome.payload["stage_broken"],
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
                for call in overflow:
                    payload = {
                        "ok": False,
                        "error": "too_many_tool_calls",
                        "detail": (
                            f"每轮最多执行 {self.MAX_TOOL_CALLS_PER_TURN} 个工具调用；"
                            "该调用未执行。请把多步走法放进 apply_moves，或在下一轮再调用。"
                        ),
                        "tool": call.name,
                    }
                    record.tool_results.append(
                        {
                            "role": "tool",
                            "tool_call_id": call.id,
                            "content": json.dumps(payload, ensure_ascii=False),
                        }
                    )
                    notify(
                        "tool.result",
                        {
                            "call_id": call.id,
                            "tool": call.name,
                            "ok": False,
                            "payload": payload,
                        },
                    )
                    steps.append(
                        StepRecord(
                            seq=len(steps),
                            kind="tool",
                            tool_name=call.name,
                            arguments=call.arguments,
                            result=payload,
                            state=executor.state.to_json(),
                            reference_length_after=None,
                        )
                    )
                if effective_action:
                    # 有成功生效的工具调用 => 本 turn 不是"纯思考"，连续计数清零
                    nudges = 0
                    truncations = 0
                if status in (
                    EpisodeStatus.SOLVED,
                    EpisodeStatus.BUDGET_EXCEEDED,
                    EpisodeStatus.PROTOCOL_ERROR,
                ):
                    break
                if executor.protocol_errors >= self.MAX_PROTOCOL_ERRORS:
                    status = EpisodeStatus.PROTOCOL_ERROR
                    break
                if truncated:
                    if truncations > self.MAX_TRUNCATIONS:
                        status = EpisodeStatus.MODEL_TRUNCATION_LOOP
                        error_message = (
                            "output truncated repeatedly without a tool call "
                            "(finish_reason=length)"
                        )
                        break
                    nudge = self.TRUNCATION_NUDGE
            else:
                records.append(TurnRecord(assistant=assistant))
                if executor.state.is_solved():
                    status = EpisodeStatus.SOLVED
                    break
                if truncated:
                    if truncations > self.MAX_TRUNCATIONS:
                        status = EpisodeStatus.MODEL_TRUNCATION_LOOP
                        error_message = (
                            "output truncated repeatedly without a tool call "
                            "(finish_reason=length)"
                        )
                        break
                    # 截断轮不进入 nudge 累计，只提示压缩思考/继续
                    nudge = self.TRUNCATION_NUDGE
                    continue
                nudges += 1
                if nudges > self.MAX_NUDGES:
                    status = EpisodeStatus.STOPPED_UNSOLVED
                    break
                nudge = (
                    "你还没有解出魔方。请继续调用工具；"
                    "如果确实无法继续，请明确说明。"
                )
            if (
                self.require_plan
                and executor.plan is None
                and plan_nudges < self.MAX_PLAN_NUDGES
            ):
                # 催计划独立计数：拒不交计划只提醒几次，不杀本局
                nudge = (
                    "请先调用 submit_plan 设定目标与分阶段计划，然后再继续。"
                )
                plan_nudges += 1

        flush_turn_steps()
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
        # provider_errors = 本局内退避重试 + 最终 ProviderError（进出场差值）
        stats_end = _provider_stats(self.provider)
        provider_errors = sum(
            stats_end.get(key, 0) - stats_start.get(key, 0)
            for key in ("retries", "errors")
        )
        result = EpisodeResult(
            status=status,
            solved=final_state.is_solved(),
            moves_used=executor.moves_used,
            reference_length=reference_length,
            efficiency=efficiency,
            progress_ratio=progress,
            invalid_calls=executor.invalid_calls,
            protocol_errors=executor.protocol_errors,
            provider_errors=provider_errors,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            latency_ms=int((time.monotonic() - started) * 1000),
            final_state=final_state.to_json(),
            failure_code=failure_code,
            error=error_message,
            plan=executor.plan,
            steps=steps,
        )
        notify("episode.finished", {"status": status.value, "solved": result.solved})
        return result
