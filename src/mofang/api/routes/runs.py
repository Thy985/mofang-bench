from __future__ import annotations

import csv
import io
from dataclasses import asdict

from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse

from ...service.factory import budget_for
from ...store.benchmarks import get_benchmark
from ...store.providers import get_provider
from ...store.runs import (
    create_run,
    get_run,
    get_run_episodes,
    get_steps,
    list_runs,
)
from ..events import effective_after
from ..schemas import EpisodeOut, RunCreate, RunOut

router = APIRouter(prefix="/api/runs", tags=["runs"])


def _episode_out(episode: dict) -> EpisodeOut:
    data = dict(episode)
    data["task_key"] = data["task_id"].split(":", 1)[-1]
    return EpisodeOut(**data)


def _run_out(run: dict) -> RunOut:
    return RunOut(**run)


@router.post("", status_code=202)
async def start(payload: RunCreate, request: Request) -> dict:
    db = request.app.state.db
    provider_ids = payload.provider_ids or (
        [payload.provider_id] if payload.provider_id else []
    )
    if not provider_ids:
        raise HTTPException(400, "provider_id 或 provider_ids 至少填一个")
    benchmark = get_benchmark(db, payload.benchmark_id)
    if benchmark is None:
        raise HTTPException(404, "benchmark not found")
    task_keys = payload.task_keys
    if task_keys is not None:
        if not task_keys:
            raise HTTPException(400, "task_keys 不能是空列表（不选题请传 null）")
        valid = {task.id for task in benchmark.tasks}
        invalid = [key for key in task_keys if key not in valid]
        if invalid:
            raise HTTPException(
                400, f"task_keys 不属于该题集: {', '.join(invalid[:5])}"
            )
    providers = []
    for provider_id in provider_ids:
        provider = get_provider(db, provider_id)
        if provider is None:
            raise HTTPException(404, f"provider not found: {provider_id}")
        providers.append(provider)
    try:
        budget = asdict(budget_for(benchmark.cube, payload.budget))
    except TypeError as exc:
        raise HTTPException(400, f"invalid budget: {exc}") from exc
    created = []
    for provider in providers:
        run_id = create_run(
            db,
            provider_id=provider.id,
            benchmark_id=benchmark.id,
            tool_mode=payload.tool_mode,
            prompt_version="v1",
            params=payload.params,
            budget=budget,
            task_keys=task_keys,
        )
        request.app.state.service.start(run_id)
        created.append({"id": run_id, "provider_id": provider.id})
    return {"id": created[0]["id"], "runs": created}


@router.get("", response_model=list[RunOut])
def history(request: Request) -> list[RunOut]:
    return [_run_out(run) for run in list_runs(request.app.state.db)]


@router.get("/{run_id}")
def detail(run_id: str, request: Request) -> dict:
    run = get_run(request.app.state.db, run_id)
    if run is None:
        raise HTTPException(404, "run not found")
    return {
        "run": _run_out(run),
        "episodes": [
            _episode_out(item)
            for item in get_run_episodes(request.app.state.db, run_id)
        ],
    }


def _event_state(event) -> dict | None:
    if event.type == "move.applied":
        state = event.data.get("state")
        if isinstance(state, dict) and state:
            return state
    if event.type == "tool.result":
        payload = event.data.get("payload")
        if isinstance(payload, dict):
            state = payload.get("state")
            if isinstance(state, dict) and state:
                return state
    return None


def _live_state(db, events, run: dict, episodes: list[dict]) -> dict | None:
    if not episodes:
        return None
    last = episodes[-1]
    if last["status"] != "running":
        return last["final_state"] or None
    steps = get_steps(db, last["id"])
    if steps and steps[-1]["state"]:
        return steps[-1]["state"]
    for event in reversed(events.history(run["id"])):
        if event.episode_id != last["id"]:
            continue
        state = _event_state(event)
        if state is not None:
            return state
    benchmark = get_benchmark(db, run["benchmark_id"])
    if benchmark is not None:
        task_key = last["task_id"].split(":", 1)[-1]
        for task in benchmark.tasks:
            if task.id == task_key:
                return task.state
    return None


@router.get("/{run_id}/snapshot")
def snapshot(run_id: str, request: Request) -> dict:
    db = request.app.state.db
    run = get_run(db, run_id)
    if run is None:
        raise HTTPException(404, "run not found")
    episodes = get_run_episodes(db, run_id)
    current_state = _live_state(
        db, request.app.state.events, run, episodes
    )
    return {
        "run": _run_out(run),
        "episodes": [_episode_out(item) for item in episodes],
        "last_event_id": len(request.app.state.events.history(run_id)),
        "current_state": current_state,
    }


@router.get("/{run_id}/events")
async def events(
    run_id: str,
    request: Request,
    last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
    after: int = Query(default=0, ge=0),
):
    if get_run(request.app.state.db, run_id) is None:
        raise HTTPException(404, "run not found")
    stream = request.app.state.events.stream(
        run_id, after=effective_after(last_event_id, after)
    )
    return StreamingResponse(
        stream,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/{run_id}/cancel")
async def cancel(run_id: str, request: Request) -> dict:
    run = get_run(request.app.state.db, run_id)
    if run is None:
        raise HTTPException(404, "run not found")
    if run["status"] not in ("queued", "running"):
        raise HTTPException(409, "run is not running")
    cancelled = await request.app.state.service.cancel(run_id)
    if not cancelled:
        raise HTTPException(409, "run is not running")
    return {"cancelled": True}


@router.get("/{run_id}/report")
def report(run_id: str, request: Request) -> dict:
    db = request.app.state.db
    run = get_run(db, run_id)
    if run is None:
        raise HTTPException(404, "run not found")
    episodes = [
        _episode_out(item).model_dump()
        for item in get_run_episodes(db, run_id)
    ]
    solved = sum(1 for item in episodes if item["solved"])
    totals = run["totals"] or {
        "benchmark_id": run["benchmark_id"],
        "benchmark_hash": None,
        "benchmark_total_tasks": None,
        "partial": True,
        "totals": {
            "tasks": len(episodes),
            "solved": solved,
            "solve_rate": solved / len(episodes) if episodes else 0.0,
            "ci95": [0.0, 1.0],
        },
        "by_bin": {},
        "episodes": [],
    }
    payload = dict(totals)
    payload.update(
        {
            "run_id": run_id,
            "provider_id": run["provider_id"],
            "benchmark_id": run["benchmark_id"],
            "status": run["status"],
            "started_at": run["started_at"],
            "finished_at": run["finished_at"],
            "episodes": episodes,
        }
    )
    return payload


@router.get("/{run_id}/export")
def export(run_id: str, request: Request, format: str = "csv") -> Response:
    db = request.app.state.db
    run = get_run(db, run_id)
    if run is None:
        raise HTTPException(404, "run not found")
    episodes = [
        _episode_out(item).model_dump()
        for item in get_run_episodes(db, run_id)
    ]
    columns = [
        "task_id", "status", "solved", "moves_used", "reference_length",
        "efficiency", "progress_ratio", "protocol_errors", "tokens_in",
        "tokens_out", "latency_ms", "failure_code",
    ]
    rows = [{**item, "task_id": item["task_key"]} for item in episodes]
    if format == "csv":
        buffer = io.StringIO()
        writer = csv.DictWriter(buffer, fieldnames=columns)
        writer.writeheader()
        writer.writerows({key: item.get(key) for key in columns} for item in rows)
        return Response(
            buffer.getvalue(),
            media_type="text/csv",
            headers={
                "Content-Disposition": f'attachment; filename="run-{run_id}.csv"'
            },
        )
    if format == "md":
        lines = [
            "| " + " | ".join(columns) + " |",
            "| " + " | ".join("---" for _ in columns) + " |",
        ]
        for item in rows:
            lines.append(
                "| " + " | ".join(str(item.get(key)) for key in columns) + " |"
            )
        return Response(
            "\n".join(lines) + "\n",
            media_type="text/markdown",
            headers={
                "Content-Disposition": f'attachment; filename="run-{run_id}.md"'
            },
        )
    raise HTTPException(400, "format must be csv or md")
