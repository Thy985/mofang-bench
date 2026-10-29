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
