# M2 API 工作台实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Plan 1 的 runner 之上增加本地 FastAPI + SQLite + SSE 服务，提供 provider/benchmark/run/episode API、实时事件、取消、快照、报告导出与同基准集对比，暂不做 React 前端。

**Architecture:** FastAPI 进程持有唯一真相源 SQLite；`RunService` 在事件循环中逐个执行 episode，调用 Plan 1 的 `EpisodeRunner`，把事件写入内存事件总线并通过 SSE 推送，把 episode 与步骤落库。Provider 密钥只存环境变量名，运行时解析。求解器沿用 2x2 表与 3x3 GPL 子进程。

**Tech Stack:** Python 3.12、FastAPI、uvicorn、SQLite（stdlib `sqlite3`）、pydantic 2、httpx、pytest、pytest-asyncio、Starlette TestClient。

**Spec:** `docs/superpowers/specs/2026-10-26-rubiks-cube-model-bench-design.md`（§4、§7、§8、§10、§11）

## Global Constraints

- 服务只绑 `127.0.0.1`；CORS 只允许 `http://127.0.0.1:5173` 与 `http://localhost:5173`。
- API key 不落库、不下发、不写日志；DB 只存环境变量名 `api_key_ref`，运行时从 `os.environ` 解析。
- 服务端是唯一真相源；所有走法状态以服务端 `state_json` 为准。
- 预算默认值：2x2 `max_moves=30, max_seconds=300, max_tool_calls=50, max_tokens=300000`；3x3 `100 / 900 / 150 / 1000000`；单轮 `turn_timeout=120`。
- 模型永远看不到参照解、参照长度、打乱序列或距离；`get_state` 只返回状态与预算。
- 不做跨难度加权总分；解出率带 Wilson 95% CI；对比只允许同一 `benchmark_id` 且 `content_hash` 一致。
- SQLite 使用 WAL、外键；索引 `episodes(run_id)`、`steps(episode_id, seq)`、`tasks(benchmark_id, bin)`。
- GPL 边界：`src/mofang/api/`、`src/mofang/service/`、`src/mofang/store/` 不得 `import twophase`；3x3 只用 `RubikTwoPhaseClient`。
- 所有新 HTTP 路径以 `/api` 开头；错误响应使用 `{"detail": ...}`。
- 测试不得访问真实网络；provider 一律通过工厂注入 `FakeProvider` 或 `respx`。

---

### Task 0: 本地堆叠分支与基线

**Files:**
- 无代码改动

**Interfaces:**
- Consumes: Plan 1 的 `plan/backend-core-cli` 分支（HEAD 含真实模型修复）
- Produces: 新分支 `plan/api-workbench`，后续任务都在此分支提交

- [ ] **Step 1: 创建堆叠分支**

```bash
git switch -c plan/api-workbench
```

- [ ] **Step 2: 确认基线测试**

Run: `uv run pytest -q`

Expected: `122 passed`（含两个 slow；若 2x2 表或 3x3 表缺失，对应 slow 测试 skip，但其余必须通过）

---

### Task 1: 依赖与运行配置

**Files:**
- Modify: `pyproject.toml`
- Create: `src/mofang/api/__init__.py`
- Create: `src/mofang/api/settings.py`
- Test: `tests/api/test_settings.py`

**Interfaces:**
- Consumes: 无
- Produces:
  - `Settings(db_path: Path, table_path: Path, host: str = "127.0.0.1", port: int = 8000, cors_origins: tuple[str, ...] = (...))`
  - `Settings.from_env() -> Settings`
  - `create_app`（Task 10 定义）

- [ ] **Step 1: 写失败测试**

`tests/api/test_settings.py`：

```python
from pathlib import Path

from mofang.api.settings import Settings


def test_settings_defaults() -> None:
    settings = Settings.from_env({})
    assert settings.db_path == Path("data/mofang.db")
    assert settings.table_path == Path("data/cache/2x2_distances.pkl")
    assert settings.host == "127.0.0.1"
    assert settings.port == 8000
    assert settings.cors_origins == (
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    )


def test_settings_env_override() -> None:
    settings = Settings.from_env(
        {
            "MOFANG_DB": "tmp/test.db",
            "MOFANG_TABLE": "tmp/table.pkl",
            "MOFANG_HOST": "localhost",
            "MOFANG_PORT": "9001",
        }
    )
    assert settings.db_path == Path("tmp/test.db")
    assert settings.table_path == Path("tmp/table.pkl")
    assert settings.host == "localhost"
    assert settings.port == 9001
```

- [ ] **Step 2: 运行测试确认失败**

Run: `uv run pytest tests/api/test_settings.py -q`

Expected: FAIL with `ModuleNotFoundError: No module named 'mofang.api'`

- [ ] **Step 3: 加依赖并实现 Settings**

`pyproject.toml` 的 `dependencies` 增加：

```toml
  "fastapi>=0.115,<1",
  "uvicorn>=0.30,<1",
```

`src/mofang/api/__init__.py` 为空文件。

`src/mofang/api/settings.py`：

```python
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping


@dataclass(frozen=True)
class Settings:
    db_path: Path = Path("data/mofang.db")
    table_path: Path = Path("data/cache/2x2_distances.pkl")
    host: str = "127.0.0.1"
    port: int = 8000
    cors_origins: tuple[str, ...] = (
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    )

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "Settings":
        values = os.environ if env is None else env
        return cls(
            db_path=Path(values.get("MOFANG_DB", "data/mofang.db")),
            table_path=Path(
                values.get("MOFANG_TABLE", "data/cache/2x2_distances.pkl")
            ),
            host=values.get("MOFANG_HOST", "127.0.0.1"),
            port=int(values.get("MOFANG_PORT", "8000")),
        )
```

- [ ] **Step 4: 安装依赖并跑测试**

Run: `uv sync --extra dev` 然后 `uv run pytest tests/api/test_settings.py -q`

Expected: `2 passed`

- [ ] **Step 5: 提交**

```bash
git add pyproject.toml uv.lock src/mofang/api/__init__.py src/mofang/api/settings.py tests/api/test_settings.py
git commit -m "feat: API 运行配置与 FastAPI 依赖"
```

---

### Task 2: SQLite schema 与连接管理

**Files:**
- Create: `src/mofang/store/__init__.py`
- Create: `src/mofang/store/db.py`
- Test: `tests/store/test_db.py`

**Interfaces:**
- Consumes: 无
- Produces:
  - `Database(path: Path)`
  - `Database.initialize() -> None`
  - `Database.connect() -> sqlite3.Connection`（调用方负责 close）
  - `Database.transaction()` context manager，提交/回滚
  - `SCHEMA` 常量（Task 3–5 的表）

- [ ] **Step 1: 写失败测试**

`tests/store/test_db.py`：

```python
import sqlite3
from pathlib import Path

from mofang.store.db import Database


def test_initialize_is_idempotent_and_uses_wal(tmp_path: Path) -> None:
    db = Database(tmp_path / "test.db")
    db.initialize()
    db.initialize()
    with db.connect() as conn:
        tables = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
        fk = conn.execute("PRAGMA foreign_keys").fetchone()[0]
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


def test_transaction_rolls_back(tmp_path: Path) -> None:
    db = Database(tmp_path / "test.db")
    db.initialize()
    try:
        with db.transaction() as conn:
            conn.execute(
                "INSERT INTO providers VALUES (?,?,?,?,?,?,?)",
                ("p1", "n", "http://x", "m", "KEY", "{}", "now"),
            )
            raise RuntimeError("boom")
    except RuntimeError:
        pass
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM providers").fetchone()[0] == 0
```

- [ ] **Step 2: 运行测试确认失败**

Run: `uv run pytest tests/store/test_db.py -q`

Expected: FAIL with `ModuleNotFoundError: No module named 'mofang.store'`

- [ ] **Step 3: 实现 Database 与 schema**

`src/mofang/store/__init__.py` 为空文件。

`src/mofang/store/db.py`：

```python
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
        with self.connect() as conn:
            conn.executescript(SCHEMA)

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
```

注意：`sqlite3.Connection` 的 `with` 只提交/回滚事务、不关闭连接；测试中用 `with db.connect() as conn` 后由 GC 关闭。生产代码统一用 `transaction()`。

- [ ] **Step 4: 跑测试**

Run: `uv run pytest tests/store/test_db.py -q`

Expected: `2 passed`

- [ ] **Step 5: 提交**

```bash
git add src/mofang/store/__init__.py src/mofang/store/db.py tests/store/test_db.py
git commit -m "feat: SQLite schema 与连接管理"
```

---

### Task 3: Provider store（只存 key 引用）

**Files:**
- Create: `src/mofang/store/providers.py`
- Test: `tests/store/test_providers.py`

**Interfaces:**
- Consumes: `Database`
- Produces:
  - `ProviderRecord(id, name, base_url, model, api_key_ref, params_json, created_at)`
  - `create_provider(db, *, name, base_url, model, api_key_ref, params) -> ProviderRecord`
  - `list_providers(db) -> list[ProviderRecord]`
  - `get_provider(db, provider_id) -> ProviderRecord | None`
  - `ProviderRecord.params -> dict`

- [ ] **Step 1: 写失败测试**

`tests/store/test_providers.py`：

```python
from pathlib import Path

from mofang.store.db import Database
from mofang.store.providers import create_provider, get_provider, list_providers


def test_provider_round_trip(tmp_path: Path) -> None:
    db = Database(tmp_path / "t.db")
    db.initialize()
    record = create_provider(
        db,
        name="local",
        base_url="http://localhost:20128/v1",
        model="ollama/gpt-oss:120b",
        api_key_ref="MOFANG_TEST_KEY",
        params={"temperature": 0.0, "max_tokens": 4096},
    )
    assert record.id
    assert record.params["max_tokens"] == 4096
    loaded = get_provider(db, record.id)
    assert loaded == record
    assert [item.id for item in list_providers(db)] == [record.id]


def test_provider_not_found(tmp_path: Path) -> None:
    db = Database(tmp_path / "t.db")
    db.initialize()
    assert get_provider(db, "missing") is None
```

- [ ] **Step 2: 运行确认失败**

Run: `uv run pytest tests/store/test_providers.py -q`

Expected: FAIL with `ModuleNotFoundError: No module named 'mofang.store.providers'`

- [ ] **Step 3: 实现 store**

`src/mofang/store/providers.py`：

```python
from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from .db import Database


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(frozen=True)
class ProviderRecord:
    id: str
    name: str
    base_url: str
    model: str
    api_key_ref: str
    params_json: str
    created_at: str

    @property
    def params(self) -> dict[str, Any]:
        return json.loads(self.params_json)


def _row_to_record(row: Any) -> ProviderRecord:
    return ProviderRecord(
        id=row["id"],
        name=row["name"],
        base_url=row["base_url"],
        model=row["model"],
        api_key_ref=row["api_key_ref"],
        params_json=row["params_json"],
        created_at=row["created_at"],
    )


def create_provider(
    db: Database,
    *,
    name: str,
    base_url: str,
    model: str,
    api_key_ref: str,
    params: dict[str, Any] | None = None,
) -> ProviderRecord:
    record = ProviderRecord(
        id=uuid.uuid4().hex,
        name=name,
        base_url=base_url.rstrip("/"),
        model=model,
        api_key_ref=api_key_ref,
        params_json=json.dumps(params or {}, ensure_ascii=False),
        created_at=now(),
    )
    with db.transaction() as conn:
        conn.execute(
            "INSERT INTO providers VALUES (?,?,?,?,?,?,?)",
            (
                record.id,
                record.name,
                record.base_url,
                record.model,
                record.api_key_ref,
                record.params_json,
                record.created_at,
            ),
        )
    return record


def list_providers(db: Database) -> list[ProviderRecord]:
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT * FROM providers ORDER BY created_at, id"
        ).fetchall()
    return [_row_to_record(row) for row in rows]


def get_provider(db: Database, provider_id: str) -> ProviderRecord | None:
    with db.connect() as conn:
        row = conn.execute(
            "SELECT * FROM providers WHERE id = ?", (provider_id,)
        ).fetchone()
    return _row_to_record(row) if row else None
```

- [ ] **Step 4: 跑测试**

Run: `uv run pytest tests/store/test_providers.py -q`

Expected: `2 passed`

- [ ] **Step 5: 提交**

```bash
git add src/mofang/store/providers.py tests/store/test_providers.py
git commit -m "feat: provider store 只保存密钥引用"
```

---

### Task 4: Benchmark store（含 task_key 映射）

**Files:**
- Create: `src/mofang/store/benchmarks.py`
- Test: `tests/store/test_benchmarks.py`

**Interfaces:**
- Consumes: `Database`、`Benchmark`、`Task`
- Produces:
  - `save_benchmark(db, benchmark, config: dict) -> None`（已存在则不改动，冻结集不可原地覆盖）
  - `list_benchmarks(db) -> list[dict]`（不含 tasks）
  - `get_benchmark(db, benchmark_id) -> Benchmark | None`
  - `get_task_ids(db, benchmark_id) -> list[str]`（DB 行 id，按插入顺序）
  - `TASK_ROW_ID = lambda benchmark_id, task_id: f"{benchmark_id}:{task_id}"`

- [ ] **Step 1: 写失败测试**

`tests/store/test_benchmarks.py`：

```python
from pathlib import Path

from mofang.cube.moves import apply_moves
from mofang.cube.state import CubeState
from mofang.store.benchmarks import (
    get_benchmark,
    get_task_ids,
    list_benchmarks,
    save_benchmark,
)
from mofang.store.db import Database
from mofang.tasks.models import Benchmark, Task


def make_benchmark() -> Benchmark:
    state = apply_moves(CubeState.solved(2), ["R"])
    task = Task(
        id="2x2-1-1",
        cube="2x2",
        scramble=["R"],
        scramble_depth=1,
        state=state.to_json(),
        reference_length=1,
        reference_kind="exact",
        bin="1",
    )
    bench = Benchmark(id="bench-1", name="demo", cube="2x2", tasks=[task])
    bench.content_hash = bench.compute_hash()
    return bench


def test_benchmark_round_trip(tmp_path: Path) -> None:
    db = Database(tmp_path / "t.db")
    db.initialize()
    bench = make_benchmark()
    save_benchmark(db, bench, {"seed": 1})
    save_benchmark(db, bench, {"seed": 1})
    loaded = get_benchmark(db, "bench-1")
    assert loaded is not None
    assert loaded.content_hash == bench.content_hash
    assert loaded.tasks[0].state == bench.tasks[0].state
    assert get_task_ids(db, "bench-1") == ["bench-1:2x2-1-1"]
    assert list_benchmarks(db)[0]["content_hash"] == bench.content_hash


def test_missing_benchmark(tmp_path: Path) -> None:
    db = Database(tmp_path / "t.db")
    db.initialize()
    assert get_benchmark(db, "nope") is None
    assert get_task_ids(db, "nope") == []
```

- [ ] **Step 2: 运行确认失败**

Run: `uv run pytest tests/store/test_benchmarks.py -q`

Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: 实现 store**

`src/mofang/store/benchmarks.py`：

```python
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
    with db.connect() as conn:
        rows = conn.execute(
            """
            SELECT b.*, COUNT(t.id) AS task_count
            FROM benchmarks b
            LEFT JOIN tasks t ON t.benchmark_id = b.id
            GROUP BY b.id
            ORDER BY b.frozen_at DESC, b.id
            """
        ).fetchall()
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
    with db.connect() as conn:
        row = conn.execute(
            "SELECT * FROM benchmarks WHERE id = ?", (benchmark_id,)
        ).fetchone()
        if row is None:
            return None
        task_rows = conn.execute(
            "SELECT * FROM tasks WHERE benchmark_id = ? ORDER BY rowid",
            (benchmark_id,),
        ).fetchall()
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
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT id FROM tasks WHERE benchmark_id = ? ORDER BY rowid",
            (benchmark_id,),
        ).fetchall()
    return [row["id"] for row in rows]
```

- [ ] **Step 4: 跑测试**

Run: `uv run pytest tests/store/test_benchmarks.py -q`

Expected: `2 passed`

- [ ] **Step 5: 提交**

```bash
git add src/mofang/store/benchmarks.py tests/store/test_benchmarks.py
git commit -m "feat: benchmark store 与任务行映射"
```

### Task 5: Run / Episode / Step store

**Files:**
- Create: `src/mofang/store/runs.py`
- Test: `tests/store/test_runs.py`

**Interfaces:**
- Consumes: `Database`、`EpisodeResult`、`StepRecord`、`EpisodeStatus`
- Produces:
  - `create_run(db, *, provider_id, benchmark_id, tool_mode, prompt_version, params, budget) -> str`
  - `set_run_status(db, run_id, status, *, totals=None, error=None, started=False, finished=False) -> None`
  - `get_run(db, run_id) -> dict | None`
  - `list_runs(db) -> list[dict]`
  - `create_episode(db, *, run_id, task_row_id, reference_length, started_at) -> str`
  - `finish_episode(db, episode_id, result: EpisodeResult) -> None`
  - `add_steps(db, episode_id, steps: list[StepRecord]) -> None`
  - `get_episode(db, episode_id) -> dict | None`
  - `get_steps(db, episode_id) -> list[dict]`
  - `get_run_episodes(db, run_id) -> list[dict]`
  - `mark_running_interrupted(db) -> int`

- [ ] **Step 1: 写失败测试**

`tests/store/test_runs.py`：

```python
import json
from pathlib import Path

from mofang.cube.state import CubeState
from mofang.runner.episode import EpisodeResult, EpisodeStatus, StepRecord
from mofang.store.db import Database
from mofang.store.providers import create_provider
from mofang.store.runs import (
    add_steps,
    create_episode,
    create_run,
    finish_episode,
    get_episode,
    get_run,
    get_run_episodes,
    get_steps,
    list_runs,
    mark_running_interrupted,
    set_run_status,
)


def setup(tmp_path: Path) -> tuple[Database, str, str]:
    db = Database(tmp_path / "t.db")
    db.initialize()
    provider = create_provider(
        db,
        name="p",
        base_url="http://localhost:1/v1",
        model="m",
        api_key_ref="KEY",
    )
    with db.transaction() as conn:
        conn.execute(
            "INSERT INTO benchmarks VALUES (?,?,?,?,?,?,?,?)",
            ("b1", "demo", "v1", "frozen", "2x2", "{}", "hash", "now"),
        )
        conn.execute(
            "INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?)",
            (
                "b1:t1", "b1", "t1", "2x2", '["R"]', 1,
                json.dumps(CubeState.solved(2).to_json()), 1, "exact", "1",
            ),
        )
    run_id = create_run(
        db,
        provider_id=provider.id,
        benchmark_id="b1",
        tool_mode="both",
        prompt_version="v1",
        params={"temperature": 0.0},
        budget={"max_moves": 10},
    )
    return db, provider.id, run_id


def test_run_and_episode_lifecycle(tmp_path: Path) -> None:
    db, _, run_id = setup(tmp_path)
    assert get_run(db, run_id)["status"] == "queued"
    set_run_status(db, run_id, "running", started=True)
    episode_id = create_episode(
        db, run_id=run_id, task_row_id="b1:t1", reference_length=1, started_at="now"
    )
    result = EpisodeResult(
        status=EpisodeStatus.SOLVED,
        solved=True,
        moves_used=1,
        reference_length=1,
        efficiency=1.0,
        progress_ratio=1.0,
        invalid_calls=0,
        protocol_errors=0,
        tokens_in=10,
        tokens_out=5,
        latency_ms=100,
        final_state=CubeState.solved(2).to_json(),
        failure_code=None,
        error=None,
        steps=[],
    )
    finish_episode(db, episode_id, result)
    add_steps(
        db,
        episode_id,
        [
            StepRecord(
                seq=0,
                kind="tool",
                tool_name="turn",
                arguments={"face": "R", "amount": 1},
                result={"ok": True},
                state=result.final_state,
                reference_length_after=0,
            )
        ],
    )
    set_run_status(db, run_id, "finished", totals={"tasks": 1}, finished=True)
    run = get_run(db, run_id)
    assert run["status"] == "finished"
    assert run["totals"]["tasks"] == 1
    episode = get_episode(db, episode_id)
    assert episode["solved"] == 1
    assert episode["efficiency"] == 1.0
    steps = get_steps(db, episode_id)
    assert steps[0]["tool_name"] == "turn"
    assert steps[0]["state"]["cube"] == "2x2"
    assert len(get_run_episodes(db, run_id)) == 1
    assert list_runs(db)[0]["id"] == run_id


def test_mark_running_interrupted(tmp_path: Path) -> None:
    db, _, run_id = setup(tmp_path)
    set_run_status(db, run_id, "running", started=True)
    episode_id = create_episode(
        db, run_id=run_id, task_row_id="b1:t1", reference_length=1, started_at="now"
    )
    assert mark_running_interrupted(db) == 1
    assert get_episode(db, episode_id)["status"] == "interrupted"
    assert get_run(db, run_id)["status"] == "interrupted"
```

- [ ] **Step 2: 运行确认失败**

Run: `uv run pytest tests/store/test_runs.py -q`

Expected: FAIL with `ModuleNotFoundError: No module named 'mofang.store.runs'`

- [ ] **Step 3: 实现 store**

`src/mofang/store/runs.py`：

```python
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
) -> str:
    run_id = uuid.uuid4().hex
    with db.transaction() as conn:
        conn.execute(
            "INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
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
            ),
        )
    return run_id


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
        "created_at": row["created_at"],
        "started_at": row["started_at"],
        "finished_at": row["finished_at"],
    }


def get_run(db: Database, run_id: str) -> dict[str, Any] | None:
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
    return _run_dict(row) if row else None


def list_runs(db: Database) -> list[dict[str, Any]]:
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT * FROM runs ORDER BY created_at DESC, id"
        ).fetchall()
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
    with db.connect() as conn:
        row = conn.execute(
            "SELECT * FROM episodes WHERE id = ?", (episode_id,)
        ).fetchone()
    return _episode_dict(row) if row else None


def get_run_episodes(db: Database, run_id: str) -> list[dict[str, Any]]:
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT * FROM episodes WHERE run_id = ? ORDER BY rowid", (run_id,)
        ).fetchall()
    return [_episode_dict(row) for row in rows]


def get_steps(db: Database, episode_id: str) -> list[dict[str, Any]]:
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT * FROM steps WHERE episode_id = ? ORDER BY seq", (episode_id,)
        ).fetchall()
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


def mark_running_interrupted(db: Database) -> int:
    with db.transaction() as conn:
        count = conn.execute(
            "UPDATE episodes SET status = 'interrupted' WHERE status = 'running'"
        ).rowcount
        conn.execute(
            "UPDATE runs SET status = 'interrupted' WHERE status IN ('queued','running')"
        )
    return count
```

- [ ] **Step 4: 跑测试**

Run: `uv run pytest tests/store/test_runs.py -q`

Expected: `2 passed`

- [ ] **Step 5: 提交**

```bash
git add src/mofang/store/runs.py tests/store/test_runs.py
git commit -m "feat: run/episode/step 持久化与中断恢复"
```

---

### Task 6: Provider 工厂、预算与求解器工厂

**Files:**
- Create: `src/mofang/service/__init__.py`
- Create: `src/mofang/service/factory.py`
- Test: `tests/service/test_factory.py`

**Interfaces:**
- Consumes: `ProviderRecord`、`OpenAICompatibleAdapter`、`Budget`、`ModelParams`、`Table2x2Solver`、`RubikTwoPhaseClient`
- Produces:
  - `ProviderConfigError(RuntimeError)`
  - `build_adapter(record, env=None) -> OpenAICompatibleAdapter`
  - `budget_for(cube, overrides) -> Budget`
  - `model_params_for(record, overrides) -> ModelParams`
  - `make_solver_factory(table_path: Path) -> Callable[[str], ReferenceSolver]`

- [ ] **Step 1: 写失败测试**

`tests/service/test_factory.py`：

```python
from pathlib import Path

import pytest

from mofang.cube.state import CubeState
from mofang.cube.table2x2 import build_table, save_table
from mofang.service.factory import (
    ProviderConfigError,
    budget_for,
    build_adapter,
    make_solver_factory,
    model_params_for,
)
from mofang.store.db import Database
from mofang.store.providers import create_provider


def test_build_adapter_requires_env_key(tmp_path: Path) -> None:
    db = Database(tmp_path / "t.db")
    db.initialize()
    record = create_provider(
        db,
        name="p",
        base_url="http://localhost:1/v1",
        model="m",
        api_key_ref="MISSING_KEY",
    )
    with pytest.raises(ProviderConfigError):
        build_adapter(record, env={})


def test_build_adapter_uses_key_and_params(tmp_path: Path) -> None:
    db = Database(tmp_path / "t.db")
    db.initialize()
    record = create_provider(
        db,
        name="p",
        base_url="http://localhost:1/v1/",
        model="m",
        api_key_ref="KEY",
        params={"max_tokens": 123},
    )
    adapter = build_adapter(record, env={"KEY": "secret"})
    assert adapter.base_url == "http://localhost:1/v1"
    assert adapter.api_key == "secret"
    assert adapter.model == "m"
    assert model_params_for(record, {}).max_tokens == 123
    assert model_params_for(record, {"temperature": 1.0}).temperature == 1.0


def test_budget_defaults_and_overrides() -> None:
    assert budget_for("2x2", {}).max_moves == 30
    assert budget_for("2x2", {}).max_seconds == 300.0
    assert budget_for("3x3", {}).max_moves == 100
    assert budget_for("3x3", {}).max_tokens == 1_000_000
    assert budget_for("2x2", {"max_moves": 5}).max_moves == 5


def test_solver_factory_2x2(tmp_path: Path) -> None:
    table_path = tmp_path / "table.pkl"
    save_table(build_table(max_depth=2), table_path)
    solver = make_solver_factory(table_path)("2x2")
    assert solver.distance(CubeState.solved(2)) == 0
```

- [ ] **Step 2: 运行确认失败**

Run: `uv run pytest tests/service/test_factory.py -q`

Expected: FAIL with `ModuleNotFoundError: No module named 'mofang.service'`

- [ ] **Step 3: 实现工厂**

`src/mofang/service/__init__.py` 为空文件。

`src/mofang/service/factory.py`：

```python
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Callable, Mapping

from ..cube.solver import ReferenceSolver, RubikTwoPhaseClient
from ..cube.table2x2 import Table2x2Solver, load_table
from ..models.openai_compat import OpenAICompatibleAdapter
from ..models.provider import ModelParams
from ..runner.budget import Budget
from ..store.providers import ProviderRecord

DEFAULT_BUDGETS = {
    "2x2": {
        "max_moves": 30,
        "max_seconds": 300.0,
        "max_tool_calls": 50,
        "max_tokens": 300_000,
        "turn_timeout": 120.0,
    },
    "3x3": {
        "max_moves": 100,
        "max_seconds": 900.0,
        "max_tool_calls": 150,
        "max_tokens": 1_000_000,
        "turn_timeout": 120.0,
    },
}


class ProviderConfigError(RuntimeError):
    pass


def build_adapter(
    record: ProviderRecord,
    env: Mapping[str, str] | None = None,
) -> OpenAICompatibleAdapter:
    values = os.environ if env is None else env
    key = values.get(record.api_key_ref, "")
    if not key:
        raise ProviderConfigError(
            f"environment variable {record.api_key_ref} is not set"
        )
    return OpenAICompatibleAdapter(
        base_url=record.base_url,
        api_key=key,
        model=record.model,
    )


def budget_for(cube: str, overrides: Mapping[str, Any]) -> Budget:
    values = dict(DEFAULT_BUDGETS[cube])
    values.update(overrides)
    return Budget(**values)


def model_params_for(
    record: ProviderRecord, overrides: Mapping[str, Any]
) -> ModelParams:
    values = dict(record.params)
    values.update(overrides)
    extra = values.pop("extra", {})
    return ModelParams(
        temperature=float(values.get("temperature", 0.0)),
        max_tokens=int(values.get("max_tokens", 4096)),
        extra=dict(extra),
    )


def make_solver_factory(
    table_path: Path,
) -> Callable[[str], ReferenceSolver]:
    def factory(cube: str) -> ReferenceSolver:
        if cube == "2x2":
            return Table2x2Solver(load_table(table_path))
        return RubikTwoPhaseClient()

    return factory
```

- [ ] **Step 4: 跑测试**

Run: `uv run pytest tests/service/test_factory.py -q`

Expected: `4 passed`

- [ ] **Step 5: 提交**

```bash
git add src/mofang/service/__init__.py src/mofang/service/factory.py tests/service/test_factory.py
git commit -m "feat: provider/预算/求解器工厂"
```

---

### Task 7: 事件总线与 SSE 格式化

**Files:**
- Create: `src/mofang/api/events.py`
- Test: `tests/api/test_events.py`

**Interfaces:**
- Consumes: 无
- Produces:
  - `Event(id, type, run_id, episode_id, ts, data)`
  - `RunEventBus.publish(run_id, type, data, episode_id=None) -> Event`
  - `RunEventBus.history(run_id, after=0) -> list[Event]`
  - `RunEventBus.stream(run_id, after=0, heartbeat=15.0) -> AsyncIterator[str]`
  - `format_sse(event) -> str`
  - `parse_last_event_id(value: str | None) -> int`

- [ ] **Step 1: 写失败测试**

`tests/api/test_events.py`：

```python
import asyncio
import json

from mofang.api.events import (
    RunEventBus,
    format_sse,
    parse_last_event_id,
)


def test_publish_and_history() -> None:
    bus = RunEventBus()
    first = bus.publish("r1", "run.started", {"a": 1})
    second = bus.publish("r1", "episode.started", {}, episode_id="e1")
    assert (first.id, second.id) == (1, 2)
    assert [event.id for event in bus.history("r1", after=1)] == [2]
    assert bus.history("r1", after=99) == []


def test_format_sse_and_last_event_id() -> None:
    bus = RunEventBus()
    event = bus.publish("r1", "tool.call", {"tool": "turn"})
    text = format_sse(event)
    assert text.startswith("id: 1\nevent: tool.call\ndata: ")
    assert text.endswith("\n\n")
    payload = json.loads(text.split("data: ", 1)[1].strip())
    assert payload == {"tool": "turn"}
    assert parse_last_event_id("2") == 2
    assert parse_last_event_id(None) == 0
    assert parse_last_event_id("bad") == 0


async def test_stream_replays_and_receives_live_events() -> None:
    bus = RunEventBus()
    bus.publish("r1", "run.started", {})
    stream = bus.stream("r1", after=0, heartbeat=0.05)
    first = await anext(stream)
    assert "event: run.started" in first
    bus.publish("r1", "run.finished", {})
    second = await anext(stream)
    assert "event: run.finished" in second
    ping = await anext(stream)
    assert ping == ": ping\n\n"
    await stream.aclose()
```

- [ ] **Step 2: 运行确认失败**

Run: `uv run pytest tests/api/test_events.py -q`

Expected: FAIL with `ModuleNotFoundError: No module named 'mofang.api.events'`

- [ ] **Step 3: 实现事件总线**

`src/mofang/api/events.py`：

```python
from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, AsyncIterator


@dataclass(frozen=True)
class Event:
    id: int
    type: str
    run_id: str
    episode_id: str | None
    ts: str
    data: dict[str, Any]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def format_sse(event: Event) -> str:
    payload = {
        "id": event.id,
        "type": event.type,
        "run_id": event.run_id,
        "episode_id": event.episode_id,
        "ts": event.ts,
        "data": event.data,
    }
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return f"id: {event.id}\nevent: {event.type}\ndata: {data}\n\n"


def parse_last_event_id(value: str | None) -> int:
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


@dataclass
class _RunChannel:
    history: list[Event] = field(default_factory=list)
    subscribers: set[asyncio.Queue[Event]] = field(default_factory=set)


class RunEventBus:
    def __init__(self) -> None:
        self._channels: dict[str, _RunChannel] = defaultdict(_RunChannel)

    def publish(
        self,
        run_id: str,
        type: str,
        data: dict[str, Any],
        episode_id: str | None = None,
    ) -> Event:
        channel = self._channels[run_id]
        event = Event(
            id=len(channel.history) + 1,
            type=type,
            run_id=run_id,
            episode_id=episode_id,
            ts=_now(),
            data=data,
        )
        channel.history.append(event)
        for queue in list(channel.subscribers):
            queue.put_nowait(event)
        return event

    def history(self, run_id: str, after: int = 0) -> list[Event]:
        return [
            event for event in self._channels[run_id].history if event.id > after
        ]

    async def stream(
        self, run_id: str, after: int = 0, heartbeat: float = 15.0
    ) -> AsyncIterator[str]:
        channel = self._channels[run_id]
        queue: asyncio.Queue[Event] = asyncio.Queue()
        for event in self.history(run_id, after):
            yield format_sse(event)
        channel.subscribers.add(queue)
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=heartbeat)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                    continue
                yield format_sse(event)
        finally:
            channel.subscribers.discard(queue)
```

- [ ] **Step 4: 跑测试**

Run: `uv run pytest tests/api/test_events.py -q`

Expected: `3 passed`

- [ ] **Step 5: 提交**

```bash
git add src/mofang/api/events.py tests/api/test_events.py
git commit -m "feat: run 事件总线与 SSE 格式化"
```

---

### Task 8: EpisodeRunner 事件细化与取消

**Files:**
- Modify: `src/mofang/runner/episode.py:78-125`（`run` 签名、取消检查）
- Modify: `src/mofang/runner/episode.py:170-190`（tool 事件）
- Test: `tests/runner/test_episode.py`

**Interfaces:**
- Consumes: 现有 `EpisodeRunner`
- Produces:
  - `EpisodeRunner(provider, solver, budget, params=None, tool_mode="both")`
  - `EpisodeRunner.run(task, emit=None, cancel: asyncio.Event | None = None) -> EpisodeResult`
  - `tool_mode` 过滤：`turn_only` 暴露 `turn/get_state/check_solved`，`batch_only` 暴露 `apply_moves/get_state/check_solved`
  - 事件新增：`tool.call`（`{"call_id","tool","arguments"}`）、`tool.result`（`{"call_id","tool","ok","payload"}`）
  - `move.applied` 仅在 `outcome.applied` 非空时发，payload 增加 `moves`、`state`、`moves_used`

- [ ] **Step 1: 写失败测试**

在 `tests/runner/test_episode.py` 末尾追加：

```python
def test_emits_tool_events_and_move_state(table_solver: Table2x2Solver) -> None:
    task = make_task(table_solver, ["R"])
    provider = FakeProvider(
        [
            ModelTurn(
                tool_calls=[
                    ToolCall(id="c1", name="apply_moves", arguments={"moves": ["R'"]})
                ]
            )
        ]
    )
    events: list[tuple[str, dict]] = []

    def emit(kind: str, payload: dict) -> None:
        events.append((kind, payload))

    result = asyncio.run(
        EpisodeRunner(
            provider=provider, solver=table_solver, budget=Budget(max_moves=10)
        ).run(task, emit=emit)
    )
    kinds = [kind for kind, _ in events]
    assert "tool.call" in kinds
    assert "tool.result" in kinds
    move_events = [payload for kind, payload in events if kind == "move.applied"]
    assert move_events[-1]["moves"] == ["R'"]
    assert move_events[-1]["state"]["cube"] == "2x2"
    assert result.status == EpisodeStatus.SOLVED
    assert any(step.kind == "model_message" for step in result.steps)


def test_cancelled_before_first_turn(table_solver: Table2x2Solver) -> None:
    task = make_task(table_solver, ["R"])
    provider = FakeProvider([ModelTurn(content="never")])
    cancel = asyncio.Event()
    cancel.set()
    result = asyncio.run(
        EpisodeRunner(
            provider=provider, solver=table_solver, budget=Budget(max_moves=10)
        ).run(task, cancel=cancel)
    )
    assert result.status == EpisodeStatus.CANCELLED
    assert result.error == "cancelled"
    assert provider.calls == []


async def test_cancel_interrupts_inflight_chat(
    table_solver: Table2x2Solver,
) -> None:
    class SlowProvider:
        async def chat(self, messages, tools, params):
            await asyncio.sleep(10)
            raise AssertionError("cancelled chat should not return")

        async def probe_tools(self) -> bool:
            return True

    task = make_task(table_solver, ["R"])
    cancel = asyncio.Event()
    runner = EpisodeRunner(
        provider=SlowProvider(), solver=table_solver, budget=Budget(max_moves=10)
    )
    run_task = asyncio.create_task(runner.run(task, cancel=cancel))
    await asyncio.sleep(0.05)
    cancel.set()
    result = await asyncio.wait_for(run_task, timeout=2)
    assert result.status == EpisodeStatus.CANCELLED
    assert result.error == "cancelled"


async def test_tool_mode_filters_tools(table_solver: Table2x2Solver) -> None:
    class RecordingProvider:
        def __init__(self) -> None:
            self.tools: list[dict] = []

        async def chat(self, messages, tools, params):
            self.tools = tools
            return ModelTurn(content="done")

        async def probe_tools(self) -> bool:
            return True

    provider = RecordingProvider()
    task = make_task(table_solver, ["R"])
    await EpisodeRunner(
        provider=provider,
        solver=table_solver,
        budget=Budget(max_moves=10),
        tool_mode="batch_only",
    ).run(task)
    names = {tool["function"]["name"] for tool in provider.tools}
    assert names == {"apply_moves", "get_state", "check_solved"}
```

- [ ] **Step 2: 运行确认失败**

Run: `uv run pytest tests/runner/test_episode.py -q`

Expected: FAIL（`unexpected keyword argument 'cancelled'` / 缺少事件）

- [ ] **Step 3: 实现 runner 改动**

`__init__` 增加 `tool_mode`（默认 `both`，非法值抛 `ValueError`），并增加工具过滤与可中断的 chat 辅助方法。在文件顶部 import `contextlib`，定义：

```python
class _EpisodeCancelled(Exception):
    pass


def _tools(self) -> list[dict[str, Any]]:
    names = {"get_state", "check_solved"}
    if self.tool_mode in ("both", "turn_only"):
        names.add("turn")
    if self.tool_mode in ("both", "batch_only"):
        names.add("apply_moves")
    return [
        tool for tool in TOOLS if tool["function"]["name"] in names
    ]


async def _chat(
    self,
    messages: list[dict[str, Any]],
    cancel: asyncio.Event | None,
) -> ModelTurn:
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
```

`run` 签名改为：

```python
    async def run(
        self,
        task: Task,
        emit: Callable[[str, dict[str, Any]], None] | None = None,
        cancel: asyncio.Event | None = None,
    ) -> EpisodeResult:
```

在 `while True:` 第一行前加入：

```python
            if cancel is not None and cancel.is_set():
                status = EpisodeStatus.CANCELLED
                error_message = "cancelled"
                break
```

原来的 `try: turn = await asyncio.wait_for(self.provider.chat(messages, TOOLS, self.params), ...)` 改为：

```python
            try:
                turn = await self._chat(messages, cancel)
            except _EpisodeCancelled:
                status = EpisodeStatus.CANCELLED
                error_message = "cancelled"
                break
            except asyncio.TimeoutError:
                status = EpisodeStatus.TIMEOUT
                error_message = f"turn timeout after {self.budget.turn_timeout:g}s"
                break
            except ProviderError as exc:
                status = (
                    EpisodeStatus.TIMEOUT
                    if exc.kind == "timeout"
                    else EpisodeStatus.PROVIDER_ERROR
                )
                error_message = str(exc) or exc.kind
                break
```

在构造 assistant 消息后、进入 tool_calls 分支前，追加模型消息步骤：

```python
            steps.append(
                StepRecord(
                    seq=len(steps),
                    kind="model_message",
                    arguments={
                        "tool_calls": [call.name for call in turn.tool_calls]
                    },
                    result={"content": turn.content},
                    state=executor.state.to_json(),
                    reference_length_after=self.solver.distance(executor.state),
                )
            )
```

工具执行改为：

```python
                for call in calls:
                    notify(
                        "tool.call",
                        {
                            "call_id": call.id,
                            "tool": call.name,
                            "arguments": call.arguments,
                        },
                    )
                    outcome = executor.execute(call.name, call.arguments)
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
                    length_after = self.solver.distance(executor.state)
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
                            },
                        )
                    if executor.state.is_solved():
                        status = EpisodeStatus.SOLVED
                        break
```

同时把旧的 `notify("move.applied", {"payload": outcome.payload})` 删除，避免重复。

- [ ] **Step 4: 跑测试**

Run: `uv run pytest tests/runner/test_episode.py -q`

Expected: 全部通过（含原有 5 个 + 新增 2 个）

- [ ] **Step 5: 提交**

```bash
git add src/mofang/runner/episode.py tests/runner/test_episode.py
git commit -m "feat: runner 推送工具事件并支持取消"
```

### Task 9: RunService（后台执行、落库、事件、取消）

**Files:**
- Create: `src/mofang/service/runs.py`
- Test: `tests/service/test_runs_service.py`

**Interfaces:**
- Consumes: `Database`、`RunEventBus`、`EpisodeRunner`、`aggregate_report`、`create_run/set_run_status/create_episode/finish_episode/add_steps/get_run/get_provider/get_benchmark`、`ProviderRecord`、`budget_for`、`model_params_for`
- Produces:
  - `RunService(db, events, provider_factory, solver_factory)`
  - `RunService.start(run_id) -> None`（`asyncio.create_task`）
  - `RunService.cancel(run_id) -> bool`
  - `RunService.wait(run_id) -> None`
  - 事件：`run.started`、`episode.started`、`model.turn.started`、`model.message`、`tool.call`、`tool.result`、`move.applied`、`episode.finished`、`run.finished`、`run.error`

- [ ] **Step 1: 写失败测试**

`tests/service/test_runs_service.py`：

```python
import asyncio
import json
from pathlib import Path

from mofang.api.events import RunEventBus
from mofang.cube.moves import apply_moves
from mofang.cube.state import CubeState
from mofang.cube.table2x2 import Table2x2Solver, build_table
from mofang.models.provider import FakeProvider, ModelTurn, ToolCall
from mofang.service.runs import RunService
from mofang.store.benchmarks import save_benchmark
from mofang.store.db import Database
from mofang.store.providers import create_provider
from mofang.store.runs import create_run, get_episode, get_run, get_run_episodes
from mofang.tasks.models import Benchmark, Task


def seed_run(tmp_path: Path) -> tuple[Database, str]:
    db = Database(tmp_path / "t.db")
    db.initialize()
    provider = create_provider(
        db, name="p", base_url="http://localhost:1/v1",
        model="m", api_key_ref="KEY",
    )
    state = apply_moves(CubeState.solved(2), ["R"])
    task = Task(
        id="t1", cube="2x2", scramble=["R"], scramble_depth=1,
        state=state.to_json(), reference_length=1,
        reference_kind="exact", bin="1",
    )
    bench = Benchmark(id="b1", name="demo", cube="2x2", tasks=[task])
    bench.content_hash = bench.compute_hash()
    save_benchmark(db, bench, {"seed": 1})
    run_id = create_run(
        db, provider_id=provider.id, benchmark_id="b1", tool_mode="both",
        prompt_version="v1", params={}, budget={"max_moves": 10},
    )
    return db, run_id


def solver_factory(_cube: str) -> Table2x2Solver:
    return Table2x2Solver(build_table(max_depth=2))


async def test_executes_run_and_persists(tmp_path: Path) -> None:
    db, run_id = seed_run(tmp_path)
    bus = RunEventBus()
    provider = FakeProvider(
        [
            ModelTurn(
                tool_calls=[
                    ToolCall(id="c1", name="apply_moves", arguments={"moves": ["R'"]})
                ]
            )
        ]
    )
    service = RunService(
        db, bus,
        provider_factory=lambda record: provider,
        solver_factory=solver_factory,
    )
    service.start(run_id)
    await service.wait(run_id)
    run = get_run(db, run_id)
    assert run["status"] == "finished"
    assert run["totals"]["totals"]["solved"] == 1
    episodes = get_run_episodes(db, run_id)
    assert episodes[0]["status"] == "solved"
    assert get_episode(db, episodes[0]["id"])["moves_used"] == 1
    kinds = [event.type for event in bus.history(run_id)]
    assert kinds[0] == "run.started"
    assert "tool.call" in kinds
    assert "tool.result" in kinds
    assert "move.applied" in kinds
    assert kinds[-1] == "run.finished"


async def test_cancel_marks_run_cancelled(tmp_path: Path) -> None:
    db, run_id = seed_run(tmp_path)
    bus = RunEventBus()

    class SlowProvider:
        async def probe_tools(self) -> bool:
            return True

        async def chat(self, messages, tools, params):
            await asyncio.sleep(10)
            raise AssertionError("should not return")

    service = RunService(
        db, bus,
        provider_factory=lambda record: SlowProvider(),
        solver_factory=solver_factory,
    )
    service.start(run_id)
    await asyncio.sleep(0.05)
    assert await service.cancel(run_id) is True
    await service.wait(run_id)
    assert get_run(db, run_id)["status"] == "cancelled"
    assert all(
        item["status"] != "solved" for item in get_run_episodes(db, run_id)
    )


async def test_provider_factory_error_marks_run_failed(tmp_path: Path) -> None:
    db, run_id = seed_run(tmp_path)
    bus = RunEventBus()

    def broken_factory(record):
        raise RuntimeError("no key")

    service = RunService(
        db, bus,
        provider_factory=broken_factory,
        solver_factory=solver_factory,
    )
    service.start(run_id)
    await service.wait(run_id)
    run = get_run(db, run_id)
    assert run["status"] == "failed"
    assert "no key" in run["error"]
    assert [event.type for event in bus.history(run_id)][-1] == "run.error"
```

- [ ] **Step 2: 运行确认失败**

Run: `uv run pytest tests/service/test_runs_service.py -q`

Expected: FAIL with `ModuleNotFoundError: No module named 'mofang.service.runs'`

- [ ] **Step 3: 实现 RunService**

`src/mofang/service/runs.py`：

```python
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
from ..store.providers import ProviderRecord, get_provider
from ..store.runs import (
    add_steps,
    create_episode,
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
        async with self._lock:  # 跨 run 串行，避免成本与限速混乱
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
                    run_id, "episode.started",
                    {"task_id": task.id, "reference_length": task.reference_length},
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
                result = await runner.run(
                    task, emit=emit, cancel=cancel
                )
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
        except Exception as exc:  # 运行级错误必须落库并可查
            self._fail(run_id, str(exc))
        finally:
            close = getattr(adapter, "close", None)
            if close is not None:
                await close()
            if solver is not None:
                solver_close = getattr(solver, "close", None)
                if solver_close is not None:
                    solver_close()

    def _fail(self, run_id: str, message: str) -> None:
        set_run_status(
            self.db, run_id, "failed", error=message, finished=True
        )
        self.events.publish(run_id, "run.error", {"message": message})
```

注意：`task_row_id` 直接复用 store 的命名函数；`async with self._lock` 保证跨 run 串行。取消依赖 Task 8 的 `_chat` 竞速，因此 `cancel()` 能中断在途 HTTP 请求；`_EpisodeCancelled` 只在 runner 内部使用。

- [ ] **Step 4: 跑测试**

Run: `uv run pytest tests/service/test_runs_service.py -q`

Expected: `3 passed`

- [ ] **Step 5: 提交**

```bash
git add src/mofang/service/runs.py tests/service/test_runs_service.py
git commit -m "feat: RunService 后台执行、落库与取消"
```

---

### Task 10: FastAPI app、provider 与 benchmark 路由

**Files:**
- Create: `src/mofang/api/schemas.py`
- Create: `src/mofang/api/app.py`
- Create: `src/mofang/api/routes/__init__.py`
- Create: `src/mofang/api/routes/providers.py`
- Create: `src/mofang/api/routes/benchmarks.py`
- Test: `tests/api/test_providers_api.py`
- Test: `tests/api/test_benchmarks_api.py`

**Interfaces:**
- Consumes: `Settings`、`Database`、`RunEventBus`、`RunService`、store 函数、`generate_benchmark`
- Produces:
  - `create_app(settings=None, *, db=None, provider_factory=None, solver_factory=None, env=None) -> FastAPI`
  - `GET/POST /api/providers`、`POST /api/providers/{id}/probe`
  - `GET/POST /api/benchmarks`、`GET /api/benchmarks/{id}`

- [ ] **Step 1: 写失败测试**

`tests/api/test_providers_api.py`：

```python
from fastapi.testclient import TestClient

from mofang.api.app import create_app
from mofang.models.provider import FakeProvider
from mofang.store.db import Database


def make_client(tmp_path):
    db = Database(tmp_path / "t.db")
    app = create_app(
        db=db,
        provider_factory=lambda record: FakeProvider([]),
        solver_factory=lambda cube: None,
        env={"LOCAL_KEY": "secret"},
    )
    return TestClient(app), db


def test_create_and_list_provider_masks_key(tmp_path) -> None:
    client, _ = make_client(tmp_path)
    with client:
        response = client.post(
            "/api/providers",
            json={
                "name": "local",
                "base_url": "http://localhost:20128/v1",
                "model": "m",
                "api_key_ref": "LOCAL_KEY",
                "params": {"max_tokens": 128},
            },
        )
        assert response.status_code == 201
        assert "secret" not in response.text
        body = response.json()
        assert body["key_configured"] is True
        listed = client.get("/api/providers").json()
        assert listed[0]["api_key_ref"] == "LOCAL_KEY"
        assert "secret" not in str(listed)


def test_probe_provider(tmp_path) -> None:
    client, _ = make_client(tmp_path)
    with client:
        created = client.post(
            "/api/providers",
            json={
                "name": "local",
                "base_url": "http://localhost:1/v1",
                "model": "m",
                "api_key_ref": "LOCAL_KEY",
            },
        ).json()
        response = client.post(f"/api/providers/{created['id']}/probe")
        assert response.status_code == 200
        assert response.json() == {"ok": True, "tool_calling": True}


def test_probe_missing_provider(tmp_path) -> None:
    client, _ = make_client(tmp_path)
    with client:
        assert client.post("/api/providers/nope/probe").status_code == 404
```

`tests/api/test_benchmarks_api.py`：

```python
from fastapi.testclient import TestClient

from mofang.api.app import create_app
from mofang.cube.table2x2 import Table2x2Solver, build_table
from mofang.store.db import Database


def make_client(tmp_path):
    db = Database(tmp_path / "t.db")
    app = create_app(
        db=db,
        provider_factory=lambda record: None,
        solver_factory=lambda cube: Table2x2Solver(build_table(max_depth=2)),
        env={},
    )
    return TestClient(app)


def test_generate_and_get_benchmark(tmp_path) -> None:
    client = make_client(tmp_path)
    with client:
        response = client.post(
            "/api/benchmarks",
            json={
                "name": "demo",
                "cube": "2x2",
                "depths": [1, 2],
                "per_depth": 1,
                "seed": 3,
                "solver": "table",
            },
        )
        assert response.status_code == 201
        body = response.json()
        assert body["task_count"] == 2
        listed = client.get("/api/benchmarks").json()
        assert listed[0]["id"] == body["id"]
        detail = client.get(f"/api/benchmarks/{body['id']}").json()
        assert len(detail["tasks"]) == 2
        assert detail["tasks"][0]["reference_kind"] == "exact"


def test_bad_benchmark_request(tmp_path) -> None:
    client = make_client(tmp_path)
    with client:
        response = client.post(
            "/api/benchmarks",
            json={"name": "x", "cube": "2x2", "depths": [], "per_depth": 1},
        )
        assert response.status_code == 400
```

- [ ] **Step 2: 运行确认失败**

Run: `uv run pytest tests/api/test_providers_api.py tests/api/test_benchmarks_api.py -q`

Expected: FAIL with `ModuleNotFoundError: No module named 'mofang.api.app'`

- [ ] **Step 3: 实现 schemas、app 与两个路由**

`src/mofang/api/schemas.py`：

```python
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class ProviderCreate(BaseModel):
    name: str = Field(min_length=1)
    base_url: str = Field(min_length=1)
    model: str = Field(min_length=1)
    api_key_ref: str = Field(min_length=1)
    params: dict[str, Any] = Field(default_factory=dict)


class ProviderOut(BaseModel):
    id: str
    name: str
    base_url: str
    model: str
    api_key_ref: str
    params: dict[str, Any]
    key_configured: bool
    created_at: str


class BenchmarkCreate(BaseModel):
    name: str = Field(min_length=1)
    cube: Literal["2x2", "3x3"]
    depths: list[int] = Field(default_factory=lambda: [1, 2, 3])
    per_depth: int = Field(default=2, ge=1)
    seed: int = 42
    solver: Literal["table", "rubik"] = "table"


class BenchmarkOut(BaseModel):
    id: str
    name: str
    version: str
    kind: str
    cube: str
    content_hash: str
    frozen_at: str
    task_count: int


class BenchmarkDetail(BenchmarkOut):
    tasks: list[dict[str, Any]]


class RunCreate(BaseModel):
    provider_id: str
    benchmark_id: str
    tool_mode: Literal["both", "turn_only", "batch_only"] = "both"
    params: dict[str, Any] = Field(default_factory=dict)
    budget: dict[str, Any] = Field(default_factory=dict)
```

`src/mofang/api/app.py`：

```python
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import Callable

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from ..cube.solver import ReferenceSolver
from ..models.provider import ProviderAdapter
from ..service.factory import build_adapter, make_solver_factory
from ..service.runs import RunService
from ..store.db import Database
from ..store.providers import ProviderRecord
from ..store.runs import mark_running_interrupted
from .events import RunEventBus
from .routes import benchmarks, providers
from .settings import Settings


def create_app(
    settings: Settings | None = None,
    *,
    db: Database | None = None,
    provider_factory: Callable[[ProviderRecord], ProviderAdapter] | None = None,
    solver_factory: Callable[[str], ReferenceSolver] | None = None,
    env: dict[str, str] | None = None,
) -> FastAPI:
    resolved = settings or Settings.from_env()
    database = db or Database(resolved.db_path)
    events = RunEventBus()
    env_values = dict(os.environ) if env is None else dict(env)
    pfactory = provider_factory or (
        lambda record: build_adapter(record, env_values)
    )
    sfactory = solver_factory or make_solver_factory(resolved.table_path)
    service = RunService(database, events, pfactory, sfactory)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        database.initialize()
        mark_running_interrupted(database)
        yield

    app = FastAPI(title="mofang", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(resolved.cors_origins),
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.settings = resolved
    app.state.db = database
    app.state.events = events
    app.state.service = service
    app.state.provider_factory = pfactory
    app.state.solver_factory = sfactory
    app.state.env = env_values
    app.include_router(providers.router)
    app.include_router(benchmarks.router)
    return app
```

`src/mofang/api/routes/__init__.py` 为空文件。

`src/mofang/api/routes/providers.py`：

```python
from __future__ import annotations

import os

from fastapi import APIRouter, HTTPException, Request

from ...models.provider import ProviderError
from ...service.factory import ProviderConfigError
from ...store.providers import (
    ProviderRecord,
    create_provider,
    get_provider,
    list_providers,
)
from ..schemas import ProviderCreate, ProviderOut

router = APIRouter(prefix="/api/providers", tags=["providers"])


def _configured(request: Request, ref: str) -> bool:
    env = request.app.state.env
    values = os.environ if env is None else env
    return bool(values.get(ref))


def _out(request: Request, record: ProviderRecord) -> ProviderOut:
    return ProviderOut(
        id=record.id,
        name=record.name,
        base_url=record.base_url,
        model=record.model,
        api_key_ref=record.api_key_ref,
        params=record.params,
        key_configured=_configured(request, record.api_key_ref),
        created_at=record.created_at,
    )


@router.post("", response_model=ProviderOut, status_code=201)
def create(payload: ProviderCreate, request: Request) -> ProviderOut:
    if not payload.base_url.startswith(("http://", "https://")):
        raise HTTPException(400, "base_url must be http(s)")
    record = create_provider(
        request.app.state.db,
        name=payload.name,
        base_url=payload.base_url,
        model=payload.model,
        api_key_ref=payload.api_key_ref,
        params=payload.params,
    )
    return _out(request, record)


@router.get("", response_model=list[ProviderOut])
def list_all(request: Request) -> list[ProviderOut]:
    return [
        _out(request, record)
        for record in list_providers(request.app.state.db)
    ]


@router.post("/{provider_id}/probe")
async def probe(provider_id: str, request: Request) -> dict:
    record = get_provider(request.app.state.db, provider_id)
    if record is None:
        raise HTTPException(404, "provider not found")
    adapter = None
    try:
        adapter = request.app.state.provider_factory(record)
        tool_calling = await adapter.probe_tools()
    except ProviderConfigError as exc:
        raise HTTPException(400, str(exc)) from exc
    except ProviderError as exc:
        raise HTTPException(
            502, {"kind": exc.kind, "message": str(exc)}
        ) from exc
    finally:
        close = getattr(adapter, "close", None)
        if close is not None:
            await close()
    return {"ok": True, "tool_calling": tool_calling}
```

`src/mofang/api/routes/benchmarks.py`：

```python
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from ...store.benchmarks import (
    get_benchmark,
    list_benchmarks,
    save_benchmark,
)
from ...tasks.generator import generate_benchmark
from ..schemas import BenchmarkCreate, BenchmarkDetail, BenchmarkOut

router = APIRouter(prefix="/api/benchmarks", tags=["benchmarks"])


@router.post("", response_model=BenchmarkDetail, status_code=201)
def create(payload: BenchmarkCreate, request: Request) -> BenchmarkDetail:
    if not payload.depths or any(depth < 1 for depth in payload.depths):
        raise HTTPException(400, "depths must be positive")
    if payload.cube == "2x2" and payload.solver != "table":
        raise HTTPException(400, "2x2 requires table solver")
    if payload.cube == "3x3" and payload.solver != "rubik":
        raise HTTPException(400, "3x3 requires rubik solver")
    solver = None
    try:
        solver = request.app.state.solver_factory(payload.cube)
        benchmark = generate_benchmark(
            name=payload.name,
            cube=payload.cube,
            depths=payload.depths,
            per_depth=payload.per_depth,
            seed=payload.seed,
            solver=solver,
        )
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(400, str(exc)) from exc
    finally:
        close = getattr(solver, "close", None)
        if close is not None:
            close()
    benchmark.content_hash = benchmark.compute_hash()
    save_benchmark(
        request.app.state.db,
        benchmark,
        payload.model_dump(),
    )
    return BenchmarkDetail(
        **_benchmark_out(benchmark).model_dump(),
        tasks=[task.model_dump() for task in benchmark.tasks],
    )


def _benchmark_out(benchmark) -> BenchmarkOut:
    return BenchmarkOut(
        id=benchmark.id,
        name=benchmark.name,
        version=benchmark.version,
        kind=benchmark.kind,
        cube=benchmark.cube,
        content_hash=benchmark.content_hash,
        frozen_at=benchmark.created_at,
        task_count=len(benchmark.tasks),
    )


@router.get("", response_model=list[BenchmarkOut])
def list_all(request: Request) -> list[BenchmarkOut]:
    return [BenchmarkOut(**item) for item in list_benchmarks(request.app.state.db)]


@router.get("/{benchmark_id}", response_model=BenchmarkDetail)
def detail(benchmark_id: str, request: Request) -> BenchmarkDetail:
    benchmark = get_benchmark(request.app.state.db, benchmark_id)
    if benchmark is None:
        raise HTTPException(404, "benchmark not found")
    return BenchmarkDetail(
        **_benchmark_out(benchmark).model_dump(),
        tasks=[task.model_dump() for task in benchmark.tasks],
    )
```

- [ ] **Step 4: 跑测试**

Run: `uv run pytest tests/api/test_providers_api.py tests/api/test_benchmarks_api.py -q`

Expected: `5 passed`

- [ ] **Step 5: 提交**

```bash
git add src/mofang/api/schemas.py src/mofang/api/app.py src/mofang/api/routes tests/api/test_providers_api.py tests/api/test_benchmarks_api.py
git commit -m "feat: FastAPI app 与 provider/benchmark 路由"
```

### Task 11: Run / Episode / SSE / Report / Export 路由

**Files:**
- Create: `src/mofang/api/routes/runs.py`
- Create: `src/mofang/api/routes/episodes.py`
- Modify: `src/mofang/api/schemas.py`
- Test: `tests/api/test_runs_api.py`

**Interfaces:**
- Consumes: `RunService`、`RunEventBus`、store 函数、`budget_for`、`asdict`
- Produces:
  - `POST/GET /api/runs`、`GET /api/runs/{id}`、`GET /api/runs/{id}/snapshot`
  - `GET /api/runs/{id}/events`（SSE，支持 `Last-Event-ID`）
  - `POST /api/runs/{id}/cancel`
  - `GET /api/runs/{id}/report`、`GET /api/runs/{id}/export?format=csv|md`
  - `GET /api/episodes/{id}`、`GET /api/episodes/{id}/steps`

- [ ] **Step 1: 写失败测试**

`tests/api/test_runs_api.py`：

```python
import time
from pathlib import Path

from fastapi.testclient import TestClient

from mofang.api.app import create_app
from mofang.cube.moves import apply_moves
from mofang.cube.state import CubeState
from mofang.cube.table2x2 import Table2x2Solver, build_table
from mofang.models.provider import FakeProvider, ModelTurn, ToolCall
from mofang.store.benchmarks import save_benchmark
from mofang.store.db import Database
from mofang.tasks.models import Benchmark, Task


def make_app(tmp_path: Path, turns) -> tuple[TestClient, str]:
    db = Database(tmp_path / "t.db")
    db.initialize()
    state = apply_moves(CubeState.solved(2), ["R"])
    benchmark = Benchmark(
        id="bench",
        name="demo",
        cube="2x2",
        tasks=[
            Task(
                id="t1", cube="2x2", scramble=["R"], scramble_depth=1,
                state=state.to_json(), reference_length=1,
                reference_kind="exact", bin="1",
            )
        ],
    )
    save_benchmark(db, benchmark, {"seed": 3})
    provider = FakeProvider(turns)
    app = create_app(
        db=db,
        provider_factory=lambda record: provider,
        solver_factory=lambda cube: Table2x2Solver(build_table(max_depth=2)),
        env={},
    )
    return TestClient(app), benchmark.id


def wait_finished(client: TestClient, run_id: str, timeout: float = 10.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        run = client.get(f"/api/runs/{run_id}").json()["run"]
        if run["status"] not in ("queued", "running"):
            return run
        time.sleep(0.05)
    raise AssertionError("run did not finish")


def seed(client: TestClient) -> str:
    provider = client.post(
        "/api/providers",
        json={
            "name": "p", "base_url": "http://localhost:1/v1",
            "model": "m", "api_key_ref": "KEY",
        },
    ).json()
    return provider["id"]


def test_run_lifecycle_report_and_export(tmp_path: Path) -> None:
    client, benchmark_id = make_app(
        tmp_path,
        [
            ModelTurn(
                tool_calls=[
                    ToolCall(id="c1", name="apply_moves", arguments={"moves": ["R'"]})
                ]
            )
        ],
    )
    with client:
        provider_id = seed(client)
        response = client.post(
            "/api/runs",
            json={"provider_id": provider_id, "benchmark_id": benchmark_id},
        )
        assert response.status_code == 202
        run_id = response.json()["id"]
        run = wait_finished(client, run_id)
        assert run["status"] == "finished"
        episodes = client.get(f"/api/runs/{run_id}").json()["episodes"]
        assert episodes[0]["solved"] is True
        report = client.get(f"/api/runs/{run_id}/report").json()
        assert report["totals"]["solved"] == 1
        steps = client.get(f"/api/episodes/{episodes[0]['id']}/steps").json()
        assert any(step["tool_name"] == "apply_moves" for step in steps)
        assert any(step["kind"] == "model_message" for step in steps)
        snapshot = client.get(f"/api/runs/{run_id}/snapshot").json()
        assert snapshot["last_event_id"] >= 1
        csv = client.get(f"/api/runs/{run_id}/export?format=csv")
        assert csv.status_code == 200
        assert "apply_moves" not in csv.text
        assert "task_id,status,solved" in csv.text
        md = client.get(f"/api/runs/{run_id}/export?format=md")
        assert md.status_code == 200
        assert "| task_id |" in md.text
        bad = client.get(f"/api/runs/{run_id}/export?format=xml")
        assert bad.status_code == 400


def test_sse_replays_and_finishes(tmp_path: Path) -> None:
    client, benchmark_id = make_app(
        tmp_path,
        [
            ModelTurn(
                tool_calls=[
                    ToolCall(id="c1", name="apply_moves", arguments={"moves": ["R'"]})
                ]
            )
        ],
    )
    with client:
        provider_id = seed(client)
        run_id = client.post(
            "/api/runs",
            json={"provider_id": provider_id, "benchmark_id": benchmark_id},
        ).json()["id"]
        wait_finished(client, run_id)
        seen = []
        with client.stream("GET", f"/api/runs/{run_id}/events") as response:
            assert response.status_code == 200
            for line in response.iter_lines():
                if line.startswith("event: "):
                    seen.append(line.split(": ", 1)[1])
                    if line.endswith("run.finished"):
                        break
        assert "run.started" in seen
        assert "tool.call" in seen
        assert seen[-1] == "run.finished"


def test_cancel_and_missing(tmp_path: Path) -> None:
    client, _ = make_app(tmp_path, [])
    with client:
        assert client.get("/api/runs/nope").status_code == 404
        assert client.get("/api/runs/nope/events").status_code == 404
        assert client.post("/api/runs/nope/cancel").status_code == 404
```

- [ ] **Step 2: 运行确认失败**

Run: `uv run pytest tests/api/test_runs_api.py -q`

Expected: FAIL（404/路由不存在）

- [ ] **Step 3: 扩展 schemas 并实现路由**

在 `src/mofang/api/schemas.py` 追加：

```python
class RunOut(BaseModel):
    id: str
    provider_id: str
    benchmark_id: str
    tool_mode: str
    prompt_version: str
    status: str
    totals: dict[str, Any] | None
    error: str | None
    created_at: str
    started_at: str | None
    finished_at: str | None


class EpisodeOut(BaseModel):
    id: str
    run_id: str
    task_id: str
    task_key: str
    status: str
    solved: bool
    moves_used: int
    reference_length: int
    efficiency: float | None
    progress_ratio: float | None
    protocol_errors: int
    tokens_in: int | None
    tokens_out: int | None
    latency_ms: int | None
    failure_code: str | None
    error: str | None
    started_at: str | None
    finished_at: str | None


class StepOut(BaseModel):
    id: str
    seq: int
    kind: str
    tool_name: str | None
    arguments: dict[str, Any] | None
    result: dict[str, Any] | None
    state: dict[str, Any] | None
    reference_length_after: int | None
```

`src/mofang/api/routes/runs.py`：

```python
from __future__ import annotations

import csv
import io
from dataclasses import asdict

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import Response, StreamingResponse

from ...service.factory import budget_for
from ...store.benchmarks import get_benchmark
from ...store.providers import get_provider
from ...store.runs import (
    create_run,
    get_episode,
    get_run,
    get_run_episodes,
    get_steps,
    list_runs,
)
from ..events import parse_last_event_id
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
    provider = get_provider(db, payload.provider_id)
    benchmark = get_benchmark(db, payload.benchmark_id)
    if provider is None:
        raise HTTPException(404, "provider not found")
    if benchmark is None:
        raise HTTPException(404, "benchmark not found")
    try:
        budget = asdict(budget_for(benchmark.cube, payload.budget))
    except TypeError as exc:
        raise HTTPException(400, f"invalid budget: {exc}") from exc
    run_id = create_run(
        db,
        provider_id=provider.id,
        benchmark_id=benchmark.id,
        tool_mode=payload.tool_mode,
        prompt_version="v1",
        params=payload.params,
        budget=budget,
    )
    request.app.state.service.start(run_id)
    return {"id": run_id}


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


@router.get("/{run_id}/snapshot")
def snapshot(run_id: str, request: Request) -> dict:
    db = request.app.state.db
    run = get_run(db, run_id)
    if run is None:
        raise HTTPException(404, "run not found")
    episodes = get_run_episodes(db, run_id)
    current_state = None
    if episodes:
        last = episodes[-1]
        current_state = last["final_state"]
        if last["status"] == "running":
            steps = get_steps(db, last["id"])
            if steps:
                current_state = steps[-1]["state"]
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
):
    if get_run(request.app.state.db, run_id) is None:
        raise HTTPException(404, "run not found")
    stream = request.app.state.events.stream(
        run_id, after=parse_last_event_id(last_event_id)
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
    episodes = [_episode_out(item).model_dump() for item in get_run_episodes(db, run_id)]
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
    episodes = [_episode_out(item).model_dump() for item in get_run_episodes(db, run_id)]
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
            headers={"Content-Disposition": f'attachment; filename="run-{run_id}.csv"'},
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
            headers={"Content-Disposition": f'attachment; filename="run-{run_id}.md"'},
        )
    raise HTTPException(400, "format must be csv or md")
```

`src/mofang/api/routes/episodes.py`：

```python
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from ...store.runs import get_episode, get_steps
from ..schemas import EpisodeOut, StepOut

router = APIRouter(prefix="/api/episodes", tags=["episodes"])


@router.get("/{episode_id}", response_model=EpisodeOut)
def detail(episode_id: str, request: Request) -> EpisodeOut:
    episode = get_episode(request.app.state.db, episode_id)
    if episode is None:
        raise HTTPException(404, "episode not found")
    data = dict(episode)
    data["task_key"] = data["task_id"].split(":", 1)[-1]
    return EpisodeOut(**data)


@router.get("/{episode_id}/steps", response_model=list[StepOut])
def steps(episode_id: str, request: Request) -> list[StepOut]:
    if get_episode(request.app.state.db, episode_id) is None:
        raise HTTPException(404, "episode not found")
    return [StepOut(**item) for item in get_steps(request.app.state.db, episode_id)]
```

在 `src/mofang/api/app.py` 中把导入改为 `from .routes import benchmarks, episodes, providers, runs`，并在 `include_router` 增加 `runs.router` 与 `episodes.router`。

- [ ] **Step 4: 跑测试**

Run: `uv run pytest tests/api/test_runs_api.py -q`

Expected: `3 passed`

- [ ] **Step 5: 提交**

```bash
git add src/mofang/api/routes/runs.py src/mofang/api/routes/episodes.py src/mofang/api/schemas.py src/mofang/api/app.py tests/api/test_runs_api.py
git commit -m "feat: run/episode/SSE/报告/导出路由"
```

---

### Task 12: 同基准集对比

**Files:**
- Create: `src/mofang/eval/compare.py`
- Create: `src/mofang/api/routes/compare.py`
- Modify: `src/mofang/api/app.py`
- Test: `tests/eval/test_compare.py`
- Test: `tests/api/test_compare_api.py`

**Interfaces:**
- Consumes: `Database`、`get_run`、`get_run_episodes`、`get_benchmark`
- Produces:
  - `bootstrap_diff_ci(diffs: list[float], n=2000, seed=0) -> tuple[float, float, float]`（observed, low, high）
  - `compare_runs(db, run_ids: list[str]) -> dict`
  - `GET /api/compare?run_ids=a,b`

- [ ] **Step 1: 写失败测试**

`tests/eval/test_compare.py`：

```python
from mofang.eval.compare import bootstrap_diff_ci


def test_bootstrap_deterministic_and_bounded() -> None:
    observed, low, high = bootstrap_diff_ci([1.0, 0.0, 1.0, 1.0], n=500, seed=7)
    assert observed == 0.75
    assert low <= observed <= high
    assert 0.0 <= low <= high <= 1.0


def test_bootstrap_empty() -> None:
    assert bootstrap_diff_ci([]) == (0.0, 0.0, 0.0)
```

`tests/api/test_compare_api.py`：

```python
from pathlib import Path

from fastapi.testclient import TestClient

from mofang.api.app import create_app
from mofang.store.db import Database


def test_compare_requires_two_runs(tmp_path: Path) -> None:
    app = create_app(db=Database(tmp_path / "t.db"), env={})
    with TestClient(app) as client:
        assert client.get("/api/compare?run_ids=a").status_code == 400
        assert client.get("/api/compare?run_ids=a,b").status_code == 404
```

- [ ] **Step 2: 运行确认失败**

Run: `uv run pytest tests/eval/test_compare.py tests/api/test_compare_api.py -q`

Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现对比**

`src/mofang/eval/compare.py`：

```python
from __future__ import annotations

import random

from ..store.benchmarks import get_benchmark
from ..store.db import Database
from ..store.runs import get_run, get_run_episodes


def bootstrap_diff_ci(
    diffs: list[float], n: int = 2000, seed: int = 0
) -> tuple[float, float, float]:
    if not diffs:
        return 0.0, 0.0, 0.0
    observed = sum(diffs) / len(diffs)
    rng = random.Random(seed)
    samples = []
    for _ in range(n):
        total = 0.0
        for _ in diffs:
            total += diffs[rng.randrange(len(diffs))]
        samples.append(total / len(diffs))
    samples.sort()
    low = samples[int(0.025 * (n - 1))]
    high = samples[int(0.975 * (n - 1))]
    return observed, low, high


def compare_runs(db: Database, run_ids: list[str]) -> dict:
    if len(run_ids) != 2:
        raise ValueError("exactly two runs required")
    runs = [get_run(db, run_id) for run_id in run_ids]
    if any(run is None for run in runs):
        raise LookupError("run not found")
    first, second = runs
    assert first is not None and second is not None
    if first["benchmark_id"] != second["benchmark_id"]:
        raise ValueError("runs use different benchmarks")
    first_bench = get_benchmark(db, first["benchmark_id"])
    second_bench = get_benchmark(db, second["benchmark_id"])
    if first_bench is None or second_bench is None:
        raise ValueError("benchmark not found")
    if first_bench.content_hash != second_bench.content_hash:
        raise ValueError("benchmark content hash mismatch")
    first_eps = {item["task_id"]: item for item in get_run_episodes(db, first["id"])}
    second_eps = {item["task_id"]: item for item in get_run_episodes(db, second["id"])}
    keys = sorted(set(first_eps) & set(second_eps))
    pairs = []
    diffs = []
    for key in keys:
        a, b = first_eps[key], second_eps[key]
        delta = int(b["solved"]) - int(a["solved"])
        diffs.append(float(delta))
        pairs.append(
            {
                "task_id": key.split(":", 1)[-1],
                "first_solved": bool(a["solved"]),
                "second_solved": bool(b["solved"]),
                "delta": delta,
            }
        )
    observed, low, high = bootstrap_diff_ci(diffs)
    return {
        "benchmark_id": first["benchmark_id"],
        "content_hash": first_bench.content_hash,
        "tasks": len(keys),
        "runs": run_ids,
        "solve_rate_first": sum(1 for item in keys if first_eps[item]["solved"]) / len(keys) if keys else 0.0,
        "solve_rate_second": sum(1 for item in keys if second_eps[item]["solved"]) / len(keys) if keys else 0.0,
        "solve_rate_diff": observed,
        "ci95": [low, high],
        "pairs": pairs,
    }
```

`src/mofang/api/routes/compare.py`：

```python
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from ...eval.compare import compare_runs

router = APIRouter(prefix="/api/compare", tags=["compare"])


@router.get("")
def compare(run_ids: str, request: Request) -> dict:
    ids = [item.strip() for item in run_ids.split(",") if item.strip()]
    if len(ids) != 2:
        raise HTTPException(400, "exactly two run_ids required")
    try:
        return compare_runs(request.app.state.db, ids)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
```

在 `app.py` 包含 `compare.router`。

- [ ] **Step 4: 跑测试**

Run: `uv run pytest tests/eval/test_compare.py tests/api/test_compare_api.py -q`

Expected: `3 passed`

- [ ] **Step 5: 提交**

```bash
git add src/mofang/eval/compare.py src/mofang/api/routes/compare.py src/mofang/api/app.py tests/eval/test_compare.py tests/api/test_compare_api.py
git commit -m "feat: 同基准集配对对比与 bootstrap CI"
```

---

### Task 13: serve CLI、文档与端到端冒烟

**Files:**
- Modify: `src/mofang/cli.py`
- Modify: `README.md`
- Modify: `PROJECT-PASSPORT.md`
- Test: `tests/test_cli.py`

**Interfaces:**
- Consumes: `create_app`、`Settings`、`uvicorn`
- Produces: `mofang serve --host --port --db --table`

- [ ] **Step 1: 写失败测试**

在 `tests/test_cli.py` 追加：

```python
def test_serve_parser_defaults() -> None:
    from mofang.cli import build_parser

    args = build_parser().parse_args(["serve"])
    assert args.command == "serve"
    assert args.host == "127.0.0.1"
    assert args.port == 8000
    assert args.db == "data/mofang.db"
    assert args.table == "data/cache/2x2_distances.pkl"
```

- [ ] **Step 2: 运行确认失败**

Run: `uv run pytest tests/test_cli.py::test_serve_parser_defaults -q`

Expected: FAIL（`serve` 不存在）

- [ ] **Step 3: 实现 serve 与文档**

`src/mofang/cli.py`：

- 在 `build_parser()` 增加：

```python
    serve = sub.add_parser("serve", help="run the local API server")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8000)
    serve.add_argument("--db", default="data/mofang.db")
    serve.add_argument("--table", default="data/cache/2x2_distances.pkl")
```

- 在 `main()` 的分发里增加：

```python
    if args.command == "serve":
        return _serve(args)
```

- 新增：

```python
def _serve(args: argparse.Namespace) -> int:
    import uvicorn

    from .api.app import create_app
    from .api.settings import Settings

    settings = Settings(
        db_path=Path(args.db),
        table_path=Path(args.table),
        host=args.host,
        port=args.port,
    )
    uvicorn.run(create_app(settings), host=args.host, port=args.port)
    return 0
```

`README.md` 增加“本地 API”小节：

````markdown
## 本地 API

```bash
uv run mofang serve --port 8000
curl -s http://127.0.0.1:8000/api/benchmarks
```

Provider 的 `api_key_ref` 是环境变量名；启动服务前导出该变量：

```bash
export OPENAI_API_KEY=...
uv run mofang serve
```

启动 run 后通过 SSE 观察事件：

```bash
curl -N http://127.0.0.1:8000/api/runs/<id>/events
```
````

`PROJECT-PASSPORT.md` 的端口表改为：

```markdown
- Plan 1：CLI，无服务端口。
- M2：FastAPI `127.0.0.1:8000`（`uv run mofang serve`）；DB 默认 `data/mofang.db`。
- M3：Vite `127.0.0.1:5173`。
```

- [ ] **Step 4: 跑测试与手动冒烟**

Run: `uv run pytest -q`

Expected: 全绿。

手动冒烟（真实网关，key 只放环境变量）：

```bash
export OPENAI_API_KEY=...
uv run mofang serve --port 8000   # 后台
curl -s -X POST http://127.0.0.1:8000/api/providers \
  -H "Content-Type: application/json" \
  -d '{"name":"local","base_url":"http://localhost:20128/v1","model":"ollama/gpt-oss:120b","api_key_ref":"OPENAI_API_KEY"}'
curl -s -X POST http://127.0.0.1:8000/api/providers/<id>/probe
curl -s -X POST http://127.0.0.1:8000/api/benchmarks \
  -H "Content-Type: application/json" \
  -d '{"name":"smoke","cube":"2x2","depths":[1],"per_depth":1,"seed":3}'
curl -s -X POST http://127.0.0.1:8000/api/runs \
  -H "Content-Type: application/json" \
  -d '{"provider_id":"<id>","benchmark_id":"<id>"}'
curl -N http://127.0.0.1:8000/api/runs/<run_id>/events
```

Expected：事件从 `run.started` 到 `run.finished`；报告可读；服务停止后重启，未完成 run 变为 `interrupted`。

- [ ] **Step 5: 提交**

```bash
git add src/mofang/cli.py README.md PROJECT-PASSPORT.md tests/test_cli.py
git commit -m "feat: mofang serve 本地 API 与文档"
```

---

## 范围说明（本计划不做）

- React/three.js 工作台、Playwright E2E：M3 单独计划。
- 多 trial / `pass@k`：M4；当前一次 run 每题一局。
- USD 成本上限与价格表：无定价数据，`cost_usd` 记 null。
- provider 原始响应 artifact：`artifacts` 表已建但本计划不写入（prompt 快照/原始响应后续补）。
- 流式推理展示、多模态输入、3x3 精确最优：后置。
- 同一 run 内并发 episode：MVP 串行；跨 run 由 `RunService._lock` 串行。

## Self-Review

**Spec coverage：**
- §8.6 API 表：providers（create/list/probe）、benchmarks（list/create/detail）、runs（create/list/detail/snapshot/events/cancel/report/export）、episodes（detail/steps）、compare —— Task 10–12 覆盖。
- SSE 事件：run.started/episode.started/model.turn.started/model.message/tool.call/tool.result/move.applied/episode.finished/run.finished/run.error —— Task 7–9 覆盖。
- §8.4 数据模型：providers/benchmarks/tasks/runs/episodes/steps/artifacts —— Task 2 建表；Task 3–5 读写；artifacts 建表但本计划不写入（见范围说明）。
- §10 安全：127.0.0.1、CORS 白名单、key 只存引用 —— Task 1/3/10 覆盖。
- §8.1 状态机：solved/stopped_unsolved/budget_exceeded/timeout/protocol_error/provider_error/cancelled/interrupted —— Plan 1 runner + Task 5/8/9 覆盖。
- §8.5 基准集版本：content_hash 冻结与对比校验 —— Task 4/12 覆盖。

**Placeholder scan：** 无 TBD/TODO；所有步骤含实际代码或命令。

**Type consistency：**
- task 行 id 统一 `f"{benchmark_id}:{task_id}"`（Task 4 `task_row_id`，Task 9 使用同格式）。
- `EpisodeResult`/`StepRecord` 字段与 Plan 1 一致；`error` 字段已在 Plan 1 加入。
- 事件总线 `Event` 字段与 SSE data 一致。
- `budget_for` 返回 `Budget`，`asdict` 后写入 `runs.budget_json`；`RunService` 再次合并默认值，幂等。


