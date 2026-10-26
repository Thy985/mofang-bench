from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

SCHEMA = """
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,
  api_key_ref TEXT NOT NULL,
  params_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS benchmarks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  kind TEXT NOT NULL,
  cube TEXT NOT NULL,
  config_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  frozen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  benchmark_id TEXT NOT NULL REFERENCES benchmarks(id) ON DELETE CASCADE,
  task_key TEXT NOT NULL,
  cube TEXT NOT NULL,
  scramble TEXT NOT NULL,
  scramble_depth INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  reference_length INTEGER NOT NULL,
  reference_kind TEXT NOT NULL,
  bin TEXT NOT NULL,
  UNIQUE (benchmark_id, task_key)
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id),
  benchmark_id TEXT NOT NULL REFERENCES benchmarks(id),
  tool_mode TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  params_json TEXT NOT NULL,
  budget_json TEXT NOT NULL,
  status TEXT NOT NULL,
  totals_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id),
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
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS steps (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  tool_name TEXT,
  args_json TEXT,
  result_json TEXT,
  state_json TEXT,
  reference_length_after INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_episodes_run ON episodes(run_id);
CREATE INDEX IF NOT EXISTS idx_steps_episode ON steps(episode_id, seq);
CREATE INDEX IF NOT EXISTS idx_tasks_benchmark_bin ON tasks(benchmark_id, bin);
"""


class Database:
    def __init__(self, path: Path) -> None:
        self.path = path

    def connect(self) -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.path, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def initialize(self) -> None:
        conn = self.connect()
        try:
            conn.executescript(SCHEMA)
            conn.commit()
        finally:
            conn.close()

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        conn = self.connect()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
