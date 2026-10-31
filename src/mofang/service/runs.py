from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any, Callable

from ..api.events import RunEventBus
from ..cube.solver import ReferenceSolver
from ..eval.aggregate import aggregate_report
from ..models.provider import ProviderAdapter
from ..runner.episode import EpisodeRunner
from ..store.benchmarks import get_benchmark, task_row_id
from ..store.db import Database
from ..store.providers import (
    ProviderRecord,
    get_provider,
    set_provider_param,
)
from ..store.runs import (
    add_steps,
    create_episode,
    fail_running_episodes,
    finish_episode,
    get_run,
    set_run_status,
)
from .factory import budget_for, model_params_for

ProviderFactory = Callable[[ProviderRecord], ProviderAdapter]
SolverFactory = Callable[[str], ReferenceSolver]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class RunService:
    def __init__(
        self,
        db: Database,
        events: RunEventBus,
        provider_factory: ProviderFactory,
        solver_factory: SolverFactory,
    ) -> None:
        self.db = db
        self.events = events
        self.provider_factory = provider_factory
        self.solver_factory = solver_factory
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._cancels: dict[str, asyncio.Event] = {}
        self._lock = asyncio.Lock()

    def start(self, run_id: str) -> None:
        cancel = asyncio.Event()
        self._cancels[run_id] = cancel
        task = asyncio.create_task(self._execute(run_id, cancel))
        self._tasks[run_id] = task
        task.add_done_callback(lambda _: self._tasks.pop(run_id, None))

    async def cancel(self, run_id: str) -> bool:
        event = self._cancels.get(run_id)
        if event is None:
            return False
        event.set()
        return True

    async def wait(self, run_id: str) -> None:
        task = self._tasks.get(run_id)
        if task is not None:
            await task

    async def _execute(self, run_id: str, cancel: asyncio.Event) -> None:
        async with self._lock:
            await self._execute_locked(run_id, cancel)

    async def _execute_locked(
        self, run_id: str, cancel: asyncio.Event
    ) -> None:
        run = get_run(self.db, run_id)
        if run is None:
            return
        benchmark = get_benchmark(self.db, run["benchmark_id"])
        provider = get_provider(self.db, run["provider_id"])
        if benchmark is None or provider is None:
            self._fail(run_id, "benchmark or provider not found")
            return

        self.events.publish(run_id, "run.started", {"benchmark_id": benchmark.id})
        set_run_status(self.db, run_id, "running", started=True)
        adapter: ProviderAdapter | None = None
        solver: ReferenceSolver | None = None
        results = []
        try:
            adapter = self.provider_factory(provider)
            solver = self.solver_factory(benchmark.cube)
            params = model_params_for(provider, run["params"])
            budget = budget_for(benchmark.cube, run["budget"])

            for task in benchmark.tasks:
                if cancel.is_set():
                    break
                task_row = task_row_id(benchmark.id, task.id)
                episode_id = create_episode(
                    self.db,
                    run_id=run_id,
                    task_row_id=task_row,
                    reference_length=task.reference_length,
                    started_at=_now(),
                )
                self.events.publish(
                    run_id,
                    "episode.started",
                    {
                        "task_id": task.id,
                        "reference_length": task.reference_length,
                    },
                    episode_id=episode_id,
                )

                def emit(
                    kind: str,
                    payload: dict[str, Any],
                    episode_id: str = episode_id,
                ) -> None:
                    if kind == "episode.finished":
                        return
                    self.events.publish(
                        run_id, kind, payload, episode_id=episode_id
                    )

                runner = EpisodeRunner(
                    provider=adapter,
                    solver=solver,
                    budget=budget,
                    params=params,
                    tool_mode=run["tool_mode"],
                )
                result = await runner.run(task, emit=emit, cancel=cancel)
                finish_episode(self.db, episode_id, result)
                add_steps(self.db, episode_id, result.steps)
                results.append(result)
                self.events.publish(
                    run_id,
                    "episode.finished",
                    {
                        "task_id": task.id,
                        "status": result.status.value,
                        "solved": result.solved,
                        "moves_used": result.moves_used,
                    },
                    episode_id=episode_id,
                )
                if cancel.is_set():
                    break

            totals = aggregate_report(benchmark, results) if results else None
            status = "cancelled" if cancel.is_set() else "finished"
            set_run_status(
                self.db, run_id, status, totals=totals, finished=True
            )
            self.events.publish(
                run_id,
                "run.finished",
                {"status": status, "totals": totals},
            )
        except Exception as exc:
            self._fail(run_id, str(exc))
        finally:
            if (
                adapter is not None
                and provider is not None
                and getattr(adapter, "downgraded", False)
            ):
                set_provider_param(self.db, provider.id, "stream", False)
            if (
                adapter is not None
                and provider is not None
                and getattr(adapter, "max_tokens_downgraded", False)
            ):
                set_provider_param(self.db, provider.id, "max_tokens", 8192)
            close = getattr(adapter, "close", None)
            if close is not None:
                await close()
            if solver is not None:
                solver_close = getattr(solver, "close", None)
                if solver_close is not None:
                    solver_close()

    def _fail(self, run_id: str, message: str) -> None:
        fail_running_episodes(self.db, run_id, message)
        set_run_status(
            self.db, run_id, "failed", error=message, finished=True
        )
        self.events.publish(run_id, "run.error", {"message": message})
