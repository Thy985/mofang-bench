from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from ..tasks.models import Benchmark, Task
from .db import Database


def task_row_id(benchmark_id: str, task_key: str) -> str:
    return f"{benchmark_id}:{task_key}"


def _benchmark_dict(benchmark: Benchmark, config: dict[str, Any]) -> tuple:
    return (
        benchmark.id,
        benchmark.name,
        benchmark.version,
        benchmark.kind,
        benchmark.cube,
        json.dumps(config, ensure_ascii=False),
        benchmark.content_hash or benchmark.compute_hash(),
        benchmark.created_at or datetime.now(timezone.utc).isoformat(),
    )


def save_benchmark(
    db: Database, benchmark: Benchmark, config: dict[str, Any]
) -> None:
    with db.transaction() as conn:
        exists = conn.execute(
            "SELECT 1 FROM benchmarks WHERE id = ?", (benchmark.id,)
        ).fetchone()
        if exists:
            return
        conn.execute(
            "INSERT INTO benchmarks VALUES (?,?,?,?,?,?,?,?)",
            _benchmark_dict(benchmark, config),
        )
        for task in benchmark.tasks:
            conn.execute(
                "INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?)",
                (
                    task_row_id(benchmark.id, task.id),
                    benchmark.id,
                    task.id,
                    task.cube,
                    json.dumps(task.scramble),
                    task.scramble_depth,
                    json.dumps(task.state, ensure_ascii=False),
                    task.reference_length,
                    task.reference_kind,
                    task.bin,
                ),
            )


def list_benchmarks(db: Database) -> list[dict[str, Any]]:
    conn = db.connect()
    try:
        rows = conn.execute(
            """
            SELECT b.*, COUNT(t.id) AS task_count
            FROM benchmarks b
            LEFT JOIN tasks t ON t.benchmark_id = b.id
            GROUP BY b.id
            ORDER BY b.frozen_at DESC, b.id
            """
        ).fetchall()
    finally:
        conn.close()
    return [
        {
            "id": row["id"],
            "name": row["name"],
            "version": row["version"],
            "kind": row["kind"],
            "cube": row["cube"],
            "content_hash": row["content_hash"],
            "frozen_at": row["frozen_at"],
            "task_count": row["task_count"],
        }
        for row in rows
    ]


def get_benchmark(db: Database, benchmark_id: str) -> Benchmark | None:
    conn = db.connect()
    try:
        row = conn.execute(
            "SELECT * FROM benchmarks WHERE id = ?", (benchmark_id,)
        ).fetchone()
        if row is None:
            return None
        task_rows = conn.execute(
            "SELECT * FROM tasks WHERE benchmark_id = ? ORDER BY rowid",
            (benchmark_id,),
        ).fetchall()
    finally:
        conn.close()
    tasks = [
        Task(
            id=item["task_key"],
            cube=item["cube"],
            scramble=json.loads(item["scramble"]),
            scramble_depth=item["scramble_depth"],
            state=json.loads(item["state_json"]),
            reference_length=item["reference_length"],
            reference_kind=item["reference_kind"],
            bin=item["bin"],
        )
        for item in task_rows
    ]
    return Benchmark(
        id=row["id"],
        name=row["name"],
        version=row["version"],
        cube=row["cube"],
        kind=row["kind"],
        tasks=tasks,
        content_hash=row["content_hash"],
        created_at=row["frozen_at"],
    )


def get_task_ids(db: Database, benchmark_id: str) -> list[str]:
    conn = db.connect()
    try:
        rows = conn.execute(
            "SELECT id FROM tasks WHERE benchmark_id = ? ORDER BY rowid",
            (benchmark_id,),
        ).fetchall()
    finally:
        conn.close()
    return [row["id"] for row in rows]
