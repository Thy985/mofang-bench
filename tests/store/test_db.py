import sqlite3
from pathlib import Path

from mofang.store.db import Database


def test_initialize_is_idempotent_and_uses_wal(tmp_path: Path) -> None:
    db = Database(tmp_path / "test.db")
    db.initialize()
    db.initialize()
    conn = db.connect()
    try:
        tables = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
        fk = conn.execute("PRAGMA foreign_keys").fetchone()[0]
    finally:
        conn.close()
    assert {
        "providers",
        "benchmarks",
        "tasks",
        "runs",
        "episodes",
        "steps",
        "artifacts",
    } <= tables
    assert mode.lower() == "wal"
    assert fk == 1


def test_initialize_migrates_providers_api_key_column(tmp_path: Path) -> None:
    path = tmp_path / "old.db"
    conn = sqlite3.connect(path)
    try:
        conn.execute(
            """
            CREATE TABLE providers (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              base_url TEXT NOT NULL,
              model TEXT NOT NULL,
              api_key_ref TEXT NOT NULL,
              params_json TEXT NOT NULL,
              created_at TEXT NOT NULL
            )
            """
        )
        conn.commit()
    finally:
        conn.close()
    db = Database(path)
    db.initialize()
    conn = db.connect()
    try:
        columns = {
            row["name"] for row in conn.execute("PRAGMA table_info(providers)")
        }
    finally:
        conn.close()
    assert "api_key" in columns


def test_initialize_backfills_skill_for_old_runs_and_episodes(tmp_path: Path) -> None:
    path = tmp_path / "old-skill.db"
    conn = sqlite3.connect(path)
    try:
        conn.execute(
            """
            CREATE TABLE runs (
              id TEXT PRIMARY KEY,
              provider_id TEXT NOT NULL,
              benchmark_id TEXT NOT NULL,
              tool_mode TEXT NOT NULL,
              prompt_version TEXT NOT NULL,
              params_json TEXT NOT NULL,
              budget_json TEXT NOT NULL,
              status TEXT NOT NULL,
              totals_json TEXT,
              error TEXT,
              created_at TEXT NOT NULL,
              started_at TEXT,
              finished_at TEXT,
              task_keys_json TEXT,
              require_plan INTEGER NOT NULL DEFAULT 0,
              solver TEXT NOT NULL DEFAULT 'off'
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE episodes (
              id TEXT PRIMARY KEY,
              run_id TEXT NOT NULL,
              task_id TEXT NOT NULL,
              status TEXT NOT NULL,
              solved INTEGER NOT NULL DEFAULT 0,
              moves_used INTEGER NOT NULL DEFAULT 0,
              reference_length INTEGER NOT NULL,
              efficiency REAL,
              progress_ratio REAL,
              invalid_calls INTEGER NOT NULL DEFAULT 0,
              protocol_errors INTEGER NOT NULL DEFAULT 0,
              provider_errors INTEGER NOT NULL DEFAULT 0,
              tokens_in INTEGER,
              tokens_out INTEGER,
              cost_usd REAL,
              latency_ms INTEGER,
              final_state_json TEXT NOT NULL,
              failure_code TEXT,
              error TEXT,
              started_at TEXT,
              finished_at TEXT,
              plan_json TEXT,
              solver TEXT NOT NULL DEFAULT 'off'
            )
            """
        )
        conn.execute(
            """
            INSERT INTO runs VALUES
              ('r1','p1','b1','both','v1','{}','{}','finished',
               NULL,NULL,'now',NULL,NULL,NULL,0,'assist')
            """
        )
        conn.execute(
            """
            INSERT INTO episodes VALUES
              ('e1','r1','t1','solved',1,1,1,1.0,1.0,0,0,0,
               10,10,0,100,'{}',NULL,NULL,'now','now',NULL,'assist')
            """
        )
        conn.commit()
    finally:
        conn.close()
    db = Database(path)
    db.initialize()
    conn = db.connect()
    try:
        run_skill = conn.execute("SELECT skill FROM runs").fetchone()["skill"]
        episode_skill = conn.execute(
            "SELECT skill FROM episodes"
        ).fetchone()["skill"]
    finally:
        conn.close()
    assert run_skill == "none"
    assert episode_skill == "none"


def test_transaction_rolls_back(tmp_path: Path) -> None:
    db = Database(tmp_path / "test.db")
    db.initialize()
    try:
        with db.transaction() as conn:
            conn.execute(
                """
                INSERT INTO providers
                  (id, name, base_url, model, api_key_ref,
                   params_json, created_at)
                VALUES (?,?,?,?,?,?,?)
                """,
                ("p1", "n", "http://x", "m", "KEY", "{}", "now"),
            )
            raise RuntimeError("boom")
    except RuntimeError:
        pass
    conn = db.connect()
    try:
        count = conn.execute("SELECT COUNT(*) FROM providers").fetchone()[0]
    finally:
        conn.close()
    assert count == 0
