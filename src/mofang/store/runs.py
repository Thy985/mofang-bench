from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from ..runner.episode import EpisodeResult, StepRecord
from .db import Database


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def create_run(
    db: Database,
    *,
    provider_id: str,
    benchmark_id: str,
    tool_mode: str,
    prompt_version: str,
    params: dict[str, Any],
    budget: dict[str, Any],
    task_keys: list[str] | None = None,
) -> str:
    run_id = uuid.uuid4().hex
    with db.transaction() as conn:
        conn.execute(
            """
            INSERT INTO runs
              (id, provider_id, benchmark_id, tool_mode, prompt_version,
               params_json, budget_json, status, totals_json, error,
               created_at, started_at, finished_at, task_keys_json)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                run_id,
                provider_id,
                benchmark_id,
                tool_mode,
                prompt_version,
                _dump(params),
                _dump(budget),
                "queued",
                None,
                None,
                now(),
                None,
                None,
                _dump(task_keys) if task_keys is not None else None,
            ),
        )
    return run_id


def count_runs_for_provider(db: Database, provider_id: str) -> int:
    conn = db.connect()
    try:
        row = conn.execute(
            "SELECT COUNT(*) FROM runs WHERE provider_id = ?", (provider_id,)
        ).fetchone()
    finally:
        conn.close()
    return int(row[0])


def set_run_status(
    db: Database,
    run_id: str,
    status: str,
    *,
    totals: dict[str, Any] | None = None,
    error: str | None = None,
    started: bool = False,
    finished: bool = False,
) -> None:
    with db.transaction() as conn:
        conn.execute(
            """
            UPDATE runs SET status = ?,
              totals_json = COALESCE(?, totals_json),
              error = COALESCE(?, error),
              started_at = CASE WHEN ? THEN ? ELSE started_at END,
              finished_at = CASE WHEN ? THEN ? ELSE finished_at END
            WHERE id = ?
            """,
            (
                status,
                _dump(totals) if totals is not None else None,
                error,
                int(started),
                now() if started else None,
                int(finished),
                now() if finished else None,
                run_id,
            ),
        )


def _run_dict(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "provider_id": row["provider_id"],
        "benchmark_id": row["benchmark_id"],
        "tool_mode": row["tool_mode"],
        "prompt_version": row["prompt_version"],
        "params": json.loads(row["params_json"]),
        "budget": json.loads(row["budget_json"]),
        "status": row["status"],
        "totals": json.loads(row["totals_json"]) if row["totals_json"] else None,
        "error": row["error"],
        "task_keys": (
            json.loads(row["task_keys_json"])
            if row["task_keys_json"]
            else None
        ),
        "created_at": row["created_at"],
        "started_at": row["started_at"],
        "finished_at": row["finished_at"],
    }


def get_run(db: Database, run_id: str) -> dict[str, Any] | None:
    conn = db.connect()
    try:
        row = conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
    finally:
        conn.close()
    return _run_dict(row) if row else None


def list_runs(db: Database) -> list[dict[str, Any]]:
    conn = db.connect()
    try:
        rows = conn.execute(
            "SELECT * FROM runs ORDER BY created_at DESC, id"
        ).fetchall()
    finally:
        conn.close()
    return [_run_dict(row) for row in rows]


def create_episode(
    db: Database,
    *,
    run_id: str,
    task_row_id: str,
    reference_length: int,
    started_at: str,
) -> str:
    episode_id = uuid.uuid4().hex
    with db.transaction() as conn:
        conn.execute(
            """
            INSERT INTO episodes
              (id, run_id, task_id, status, solved, moves_used, reference_length,
               final_state_json, started_at)
            VALUES (?,?,?,?,0,0,?,?,?)
            """,
            (
                episode_id,
                run_id,
                task_row_id,
                "running",
                reference_length,
                "{}",
                started_at,
            ),
        )
    return episode_id


def finish_episode(db: Database, episode_id: str, result: EpisodeResult) -> None:
    with db.transaction() as conn:
        conn.execute(
            """
            UPDATE episodes SET
              status = ?, solved = ?, moves_used = ?, reference_length = ?,
              efficiency = ?, progress_ratio = ?, invalid_calls = ?,
              protocol_errors = ?, provider_errors = ?, tokens_in = ?,
              tokens_out = ?, latency_ms = ?, final_state_json = ?,
              failure_code = ?, error = ?, finished_at = ?
            WHERE id = ?
            """,
            (
                result.status.value,
                int(result.solved),
                result.moves_used,
                result.reference_length,
                result.efficiency,
                result.progress_ratio,
                result.invalid_calls,
                result.protocol_errors,
                0,
                result.tokens_in,
                result.tokens_out,
                result.latency_ms,
                _dump(result.final_state),
                result.failure_code,
                result.error,
                now(),
                episode_id,
            ),
        )


def add_steps(db: Database, episode_id: str, steps: list[StepRecord]) -> None:
    if not steps:
        return
    with db.transaction() as conn:
        conn.executemany(
            "INSERT INTO steps VALUES (?,?,?,?,?,?,?,?,?,?)",
            [
                (
                    uuid.uuid4().hex,
                    episode_id,
                    step.seq,
                    "tool_result" if step.kind == "tool" else step.kind,
                    step.tool_name,
                    _dump(step.arguments),
                    _dump(step.result),
                    _dump(step.state),
                    step.reference_length_after,
                    now(),
                )
                for step in steps
            ],
        )


def _episode_dict(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "run_id": row["run_id"],
        "task_id": row["task_id"],
        "status": row["status"],
        "solved": bool(row["solved"]),
        "moves_used": row["moves_used"],
        "reference_length": row["reference_length"],
        "efficiency": row["efficiency"],
        "progress_ratio": row["progress_ratio"],
        "invalid_calls": row["invalid_calls"],
        "protocol_errors": row["protocol_errors"],
        "provider_errors": row["provider_errors"],
        "tokens_in": row["tokens_in"],
        "tokens_out": row["tokens_out"],
        "cost_usd": row["cost_usd"],
        "latency_ms": row["latency_ms"],
        "final_state": json.loads(row["final_state_json"]),
        "failure_code": row["failure_code"],
        "error": row["error"],
        "started_at": row["started_at"],
        "finished_at": row["finished_at"],
    }


def get_episode(db: Database, episode_id: str) -> dict[str, Any] | None:
    conn = db.connect()
    try:
        row = conn.execute(
            "SELECT * FROM episodes WHERE id = ?", (episode_id,)
        ).fetchone()
    finally:
        conn.close()
    return _episode_dict(row) if row else None


def get_run_episodes(db: Database, run_id: str) -> list[dict[str, Any]]:
    conn = db.connect()
    try:
        rows = conn.execute(
            "SELECT * FROM episodes WHERE run_id = ? ORDER BY rowid", (run_id,)
        ).fetchall()
    finally:
        conn.close()
    return [_episode_dict(row) for row in rows]


def get_steps(db: Database, episode_id: str) -> list[dict[str, Any]]:
    conn = db.connect()
    try:
        rows = conn.execute(
            "SELECT * FROM steps WHERE episode_id = ? ORDER BY seq", (episode_id,)
        ).fetchall()
    finally:
        conn.close()
    return [
        {
            "id": row["id"],
            "episode_id": row["episode_id"],
            "seq": row["seq"],
            "kind": row["kind"],
            "tool_name": row["tool_name"],
            "arguments": json.loads(row["args_json"]) if row["args_json"] else None,
            "result": json.loads(row["result_json"]) if row["result_json"] else None,
            "state": json.loads(row["state_json"]) if row["state_json"] else None,
            "reference_length_after": row["reference_length_after"],
            "created_at": row["created_at"],
        }
        for row in rows
    ]


def fail_running_episodes(db: Database, run_id: str, message: str) -> None:
    with db.transaction() as conn:
        conn.execute(
            """
            UPDATE episodes SET status = 'interrupted', error = ?, finished_at = ?
            WHERE run_id = ? AND status = 'running'
            """,
            (message, now(), run_id),
        )


def mark_running_interrupted(db: Database) -> int:
    with db.transaction() as conn:
        count = conn.execute(
            "UPDATE episodes SET status = 'interrupted' WHERE status = 'running'"
        ).rowcount
        conn.execute(
            "UPDATE runs SET status = 'interrupted' WHERE status IN ('queued','running')"
        )
    return count
