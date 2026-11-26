r"""干净基线跑批：skill=none / solver=off。

目的：在修好的 harness 上重测模型的魔方推理水平，不注入任何 skill pack、
不开放求解器。题池从 data/mofang.db 只读取（ro），全部写入独立临时库。

启动示例（Windows PowerShell，独立 WMI 进程，母进程退出不影响它）：

  $ts = Get-Date -Format 'yyyyMMdd-HHmmss'
  $root = 'd:\Projects\Archive\mofang'
  $out = Join-Path $root "data\reports\baseline-$ts"
  New-Item -ItemType Directory -Force -Path $out | Out-Null
  $procId = (Invoke-CimMethod -ClassName Win32_Process -MethodName Create `
    -Arguments @{ CommandLine = "`"$root\.venv\Scripts\python.exe`" -u `"$root\scripts\run_baseline.py`" --db `"data\baseline-$ts.db`" --out `"$out`" --log-file `"$out\runner.log`"" }).ProcessId
  $procId

崩溃复盘（不需要 report.json）：

  .venv\Scripts\python.exe scripts\run_baseline.py --summarize-events <events-*.jsonl>
"""

from __future__ import annotations

import argparse
import asyncio
import atexit
import json
import os
import signal
import sqlite3
import statistics
import sys
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "scripts"))

import verify_skill_pack as vsp  # noqa: E402  复用事件重建/记账逻辑

from mofang.api.events import EventJournal, RunEventBus  # noqa: E402
from mofang.service.factory import (  # noqa: E402
    build_adapter,
    budget_for,
    make_solver_factory,
)
from mofang.service.runs import RunService  # noqa: E402
from mofang.store.benchmarks import save_benchmark  # noqa: E402
from mofang.store.db import Database  # noqa: E402
from mofang.store.providers import create_provider  # noqa: E402
from mofang.store.runs import (  # noqa: E402
    create_run,
    get_run,
    get_run_episodes,
)
from mofang.tasks.models import Benchmark, Task  # noqa: E402

DEFAULT_PLAN = (
    "2x2-1-1:3,2x2-1-2:1,2x2-5-1:1,2x2-5-2:1,3x3-3-1:1,3x3-3-2:1"
)


def log(message: str) -> None:
    stamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{stamp}] {message}", flush=True)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def read_source_pool(source_db: Path) -> dict[str, tuple[Benchmark, Task]]:
    """只读地把 source 库里所有 benchmark + task 建成可复用的对象。"""
    conn = sqlite3.connect(f"file:{source_db}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        benches = conn.execute("SELECT * FROM benchmarks ORDER BY id").fetchall()
        tasks = conn.execute("SELECT * FROM tasks ORDER BY rowid").fetchall()
    finally:
        conn.close()
    pool: dict[str, tuple[Benchmark, Task]] = {}
    for bench_row in benches:
        bench_tasks: list[Task] = []
        for row in tasks:
            if row["benchmark_id"] != bench_row["id"]:
                continue
            task = Task(
                id=row["task_key"],
                cube=row["cube"],
                scramble=json.loads(row["scramble"]),
                scramble_depth=row["scramble_depth"],
                state=json.loads(row["state_json"]),
                reference_length=row["reference_length"],
                reference_kind=row["reference_kind"],
                bin=row["bin"],
            )
            bench_tasks.append(task)
        if not bench_tasks:
            continue
        bench = Benchmark(
            id=bench_row["id"],
            name=bench_row["name"],
            version=bench_row["version"],
            kind=bench_row["kind"],
            cube=bench_row["cube"],
            tasks=bench_tasks,
            content_hash=bench_row["content_hash"],
            created_at=bench_row["frozen_at"],
        )
        for task in bench_tasks:
            pool[task.id] = (bench, task)
    return pool


def parse_plan(raw: str) -> list[tuple[str, int]]:
    entries: list[tuple[str, int]] = []
    for chunk in raw.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        key, _, repeat = chunk.partition(":")
        entries.append((key, max(1, int(repeat or "1"))))
    return entries


def _elapsed_sum(turns: list[dict], upto: int) -> int | None:
    values = [
        turn.get("elapsed_ms")
        for turn in turns[:upto]
        if turn.get("elapsed_ms") is not None
    ]
    return sum(values) if values else None


def behavior_metrics(record: dict) -> dict[str, Any]:
    """单局行为画像：工具构成、截断、原地打转、D 面成面耗时占比。"""
    turns = record.get("turns") or []
    tool_counts: dict[str, int] = {}
    for turn in turns:
        for tool in turn.get("tools") or []:
            tool_counts[tool] = tool_counts.get(tool, 0) + 1
    refs = [
        turn["ref_after"]
        for turn in turns
        if turn.get("ref_after") is not None
    ]
    rebounds = [
        {"turn": index + 1, "prev": refs[index - 1], "ref": refs[index]}
        for index in range(1, len(refs))
        if refs[index] > refs[index - 1]
    ]
    repeated = [
        index
        for index in range(1, len(turns))
        if turns[index].get("applied_moves")
        and turns[index]["applied_moves"] == turns[index - 1]["applied_moves"]
    ]
    d_face_turn = None
    for index, turn in enumerate(turns, 1):
        if any(
            item.get("d_uniform") for item in turn.get("probes") or []
        ):
            d_face_turn = index
            break
    first_move_turn = next(
        (index for index, turn in enumerate(turns, 1) if turn.get("applied_moves")),
        None,
    )
    last_phase = None
    for turn in reversed(turns):
        if turn.get("phase"):
            last_phase = turn["phase"]
            break
    wall_ms = record.get("latency_ms") or 0
    d_face_ms = _elapsed_sum(turns, d_face_turn) if d_face_turn else None
    return {
        "tool_call_counts": tool_counts,
        "truncated_turns": sum(1 for turn in turns if turn.get("truncated")),
        "ref_trajectory": refs,
        "ref_rebounds": rebounds,
        "repeated_move_turns": repeated,
        "turns_before_first_move": first_move_turn,
        "d_face_done_turn": d_face_turn,
        "d_face_elapsed_ms": d_face_ms,
        "d_face_share": (
            round(d_face_ms / wall_ms, 3) if d_face_ms and wall_ms else None
        ),
        "last_phase": last_phase,
        "thinking_turns": sum(1 for turn in turns if turn.get("thinking")),
        "empty_thinking_turns": sum(
            1 for turn in turns if not turn.get("thinking")
        ),
        "moves_per_turn": [
            sum(len(batch or []) for batch in turn.get("applied_moves") or [])
            for turn in turns
        ],
        "completion_tokens_per_turn": [
            turn.get("completion_tokens") for turn in turns
        ],
    }


def compact_turns(record: dict) -> list[dict]:
    rows: list[dict] = []
    for index, turn in enumerate(record.get("turns") or [], 1):
        rows.append(
            {
                "turn": index,
                "tools": turn.get("tools") or [],
                "moves": [
                    move
                    for batch in turn.get("applied_moves") or []
                    for move in (batch or [])
                ],
                "ref_after": turn.get("ref_after"),
                "phase": turn.get("phase"),
                "thinking_chars": len(turn.get("thinking") or ""),
                "elapsed_ms": turn.get("elapsed_ms"),
                "completion_tokens": turn.get("completion_tokens"),
                "truncated": turn.get("truncated"),
                "moves_used_at_start": turn.get("moves_used_at_start"),
            }
        )
    return rows


def group_summary(episodes: list[dict]) -> dict[str, Any]:
    def stats(values: list[float]) -> dict[str, Any]:
        clean = [value for value in values if value is not None]
        if not clean:
            return {"n": 0, "median": None, "max": None, "min": None}
        return {
            "n": len(clean),
            "median": round(statistics.median(clean), 1),
            "max": round(max(clean), 1),
            "min": round(min(clean), 1),
        }

    solved = sum(1 for ep in episodes if ep["solved"])
    statuses: dict[str, int] = {}
    codes: dict[str, int] = {}
    phases: dict[str, int] = {}
    for ep in episodes:
        statuses[ep["status"]] = statuses.get(ep["status"], 0) + 1
        code = ep.get("failure_code") or "-"
        codes[code] = codes.get(code, 0) + 1
        phase = (ep.get("behavior") or {}).get("last_phase") or "-"
        phases[phase] = phases.get(phase, 0) + 1
    return {
        "episodes": len(episodes),
        "solved": solved,
        "solve_rate": round(solved / len(episodes), 3) if episodes else None,
        "statuses": statuses,
        "failure_codes": codes,
        "last_phases": phases,
        "moves_used": stats([ep.get("moves_used") for ep in episodes]),
        "wall_clock_s": stats([ep.get("wall_clock_s") for ep in episodes]),
        "turns": stats([ep.get("turns_total") for ep in episodes]),
        "thinking_chars_median": stats(
            [ep.get("thinking_chars_median") for ep in episodes]
        ),
        "thinking_chars_max": stats(
            [ep.get("thinking_chars_max") for ep in episodes]
        ),
    }


async def run(args: argparse.Namespace) -> int:
    db_path = Path(args.db)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    log(f"db {db_path}")
    log(f"out {out_dir}")
    log(f"pid {os.getpid()}")

    pool = read_source_pool(Path(args.source_db))
    plan = parse_plan(args.plan)
    missing = [key for key, _ in plan if key not in pool]
    if missing:
        raise SystemExit(f"task keys not found in source db: {missing}")
    log(f"source pool {len(pool)} tasks: {sorted(pool)}")

    db = Database(db_path)
    db.initialize()
    journal = EventJournal(out_dir)
    events = RunEventBus(journal)
    vsp.ACTIVE.update(
        {"bus": events, "journal": journal, "db": db, "finished": False}
    )
    atexit.register(vsp._atexit)
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, vsp._signal)
        except (ValueError, OSError):
            pass

    imported: dict[str, Benchmark] = {}
    for key, _ in plan:
        bench, _task = pool[key]
        if bench.id in imported:
            continue
        save_benchmark(db, bench, {"source": "data/mofang.db", "baseline": True})
        imported[bench.id] = bench
        log(
            f"imported benchmark {bench.id} cube={bench.cube} "
            f"tasks={[t.id for t in bench.tasks]}"
        )

    cfg = vsp.load_provider_config(Path(args.source_db), args.provider)
    provider = create_provider(
        db,
        name=f"{cfg['name']}-baseline-none",
        base_url=cfg["base_url"],
        model=cfg["model"],
        api_key_ref="",
        api_key=cfg["api_key"],
        params={
            "temperature": 0,
            "extra": {},
            "retry_delay": args.retry_delay,
            "stream": True,
        },
    )
    log(f"provider {provider.id} {provider.model} retry_delay={args.retry_delay}")

    solver_factory = make_solver_factory(
        ROOT / "data" / "cache" / "2x2_distances.pkl"
    )
    service = RunService(
        db,
        events,
        lambda record: build_adapter(record),
        solver_factory,
        max_parallel_episodes=1,
    )

    runs_out: list[dict] = []
    attempt = 0
    for key, repeats in plan:
        bench, task = pool[key]
        budget = asdict(budget_for(bench.cube, {}, skill="none"))
        log(
            f"task {key} cube={bench.cube} depth={task.scramble_depth} "
            f"ref={task.reference_length} repeats={repeats} budget={budget}"
        )
        for repeat in range(1, repeats + 1):
            attempt += 1
            run_id = create_run(
                db,
                provider_id=provider.id,
                benchmark_id=bench.id,
                tool_mode="both",
                prompt_version="v1",
                params={},
                budget=budget,
                task_keys=[key],
                require_plan=False,
                solver="off",
                skill="none",
            )
            vsp.ACTIVE.update({"run_id": run_id, "finished": False})
            log(f"=== RUN {attempt} task={key} rep={repeat} {run_id} ===")
            service.start(run_id)

            printed = 0
            while True:
                current = get_run(db, run_id)
                history = [_as_dict(event) for event in events.history(run_id)]
                for event in history[printed:]:
                    if event["type"] == "thinking.delta":
                        continue
                    log(f"  ev#{event['id']} {vsp.describe(event)}")
                printed = len(history)
                if current is None or current["status"] not in (
                    "queued",
                    "running",
                ):
                    break
                await asyncio.sleep(2)

            await service.wait(run_id)
            final_run = get_run(db, run_id)
            vsp.ACTIVE.update({"finished": True, "run_id": None})
            history = [_as_dict(event) for event in events.history(run_id)]
            for event in history[printed:]:
                if event["type"] == "thinking.delta":
                    continue
                log(f"  ev#{event['id']} {vsp.describe(event)}")

            episodes = [
                vsp.episode_record(
                    db,
                    ep,
                    [
                        item
                        for item in history
                        if item.get("episode_id") == ep["id"]
                    ],
                    key,
                    task.state,
                    "none",
                )
                for ep in get_run_episodes(db, run_id)
            ]
            for record in episodes:
                record["behavior"] = behavior_metrics(record)
                record["turn_rows"] = compact_turns(record)
            runs_out.append(
                {
                    "attempt": attempt,
                    "run_id": run_id,
                    "task_key": key,
                    "cube": bench.cube,
                    "depth": task.scramble_depth,
                    "repeat": repeat,
                    "reference_length": task.reference_length,
                    "benchmark_id": bench.id,
                    "skill": "none",
                    "solver": "off",
                    "require_plan": False,
                    "budget": budget,
                    "status": final_run["status"] if final_run else None,
                    "error": final_run["error"] if final_run else None,
                    "started_at": final_run["started_at"] if final_run else None,
                    "finished_at": final_run["finished_at"] if final_run else None,
                    "episodes": episodes,
                }
            )
            record = episodes[0] if episodes else {}
            log(
                f"run {attempt} task={key} status="
                f"{final_run['status'] if final_run else None} "
                f"solved={record.get('solved')} moves={record.get('moves_used')} "
                f"wall={record.get('wall_clock_s')}s "
                f"refs={(record.get('behavior') or {}).get('ref_trajectory')}"
            )

    episodes_all = [ep for run in runs_out for ep in run.get("episodes") or []]
    groups: dict[str, dict] = {}
    for run in runs_out:
        label = f"{run['cube']}-d{run['depth']}"
        groups.setdefault(label, {"runs": []})["runs"].append(run)
    grouped = {
        label: group_summary([ep for run in item["runs"] for ep in run["episodes"]])
        for label, item in groups.items()
    }
    by_cube = {
        cube: group_summary(
            [ep for run in runs_out if run["cube"] == cube for ep in run["episodes"]]
        )
        for cube in sorted({run["cube"] for run in runs_out})
    }
    report = {
        "generated_at": now_iso(),
        "db_path": str(db_path),
        "out_dir": str(out_dir),
        "pid": os.getpid(),
        "source_db": str(args.source_db),
        "provider": {
            "id": provider.id,
            "name": provider.name,
            "base_url": provider.base_url,
            "model": provider.model,
        },
        "skill": "none",
        "solver": "off",
        "require_plan": False,
        "plan": [
            {"task_key": key, "repeats": repeats} for key, repeats in plan
        ],
        "pool": {
            key: {
                "benchmark_id": bench.id,
                "cube": bench.cube,
                "depth": task.scramble_depth,
                "reference_length": task.reference_length,
            }
            for key, (bench, task) in sorted(pool.items())
        },
        "summary": group_summary(episodes_all),
        "by_group": grouped,
        "by_cube": by_cube,
        "runs": runs_out,
    }
    report_path = out_dir / "report.json"
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    log(f"SUMMARY {json.dumps(report['summary'], ensure_ascii=False)}")
    log(f"REPORT {report_path}")
    return 0


def _as_dict(event) -> dict:
    return {
        "id": event.id,
        "type": event.type,
        "run_id": event.run_id,
        "episode_id": event.episode_id,
        "ts": event.ts,
        "data": event.data,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default="")
    parser.add_argument("--out", default="")
    parser.add_argument("--source-db", default=str(ROOT / "data" / "mofang.db"))
    parser.add_argument("--provider", default="dots")
    parser.add_argument("--retry-delay", type=float, default=2.0)
    parser.add_argument("--plan", default=DEFAULT_PLAN)
    parser.add_argument("--log-file", default="")
    parser.add_argument("--summarize-events", default="")
    args = parser.parse_args()
    if args.summarize_events:
        return vsp.summarize_events(Path(args.summarize_events))
    if not args.db or not args.out:
        parser.error("--db and --out are required when running")
    if args.log_file:
        handle = open(args.log_file, "a", encoding="utf-8", buffering=1)
        sys.stdout = handle
        sys.stderr = handle
    try:
        return asyncio.run(run(args))
    except BaseException as exc:
        vsp._abort_active(f"unhandled {type(exc).__name__}: {exc}")
        raise


if __name__ == "__main__":
    raise SystemExit(main())
