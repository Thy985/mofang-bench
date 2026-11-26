r"""2x2 Ortega skill pack 验跑（独立进程、逐条落盘、可崩溃复盘）。

启动示例（Windows PowerShell，独立进程，母进程退出不影响它）：

  $ts = Get-Date -Format 'yyyyMMdd-HHmmss'
  $root = 'd:\Projects\Archive\mofang'
  $out = Join-Path $root "data\reports\verify-skill-pack-$ts"
  New-Item -ItemType Directory -Force -Path $out | Out-Null
  $p = Start-Process -FilePath (Join-Path $root '.venv\Scripts\python.exe') `
    -ArgumentList @('-u', (Join-Path $root 'scripts\verify_skill_pack.py'),
      '--db', "data\verify-skill-pack-$ts.db", '--out', $out) `
    -WorkingDirectory $root -RedirectStandardOutput (Join-Path $out 'runner.log') `
    -RedirectStandardError (Join-Path $out 'runner.err.log') -PassThru
  $p.Id

停止：Stop-Process -Id <pid> -Force

崩溃复盘（不需要 report.json）：

  .venv\Scripts\python.exe scripts\verify_skill_pack.py --summarize-events `
    data\reports\verify-skill-pack-<ts>\events-<run_id>.jsonl
"""

from __future__ import annotations

import argparse
import asyncio
import atexit
import json
import os
import re
import signal
import sqlite3
import statistics
import sys
import time
import traceback
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from mofang.api.events import EventJournal, RunEventBus
from mofang.cube.state import CubeState
from mofang.runner.stage import probe as stage_probe
from mofang.service.factory import (
    build_adapter,
    budget_for,
    make_solver_factory,
)
from mofang.service.runs import RunService
from mofang.store.benchmarks import get_benchmark, save_benchmark
from mofang.store.db import Database
from mofang.store.providers import create_provider, get_provider
from mofang.store.runs import (
    create_run,
    fail_running_episodes,
    get_run,
    get_run_episodes,
    get_steps,
    list_runs,
    set_run_status,
)
from mofang.tasks.generator import generate_benchmark

OPPOSITE = {
    "white": "yellow",
    "yellow": "white",
    "red": "orange",
    "orange": "red",
    "green": "blue",
    "blue": "green",
}

COLOR_RE = re.compile(
    r"目标色[^。\n]{0,24}?(white|yellow|red|orange|green|blue)"
)
NARRATION_RE = re.compile(
    r"[^。\n]{0,60}(我数到|数到\s*[0-9Xx]+\s*个|bar\s*在|所以用第)[^。\n]{0,80}"
)
OLL_CHECK_RE = re.compile(
    r"OLL check:\s*same_color_corners=(\d+),\s*bar=([A-Za-z]+),\s*branch=(\d+)"
)
# 本批 pack 只要求一句结论：`n=<X>, bar=<面> → 第 <k> 条`
OLL_CONCLUSION_RE = re.compile(
    r"n=(\d+),\s*bar=([A-Za-z]+)\s*→\s*第\s*(\d+)\s*条"
)
OLL_AFTER_RE = re.compile(
    r"OLL after:\s*same_color_corners=(\d+),\s*delta=([+-]?\d+|0),\s*next=([A-Za-z]+)"
)


def parse_oll_lines(blob: str) -> tuple[list[dict], list[dict]]:
    checks = [
        {
            "n": int(m.group(1)),
            "bar": m.group(2).lower(),
            "branch": int(m.group(3)),
            "raw": m.group(0),
            "format": "oll_check",
        }
        for m in OLL_CHECK_RE.finditer(blob)
    ]
    checks.extend(
        {
            "n": int(m.group(1)),
            "bar": m.group(2).lower(),
            "branch": int(m.group(3)),
            "raw": m.group(0),
            "format": "conclusion",
        }
        for m in OLL_CONCLUSION_RE.finditer(blob)
    )
    afters = [
        {
            "n": int(m.group(1)),
            "delta": int(m.group(2)),
            "next": m.group(3).lower(),
            "raw": m.group(0),
        }
        for m in OLL_AFTER_RE.finditer(blob)
    ]
    return checks, afters


def oll_actual(state_json: dict | None, skill: str) -> dict | None:
    if not state_json:
        return None
    report = stage_probe(CubeState.from_json(state_json), skill)
    return {
        "target_color": report.u_target,
        "same_color_corners": report.u_counts.get(report.u_target or "", 0),
        "u_face_counts": dict(report.u_counts),
        "bar_faces": list(report.bar_faces),
        "phase": report.phase,
    }

ACTIVE: dict[str, Any] = {"run_id": None, "bus": None, "finished": False}


def log(message: str) -> None:
    stamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{stamp}] {message}", flush=True)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _elapsed_ms(start_ts: str | None, end_ts: str | None) -> int | None:
    if not start_ts or not end_ts:
        return None
    try:
        start = datetime.fromisoformat(start_ts)
        end = datetime.fromisoformat(end_ts)
    except ValueError:
        return None
    return int((end - start).total_seconds() * 1000)


def _face_uniform(state: CubeState, name: str) -> bool:
    grid = state.face(name)
    first = grid[0][0]
    return all(color == first for row in grid for color in row)


def _bar_count(state: CubeState, layer: str) -> int | None:
    if state.size != 2:
        return None
    row = 0 if layer == "U" else state.size - 1
    bars = 0
    for name in ("R", "F", "L", "B"):
        grid = state.face(name)
        if grid[row][0] == grid[row][1]:
            bars += 1
    return bars


def probe_state(state_json: dict, size: int) -> dict:
    state = CubeState.from_json(state_json)
    d_color = state.face("D")[0][0].value
    u_target = OPPOSITE[d_color]
    u_cells = [c.value for row in state.face("U") for c in row]
    probe = {
        "d_uniform": _face_uniform(state, "D"),
        "u_uniform": _face_uniform(state, "U"),
        "solved": state.is_solved(),
        "d_color": d_color if _face_uniform(state, "D") else None,
        "u_target_color": u_target,
        "u_target_count": sum(1 for c in u_cells if c == u_target),
        "u_bars": _bar_count(state, "U"),
        "d_bars": _bar_count(state, "D"),
    }
    if probe["solved"]:
        probe["phase"] = "done"
    elif not probe["d_uniform"]:
        probe["phase"] = "1-D-face"
    elif not probe["u_uniform"]:
        probe["phase"] = "2-OLL"
    else:
        probe["phase"] = "3-PBL"
    return probe


def text_metrics(turns: list[dict]) -> dict:
    claims: list[dict] = []
    narrations: list[dict] = []
    for index, turn in enumerate(turns, 1):
        blob = (turn.get("thinking") or "") + "\n" + (turn.get("content") or "")
        for match in COLOR_RE.finditer(blob):
            claims.append(
                {"turn": index, "color": match.group(1), "snippet": match.group(0)}
            )
        for match in NARRATION_RE.finditer(blob):
            snippet = match.group(0).strip()
            if snippet and snippet not in [n["snippet"] for n in narrations]:
                narrations.append({"turn": index, "snippet": snippet[:200]})
    return {"target_color_mentions": claims, "narration_snippets": narrations}


def build_turns(
    events: list[dict], size: int = 2, initial_state: dict | None = None
) -> list[dict]:
    turns: list[dict] = []
    current: dict | None = None
    last_completion = 0
    last_state = initial_state
    for event in events:
        kind = event["type"]
        data = event.get("data") or {}
        if kind == "model.turn.started":
            if current is not None:
                turns.append(current)
            current = {
                "finish_reason": None,
                "tool_calls": 0,
                "tools": [],
                "tool_args": [],
                "truncated": False,
                "completion_tokens": None,
                "completion_tokens_cumulative": None,
                "content": "",
                "thinking": "",
                "moves_used_at_start": data.get("moves_used"),
                "applied_moves": [],
                "ref_after": None,
                "phase": None,
                "probes": [],
                "state_before": last_state,
                "oll_checks": [],
                "oll_afters": [],
                "stage_broken": [],
                "tool_results": [],
                "started_ts": event.get("ts"),
                "message_ts": None,
                "elapsed_ms": None,
                "probe_calls": 0,
                "probe_return": None,
                "landings": [],
                "blocked_landings": [],
                "oll_delta": [],
            }
        elif current is None:
            continue
        elif kind == "model.message":
            current["finish_reason"] = data.get("finish_reason")
            current["tool_calls"] = data.get("tool_calls")
            cumulative = (data.get("usage") or {}).get("completion_tokens") or 0
            current["completion_tokens_cumulative"] = cumulative
            current["completion_tokens"] = max(0, cumulative - last_completion)
            last_completion = cumulative
            current["content"] = data.get("content") or ""
            current["thinking"] = data.get("thinking") or ""
            current["message_ts"] = event.get("ts")
            current["elapsed_ms"] = _elapsed_ms(
                current.get("started_ts"), current.get("message_ts")
            )
            blob = (current["thinking"] or "") + "\n" + (current["content"] or "")
            checks, afters = parse_oll_lines(blob)
            current["oll_checks"] = checks
            current["oll_afters"] = afters
        elif kind == "tool.call":
            tool = data.get("tool")
            current["tools"].append(tool)
            current["tool_args"].append(
                {"tool": tool, "arguments": data.get("arguments")}
            )
            if tool in ("turn", "apply_moves"):
                current["landings"].append(
                    {"tool": tool, "after_probe": current["probe_calls"] > 0}
                )
            elif tool == "probe_oll":
                current["probe_calls"] += 1
        elif kind == "tool.result":
            payload = data.get("payload") or {}
            current["tool_results"].append(
                {"tool": data.get("tool"), "payload": payload}
            )
            if payload.get("stage_broken"):
                current["stage_broken"].append(payload["stage_broken"])
            if payload.get("oll_delta"):
                current["oll_delta"].append(payload["oll_delta"])
            if data.get("tool") == "probe_oll" and payload.get("ok"):
                current["probe_return"] = payload
            if payload.get("error") == "probe_oll_required":
                current["blocked_landings"].append(payload)
        elif kind == "model.truncated":
            current["truncated"] = True
        elif kind == "move.applied":
            current["applied_moves"].append(data.get("moves"))
            current["ref_after"] = data.get("reference_length_after")
            if data.get("state"):
                last_state = data["state"]
                probe = probe_state(data["state"], size)
                current["phase"] = probe["phase"]
                current["probes"].append(probe)
        elif kind == "model.finished":
            current["finish_reason"] = current["finish_reason"]
    if current is not None:
        turns.append(current)
    return turns


def parse_events_file(path: Path) -> tuple[list[dict], int]:
    events: list[dict] = []
    malformed = 0
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            malformed += 1
    return events, malformed


def summarize_events(target: Path) -> int:
    paths = (
        sorted(target.glob("events-*.jsonl"))
        if target.is_dir()
        else [target]
    )
    for path in paths:
        events, malformed = parse_events_file(path)
        turns = build_turns(events)
        print(f"== {path.name}: {len(events)} events, malformed={malformed} ==")
        print(
            "turn\ttools\tmoves\tused\tref_after\tphase\tcompletion\tthinking"
            "\telapsed_ms\tprobe\tblocked\ttruncated"
        )
        for index, turn in enumerate(turns, 1):
            applied = [m for batch in turn["applied_moves"] for m in (batch or [])]
            print(
                "\t".join(
                    str(value)
                    for value in (
                        index,
                        ",".join(str(t) for t in turn["tools"]) or "-",
                        " ".join(applied) or "-",
                        turn["moves_used_at_start"],
                        turn["ref_after"],
                        turn["phase"],
                        turn["completion_tokens"],
                        len(turn["thinking"] or ""),
                        turn["elapsed_ms"],
                        turn["probe_calls"],
                        len(turn["blocked_landings"]),
                        turn["truncated"],
                    )
                )
            )
            for check in turn["oll_checks"]:
                print(f"   t{index} {check['raw']}")
            for after in turn["oll_afters"]:
                print(f"   t{index} {after['raw']}")
            for receipt in turn["oll_delta"]:
                print(
                    f"   t{index} oll_delta before={receipt.get('before')} "
                    f"after={receipt.get('after')} delta={receipt.get('delta')} "
                    f"phase_after={receipt.get('phase_after')}"
                )
            for blocked in turn["blocked_landings"]:
                print(f"   t{index} blocked: {blocked.get('detail')}")
            for broken in turn["stage_broken"]:
                print(
                    f"   t{index} stage_broken={broken.get('stage')} "
                    f"established_turn={broken.get('established_turn')} "
                    f"-> {broken.get('current_phase')}"
                )
        metrics = text_metrics(turns)
        if metrics["target_color_mentions"]:
            print("target_color_mentions:")
            for item in metrics["target_color_mentions"]:
                print(f"  t{item['turn']}: {item['snippet']}")
        if metrics["narration_snippets"]:
            print("narration_snippets:")
            for item in metrics["narration_snippets"]:
                print(f"  t{item['turn']}: {item['snippet']}")
        repeats = [
            index
            for index in range(1, len(turns))
            if turns[index - 1]["applied_moves"]
            and turns[index]["applied_moves"] == turns[index - 1]["applied_moves"]
        ]
        print(f"repeated_apply_moves_turns: {repeats}")
        if not turns:
            print("no completed model turns")
    return 0


def _abort_active(reason: str) -> None:
    run_id = ACTIVE.get("run_id")
    bus = ACTIVE.get("bus")
    if ACTIVE.get("finished") or not run_id or bus is None:
        return
    try:
        bus.publish(run_id, "run.aborted", {"reason": reason})
    except Exception:
        traceback.print_exc()
    db = ACTIVE.get("db")
    try:
        if db is not None:
            fail_running_episodes(db, run_id, reason)
            set_run_status(db, run_id, "failed", error=reason, finished=True)
    except Exception:
        traceback.print_exc()


def _atexit() -> None:
    _abort_active("process exited before run.finished")
    journal = ACTIVE.get("journal")
    if journal is not None:
        journal.close()


def _signal(signum, frame) -> None:
    _abort_active(f"signal {signum}")
    os._exit(128 + int(signum))


def load_provider_config(source_db: Path, name: str) -> dict:
    conn = sqlite3.connect(f"file:{source_db}?mode=ro", uri=True)
    try:
        row = conn.execute(
            "select name, base_url, model, api_key, params_json "
            "from providers where name = ? order by rowid desc limit 1",
            (name,),
        ).fetchone()
    finally:
        conn.close()
    if row is None:
        raise SystemExit(f"provider {name!r} not found in {source_db}")
    return {
        "name": row[0],
        "base_url": row[1],
        "model": row[2],
        "api_key": row[3] or "",
        "params": json.loads(row[4] or "{}"),
    }


def oll_consistency(turns: list[dict], skill: str) -> list[dict]:
    """把模型自述的 OLL 计数与工具层真实计数逐条对比。"""
    records: list[dict] = []
    for index, turn in enumerate(turns, 1):
        actual = oll_actual(turn.get("state_before"), skill)
        for check in turn.get("oll_checks") or []:
            if actual is None:
                records.append(
                    {"turn": index, "declared": check, "actual": None,
                     "match": None, "raw": check["raw"]}
                )
                continue
            same = check["n"] == actual["same_color_corners"]
            bar_ok = (
                (check["bar"] == "none" and not actual["bar_faces"])
                or check["bar"].upper() in actual["bar_faces"]
            )
            lenient = check["n"] in actual["u_face_counts"].values()
            records.append(
                {
                    "turn": index,
                    "declared": check,
                    "actual": actual,
                    "match": bool(same and bar_ok),
                    "lenient_match": bool(lenient),
                    "raw": check["raw"],
                }
            )
        receipts = turn.get("oll_delta") or []
        for after in turn.get("oll_afters") or []:
            receipt = receipts[-1] if receipts else None
            match = None
            if receipt is not None:
                match = (
                    after["delta"] == receipt.get("delta")
                    and after["n"] == receipt.get("after")
                )
            records.append(
                {
                    "turn": index,
                    "declared": after,
                    "actual": receipt,
                    "match": match,
                    "raw": after["raw"],
                    "kind": "after",
                }
            )
    return records


def episode_record(
    db,
    ep: dict,
    ep_events: list[dict],
    task_key: str,
    initial_state: dict | None = None,
    skill: str = "ortega",
) -> dict:
    steps = get_steps(db, ep["id"])
    turns = build_turns(ep_events, initial_state=initial_state)
    checks = oll_consistency(turns, skill)
    checked = [item for item in checks if item.get("kind") is None and item["match"] is not None]
    consistent = [item for item in checked if item["match"]]
    afters = [item for item in checks if item.get("kind") == "after"]
    after_checked = [item for item in afters if item["match"] is not None]
    thinking = [len(turn.get("thinking") or "") for turn in turns]
    elapsed = [
        turn.get("elapsed_ms")
        for turn in turns
        if turn.get("elapsed_ms") is not None
    ]
    landings = [item for turn in turns for item in turn.get("landings") or []]
    after_probe = [item for item in landings if item["after_probe"]]
    return {
        "episode_id": ep["id"],
        "task_key": task_key,
        "status": ep["status"],
        "solved": ep["solved"],
        "moves_used": ep["moves_used"],
        "reference_length": ep["reference_length"],
        "tokens_in": ep["tokens_in"],
        "tokens_out": ep["tokens_out"],
        "latency_ms": ep["latency_ms"],
        "wall_clock_s": round((ep["latency_ms"] or 0) / 1000, 1),
        "failure_code": ep["failure_code"],
        "error": ep["error"],
        "steps_count": len(steps),
        "turns": turns,
        "text_metrics": text_metrics(turns),
        "oll_consistency": checks,
        "oll_checks_total": len(checked),
        "oll_checks_consistent": len(consistent),
        "oll_after_total": len(afters),
        "oll_after_consistent": sum(1 for item in after_checked if item["match"]),
        "thinking_chars": thinking,
        "thinking_chars_total": sum(thinking),
        "thinking_chars_median": statistics.median(thinking) if thinking else None,
        "thinking_chars_max": max(thinking) if thinking else None,
        "turn_elapsed_ms": elapsed,
        "turn_elapsed_ms_median": (
            statistics.median(elapsed) if elapsed else None
        ),
        "turn_elapsed_ms_max": max(elapsed) if elapsed else None,
        "probe_calls_total": sum(turn.get("probe_calls") or 0 for turn in turns),
        "landings_total": len(landings),
        "landings_after_probe": len(after_probe),
        "landings_before_probe": len(landings) - len(after_probe),
        "blocked_landing_total": sum(
            len(turn.get("blocked_landings") or []) for turn in turns
        ),
        "oll_delta_total": sum(len(turn.get("oll_delta") or []) for turn in turns),
        "turns_total": len(turns),
        "oll_line_turns": sum(
            1
            for turn in turns
            if turn.get("oll_checks") or turn.get("oll_afters")
        ),
        "zero_move": ep["moves_used"] == 0,
        "stage_broken_count": sum(len(t["stage_broken"]) for t in turns),
    }


def aggregate_summary(runs_out: list[dict]) -> dict:
    """把逐轮样本汇成回答假设所需的中位数/最大值/拦截次数。"""
    episodes = [
        ep for run in runs_out for ep in run.get("episodes") or []
    ]
    thinking = [
        n for ep in episodes for n in ep.get("thinking_chars") or []
    ]
    elapsed = [
        n for ep in episodes for n in ep.get("turn_elapsed_ms") or []
    ]
    solved = sum(1 for ep in episodes if ep.get("solved"))
    return {
        "runs": len(runs_out),
        "episodes": len(episodes),
        "solved": solved,
        "solve_rate": round(solved / len(episodes), 3) if episodes else None,
        "thinking_chars_median": (
            statistics.median(thinking) if thinking else None
        ),
        "thinking_chars_max": max(thinking) if thinking else None,
        "turn_elapsed_ms_median": (
            statistics.median(elapsed) if elapsed else None
        ),
        "turn_elapsed_ms_max": max(elapsed) if elapsed else None,
        "probe_calls_total": sum(
            ep.get("probe_calls_total") or 0 for ep in episodes
        ),
        "blocked_landing_total": sum(
            ep.get("blocked_landing_total") or 0 for ep in episodes
        ),
        "landings_after_probe": sum(
            ep.get("landings_after_probe") or 0 for ep in episodes
        ),
        "landings_before_probe": sum(
            ep.get("landings_before_probe") or 0 for ep in episodes
        ),
        "oll_delta_total": sum(
            ep.get("oll_delta_total") or 0 for ep in episodes
        ),
        "turns_total": sum(ep.get("turns_total") or 0 for ep in episodes),
        "oll_line_turns": sum(
            ep.get("oll_line_turns") or 0 for ep in episodes
        ),
        "zero_move_runs": sum(
            1 for ep in episodes if ep.get("zero_move")
        ),
        "moves_used": [ep.get("moves_used") for ep in episodes],
        "wall_clock_s": [ep.get("wall_clock_s") for ep in episodes],
        "statuses": [ep.get("status") for ep in episodes],
        "failure_codes": [ep.get("failure_code") for ep in episodes],
    }


def load_run_out(
    db,
    run: dict,
    attempt: int,
    out_dir: Path,
    task_key: str,
    initial_state: dict | None = None,
) -> dict:
    """从 DB + events 前缀重建一次已完成（或崩溃中止）的 run。"""
    run_id = run["id"]
    event_file = out_dir / f"events-{run_id}.jsonl"
    ev, malformed = parse_events_file(event_file) if event_file.exists() else ([], 0)
    published = next(
        (
            (item.get("data") or {}).get("status")
            for item in reversed(ev)
            if item["type"] == "run.finished"
        ),
        None,
    )
    episodes = get_run_episodes(db, run_id)
    return {
        "attempt": attempt,
        "run_id": run_id,
        "benchmark_id": run["benchmark_id"],
        "skill": run["skill"],
        "solver": run["solver"],
        "budget": run["budget"],
        "recovered": True,
        "events_file": str(event_file),
        "events_count": len(ev),
        "malformed_events": malformed,
        "status": published or run["status"],
        "db_status": run["status"],
        "published_status": published,
        "error": run["error"],
        "started_at": run["started_at"],
        "finished_at": run["finished_at"],
        "episodes": [
            episode_record(
                db,
                ep,
                [item for item in ev if item.get("episode_id") == ep["id"]],
                task_key,
                initial_state,
                run["skill"],
            )
            for ep in episodes
        ],
    }


async def run(args: argparse.Namespace) -> int:
    db_path = Path(args.db)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    log(f"db {db_path}")
    log(f"out {out_dir}")
    log(f"pid {os.getpid()}")

    db = Database(db_path)
    db.initialize()
    journal = EventJournal(out_dir)
    events = RunEventBus(journal)
    ACTIVE.update(
        {"bus": events, "journal": journal, "db": db, "finished": False}
    )

    solver_factory = make_solver_factory(
        ROOT / "data" / "cache" / "2x2_distances.pkl"
    )
    prior_runs: list[dict] = []
    if args.resume:
        # 复用同库已有的 benchmark/provider，只补跑缺失的那几次。
        prior_runs = [
            run
            for run in list_runs(db)
            if run["skill"] == args.skill and run["solver"] == "off"
        ]
        prior_runs.reverse()  # list_runs 是倒序，这里按 created_at 正序重放
        if not prior_runs:
            raise SystemExit("--resume: no prior run in db")
        bench = get_benchmark(db, prior_runs[0]["benchmark_id"])
        provider = get_provider(db, prior_runs[0]["provider_id"])
        if bench is None or provider is None:
            raise SystemExit("--resume: benchmark/provider row missing")
        log(f"resume provider {provider.id} {provider.model}")
        log(f"resume benchmark {bench.id} runs={len(prior_runs)}")
    else:
        cfg = load_provider_config(Path(args.source_db), args.provider)
        # 与上批验跑保持同一组参数：不继承 source provider 的 max_tokens（16384），
        # 让 adapter 用默认 32000，避免长 pack 在首轮就撞 length 截断。
        params = {
            "temperature": 0,
            "extra": {},
            "retry_delay": args.retry_delay,
            "stream": True,
        }
        provider = create_provider(
            db,
            name=f"{cfg['name']}-{args.skill}-verify",
            base_url=cfg["base_url"],
            model=cfg["model"],
            api_key_ref="",
            api_key=cfg["api_key"],
            params=params,
        )
        log(f"provider {provider.id} {provider.model} retry_delay={args.retry_delay}")
        log(f"generating benchmark cube=2x2 depth=5 per_depth=2 seed=42")
        solver = solver_factory("2x2")
        try:
            bench = generate_benchmark(
                name=f"verify-skill-pack-{args.skill}",
                cube="2x2",
                depths=[5],
                per_depth=2,
                seed=42,
                solver=solver,
            )
        finally:
            close = getattr(solver, "close", None)
            if close:
                close()
        bench.content_hash = bench.compute_hash()
        save_benchmark(db, bench, {"task_keys": [args.task_key]})

    task = next((item for item in bench.tasks if item.id == args.task_key), None)
    if task is None:
        raise SystemExit(f"task {args.task_key} not found in benchmark")
    log(
        f"benchmark {bench.id} task={task.id} ref={task.reference_length} "
        f"scramble={task.scramble}"
    )

    def provider_factory(record):
        return build_adapter(record)

    service = RunService(
        db, events, provider_factory, solver_factory, max_parallel_episodes=1
    )
    budget = asdict(budget_for(bench.cube, {}, skill=args.skill))
    log(f"budget {budget}")

    runs_out: list[dict] = []
    done = 0
    for prior in prior_runs:
        done += 1
        runs_out.append(load_run_out(db, prior, done, out_dir, task.id, task.state))
        log(f"loaded prior run {done} {prior['id']} status={prior['status']}")
    for attempt in range(done + 1, args.runs + 1):
        run_id = create_run(
            db,
            provider_id=provider.id,
            benchmark_id=bench.id,
            tool_mode="both",
            prompt_version="v1",
            params={},
            budget=budget,
            task_keys=[args.task_key],
            require_plan=False,
            solver="off",
            skill=args.skill,
        )
        ACTIVE.update({"run_id": run_id, "finished": False})
        log(f"=== RUN {attempt}/{args.runs} {run_id} ===")
        service.start(run_id)

        printed = 0
        while True:
            run = get_run(db, run_id)
            history = [_as_dict(event) for event in events.history(run_id)]
            for event in history[printed:]:
                if event["type"] == "thinking.delta":
                    continue
                log(f"  ev#{event['id']} {describe(event)}")
            printed = len(history)
            if run is None or run["status"] not in ("queued", "running"):
                break
            await asyncio.sleep(2)

        await service.wait(run_id)
        final_run = get_run(db, run_id)
        # run 在此刻已落终态：先解除崩溃收尾钩子，避免收尾逻辑把
        # 一次正常结束的 run 改写成 failed。
        ACTIVE.update({"finished": True, "run_id": None})
        history = [_as_dict(event) for event in events.history(run_id)]
        for event in history[printed:]:
            if event["type"] == "thinking.delta":
                continue
            log(f"  ev#{event['id']} {describe(event)}")

        episode_out = [
            episode_record(
                db,
                ep,
                [item for item in history if item["episode_id"] == ep["id"]],
                task.id,
                task.state,
                args.skill,
            )
            for ep in get_run_episodes(db, run_id)
        ]
        runs_out.append(
            {
                "attempt": attempt,
                "run_id": run_id,
                "benchmark_id": bench.id,
                "benchmark_hash": bench.content_hash,
                "skill": args.skill,
                "solver": "off",
                "budget": budget,
                "status": final_run["status"] if final_run else None,
                "error": final_run["error"] if final_run else None,
                "started_at": final_run["started_at"] if final_run else None,
                "finished_at": final_run["finished_at"] if final_run else None,
                "episodes": episode_out,
            }
        )
        ep = episode_out[0] if episode_out else {}
        log(
            f"run {attempt} status={final_run['status'] if final_run else None} "
            f"moves={ep.get('moves_used')} solved={ep.get('solved')} "
            f"refs={[t.get('ref_after') for t in ep.get('turns', [])]}"
        )

    report = {
        "generated_at": now_iso(),
        "db_path": str(db_path),
        "out_dir": str(out_dir),
        "pid": os.getpid(),
        "provider": {
            "id": provider.id,
            "name": provider.name,
            "base_url": provider.base_url,
            "model": provider.model,
        },
        "provider_params": provider.params,
        "skill": args.skill,
        "solver": "off",
        "task_key": args.task_key,
        "budget": budget,
        "runs": runs_out,
    }
    summary = aggregate_summary(runs_out)
    report["summary"] = summary
    log(f"SUMMARY {json.dumps(summary, ensure_ascii=False)}")
    report_path = out_dir / "report.json"
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
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


def describe(event: dict) -> str:
    kind = event["type"]
    data = event.get("data") or {}
    if kind == "model.message":
        usage = data.get("usage") or {}
        return (
            f"model.message finish={data.get('finish_reason')} "
            f"calls={data.get('tool_calls')} "
            f"thinking_len={len(data.get('thinking') or '')} "
            f"completion={usage.get('completion_tokens')}"
        )
    if kind == "tool.call":
        return f"tool.call tool={data.get('tool')} args={data.get('arguments')}"
    if kind == "tool.result":
        payload = data.get("payload") or {}
        return (
            f"tool.result tool={data.get('tool')} ok={data.get('ok')} "
            f"error={payload.get('error')} "
            f"moves={payload.get('moves') or payload.get('applied')}"
        )
    if kind == "move.applied":
        return (
            f"move.applied moves={data.get('moves')} "
            f"used={data.get('moves_used')} ref_after="
            f"{data.get('reference_length_after')}"
        )
    return f"{kind} {json.dumps(data, ensure_ascii=False)[:220]}"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default="")
    parser.add_argument("--out", default="")
    parser.add_argument("--runs", type=int, default=2)
    parser.add_argument("--task-key", default="2x2-5-2")
    parser.add_argument("--skill", default="ortega")
    parser.add_argument("--source-db", default=str(ROOT / "data" / "mofang.db"))
    parser.add_argument("--provider", default="dots")
    parser.add_argument("--retry-delay", type=float, default=2.0)
    parser.add_argument("--log-file", default="")
    parser.add_argument("--summarize-events", default="")
    parser.add_argument(
        "--resume",
        action="store_true",
        help="复用同库已有 benchmark/provider，只补跑缺失的 runs",
    )
    args = parser.parse_args()
    if args.summarize_events:
        return summarize_events(Path(args.summarize_events))
    if not args.db or not args.out:
        parser.error("--db and --out are required when running")
    if args.log_file:
        # 独立进程启动后没有控制台接管 stdout，这里自己写行缓冲日志。
        handle = open(args.log_file, "a", encoding="utf-8", buffering=1)
        sys.stdout = handle
        sys.stderr = handle
    atexit.register(_atexit)
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, _signal)
        except (ValueError, OSError):
            pass
    try:
        return asyncio.run(run(args))
    except BaseException as exc:
        _abort_active(f"unhandled {type(exc).__name__}: {exc}")
        raise


if __name__ == "__main__":
    raise SystemExit(main())
