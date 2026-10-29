# M3 本地工作台实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 FastAPI/SSE 后端之上交付 React + three.js 本地工作台：配置 provider、生成基准集、启动 run、实时 3D 回放、结果与单题回放。

**Architecture:** 后端先做 7 项小契约扩展（事件字段、snapshot、SSE `after`、Benchmark 409、静态托管），前端用 Vite SPA 消费 REST + SSE。3D 采用“槽位 cubie + 刚性旋转 + 批次末按权威 facelet 重涂”，前端不做距离/解出率计算。E2E 用独立 mock OpenAI 服务，生产代码不内置假模型。

**Tech Stack:** Python 3.12 / FastAPI / SQLite / pytest；React 19 / TypeScript / Vite / Tailwind v4 / TanStack Query / three / @react-three/fiber / @react-three/drei；Vitest / React Testing Library / Playwright。

**Spec:** `docs/superpowers/specs/2026-10-26-m3-workbench-design.md`

## Global Constraints

- 只在本地提交，不推送远程；当前基线分支 `plan/api-workbench`，实施前创建 `plan/m3-workbench`。
- 每个任务严格 TDD：先写失败测试，确认失败，再写最小实现，测试通过后提交。
- 后端密钥只从环境变量读取；任何文件、DB、日志、测试快照都不得写入真实 key。
- 服务默认绑定 `127.0.0.1`；CORS 只允许 `127.0.0.1:5173` / `localhost:5173`。
- GPL 边界不变：只有 `src/mofang/cube/solver_worker.py` 可以 `import twophase`；前端、API、store 不得导入。
- 文档与界面文案用中文；代码注释只在“为什么”不明显时写一行。
- 现有 159 项后端测试必须保持全绿。
- 2x2 距离表必须存在于 `data/cache/2x2_distances.pkl`；缺失时先运行 `uv run python scripts/build_2x2_table.py --max-depth 11 --out data/cache/2x2_distances.pkl`。
- 3x3 生成需要 `uv sync --extra dev --extra solver` 且已建 `twophase/` 表；M3 自动化测试不生成 3x3 题集。
- 前端依赖锁 `frontend/package-lock.json`；`node_modules/`、`dist/` 不提交。
- 统一验证命令：
  - 后端：`uv run pytest -q`
  - 前端：`cd frontend && npm run typecheck && npm run test:run && npm run build`
  - E2E：`cd frontend && npm run e2e`
- E2E 固定端口：mock `20129`、API `8000`、Vite `5173`；E2E 使用临时 DB `data/e2e-<timestamp>.db`（已 gitignore）。

---

## 文件结构

```text
frontend/
  package.json
  vite.config.ts                 # Vite + Tailwind + /api 代理
  vitest.config.ts               # jsdom + setup
  playwright.config.ts           # mock/API/Vite 三进程
  e2e/workbench.spec.ts
  src/
    main.tsx                     # QueryClient + BrowserRouter
    App.tsx                      # 路由与布局
    index.css                    # Tailwind 与基础主题
    test/setup.ts
    lib/format.ts                # 时间/百分比/状态/颜色格式化
    api/types.ts                 # API 与 SSE 类型
    api/client.ts                # fetch 封装、错误归一化、导出 URL
    api/queries.ts               # TanStack Query hooks
    components/Layout.tsx
    components/StatusBadge.tsx
    components/ProgressChart.tsx
    components/ToolLog.tsx
    pages/ProvidersPage.tsx      # ProvidersView + 容器
    pages/BenchmarksPage.tsx     # 列表/生成
    pages/BenchmarkDetailPage.tsx
    pages/NewRunPage.tsx
    pages/RunsPage.tsx
    pages/RunPage.tsx
    pages/EpisodePage.tsx
    cube/facelets.ts             # facelet → 槽位/法线
    cube/moves.ts                # move → 轴/层/方向
    cube/repaint.ts              # state → 贴纸涂色计划
    cube/CubeView.tsx            # r3f Canvas + 动画队列
    hooks/liveReducer.ts         # SSE 事件 → 页面状态
    hooks/useRunEvents.ts        # snapshot + EventSource + 重连
scripts/
  fake_openai_server.py          # E2E/演示用 OpenAI-compatible mock
```

后端修改文件：

- `src/mofang/runner/episode.py`：事件字段。
- `src/mofang/api/schemas.py`：`RunOut.budget`。
- `src/mofang/api/events.py`：`effective_after`。
- `src/mofang/api/routes/runs.py`：SSE `after`、snapshot 实时局面。
- `src/mofang/api/routes/benchmarks.py`：重复基准集 409。
- `src/mofang/api/settings.py`、`src/mofang/api/app.py`：静态托管。

---

### Task 1: 事件携带参照距离与累计 tokens

**Files:**
- Modify: `src/mofang/runner/episode.py`
- Test: `tests/runner/test_episode.py`

**Interfaces:**
- Consumes: `EpisodeRunner.run()` 已有 `emit(kind, payload)`。
- Produces:
  - `move.applied` data 增加 `reference_length_after: int | None`
  - `model.message` data 增加 `usage: {"prompt_tokens": int, "completion_tokens": int}`（当前 episode 累计）

- [ ] **Step 1: 写失败测试**

在 `tests/runner/test_episode.py` 顶部补充导入：

```python
from mofang.models.provider import FakeProvider, ModelTurn, ToolCall, Usage
```

（若已有前三个导入，只补 `Usage`。）

在文件末尾追加：

```python
async def test_events_include_progress_and_usage(table_solver: Table2x2Solver) -> None:
    task = make_task(table_solver, ["R"])
    provider = FakeProvider(
        [
            ModelTurn(
                tool_calls=[
                    ToolCall(
                        id="c1",
                        name="apply_moves",
                        arguments={"moves": ["R'"]},
                    )
                ],
                usage=Usage(prompt_tokens=11, completion_tokens=7),
            )
        ]
    )
    events: list[tuple[str, dict]] = []

    def emit(kind: str, payload: dict) -> None:
        events.append((kind, payload))

    result = await EpisodeRunner(
        provider=provider,
        solver=table_solver,
        budget=Budget(max_moves=10),
    ).run(task, emit=emit)

    message = [payload for kind, payload in events if kind == "model.message"][-1]
    assert message["usage"] == {
        "prompt_tokens": 11,
        "completion_tokens": 7,
    }
    move = [payload for kind, payload in events if kind == "move.applied"][-1]
    assert move["reference_length_after"] == 0
    assert result.status == EpisodeStatus.SOLVED
```

- [ ] **Step 2: 运行确认失败**

Run: `uv run pytest tests/runner/test_episode.py::test_events_include_progress_and_usage -q`

Expected: FAIL，`KeyError: 'usage'` 或 `KeyError: 'reference_length_after'`。

- [ ] **Step 3: 扩展事件 payload**

在 `src/mofang/runner/episode.py` 找到 `model.message` 的 `notify`：

```python
            notify(
                "model.message",
                {"content": turn.content, "tool_calls": len(turn.tool_calls)},
            )
```

改为：

```python
            notify(
                "model.message",
                {
                    "content": turn.content,
                    "tool_calls": len(turn.tool_calls),
                    "usage": {
                        "prompt_tokens": tokens_in,
                        "completion_tokens": tokens_out,
                    },
                },
            )
```

找到 `move.applied` 的 `notify`：

```python
                        notify(
                            "move.applied",
                            {
                                "moves": outcome.applied,
                                "state": executor.state.to_json(),
                                "moves_used": executor.moves_used,
                                "solved": executor.state.is_solved(),
                            },
                        )
```

改为：

```python
                        notify(
                            "move.applied",
                            {
                                "moves": outcome.applied,
                                "state": executor.state.to_json(),
                                "moves_used": executor.moves_used,
                                "solved": executor.state.is_solved(),
                                "reference_length_after": length_after,
                            },
                        )
```

`length_after` 已在同一循环中、`move.applied` 之前计算，直接复用。

- [ ] **Step 4: 运行测试**

Run: `uv run pytest tests/runner/test_episode.py -q`

Expected: 全部通过。

- [ ] **Step 5: 提交**

```bash
git add src/mofang/runner/episode.py tests/runner/test_episode.py
git commit -m "feat: 事件携带参照距离与累计 tokens"
```

---

### Task 2: RunOut 暴露预算

**Files:**
- Modify: `src/mofang/api/schemas.py`
- Test: `tests/api/test_runs_api.py`

**Interfaces:**
- Consumes: `get_run()` 已返回 `budget` 字典。
- Produces: `RunOut.budget: dict[str, Any]`，供运行页显示上限。

- [ ] **Step 1: 写失败测试**

在 `tests/api/test_runs_api.py::test_run_lifecycle_report_and_export` 的 `run = wait_finished(...)` 之后追加：

```python
        assert run["budget"]["max_moves"] == 30
        assert run["budget"]["turn_timeout"] == 120.0
```

- [ ] **Step 2: 运行确认失败**

Run: `uv run pytest tests/api/test_runs_api.py::test_run_lifecycle_report_and_export -q`

Expected: FAIL，`KeyError: 'budget'` 或 Pydantic 缺字段。

- [ ] **Step 3: 增加字段**

在 `src/mofang/api/schemas.py` 的 `RunOut` 中，`tool_mode` 之后加入：

```python
    budget: dict[str, Any]
```

- [ ] **Step 4: 运行测试**

Run: `uv run pytest tests/api/test_runs_api.py -q`

Expected: 3 passed。

- [ ] **Step 5: 提交**

```bash
git add src/mofang/api/schemas.py tests/api/test_runs_api.py
git commit -m "feat: RunOut 暴露预算"
```

---

### Task 3: SSE 支持 after 查询参数

**Files:**
- Modify: `src/mofang/api/events.py`
- Modify: `src/mofang/api/routes/runs.py`
- Test: `tests/api/test_events.py`
- Test: `tests/api/test_runs_api.py`

**Interfaces:**
- Produces: `effective_after(last_event_id: str | None, after: int | None) -> int`
- 路由：`GET /api/runs/{id}/events?after=N`，与 `Last-Event-ID` 取较大值。

- [ ] **Step 1: 写失败测试**

在 `tests/api/test_events.py` 追加：

```python
def test_effective_after_prefers_larger_value() -> None:
    assert effective_after("3", 5) == 5
    assert effective_after("7", 2) == 7
    assert effective_after(None, None) == 0
    assert effective_after("bad", 4) == 4
```

并把导入改为：

```python
from mofang.api.events import (
    RunEventBus,
    effective_after,
    format_sse,
    parse_last_event_id,
)
```

在 `tests/api/test_runs_api.py::test_run_lifecycle_report_and_export` 末尾追加：

```python
        with client.stream(
            "GET", f"/api/runs/{run_id}/events?after=abc"
        ) as response:
            assert response.status_code == 422
```

用 `client.stream` 而不是 `client.get`：SSE 端点在参数校验缺失时会持续发心跳、永不结束，`client.get` 会挂住整个测试会话；`stream` 上下文读到 422 响应即结束。

- [ ] **Step 2: 运行确认失败**

Run: `uv run pytest tests/api/test_events.py::test_effective_after_prefers_larger_value tests/api/test_runs_api.py::test_run_lifecycle_report_and_export -q`

Expected: FAIL，`ImportError: effective_after`；路由查询参数校验可能已经是 422。

- [ ] **Step 3: 实现 helper 与路由参数**

在 `src/mofang/api/events.py` 的 `parse_last_event_id` 之后加入：

```python
def effective_after(last_event_id: str | None, after: int | None) -> int:
    return max(parse_last_event_id(last_event_id), after or 0)
```

在 `src/mofang/api/routes/runs.py` 中：

- 导入 `Query`：

```python
from fastapi import APIRouter, Header, HTTPException, Query, Request
```

- 导入 `effective_after`，不再需要 `parse_last_event_id`：

```python
from ..events import effective_after
```

- 修改路由签名与调用：

```python
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
```

- [ ] **Step 4: 运行测试**

Run: `uv run pytest tests/api/test_events.py tests/api/test_runs_api.py -q`

Expected: 全部通过（events 4 项、runs 3 项）。

- [ ] **Step 5: 提交**

```bash
git add src/mofang/api/events.py src/mofang/api/routes/runs.py tests/api/test_events.py tests/api/test_runs_api.py
git commit -m "feat: SSE 支持 after 查询参数"
```

---

### Task 4: snapshot 返回运行中 episode 的实时局面

**Files:**
- Modify: `src/mofang/api/routes/runs.py`
- Test: `tests/api/test_runs_api.py`

**Interfaces:**
- Consumes: `RunEventBus.history()`、`get_steps()`、`get_benchmark()`。
- Produces: `GET /api/runs/{id}/snapshot` 的 `current_state` 在 episode 运行中且无 step 时，依次回退：
  1. 最后一个 `move.applied` 的 `data.state`
  2. 最后一个 `tool.result` 的 `data.payload.state`
  3. 该题 `task.state`
  4. `null`

- [ ] **Step 1: 写失败测试**

在 `tests/api/test_runs_api.py` 顶部补充导入：

```python
from mofang.store.providers import create_provider
from mofang.store.runs import create_episode, create_run
from mofang.store.benchmarks import task_row_id
```

在文件末尾追加：

```python
def test_snapshot_returns_live_state_from_events(tmp_path: Path) -> None:
    db = Database(tmp_path / "snap.db")
    state = apply_moves(CubeState.solved(2), ["R"])
    live = apply_moves(CubeState.solved(2), ["U"])
    benchmark = Benchmark(
        id="snap-bench",
        name="snap",
        cube="2x2",
        tasks=[
            Task(
                id="t1", cube="2x2", scramble=["R"], scramble_depth=1,
                state=state.to_json(), reference_length=1,
                reference_kind="exact", bin="1",
            )
        ],
    )
    app = create_app(
        db=db,
        provider_factory=lambda record: FakeProvider([]),
        solver_factory=lambda cube: None,
        env={},
    )
    with TestClient(app) as client:
        save_benchmark(db, benchmark, {})
        provider = create_provider(
            db, name="p", base_url="http://localhost:1/v1",
            model="m", api_key_ref="KEY",
        )
        run_id = create_run(
            db, provider_id=provider.id, benchmark_id=benchmark.id,
            tool_mode="both", prompt_version="v1", params={}, budget={},
        )
        episode_id = create_episode(
            db, run_id=run_id,
            task_row_id=task_row_id(benchmark.id, "t1"),
            reference_length=1,
            started_at="2026-10-26T00:00:00+00:00",
        )
        app.state.events.publish(
            run_id,
            "move.applied",
            {"moves": ["U"], "state": live.to_json(), "moves_used": 1},
            episode_id=episode_id,
        )
        response = client.get(f"/api/runs/{run_id}/snapshot")
        assert response.status_code == 200
        assert response.json()["current_state"] == live.to_json()


def test_snapshot_falls_back_to_task_state(tmp_path: Path) -> None:
    db = Database(tmp_path / "snap2.db")
    state = apply_moves(CubeState.solved(2), ["R"])
    benchmark = Benchmark(
        id="snap-bench-2",
        name="snap2",
        cube="2x2",
        tasks=[
            Task(
                id="t1", cube="2x2", scramble=["R"], scramble_depth=1,
                state=state.to_json(), reference_length=1,
                reference_kind="exact", bin="1",
            )
        ],
    )
    app = create_app(
        db=db,
        provider_factory=lambda record: FakeProvider([]),
        solver_factory=lambda cube: None,
        env={},
    )
    with TestClient(app) as client:
        save_benchmark(db, benchmark, {})
        provider = create_provider(
            db, name="p", base_url="http://localhost:1/v1",
            model="m", api_key_ref="KEY",
        )
        run_id = create_run(
            db, provider_id=provider.id, benchmark_id=benchmark.id,
            tool_mode="both", prompt_version="v1", params={}, budget={},
        )
        create_episode(
            db, run_id=run_id,
            task_row_id=task_row_id(benchmark.id, "t1"),
            reference_length=1,
            started_at="2026-10-26T00:00:00+00:00",
        )
        response = client.get(f"/api/runs/{run_id}/snapshot")
        assert response.json()["current_state"] == state.to_json()


def test_snapshot_uses_tool_result_payload_state(tmp_path: Path) -> None:
    db = Database(tmp_path / "snap-tool.db")
    task_state = apply_moves(CubeState.solved(2), ["R"])
    live_state = apply_moves(CubeState.solved(2), ["F"])
    benchmark = Benchmark(
        id="snap-bench-tool",
        name="snap-tool",
        cube="2x2",
        tasks=[
            Task(
                id="t1", cube="2x2", scramble=["R"], scramble_depth=1,
                state=task_state.to_json(), reference_length=1,
                reference_kind="exact", bin="1",
            )
        ],
    )
    app = create_app(
        db=db,
        provider_factory=lambda record: FakeProvider([]),
        solver_factory=lambda cube: None,
        env={},
    )
    with TestClient(app) as client:
        save_benchmark(db, benchmark, {})
        provider = create_provider(
            db, name="p", base_url="http://localhost:1/v1",
            model="m", api_key_ref="KEY",
        )
        run_id = create_run(
            db, provider_id=provider.id, benchmark_id=benchmark.id,
            tool_mode="both", prompt_version="v1", params={}, budget={},
        )
        episode_id = create_episode(
            db, run_id=run_id,
            task_row_id=task_row_id(benchmark.id, "t1"),
            reference_length=1,
            started_at="2026-10-26T00:00:00+00:00",
        )
        app.state.events.publish(
            run_id,
            "tool.result",
            {
                "tool": "get_state",
                "ok": True,
                "payload": {"state": live_state.to_json()},
            },
            episode_id=episode_id,
        )
        response = client.get(f"/api/runs/{run_id}/snapshot")
        assert response.json()["current_state"] == live_state.to_json()


def test_snapshot_ignores_other_episodes_events(tmp_path: Path) -> None:
    db = Database(tmp_path / "snap-scope.db")
    task_state = apply_moves(CubeState.solved(2), ["R"])
    other_state = apply_moves(CubeState.solved(2), ["U"])
    benchmark = Benchmark(
        id="snap-bench-scope",
        name="snap-scope",
        cube="2x2",
        tasks=[
            Task(
                id="t1", cube="2x2", scramble=["R"], scramble_depth=1,
                state=task_state.to_json(), reference_length=1,
                reference_kind="exact", bin="1",
            )
        ],
    )
    app = create_app(
        db=db,
        provider_factory=lambda record: FakeProvider([]),
        solver_factory=lambda cube: None,
        env={},
    )
    with TestClient(app) as client:
        save_benchmark(db, benchmark, {})
        provider = create_provider(
            db, name="p", base_url="http://localhost:1/v1",
            model="m", api_key_ref="KEY",
        )
        run_id = create_run(
            db, provider_id=provider.id, benchmark_id=benchmark.id,
            tool_mode="both", prompt_version="v1", params={}, budget={},
        )
        first_episode = create_episode(
            db, run_id=run_id,
            task_row_id=task_row_id(benchmark.id, "t1"),
            reference_length=1,
            started_at="2026-10-26T00:00:00+00:00",
        )
        app.state.events.publish(
            run_id,
            "move.applied",
            {
                "moves": ["U"],
                "state": other_state.to_json(),
                "moves_used": 1,
            },
            episode_id=first_episode,
        )
        create_episode(
            db, run_id=run_id,
            task_row_id=task_row_id(benchmark.id, "t1"),
            reference_length=1,
            started_at="2026-10-26T00:00:01+00:00",
        )
        response = client.get(f"/api/runs/{run_id}/snapshot")
        assert response.json()["current_state"] == task_state.to_json()
```

注意：必须在 `with TestClient(app)` 内部创建 run/episode，否则 lifespan 的 `mark_running_interrupted` 会把它们改成 `interrupted`。

`test_snapshot_returns_live_state_from_events` 故意让 `live`（`U` 后的状态）与该题 `state`（`R` 后的状态）不同：若两者相同，删掉事件扫描循环也会靠 `task.state` 回退通过，测不出扫描本身。`test_snapshot_ignores_other_episodes_events` 钉住“只扫当前 episode”——`episodes` 按 rowid 排序，最后一个是新建的 running episode，前一题的事件必须被忽略。

- [ ] **Step 2: 运行确认失败**

Run: `uv run pytest tests/api/test_runs_api.py -q -k snapshot`

Expected: FAIL，`current_state` 为 `{}` 或 `None`；其中 `test_snapshot_ignores_other_episodes_events` 在当前实现下可能已通过（它钉的是修复后的行为），仍需在 Step 3 后复跑确认。

- [ ] **Step 3: 实现 snapshot 回退**

在 `src/mofang/api/routes/runs.py` 的 `snapshot` 路由之前加入：

```python
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
```

把 `snapshot` 中原来的：

```python
    episodes = get_run_episodes(db, run_id)
    current_state = None
    if episodes:
        last = episodes[-1]
        current_state = last["final_state"]
        if last["status"] == "running":
            steps = get_steps(db, last["id"])
            if steps:
                current_state = steps[-1]["state"]
```

改为：

```python
    episodes = get_run_episodes(db, run_id)
    current_state = _live_state(
        db, request.app.state.events, run, episodes
    )
```

- [ ] **Step 4: 运行测试**

Run: `uv run pytest tests/api/test_runs_api.py -q`

Expected: 8 passed（Task 3 结束时该文件为 6 项，本任务新增 2 项）。

- [ ] **Step 5: 提交**

```bash
git add src/mofang/api/routes/runs.py tests/api/test_runs_api.py
git commit -m "fix: snapshot 返回运行中 episode 的实时局面"
```

---

### Task 5: 重复基准集返回 409

**Files:**
- Modify: `src/mofang/api/routes/benchmarks.py`
- Test: `tests/api/test_benchmarks_api.py`

**Interfaces:**
- Produces: `POST /api/benchmarks` 在 `f"{name}-{cube}-{seed}"` 已存在时返回 409，detail 为 `{"message": "benchmark already exists", "id": <id>}`。

- [ ] **Step 1: 写失败测试**

在 `tests/api/test_benchmarks_api.py` 追加：

```python
def test_duplicate_benchmark_returns_conflict(tmp_path) -> None:
    client = make_client(tmp_path)
    payload = {
        "name": "dup",
        "cube": "2x2",
        "depths": [1],
        "per_depth": 1,
        "seed": 3,
    }
    with client:
        first = client.post("/api/benchmarks", json=payload)
        assert first.status_code == 201
        second = client.post("/api/benchmarks", json=payload)
        assert second.status_code == 409
        assert second.json()["detail"]["id"] == "dup-2x2-3"
```

- [ ] **Step 2: 运行确认失败**

Run: `uv run pytest tests/api/test_benchmarks_api.py::test_duplicate_benchmark_returns_conflict -q`

Expected: FAIL，第二次返回 201。

- [ ] **Step 3: 提前检查**

在 `src/mofang/api/routes/benchmarks.py::create` 的 solver 校验之后、`solver = None` 之前加入：

```python
    benchmark_id = f"{payload.name}-{payload.cube}-{payload.seed}"
    if get_benchmark(request.app.state.db, benchmark_id) is not None:
        raise HTTPException(
            409,
            {"message": "benchmark already exists", "id": benchmark_id},
        )
```

- [ ] **Step 4: 运行测试**

Run: `uv run pytest tests/api/test_benchmarks_api.py -q`

Expected: 3 passed。

- [ ] **Step 5: 提交**

```bash
git add src/mofang/api/routes/benchmarks.py tests/api/test_benchmarks_api.py
git commit -m "fix: 重复基准集返回 409"
```

---

### Task 6: FastAPI 托管前端构建产物

**Files:**
- Modify: `src/mofang/api/settings.py`
- Modify: `src/mofang/api/app.py`
- Modify: `src/mofang/cli.py`、`tests/test_cli.py`
- Test: `tests/api/test_static.py`（新建）

**Interfaces:**
- Produces:
  - `Settings.web_dir: Path | None`，默认 `Path("frontend/dist")`
  - `Settings.from_env()` 读取 `MOFANG_WEB_DIR`；空字符串表示禁用
  - `create_app()` 在 `web_dir/index.html` 存在时挂载 `/assets` 并提供 SPA 回退；`/api/*` 仍返回 JSON 404；只吐出 `web_dir` 内的文件（`%2e%2e` 之类的编码遍历不得外读，否则回退 index.html）；catch-all 只注册 GET，因此未知 `/api/*` 的非 GET 请求返回 JSON 405 而非 404
  - `mofang serve --web-dir`（默认 `frontend/dist`，空字符串禁用静态托管），`_serve()` 据此构造 `Settings`

- [ ] **Step 1: 写失败测试**

新建 `tests/api/test_static.py`：

```python
from pathlib import Path

from fastapi.testclient import TestClient

from mofang.api.app import create_app
from mofang.api.settings import Settings


def test_serves_spa_and_keeps_api_404(tmp_path: Path) -> None:
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>app</html>", encoding="utf-8")
    (dist / "assets" / "app.js").write_text(
        "console.log(1)", encoding="utf-8"
    )
    app = create_app(
        Settings(db_path=tmp_path / "t.db", web_dir=dist),
        env={},
    )
    with TestClient(app) as client:
        assert client.get("/runs/abc").text == "<html>app</html>"
        assert client.get("/assets/app.js").text == "console.log(1)"
        assert client.get("/api/nope").status_code == 404
        assert client.get("/api/nope").headers["content-type"].startswith(
            "application/json"
        )
        assert client.get("/openapi.json").status_code == 200


def test_web_dir_from_env_can_be_disabled() -> None:
    assert Settings.from_env({"MOFANG_WEB_DIR": ""}).web_dir is None
    assert (
        Settings.from_env({"MOFANG_WEB_DIR": "dist"}).web_dir
        == Path("dist")
    )
```

在 `tests/test_cli.py::test_serve_parser_defaults` 末尾补充：

```python
    assert args.web_dir == "frontend/dist"
```

并在 `tests/api/test_static.py` 末尾追加：

```python
def test_serve_parser_web_dir_override() -> None:
    from mofang.cli import build_parser

    args = build_parser().parse_args(["serve", "--web-dir", ""])
    assert args.web_dir == ""
```

再追加三条（遍历防护、直接吐文件、无 index 不挂载）：

```python
def test_spa_stays_inside_web_dir(tmp_path: Path) -> None:
    secret = tmp_path / "secret.txt"
    secret.write_text("outside", encoding="utf-8")
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>app</html>", encoding="utf-8")
    app = create_app(
        Settings(db_path=tmp_path / "t.db", web_dir=dist),
        env={},
    )
    with TestClient(app) as client:
        for path in (
            "/../secret.txt",
            "/%2e%2e/secret.txt",
            "/..%2fsecret.txt",
            "/%2e%2e%2f%2e%2e%2fsecret.txt",
            "/%2fsecret.txt",
            "/assets/%2e%2e/secret.txt",
        ):
            assert client.get(path).text != "outside"
        assert client.get("/%2e%2e/secret.txt").text == "<html>app</html>"


def test_serves_files_directly_under_web_dir(tmp_path: Path) -> None:
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<html>app</html>", encoding="utf-8")
    (dist / "favicon.ico").write_text("icon", encoding="utf-8")
    app = create_app(
        Settings(db_path=tmp_path / "t.db", web_dir=dist),
        env={},
    )
    with TestClient(app) as client:
        assert client.get("/favicon.ico").text == "icon"
        assert client.get("/").text == "<html>app</html>"


def test_no_mount_without_index(tmp_path: Path) -> None:
    app = create_app(
        Settings(db_path=tmp_path / "t.db", web_dir=tmp_path / "missing"),
        env={},
    )
    with TestClient(app) as client:
        assert client.get("/runs/abc").status_code == 404
```

- [ ] **Step 2: 运行确认失败**

Run: `uv run pytest tests/api/test_static.py tests/test_cli.py -q`

Expected: FAIL，`Settings` 不接受 `web_dir`、`serve` 无 `--web-dir`。

- [ ] **Step 3: 实现 settings、静态托管与 CLI 开关**

`src/mofang/api/settings.py`：

```python
@dataclass(frozen=True)
class Settings:
    db_path: Path = Path("data/mofang.db")
    table_path: Path = Path("data/cache/2x2_distances.pkl")
    web_dir: Path | None = Path("frontend/dist")
    host: str = "127.0.0.1"
    port: int = 8000
    cors_origins: tuple[str, ...] = (
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    )

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "Settings":
        values = os.environ if env is None else env
        web_raw = values.get("MOFANG_WEB_DIR", "frontend/dist")
        return cls(
            db_path=Path(values.get("MOFANG_DB", "data/mofang.db")),
            table_path=Path(
                values.get("MOFANG_TABLE", "data/cache/2x2_distances.pkl")
            ),
            web_dir=Path(web_raw) if web_raw else None,
            host=values.get("MOFANG_HOST", "127.0.0.1"),
            port=int(values.get("MOFANG_PORT", "8000")),
        )
```

`src/mofang/api/app.py`：

```python
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
```

在 `include_router` 之后：

```python
    web_dir = resolved.web_dir
    if web_dir is not None and (web_dir / "index.html").is_file():
        assets = web_dir / "assets"
        if assets.is_dir():
            app.mount("/assets", StaticFiles(directory=assets), name="assets")

        root = web_dir.resolve()
        index = root / "index.html"

        # catch-all 必须晚于 API 路由注册，否则会遮住接口路径
        @app.get("/{full_path:path}", include_in_schema=False)
        def spa(full_path: str):
            if full_path == "api" or full_path.startswith("api/"):
                raise HTTPException(404, "not found")
            candidate = (root / full_path).resolve()
            # 百分号编码的 ../ 会原样到达这里，必须确认仍在 web_dir 内
            if candidate.is_relative_to(root) and candidate.is_file():
                return FileResponse(candidate)
            return FileResponse(index)
```

注意：catch-all 必须注册在 API 路由之后；`/docs`、`/openapi.json` 由 FastAPI 更早注册，仍可访问。`web_dir` 内的文件会被直接吐出，因此 `frontend/dist` 只放构建产物；`is_relative_to(root)` 是必需的——`/%2e%2e/secret.txt`、`/..%2f..%2fsecret.txt` 这类编码遍历不会被 Starlette 归一化，缺这道检查会读到 `web_dir` 之外的文件。

`src/mofang/cli.py`，`serve` 子命令新增参数并传入 `Settings`：

```python
    serve.add_argument("--web-dir", default="frontend/dist")
```

```python
def _serve(args: argparse.Namespace) -> int:
    import uvicorn

    from .api.app import create_app
    from .api.settings import Settings

    settings = Settings(
        db_path=Path(args.db),
        table_path=Path(args.table),
        web_dir=Path(args.web_dir) if args.web_dir else None,
        host=args.host,
        port=args.port,
    )
    uvicorn.run(create_app(settings), host=args.host, port=args.port)
    return 0
```

- [ ] **Step 4: 运行测试**

Run: `uv run pytest tests/api/test_static.py tests/api/test_settings.py tests/test_cli.py -q`

Expected: 全部通过。

- [ ] **Step 5: 提交**

```bash
git add src/mofang/api/settings.py src/mofang/api/app.py src/mofang/cli.py tests/api/test_static.py tests/test_cli.py
git commit -m "feat: FastAPI 托管前端构建产物"
```

---

### Task 7: 前端脚手架、类型与布局

**Files:**
- Create: `frontend/`（Vite React-TS 模板）
- Modify: `frontend/package.json`、`frontend/vite.config.ts`、`frontend/src/main.tsx`、`frontend/src/App.tsx`、`frontend/src/index.css`
- Create: `frontend/vitest.config.ts`、`frontend/src/test/setup.ts`
- Create: `frontend/src/api/types.ts`
- Create: `frontend/src/lib/format.ts`、`frontend/src/lib/format.test.ts`
- Create: `frontend/src/components/Layout.tsx`
- Create: `frontend/src/App.test.tsx`

**Interfaces:**
- Produces:
  - 路由 `/providers`、`/benchmarks`、`/benchmarks/:id`、`/runs`、`/runs/new`、`/runs/:id`、`/episodes/:id`；`/` 重定向 `/runs`
  - `types.ts` 中所有 API/SSE 类型（后续任务直接消费）
  - `formatDuration`、`formatPercent`、`formatTokens`、`statusLabel`、`colorHex`、`shortId`

- [ ] **Step 1: 生成脚手架并装依赖**

Run:

```bash
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
npm install react-router-dom @tanstack/react-query three @react-three/fiber @react-three/drei
npm install -D tailwindcss @tailwindcss/vite vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @playwright/test
```

若 npm 报 React 19 与 r3f 的 peer 冲突，先确认 `@react-three/fiber` 版本 ≥9、`@react-three/drei` ≥10；仍冲突时在安装命令追加 `--legacy-peer-deps` 并在提交信息中记录原因。

- [ ] **Step 2: 配置 Vite、Vitest 与脚本**

`frontend/vite.config.ts` 整体替换为：

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
```

新建 `frontend/vitest.config.ts`：

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: false,
  },
})
```

新建 `frontend/src/test/setup.ts`：

```ts
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})
```

`frontend/package.json` 的 `scripts` 改为：

```json
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc -b --pretty false",
    "test": "vitest",
    "test:run": "vitest run",
    "e2e": "playwright test"
  },
```

- [ ] **Step 3: 写类型文件**

新建 `frontend/src/api/types.ts`：

```ts
export type CubeKind = '2x2' | '3x3'
export type Face = 'U' | 'R' | 'F' | 'D' | 'L' | 'B'
export type ColorName =
  | 'white'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'red'
  | 'orange'
export type ToolMode = 'both' | 'turn_only' | 'batch_only'

export interface CubeState {
  cube: CubeKind
  faces: Record<Face, ColorName[][]>
}

export interface Usage {
  prompt_tokens: number
  completion_tokens: number
}

export interface ProviderParams {
  temperature?: number
  max_tokens?: number
  extra?: Record<string, unknown>
}

export interface Provider {
  id: string
  name: string
  base_url: string
  model: string
  api_key_ref: string
  params: ProviderParams
  key_configured: boolean
  created_at: string
}

export interface ProviderCreate {
  name: string
  base_url: string
  model: string
  api_key_ref: string
  params: ProviderParams
}

export interface ProbeResult {
  ok: boolean
  tool_calling: boolean
}

export interface Task {
  id: string
  cube: CubeKind
  scramble: string[]
  scramble_depth: number
  state: CubeState
  reference_length: number
  reference_kind: 'exact' | 'near_optimal' | 'fake'
  bin: string
}

export interface BenchmarkSummary {
  id: string
  name: string
  version: string
  kind: string
  cube: CubeKind
  content_hash: string
  frozen_at: string
  task_count: number
}

export interface BenchmarkDetail extends BenchmarkSummary {
  tasks: Task[]
}

export interface BenchmarkCreate {
  name: string
  cube: CubeKind
  depths: number[]
  per_depth: number
  seed: number
  solver: 'table' | 'rubik'
}

export interface Budget {
  max_moves: number
  max_tool_calls: number
  max_tokens: number
  max_seconds: number
  turn_timeout: number
  max_usd?: number | null
}

export interface AggregateTotals {
  tasks: number
  solved: number
  solve_rate: number
  ci95: [number, number]
}

export interface BinStats {
  total: number
  solved: number
  solve_rate: number
  ci95: [number, number]
  mean_moves: number
}

// 后端 `aggregate_report()` 的完整返回；run.totals 与 run.finished 事件都携带它。
export interface AggregateReport {
  benchmark_id: string
  benchmark_hash: string
  benchmark_total_tasks: number
  partial: boolean
  totals: AggregateTotals
  by_bin: Record<string, BinStats>
  episodes: Array<{
    task_id: string
    status: string
    solved: boolean
    moves_used: number
    reference_length: number
    efficiency: number | null
    progress_ratio: number
    protocol_errors: number
    tokens_in: number
    tokens_out: number
    latency_ms: number
    failure_code: string | null
    error: string | null
  }>
}

export interface Run {
  id: string
  provider_id: string
  benchmark_id: string
  tool_mode: ToolMode
  prompt_version: string
  status: string
  totals: AggregateReport | null
  error: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  budget: Budget
}

export interface Episode {
  id: string
  run_id: string
  task_id: string
  task_key: string
  status: string
  solved: boolean
  moves_used: number
  reference_length: number
  efficiency: number | null
  progress_ratio: number | null
  protocol_errors: number
  tokens_in: number | null
  tokens_out: number | null
  latency_ms: number | null
  failure_code: string | null
  error: string | null
  started_at: string | null
  finished_at: string | null
}

export interface Step {
  id: string
  seq: number
  kind: string
  tool_name: string | null
  arguments: Record<string, unknown> | null
  result: Record<string, unknown> | null
  state: CubeState | null
  reference_length_after: number | null
}

export interface Snapshot {
  run: Run
  episodes: Episode[]
  last_event_id: number
  current_state: CubeState | null
}

export interface Report {
  run_id: string
  provider_id: string
  benchmark_id: string
  status: string
  started_at: string | null
  finished_at: string | null
  benchmark_hash: string | null
  benchmark_total_tasks: number | null
  partial: boolean
  totals: AggregateTotals
  by_bin: Record<string, BinStats>
  episodes: Episode[]
}

export interface RunCreate {
  provider_id: string
  benchmark_id: string
  tool_mode: ToolMode
  params: Record<string, unknown>
  budget: Partial<Budget>
}

export interface ProgressPoint {
  moves: number
  length: number | null
}

export interface RunEventBase<T extends string, D> {
  id: number
  type: T
  run_id: string
  episode_id: string | null
  ts: string
  data: D
}

export type RunEvent =
  | RunEventBase<'run.started', { benchmark_id: string }>
  | RunEventBase<
      'episode.started',
      { task_id: string; reference_length: number }
    >
  | RunEventBase<'model.turn.started', { moves_used: number }>
  | RunEventBase<
      'model.message',
      { content: string | null; tool_calls: number; usage: Usage }
    >
  | RunEventBase<
      'tool.call',
      {
        call_id: string
        tool: string
        arguments: Record<string, unknown> | null
      }
    >
  | RunEventBase<
      'tool.result',
      {
        call_id: string
        tool: string
        ok: boolean
        payload: Record<string, unknown>
      }
    >
  | RunEventBase<
      'move.applied',
      {
        moves: string[]
        state: CubeState
        moves_used: number
        solved: boolean
        reference_length_after: number | null
      }
    >
  | RunEventBase<
      'episode.finished',
      {
        task_id: string
        status: string
        solved: boolean
        moves_used: number
      }
    >
  | RunEventBase<
      'run.finished',
      { status: string; totals: AggregateReport | null }
    >
  | RunEventBase<'run.error', { message: string }>
```

- [ ] **Step 4: 写格式化工具与测试**

新建 `frontend/src/lib/format.ts`：

```ts
import type { ColorName } from '../api/types'

const COLOR_HEX: Record<ColorName, string> = {
  white: '#f8fafc',
  yellow: '#facc15',
  green: '#22c55e',
  blue: '#3b82f6',
  red: '#ef4444',
  orange: '#f97316',
}

const STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  running: '运行中',
  finished: '已完成',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '已中断',
  solved: '已解出',
  stopped_unsolved: '停手未解',
  budget_exceeded: '预算耗尽',
  timeout: '超时',
  protocol_error: '协议错误',
  provider_error: 'provider 错误',
}

export function colorHex(color: ColorName): string {
  return COLOR_HEX[color]
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—'
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function formatPercent(
  value: number | null | undefined,
  digits = 1,
): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(digits)}%`
}

export function formatTokens(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status
}

export function shortId(id: string): string {
  return id.slice(0, 8)
}
```

新建 `frontend/src/lib/format.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  colorHex,
  formatDuration,
  formatPercent,
  formatTokens,
  shortId,
  statusLabel,
} from './format'

describe('format', () => {
  it('formats durations', () => {
    expect(formatDuration(65_000)).toBe('1:05')
    expect(formatDuration(null)).toBe('—')
  })

  it('formats percentages and tokens', () => {
    expect(formatPercent(0.5)).toBe('50.0%')
    expect(formatPercent(null)).toBe('—')
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(12_500)).toBe('12.5k')
    expect(formatTokens(1_200_000)).toBe('1.2M')
  })

  it('labels statuses and ids', () => {
    expect(statusLabel('budget_exceeded')).toBe('预算耗尽')
    expect(statusLabel('unknown')).toBe('unknown')
    expect(shortId('abcdef123456')).toBe('abcdef12')
  })

  it('maps colors', () => {
    expect(colorHex('white')).toBe('#f8fafc')
    expect(colorHex('orange')).toBe('#f97316')
  })
})
```

- [ ] **Step 5: 写布局、路由与入口**

新建 `frontend/src/components/Layout.tsx`：

```tsx
import { NavLink, Outlet } from 'react-router-dom'

const links = [
  { to: '/providers', label: 'Providers' },
  { to: '/benchmarks', label: 'Benchmarks' },
  { to: '/runs', label: 'Runs' },
  { to: '/runs/new', label: 'New Run' },
]

export function Layout() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/80">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-3">
          <span className="text-lg font-semibold tracking-wide">mofang</span>
          <nav className="flex gap-4 text-sm">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  isActive
                    ? 'font-medium text-emerald-400'
                    : 'text-slate-400 hover:text-slate-200'
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-6">
        <Outlet />
      </main>
    </div>
  )
}
```

`frontend/src/App.tsx` 整体替换为：

```tsx
import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'

function Placeholder({ title }: { title: string }) {
  return <h1 className="text-2xl font-semibold">{title}</h1>
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/runs" replace />} />
        <Route path="providers" element={<Placeholder title="Providers" />} />
        <Route path="benchmarks" element={<Placeholder title="Benchmarks" />} />
        <Route
          path="benchmarks/:id"
          element={<Placeholder title="Benchmark Detail" />}
        />
        <Route path="runs" element={<Placeholder title="Runs" />} />
        <Route path="runs/new" element={<Placeholder title="New Run" />} />
        <Route path="runs/:id" element={<Placeholder title="Run" />} />
        <Route path="episodes/:id" element={<Placeholder title="Episode" />} />
      </Route>
    </Routes>
  )
}
```

`frontend/src/main.tsx` 整体替换为：

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 5_000 },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
```

`frontend/src/index.css` 整体替换为：

```css
@import "tailwindcss";

:root {
  color-scheme: dark;
}

body {
  margin: 0;
  background: #020617;
  color: #e2e8f0;
  font-family:
    ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}

* {
  box-sizing: border-box;
}
```

新建 `frontend/src/App.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => [],
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('App routes', () => {
  it('renders the providers page and navigation', () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/providers']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(
      screen.getByRole('heading', { name: 'Providers' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Runs' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 6: 运行前端验证**

Run:

```bash
cd frontend
npm run typecheck
npm run test:run
npm run build
```

Expected: 类型检查通过；4 个 format 测试 + 1 个路由测试通过；`dist/` 生成。

- [ ] **Step 7: 提交**

```bash
git add frontend
git commit -m "feat: 前端脚手架、类型与布局"
```

---

### Task 8: API 客户端与查询 hooks

**Files:**
- Create: `frontend/src/api/client.ts`
- Create: `frontend/src/api/client.test.ts`
- Create: `frontend/src/api/queries.ts`

**Interfaces:**
- Consumes: `types.ts`（Task 7）
- Produces:
  - `ApiError(status, detail)`
  - `api.providers.list/create/probe`
  - `api.benchmarks.list/create/get`
  - `api.runs.list/create/get/snapshot/cancel/report/eventsUrl`
  - `api.episodes.get/steps`
  - `exportUrl(runId, 'csv' | 'md')`、`reportUrl(runId)`
  - `qk` 查询键与 `useProviders`、`useBenchmarks`、`useBenchmark`、`useRuns`、`useRun`、`useSnapshot`、`useEpisode`、`useSteps`、`useReport`

- [ ] **Step 1: 写失败测试**

新建 `frontend/src/api/client.test.ts`：

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  api,
  exportUrl,
  reportUrl,
} from './client'
import type { ProviderCreate } from './types'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

const fetchMock = vi.fn()

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

describe('api client', () => {
  it('GETs and parses JSON', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: 'p1' }]))
    const providers = await api.providers.list()
    expect(providers).toEqual([{ id: 'p1' }])
    expect(fetchMock.mock.calls[0][0]).toBe('/api/providers')
  })

  it('POSTs JSON bodies', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'p1' }, 201))
    const payload: ProviderCreate = {
      name: 'local',
      base_url: 'http://localhost:20128/v1',
      model: 'm',
      api_key_ref: 'LOCAL_KEY',
      params: {},
    }
    await api.providers.create(payload)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/providers')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(init.body as string)).toEqual(payload)
  })

  it('normalizes structured errors', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          detail: {
            message: 'benchmark already exists',
            id: 'dup-2x2-3',
          },
        },
        409,
      ),
    )
    await expect(
      api.benchmarks.create({
        name: 'dup',
        cube: '2x2',
        depths: [1],
        per_depth: 1,
        seed: 3,
        solver: 'table',
      }),
    ).rejects.toMatchObject({
      status: 409,
      detail: expect.stringContaining('benchmark already exists'),
    })
  })

  it('builds export and report urls', () => {
    expect(exportUrl('r1', 'csv')).toBe('/api/runs/r1/export?format=csv')
    expect(reportUrl('r1')).toBe('/api/runs/r1/report')
    expect(api.runs.eventsUrl('r1', 7)).toBe(
      '/api/runs/r1/events?after=7',
    )
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd frontend && npm run test:run -- src/api/client.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现客户端**

新建 `frontend/src/api/client.ts`：

```ts
import type {
  BenchmarkCreate,
  BenchmarkDetail,
  BenchmarkSummary,
  Episode,
  ProbeResult,
  Provider,
  ProviderCreate,
  Report,
  Run,
  RunCreate,
  Snapshot,
  Step,
} from './types'

const API = '/api'

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(detail)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  if (!response.ok) {
    let detail = response.statusText || `HTTP ${response.status}`
    try {
      const body = await response.json()
      if (typeof body.detail === 'string') {
        detail = body.detail
      } else if (body.detail) {
        detail = JSON.stringify(body.detail)
      }
    } catch {
      // 非 JSON 错误体保留状态文本
    }
    throw new ApiError(response.status, detail)
  }
  return (await response.json()) as T
}

function post(body: unknown): RequestInit {
  return { method: 'POST', body: JSON.stringify(body) }
}

export const api = {
  providers: {
    list: () => request<Provider[]>('/providers'),
    create: (payload: ProviderCreate) =>
      request<Provider>('/providers', post(payload)),
    probe: (id: string) =>
      request<ProbeResult>(
        `/providers/${encodeURIComponent(id)}/probe`,
        { method: 'POST' },
      ),
  },
  benchmarks: {
    list: () => request<BenchmarkSummary[]>('/benchmarks'),
    create: (payload: BenchmarkCreate) =>
      request<BenchmarkDetail>('/benchmarks', post(payload)),
    get: (id: string) =>
      request<BenchmarkDetail>(`/benchmarks/${encodeURIComponent(id)}`),
  },
  runs: {
    list: () => request<Run[]>('/runs'),
    create: (payload: RunCreate) =>
      request<{ id: string }>('/runs', post(payload)),
    get: (id: string) =>
      request<{ run: Run; episodes: Episode[] }>(
        `/runs/${encodeURIComponent(id)}`,
      ),
    snapshot: (id: string) =>
      request<Snapshot>(`/runs/${encodeURIComponent(id)}/snapshot`),
    cancel: (id: string) =>
      request<{ cancelled: boolean }>(
        `/runs/${encodeURIComponent(id)}/cancel`,
        { method: 'POST' },
      ),
    report: (id: string) =>
      request<Report>(`/runs/${encodeURIComponent(id)}/report`),
    eventsUrl: (id: string, after = 0) =>
      `${API}/runs/${encodeURIComponent(id)}/events?after=${after}`,
  },
  episodes: {
    get: (id: string) =>
      request<Episode>(`/episodes/${encodeURIComponent(id)}`),
    steps: (id: string) =>
      request<Step[]>(`/episodes/${encodeURIComponent(id)}/steps`),
  },
}

export function exportUrl(runId: string, format: 'csv' | 'md'): string {
  return `${API}/runs/${encodeURIComponent(runId)}/export?format=${format}`
}

export function reportUrl(runId: string): string {
  return `${API}/runs/${encodeURIComponent(runId)}/report`
}
```

id 一律 `encodeURIComponent`：只有 provider/run/episode 的 id 是 `uuid4().hex`，而 benchmark 的 id 是 `f"{name}-{cube}-{seed}"`，`name` 由用户输入且只约束 `min_length=1`，含 `/`、`#`、`?` 时不编码会静默 404。

- [ ] **Step 4: 实现查询 hooks**

新建 `frontend/src/api/queries.ts`：

```ts
import { useQuery } from '@tanstack/react-query'
import { api } from './client'

export const qk = {
  providers: ['providers'] as const,
  benchmarks: ['benchmarks'] as const,
  benchmark: (id: string) => ['benchmark', id] as const,
  runs: ['runs'] as const,
  run: (id: string) => ['run', id] as const,
  snapshot: (id: string) => ['snapshot', id] as const,
  episode: (id: string) => ['episode', id] as const,
  steps: (id: string) => ['steps', id] as const,
  report: (id: string) => ['report', id] as const,
}

export function useProviders() {
  return useQuery({ queryKey: qk.providers, queryFn: api.providers.list })
}

export function useBenchmarks() {
  return useQuery({ queryKey: qk.benchmarks, queryFn: api.benchmarks.list })
}

export function useBenchmark(id: string | undefined) {
  return useQuery({
    queryKey: qk.benchmark(id ?? ''),
    queryFn: () => api.benchmarks.get(id!),
    enabled: Boolean(id),
  })
}

export function useRuns() {
  return useQuery({ queryKey: qk.runs, queryFn: api.runs.list })
}

export function useRun(id: string | undefined) {
  return useQuery({
    queryKey: qk.run(id ?? ''),
    queryFn: () => api.runs.get(id!),
    enabled: Boolean(id),
  })
}

export function useSnapshot(id: string | undefined) {
  return useQuery({
    queryKey: qk.snapshot(id ?? ''),
    queryFn: () => api.runs.snapshot(id!),
    enabled: Boolean(id),
  })
}

export function useEpisode(id: string | undefined) {
  return useQuery({
    queryKey: qk.episode(id ?? ''),
    queryFn: () => api.episodes.get(id!),
    enabled: Boolean(id),
  })
}

export function useSteps(id: string | undefined) {
  return useQuery({
    queryKey: qk.steps(id ?? ''),
    queryFn: () => api.episodes.steps(id!),
    enabled: Boolean(id),
  })
}

export function useReport(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: qk.report(id ?? ''),
    queryFn: () => api.runs.report(id!),
    enabled: Boolean(id) && enabled,
  })
}
```

- [ ] **Step 5: 运行测试与构建**

Run:

```bash
cd frontend
npm run test:run
npm run typecheck
```

Expected: 全部通过。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/api
git commit -m "feat: API 类型之外的客户端与查询 hooks"
```

---

```bash
git add frontend/src/api
git commit -m "feat: API 客户端与查询 hooks"
```

---

### Task 9: Providers 页面

**Files:**
- Create: `frontend/src/pages/ProvidersPage.tsx`
- Create: `frontend/src/pages/ProvidersPage.test.tsx`
- Create: `frontend/src/lib/errors.ts`（`describeError`，Task 10/11/15 复用）
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `useProviders()`、`api.providers.create/probe`、`qk.providers`
- Produces:
  - `ProvidersView`（可测试的纯展示组件）
  - `ProvidersPage`（容器，默认导出）
  - `describeError(err: unknown): string` —— `ApiError` 映射为“中文标签（HTTP n）：detail”，结构化 detail 取其中的 `message`；非 `ApiError`（fetch 被拒的 `TypeError`）映射为中文网络错误。界面文案必须中文，禁止把后端英文 detail 单独当作错误文案。
  - `data-testid`：`provider-card`、`key-configured`

`frontend/src/lib/errors.ts`：

```ts
import { ApiError } from '../api/client'

const STATUS_LABELS: Record<number, string> = {
  400: '请求不合法',
  404: '未找到该记录',
  409: '已存在相同记录',
  422: '字段校验未通过',
  502: '上游模型服务不可用',
}

// 后端结构化 detail（如 probe 的 502 {kind, message}）在客户端被 JSON 字符串化，取 message 展示。
function readableDetail(detail: string): string {
  try {
    const parsed: unknown = JSON.parse(detail)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const message = (parsed as { message?: unknown }).message
      if (typeof message === 'string') return message
    }
  } catch {
    // 非 JSON detail 原样展示
  }
  return detail
}

export function describeError(err: unknown): string {
  if (!(err instanceof ApiError)) {
    // fetch 被拒（后端未启动/不可达）时是 TypeError，不是 ApiError
    return '网络错误：无法访问后端，请确认服务已启动'
  }
  const label = STATUS_LABELS[err.status] ?? '后端返回错误'
  return `${label}（HTTP ${err.status}）：${readableDetail(err.detail)}`
}
```

- [ ] **Step 1: 写失败测试**

新建 `frontend/src/pages/ProvidersPage.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import type { Provider } from '../api/types'
import { ProvidersView } from './ProvidersPage'

const provider: Provider = {
  id: 'p1',
  name: 'local',
  base_url: 'http://localhost:20128/v1',
  model: 'gpt-oss',
  api_key_ref: 'OPENAI_API_KEY',
  params: { temperature: 0, max_tokens: 4096 },
  key_configured: true,
  created_at: '2026-10-26T00:00:00+00:00',
}

describe('ProvidersView', () => {
  it('creates a provider with parsed params', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(undefined)
    const onProbe = vi.fn().mockResolvedValue({
      ok: true,
      tool_calling: true,
    })
    render(
      <ProvidersView
        providers={[]}
        loading={false}
        error={null}
        onCreate={onCreate}
        onProbe={onProbe}
      />,
    )
    await user.type(screen.getByLabelText('名称'), 'local')
    await user.type(screen.getByLabelText('模型'), 'gpt-oss')
    await user.click(screen.getByRole('button', { name: '保存 provider' }))
    expect(onCreate).toHaveBeenCalledWith({
      name: 'local',
      base_url: 'http://localhost:20128/v1',
      model: 'gpt-oss',
      api_key_ref: 'OPENAI_API_KEY',
      params: {
        temperature: 0,
        max_tokens: 4096,
        extra: {},
      },
    })
  })

  it('shows key state and probe result', async () => {
    const user = userEvent.setup()
    render(
      <ProvidersView
        providers={[provider]}
        loading={false}
        error={null}
        onCreate={vi.fn()}
        onProbe={vi.fn().mockResolvedValue({
          ok: true,
          tool_calling: true,
        })}
      />,
    )
    expect(screen.getByTestId('provider-card')).toHaveTextContent('local')
    expect(screen.getByTestId('key-configured')).toHaveTextContent(
      'key 已配置',
    )
    await user.click(screen.getByRole('button', { name: '探测' }))
    expect(
      await screen.findByText('支持 tool calling'),
    ).toBeInTheDocument()
  })

  it('rejects invalid base_url and extra JSON', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()
    render(
      <ProvidersView
        providers={[]}
        loading={false}
        error={null}
        onCreate={onCreate}
        onProbe={vi.fn()}
      />,
    )
    const baseUrl = screen.getByLabelText('base_url')
    await user.clear(baseUrl)
    await user.type(baseUrl, 'ftp://bad')
    await user.type(screen.getByLabelText('名称'), 'x')
    await user.type(screen.getByLabelText('模型'), 'm')
    await user.click(screen.getByRole('button', { name: '保存 provider' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'base_url 必须是 http(s)',
    )
    expect(onCreate).not.toHaveBeenCalled()
  })

  it.each([
    ['max_tokens 清空', 'max_tokens', '', 'max_tokens 必须是正整数'],
    ['max_tokens 归零', 'max_tokens', '0', 'max_tokens 必须是正整数'],
    ['max_tokens 非数字', 'max_tokens', 'abc', 'max_tokens 必须是正整数'],
    ['temperature 越界', 'temperature', '3', 'temperature 必须是 0 到 2 之间的数值'],
    ['temperature 非数字', 'temperature', 'abc', 'temperature 必须是 0 到 2 之间的数值'],
    ['extra 是数组', 'extra JSON', '[[1,2]', 'extra 必须是 JSON 对象'],
    ['extra 是 null', 'extra JSON', 'null', 'extra 必须是 JSON 对象'],
    ['extra 是裸字符串', 'extra JSON', '"abc"', 'extra 必须是 JSON 对象'],
    ['extra 是数字', 'extra JSON', '42', 'extra 必须是 JSON 对象'],
  ])(
    'rejects %s before sending anything',
    async (_label, key, value, expected) => {
      const user = userEvent.setup()
      const onCreate = vi.fn().mockResolvedValue(undefined)
      render(
        <ProvidersView
          providers={[]}
          loading={false}
          error={null}
          onCreate={onCreate}
          onProbe={vi.fn()}
        />,
      )
      await user.type(screen.getByLabelText('名称'), 'x')
      await user.type(screen.getByLabelText('模型'), 'm')
      const field = screen.getByLabelText(key)
      await user.clear(field)
      if (value !== '') {
        await user.type(field, value)
      }
      await user.click(screen.getByRole('button', { name: '保存 provider' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(expected)
      expect(onCreate).not.toHaveBeenCalled()
    },
  )

  it('shows the empty-state guidance when the list loaded but is empty', async () => {
    render(
      <ProvidersView
        providers={[]}
        loading={false}
        error={null}
        onCreate={vi.fn()}
        onProbe={vi.fn()}
      />,
    )
    expect(
      await screen.findByText(/还没有 provider/),
    ).toBeInTheDocument()
  })

  it('maps a backend 400 on create to Chinese plus the detail', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockRejectedValue(
      new ApiError(400, 'base_url must be http(s)'),
    )
    render(
      <ProvidersView
        providers={[]}
        loading={false}
        error={null}
        onCreate={onCreate}
        onProbe={vi.fn()}
      />,
    )
    await user.type(screen.getByLabelText('名称'), 'x')
    await user.type(screen.getByLabelText('模型'), 'm')
    await user.click(screen.getByRole('button', { name: '保存 provider' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '请求不合法（HTTP 400）：base_url must be http(s)',
    )
  })

  it('unwraps the 502 dict detail when probe fails upstream', async () => {
    const user = userEvent.setup()
    const onProbe = vi.fn().mockRejectedValue(
      new ApiError(502, JSON.stringify({ kind: 'auth', message: '上游拒绝' })),
    )
    render(
      <ProvidersView
        providers={[provider]}
        loading={false}
        error={null}
        onCreate={vi.fn()}
        onProbe={onProbe}
      />,
    )
    await user.click(screen.getByRole('button', { name: '探测' }))
    const text = await screen.findByText(/上游模型服务不可用/)
    expect(text.textContent).toContain('上游拒绝')
    expect(text.textContent).not.toContain('{')
  })

  it('shows a Chinese network error when the backend is unreachable', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    render(
      <ProvidersView
        providers={[]}
        loading={false}
        error={null}
        onCreate={onCreate}
        onProbe={vi.fn()}
      />,
    )
    await user.type(screen.getByLabelText('名称'), 'x')
    await user.type(screen.getByLabelText('模型'), 'm')
    await user.click(screen.getByRole('button', { name: '保存 provider' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/网络错误/)
  })
})
```

`max_tokens` 走正整数校验、`temperature` 走 0–2 数值校验、`extra` 必须是 JSON 对象——`Number('')` 会变成 0、`JSON.parse('null')` 会得到非对象并一路写进 `params`（后端 `params: dict[str, Any]` 不拦），所以必须在前端拦下。`readPositiveInt` 只是实现内部细节，用例只断言界面上的告警文案与 `onCreate` 未被调用。

两条测试实现约束（jsdom 与 userEvent 的真实行为，不是笔误）：`input[type=number]` 会把无法解析的输入净化成 `''`，所以 “非数字” 两行测到的其实是空值路径——标签保留描述，但校验里的“空值也拒绝”是它们能红的前提；`extra` 那四行用真实 `<span>` 文案 `extra JSON` 取标签，数组值写成 `'[[1,2]'`（userEvent 会把单个 `[` 当修饰键）。

- [ ] **Step 2: 运行确认失败**

Run: `cd frontend && npm run test:run -- src/pages/ProvidersPage.test.tsx`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现页面**

新建 `frontend/src/pages/ProvidersPage.tsx`：

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../api/client'
import { describeError } from '../lib/errors'
import { qk, useProviders } from '../api/queries'
import type {
  ProbeResult,
  Provider,
  ProviderCreate,
} from '../api/types'

const initialForm = {
  name: '',
  base_url: 'http://localhost:20128/v1',
  model: '',
  api_key_ref: 'OPENAI_API_KEY',
  temperature: '0',
  max_tokens: '4096',
  extra: '{}',
}

export interface ProvidersViewProps {
  providers: Provider[]
  loading: boolean
  error: string | null
  onCreate: (payload: ProviderCreate) => Promise<void>
  onProbe: (id: string) => Promise<ProbeResult>
}

export function ProvidersView({
  providers,
  loading,
  error,
  onCreate,
  onProbe,
}: ProvidersViewProps) {
  const [form, setForm] = useState(initialForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [probes, setProbes] = useState<Record<string, string>>({})

  function update(key: keyof typeof initialForm, value: string) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function readPositiveInt(value: string, label: string): number | null {
    const parsed = Number(value)
    if (value.trim() === '' || !Number.isInteger(parsed) || parsed < 1) {
      setFormError(`${label} 必须是正整数`)
      return null
    }
    return parsed
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setFormError(null)
    if (
      !form.base_url.startsWith('http://') &&
      !form.base_url.startsWith('https://')
    ) {
      setFormError('base_url 必须是 http(s)')
      return
    }
    const maxTokens = readPositiveInt(form.max_tokens, 'max_tokens')
    if (maxTokens === null) return
    const temperature = Number(form.temperature)
    if (
      form.temperature.trim() === '' ||
      !Number.isFinite(temperature) ||
      temperature < 0 ||
      temperature > 2
    ) {
      setFormError('temperature 必须是 0 到 2 之间的数值')
      return
    }
    let extra: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(form.extra || '{}')
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setFormError('extra 必须是 JSON 对象')
        return
      }
      extra = parsed as Record<string, unknown>
    } catch {
      setFormError('extra 必须是合法 JSON')
      return
    }
    setSubmitting(true)
    try {
      await onCreate({
        name: form.name,
        base_url: form.base_url,
        model: form.model,
        api_key_ref: form.api_key_ref,
        params: {
          temperature,
          max_tokens: maxTokens,
          extra,
        },
      })
      setForm(initialForm)
    } catch (err) {
      setFormError(describeError(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleProbe(id: string) {
    setProbes((current) => ({ ...current, [id]: '探测中…' }))
    try {
      const result = await onProbe(id)
      setProbes((current) => ({
        ...current,
        [id]: result.tool_calling
          ? '支持 tool calling'
          : '不支持 tool calling',
      }))
    } catch (err) {
      setProbes((current) => ({
        ...current,
        [id]: describeError(err),
      }))
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Providers</h1>
      {error && (
        <p className="rounded border border-rose-700 bg-rose-950/40 p-3 text-sm text-rose-300">
          {error}
        </p>
      )}
      <form
        onSubmit={handleSubmit}
        className="grid gap-3 rounded border border-slate-800 bg-slate-900 p-4 md:grid-cols-2"
      >
        <label className="grid gap-1 text-sm">
          <span>名称</span>
          <input
            className="rounded bg-slate-950 px-3 py-2"
            value={form.name}
            onChange={(event) => update('name', event.target.value)}
            required
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>模型</span>
          <input
            className="rounded bg-slate-950 px-3 py-2"
            value={form.model}
            onChange={(event) => update('model', event.target.value)}
            required
          />
        </label>
        <label className="grid gap-1 text-sm md:col-span-2">
          <span>base_url</span>
          <input
            className="rounded bg-slate-950 px-3 py-2"
            value={form.base_url}
            onChange={(event) => update('base_url', event.target.value)}
            required
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>API key 环境变量</span>
          <input
            className="rounded bg-slate-950 px-3 py-2"
            value={form.api_key_ref}
            onChange={(event) =>
              update('api_key_ref', event.target.value)
            }
            required
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>temperature</span>
          <input
            type="number"
            step="0.1"
            className="rounded bg-slate-950 px-3 py-2"
            value={form.temperature}
            onChange={(event) =>
              update('temperature', event.target.value)
            }
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>max_tokens</span>
          <input
            type="number"
            className="rounded bg-slate-950 px-3 py-2"
            value={form.max_tokens}
            onChange={(event) =>
              update('max_tokens', event.target.value)
            }
          />
        </label>
        <label className="grid gap-1 text-sm md:col-span-2">
          <span>extra JSON</span>
          <textarea
            className="rounded bg-slate-950 px-3 py-2 font-mono text-xs"
            rows={2}
            value={form.extra}
            onChange={(event) => update('extra', event.target.value)}
          />
        </label>
        <div className="flex items-center gap-3 md:col-span-2">
          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            保存 provider
          </button>
          {formError && (
            <p role="alert" className="text-sm text-rose-300">
              {formError}
            </p>
          )}
        </div>
      </form>

      {loading ? (
        <p className="text-sm text-slate-400">加载中…</p>
      ) : providers.length === 0 ? (
        <p className="text-sm text-slate-400">
          还没有 provider。填写上方表单，环境变量名在启动服务前 export。
        </p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {providers.map((provider) => (
            <li
              key={provider.id}
              data-testid="provider-card"
              className="space-y-2 rounded border border-slate-800 bg-slate-900 p-4 text-sm"
            >
              <div className="text-base font-medium">{provider.name}</div>
              <div className="text-slate-400">
                {provider.model} · {provider.base_url}
              </div>
              <div className="text-slate-500">
                环境变量：{provider.api_key_ref}
              </div>
              <div className="flex items-center gap-3">
                <span
                  data-testid="key-configured"
                  className={
                    provider.key_configured
                      ? 'text-emerald-400'
                      : 'text-amber-400'
                  }
                >
                  {provider.key_configured ? 'key 已配置' : 'key 未配置'}
                </span>
                <button
                  type="button"
                  onClick={() => void handleProbe(provider.id)}
                  className="rounded border border-slate-700 px-3 py-1"
                >
                  探测
                </button>
                {probes[provider.id] && (
                  <span className="text-slate-300">{probes[provider.id]}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function ProvidersPage() {
  const queryClient = useQueryClient()
  const providers = useProviders()
  const create = useMutation({
    mutationFn: api.providers.create,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: qk.providers }),
  })
  const probe = useMutation({ mutationFn: api.providers.probe })

  return (
    <ProvidersView
      providers={providers.data ?? []}
      loading={providers.isPending}
      error={providers.error ? describeError(providers.error) : null}
      onCreate={async (payload) => {
        await create.mutateAsync(payload)
      }}
      onProbe={async (id) => probe.mutateAsync(id)}
    />
  )
}
```

把 `frontend/src/App.tsx` 中 Providers 的占位路由替换为：

```tsx
import ProvidersPage from './pages/ProvidersPage'
...
        <Route path="providers" element={<ProvidersPage />} />
```

- [ ] **Step 4: 运行测试**

Run:

```bash
cd frontend
npm run test:run -- src/pages/ProvidersPage.test.tsx
npm run typecheck
```

Expected: 18 passed（3 基础 + 9 表单校验 `it.each` + 3 错误映射 + 3 列表横幅与空状态）；类型检查通过。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/pages/ProvidersPage.tsx frontend/src/pages/ProvidersPage.test.tsx frontend/src/lib/errors.ts frontend/src/App.tsx
git commit -m "feat: Providers 页面"
```

---

### Task 10: Benchmarks 列表、生成与详情

**Files:**
- Create: `frontend/src/pages/BenchmarksPage.tsx`
- Create: `frontend/src/pages/BenchmarksPage.test.tsx`
- Create: `frontend/src/pages/BenchmarkDetailPage.tsx`
- Create: `frontend/src/lib/validate.ts`、`frontend/src/lib/validate.test.ts`
- Modify: `frontend/src/App.tsx`、`frontend/src/pages/ProvidersPage.tsx`（改用 `lib/validate`）

**Interfaces:**
- Consumes: `useBenchmarks()`、`useBenchmark(id)`、`api.benchmarks.create`、`qk.benchmarks`
- Produces:
  - `BenchmarksView`、`BenchmarkDetailView`
  - `data-testid="benchmark-task-row"`
  - 409 错误在表单内显示（按 `err.status === 409` 判别，`JSON.parse(err.detail)` 取回链 id；文案「已存在同 id 题集」）
  - `readPositiveInt(value: string): number | null`、`readNumberInRange(value, min, max): number | null`、`readPositiveNumber(value: string): number | null` —— 纯函数，不碰 React、不出文案；文案仍由页面自己出中文。Task 9 的组件内 `readPositiveInt` 迁到这里，Task 11 直接复用。
  - 站内跳转一律用 `react-router-dom` 的 `Link`（含 409 回链），不用裸 `<a>`：`<a>` 会整页重载、清空 React Query 缓存，Task 15 的 Run 页若照抄会丢掉活的 `EventSource` 与 reducer 状态。视图用到 `Link` 时测试要 `MemoryRouter` 包裹。

- [ ] **Step 1: 写失败测试**

新建 `frontend/src/pages/BenchmarksPage.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { BenchmarkDetail, BenchmarkSummary } from '../api/types'
import {
  BenchmarkDetailView,
  BenchmarksView,
} from './BenchmarksPage'

const summary: BenchmarkSummary = {
  id: 'demo-2x2-3',
  name: 'demo',
  version: 'v1',
  kind: 'frozen',
  cube: '2x2',
  content_hash: 'abcdef123456',
  frozen_at: '2026-10-26T00:00:00+00:00',
  task_count: 1,
}

const detail: BenchmarkDetail = {
  ...summary,
  tasks: [
    {
      id: '2x2-1-1',
      cube: '2x2',
      scramble: ["R'"],
      scramble_depth: 1,
      state: {
        cube: '2x2',
        faces: {
          U: [['white', 'white'], ['white', 'white']],
          R: [['red', 'red'], ['red', 'red']],
          F: [['green', 'green'], ['green', 'green']],
          D: [['yellow', 'yellow'], ['yellow', 'yellow']],
          L: [['orange', 'orange'], ['orange', 'orange']],
          B: [['blue', 'blue'], ['blue', 'blue']],
        },
      },
      reference_length: 1,
      reference_kind: 'exact',
      bin: '1',
    },
  ],
}

describe('BenchmarksView', () => {
  it('creates a 2x2 benchmark with table solver and rejects depth 20', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(undefined)
    render(
      <BenchmarksView
        benchmarks={[]}
        loading={false}
        error={null}
        onCreate={onCreate}
      />,
    )
    expect(screen.getByLabelText('深度 20')).toBeDisabled()
    await user.type(screen.getByLabelText('名称'), 'demo')
    await user.click(screen.getByLabelText('深度 1'))
    await user.click(
      screen.getByRole('button', { name: '生成基准集' }),
    )
    expect(onCreate).toHaveBeenCalledWith({
      name: 'demo',
      cube: '2x2',
      depths: [1],
      per_depth: 2,
      seed: 42,
      solver: 'table',
    })
  })

  it('shows a conflict error from the parent', async () => {
    const user = userEvent.setup()
    const onCreate = vi
      .fn()
      .mockRejectedValueOnce(new Error('benchmark already exists'))
    render(
      <BenchmarksView
        benchmarks={[summary]}
        loading={false}
        error={null}
        onCreate={onCreate}
      />,
    )
    await user.type(screen.getByLabelText('名称'), 'dup')
    await user.click(screen.getByLabelText('深度 1'))
    await user.click(
      screen.getByRole('button', { name: '生成基准集' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'benchmark already exists',
    )
  })
})

describe('BenchmarkDetailView', () => {
  it('renders task rows', () => {
    render(<BenchmarkDetailView benchmark={detail} />)
    expect(screen.getByTestId('benchmark-task-row')).toHaveTextContent(
      '2x2-1-1',
    )
    expect(screen.getByText('exact')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd frontend && npm run test:run -- src/pages/BenchmarksPage.test.tsx`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现列表与生成**

新建 `frontend/src/pages/BenchmarksPage.tsx`：

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { api } from '../api/client'
import { describeError } from '../lib/errors'
import { qk, useBenchmarks } from '../api/queries'
import type {
  BenchmarkCreate,
  BenchmarkDetail,
  BenchmarkSummary,
  CubeKind,
} from '../api/types'
import { shortId } from '../lib/format'

const DEPTHS = [1, 2, 3, 5, 10, 20]

const initialForm = {
  name: '',
  cube: '2x2' as CubeKind,
  depths: [] as number[],
  per_depth: '2',
  seed: '42',
}

export interface BenchmarksViewProps {
  benchmarks: BenchmarkSummary[]
  loading: boolean
  error: string | null
  onCreate: (payload: BenchmarkCreate) => Promise<void>
}

export function BenchmarksView({
  benchmarks,
  loading,
  error,
  onCreate,
}: BenchmarksViewProps) {
  const [form, setForm] = useState(initialForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function setCube(cube: CubeKind) {
    setForm((current) => ({
      ...current,
      cube,
      depths: current.depths.filter(
        (depth) => cube === '3x3' || depth !== 20,
      ),
    }))
  }

  function toggleDepth(depth: number) {
    if (form.cube === '2x2' && depth === 20) return
    setForm((current) => ({
      ...current,
      depths: current.depths.includes(depth)
        ? current.depths.filter((item) => item !== depth)
        : [...current.depths, depth].sort((a, b) => a - b),
    }))
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setFormError(null)
    if (form.depths.length === 0) {
      setFormError('至少选择一个深度')
      return
    }
    setSubmitting(true)
    try {
      await onCreate({
        name: form.name,
        cube: form.cube,
        depths: form.depths,
        per_depth: Number(form.per_depth),
        seed: Number(form.seed),
        solver: form.cube === '2x2' ? 'table' : 'rubik',
      })
      setForm(initialForm)
    } catch (err) {
      setFormError(describeError(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Benchmarks</h1>
      {error && (
        <p className="rounded border border-rose-700 bg-rose-950/40 p-3 text-sm text-rose-300">
          {error}
        </p>
      )}
      <form
        onSubmit={handleSubmit}
        className="grid gap-3 rounded border border-slate-800 bg-slate-900 p-4 md:grid-cols-2"
      >
        <label className="grid gap-1 text-sm">
          <span>名称</span>
          <input
            className="rounded bg-slate-950 px-3 py-2"
            value={form.name}
            onChange={(event) =>
              setForm({ ...form, name: event.target.value })
            }
            required
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>尺寸</span>
          <select
            className="rounded bg-slate-950 px-3 py-2"
            value={form.cube}
            onChange={(event) =>
              setCube(event.target.value as CubeKind)
            }
          >
            <option value="2x2">2x2</option>
            <option value="3x3">3x3</option>
          </select>
        </label>
        <div className="grid gap-1 text-sm md:col-span-2">
          <span>打乱深度</span>
          <div className="flex flex-wrap gap-3">
            {DEPTHS.map((depth) => (
              <label key={depth} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.depths.includes(depth)}
                  disabled={form.cube === '2x2' && depth === 20}
                  onChange={() => toggleDepth(depth)}
                />
                <span>深度 {depth}</span>
              </label>
            ))}
          </div>
          {form.cube === '3x3' && (
            <p className="text-xs text-amber-400">
              3x3 生成需要已构建 twophase 表，可能较慢。
            </p>
          )}
        </div>
        <label className="grid gap-1 text-sm">
          <span>每档题数</span>
          <input
            type="number"
            min={1}
            className="rounded bg-slate-950 px-3 py-2"
            value={form.per_depth}
            onChange={(event) =>
              setForm({ ...form, per_depth: event.target.value })
            }
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>seed</span>
          <input
            type="number"
            className="rounded bg-slate-950 px-3 py-2"
            value={form.seed}
            onChange={(event) =>
              setForm({ ...form, seed: event.target.value })
            }
          />
        </label>
        <div className="flex items-center gap-3 md:col-span-2">
          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            生成基准集
          </button>
          {formError && (
            <p role="alert" className="text-sm text-rose-300">
              {formError}
            </p>
          )}
        </div>
      </form>

      {loading ? (
        <p className="text-sm text-slate-400">加载中…</p>
      ) : benchmarks.length === 0 ? (
        <p className="text-sm text-slate-400">还没有基准集。</p>
      ) : (
        <ul className="space-y-2">
          {benchmarks.map((benchmark) => (
            <li
              key={benchmark.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-800 bg-slate-900 p-4 text-sm"
            >
              <div>
                <div className="font-medium">{benchmark.name}</div>
                <div className="text-slate-400">
                  {benchmark.id} · {benchmark.cube} ·{' '}
                  {benchmark.task_count} 题 · hash {shortId(benchmark.content_hash)}
                </div>
              </div>
              <Link
                className="text-emerald-400"
                to={`/benchmarks/${encodeURIComponent(benchmark.id)}`}
              >
                查看详情
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function BenchmarksPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const benchmarks = useBenchmarks()
  const create = useMutation({
    mutationFn: api.benchmarks.create,
    onSuccess: (benchmark: BenchmarkDetail) => {
      void queryClient.invalidateQueries({ queryKey: qk.benchmarks })
      navigate(`/benchmarks/${benchmark.id}`)
    },
  })

  return (
    <BenchmarksView
      benchmarks={benchmarks.data ?? []}
      loading={benchmarks.isPending}
      error={benchmarks.error ? describeError(benchmarks.error) : null}
      onCreate={async (payload) => {
        await create.mutateAsync(payload)
      }}
    />
  )
}
```

新建 `frontend/src/pages/BenchmarkDetailPage.tsx`：

```tsx
import { Link, useParams } from 'react-router-dom'
import { useBenchmark } from '../api/queries'
import type { BenchmarkDetail } from '../api/types'

export function BenchmarkDetailView({
  benchmark,
}: {
  benchmark: BenchmarkDetail
}) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{benchmark.name}</h1>
      <p className="text-sm text-slate-400">
        {benchmark.id} · {benchmark.cube} · {benchmark.tasks.length} 题 ·
        hash {benchmark.content_hash}
      </p>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-left text-slate-400">
            <th className="py-2">task</th>
            <th>scramble</th>
            <th>depth</th>
            <th>reference</th>
            <th>kind</th>
            <th>bin</th>
          </tr>
        </thead>
        <tbody>
          {benchmark.tasks.map((task) => (
            <tr
              key={task.id}
              data-testid="benchmark-task-row"
              className="border-b border-slate-900"
            >
              <td className="py-2">{task.id}</td>
              <td>{task.scramble.join(' ')}</td>
              <td>{task.scramble_depth}</td>
              <td>{task.reference_length}</td>
              <td>{task.reference_kind}</td>
              <td>{task.bin}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-4 text-sm">
        <Link className="text-emerald-400" to="/benchmarks">
          返回列表
        </Link>
        <Link
          className="text-emerald-400"
          to={`/runs/new?benchmark=${benchmark.id}`}
        >
          用此题集新建 run
        </Link>
      </div>
    </div>
  )
}

export default function BenchmarkDetailPage() {
  const { id } = useParams()
  const benchmark = useBenchmark(id)
  if (benchmark.isPending) return <p>加载中…</p>
  if (benchmark.error) {
    return <p className="text-rose-300">{benchmark.error.message}</p>
  }
  if (!benchmark.data) return null
  return <BenchmarkDetailView benchmark={benchmark.data} />
}
```

把 `frontend/src/App.tsx` 中 Benchmarks 两个占位路由替换为：

```tsx
import BenchmarksPage from './pages/BenchmarksPage'
import BenchmarkDetailPage from './pages/BenchmarkDetailPage'
...
        <Route path="benchmarks" element={<BenchmarksPage />} />
        <Route path="benchmarks/:id" element={<BenchmarkDetailPage />} />
```

- [ ] **Step 4: 运行测试**

Run:

```bash
cd frontend
npm run test:run -- src/pages/BenchmarksPage.test.tsx
npm run typecheck
```

Expected: 3 passed；类型检查通过。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/pages/BenchmarksPage.tsx frontend/src/pages/BenchmarksPage.test.tsx frontend/src/pages/BenchmarkDetailPage.tsx frontend/src/App.tsx
git commit -m "feat: Benchmarks 列表、生成与详情"
```

---

### Task 11: New Run 与 Runs 历史

**Files:**
- Create: `frontend/src/pages/NewRunPage.tsx`
- Create: `frontend/src/pages/NewRunPage.test.tsx`
- Create: `frontend/src/pages/RunsPage.tsx`
- Modify: `frontend/src/lib/validate.ts`、`frontend/src/lib/validate.test.ts`（新增 `readPositiveNumber` 及其用例）
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `useProviders()`、`useBenchmarks()`、`useRuns()`、`api.runs.create`、`qk.runs`、`readPositiveInt`/`readPositiveNumber`/`readNumberInRange`
- Produces:
  - `NewRunView`、`RunsView`
  - 默认预算：2x2 `30/50/300000/300/120`，3x3 `100/150/1000000/900/120`；预算输入以字符串保存，提交时经 `lib/validate` 校验（清空即报错，不允许 0 或负数通过）
  - 可选参数覆盖（spec §7.4）：`params_temperature`（0–2）与 `params_max_tokens`（正整数），留空则 `params` 不含该键，沿用 provider 默认
  - `data-testid="run-row"`

- [ ] **Step 1: 写失败测试**

新建 `frontend/src/pages/NewRunPage.test.tsx`：

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type {
  BenchmarkSummary,
  Provider,
  Run,
} from '../api/types'
import { NewRunView } from './NewRunPage'
import { RunsView } from './RunsPage'

// 视图里用到 Link/useSearchParams，裸 render 会抛；本文件所有用例都用 renderView 包裹
function renderView(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

const provider: Provider = {
  id: 'p1',
  name: 'local',
  base_url: 'http://localhost/v1',
  model: 'm',
  api_key_ref: 'KEY',
  params: {},
  key_configured: true,
  created_at: '2026-10-26T00:00:00+00:00',
}

const benchmarks: BenchmarkSummary[] = [
  {
    id: 'b2',
    name: 'two',
    version: 'v1',
    kind: 'frozen',
    cube: '2x2',
    content_hash: 'h2',
    frozen_at: '2026-10-26T00:00:00+00:00',
    task_count: 1,
  },
  {
    id: 'b3',
    name: 'three',
    version: 'v1',
    kind: 'frozen',
    cube: '3x3',
    content_hash: 'h3',
    frozen_at: '2026-10-26T00:00:00+00:00',
    task_count: 1,
  },
]

const run: Run = {
  id: 'run12345678',
  provider_id: 'p1',
  benchmark_id: 'b2',
  tool_mode: 'both',
  prompt_version: 'v1',
  status: 'finished',
  totals: null,
  error: null,
  created_at: '2026-10-26T00:00:00+00:00',
  started_at: null,
  finished_at: null,
  budget: {
    max_moves: 30,
    max_tool_calls: 50,
    max_tokens: 300000,
    max_seconds: 300,
    turn_timeout: 120,
  },
}

describe('NewRunView', () => {
  it('uses 2x2 defaults and submits overrides', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(undefined)
    renderView(
      <NewRunView
        providers={[provider]}
        benchmarks={benchmarks}
        onCreate={onCreate}
      />,
    )
    expect(screen.getByLabelText('max_moves')).toHaveValue(30)
    await user.clear(screen.getByLabelText('max_moves'))
    await user.type(screen.getByLabelText('max_moves'), '12')
    await user.click(screen.getByRole('button', { name: '启动 run' }))
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        provider_id: 'p1',
        benchmark_id: 'b2',
        tool_mode: 'both',
        budget: expect.objectContaining({ max_moves: 12 }),
      }),
    )
  })

  it('switches defaults when a 3x3 benchmark is selected', async () => {
    const user = userEvent.setup()
    renderView(
      <NewRunView
        providers={[provider]}
        benchmarks={benchmarks}
        onCreate={vi.fn()}
      />,
    )
    await user.selectOptions(screen.getByLabelText('Benchmark'), 'b3')
    expect(screen.getByLabelText('max_moves')).toHaveValue(100)
    expect(screen.getByLabelText('max_seconds')).toHaveValue(900)
  })

  it.each([
    ['max_moves 清空', 'max_moves', 'max_moves 必须是正整数'],
    ['max_tool_calls 清空', 'max_tool_calls', 'max_tool_calls 必须是正整数'],
    ['max_seconds 清空', 'max_seconds', 'max_seconds 必须是正数'],
    ['turn_timeout 清空', 'turn_timeout', 'turn_timeout 必须是正数'],
  ])(
    'rejects %s before starting a run',
    async (_label, key, expected) => {
      const user = userEvent.setup()
      const onCreate = vi.fn().mockResolvedValue(undefined)
      render(
        <NewRunView
          providers={[provider]}
          benchmarks={benchmarks}
          onCreate={onCreate}
        />,
      )
      await user.clear(screen.getByLabelText(key))
      await user.click(screen.getByRole('button', { name: '启动 run' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(expected)
      expect(onCreate).not.toHaveBeenCalled()
    },
  )
})

  it('sends optional param overrides when provided', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(undefined)
    renderView(
      <NewRunView
        providers={[provider]}
        benchmarks={benchmarks}
        onCreate={onCreate}
      />,
    )
    await user.type(screen.getByLabelText('params_temperature'), '0.5')
    await user.type(screen.getByLabelText('params_max_tokens'), '2048')
    await user.click(screen.getByRole('button', { name: '启动 run' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1))
    expect(onCreate.mock.calls[0][0].params).toEqual({
      temperature: 0.5,
      max_tokens: 2048,
    })
  })

  it('rejects an out-of-range temperature', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(undefined)
    renderView(
      <NewRunView
        providers={[provider]}
        benchmarks={benchmarks}
        onCreate={onCreate}
      />,
    )
    await user.type(screen.getByLabelText('params_temperature'), '3')
    await user.click(screen.getByRole('button', { name: '启动 run' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'temperature 必须是 0 到 2 之间的数值',
    )
    expect(onCreate).not.toHaveBeenCalled()
  })
})

describe('RunsView', () => {
  it('maps provider and benchmark names', () => {
    renderView(
      <RunsView
        runs={[run]}
        providers={[provider]}
        benchmarks={benchmarks}
      />,
    )
    expect(screen.getByTestId('run-row')).toHaveTextContent('local')
    expect(screen.getByTestId('run-row')).toHaveTextContent('two')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd frontend && npm run test:run -- src/pages/NewRunPage.test.tsx`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 New Run**

新建 `frontend/src/pages/NewRunPage.tsx`：

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { describeError } from '../lib/errors'
import {
  readNumberInRange,
  readPositiveInt,
  readPositiveNumber,
} from '../lib/validate'
import { useBenchmarks, useProviders, qk } from '../api/queries'
import type {
  BenchmarkSummary,
  Budget,
  CubeKind,
  Provider,
  RunCreate,
  ToolMode,
} from '../api/types'

const DEFAULTS: Record<CubeKind, Budget> = {
  '2x2': {
    max_moves: 30,
    max_tool_calls: 50,
    max_tokens: 300000,
    max_seconds: 300,
    turn_timeout: 120,
  },
  '3x3': {
    max_moves: 100,
    max_tool_calls: 150,
    max_tokens: 1000000,
    max_seconds: 900,
    turn_timeout: 120,
  },
}

type BudgetKey =
  | 'max_moves'
  | 'max_tool_calls'
  | 'max_tokens'
  | 'max_seconds'
  | 'turn_timeout'

function toBudgetForm(budget: Budget): Record<BudgetKey, string> {
  return {
    max_moves: String(budget.max_moves),
    max_tool_calls: String(budget.max_tool_calls),
    max_tokens: String(budget.max_tokens),
    max_seconds: String(budget.max_seconds),
    turn_timeout: String(budget.turn_timeout),
  }
}

export interface NewRunViewProps {
  providers: Provider[]
  benchmarks: BenchmarkSummary[]
  onCreate: (payload: RunCreate) => Promise<void>
}

export function NewRunView({
  providers,
  benchmarks,
  onCreate,
}: NewRunViewProps) {
  const [searchParams] = useSearchParams()
  const requested = searchParams.get('benchmark')
  const initialBenchmark =
    benchmarks.find((item) => item.id === requested) ?? benchmarks[0]
  const [providerId, setProviderId] = useState(providers[0]?.id ?? '')
  const [benchmarkId, setBenchmarkId] = useState(
    initialBenchmark?.id ?? '',
  )
  const [toolMode, setToolMode] = useState<ToolMode>('both')
  const [budget, setBudget] = useState<Record<BudgetKey, string>>(
    toBudgetForm(DEFAULTS[initialBenchmark?.cube ?? '2x2']),
  )
  const [temperature, setTemperature] = useState('')
  const [maxTokens, setMaxTokens] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const selected = benchmarks.find((item) => item.id === benchmarkId)

  useEffect(() => {
    if (selected) setBudget(toBudgetForm(DEFAULTS[selected.cube]))
  }, [selected?.id, selected?.cube])

  function updateBudget(key: BudgetKey, value: string) {
    setBudget((current) => ({ ...current, [key]: value }))
  }

  // 预算用字符串存：数字存法下清空输入会被 React 立刻写回 0，输入框永远清不干净
  function parseBudget(): Budget | string {
    const parsed: Partial<Budget> = {}
    for (const key of ['max_moves', 'max_tool_calls', 'max_tokens'] as const) {
      const value = readPositiveInt(budget[key])
      if (value === null) return `${key} 必须是正整数`
      parsed[key] = value
    }
    for (const key of ['max_seconds', 'turn_timeout'] as const) {
      const value = readPositiveNumber(budget[key])
      if (value === null) return `${key} 必须是正数`
      parsed[key] = value
    }
    return parsed as Budget
  }

  // 留空表示沿用 provider 的默认参数
  function parseParams(): Record<string, number> | string {
    const params: Record<string, number> = {}
    if (temperature.trim() !== '') {
      const value = readNumberInRange(temperature, 0, 2)
      if (value === null) return 'temperature 必须是 0 到 2 之间的数值'
      params.temperature = value
    }
    if (maxTokens.trim() !== '') {
      const value = readPositiveInt(maxTokens)
      if (value === null) return 'max_tokens 必须是正整数'
      params.max_tokens = value
    }
    return params
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setFormError(null)
    if (!providerId || !benchmarkId) {
      setFormError('请选择 provider 和 benchmark')
      return
    }
    const parsedBudget = parseBudget()
    if (typeof parsedBudget === 'string') {
      setFormError(parsedBudget)
      return
    }
    const parsedParams = parseParams()
    if (typeof parsedParams === 'string') {
      setFormError(parsedParams)
      return
    }
    setSubmitting(true)
    try {
      await onCreate({
        provider_id: providerId,
        benchmark_id: benchmarkId,
        tool_mode: toolMode,
        params: parsedParams,
        budget: parsedBudget,
      })
    } catch (err) {
      setFormError(describeError(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">New Run</h1>
      {providers.length === 0 && (
        <p className="text-sm text-amber-300">
          还没有 provider，先到 <Link to="/providers">Providers</Link> 配置。
        </p>
      )}
      {benchmarks.length === 0 && (
        <p className="text-sm text-amber-300">
          还没有基准集，先到 <Link to="/benchmarks">Benchmarks</Link> 生成。
        </p>
      )}
      <form
        onSubmit={handleSubmit}
        className="grid gap-3 rounded border border-slate-800 bg-slate-900 p-4 md:grid-cols-2"
      >
        <label className="grid gap-1 text-sm">
          <span>Provider</span>
          <select
            className="rounded bg-slate-950 px-3 py-2"
            value={providerId}
            onChange={(event) => setProviderId(event.target.value)}
          >
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name} ({provider.model})
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span>Benchmark</span>
          <select
            className="rounded bg-slate-950 px-3 py-2"
            value={benchmarkId}
            onChange={(event) => setBenchmarkId(event.target.value)}
          >
            {benchmarks.map((benchmark) => (
              <option key={benchmark.id} value={benchmark.id}>
                {benchmark.name} ({benchmark.cube}, {benchmark.task_count} 题)
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span>工具模式</span>
          <select
            className="rounded bg-slate-950 px-3 py-2"
            value={toolMode}
            onChange={(event) =>
              setToolMode(event.target.value as ToolMode)
            }
          >
            <option value="both">both（turn + apply_moves）</option>
            <option value="turn_only">turn only</option>
            <option value="batch_only">apply_moves only</option>
          </select>
        </label>
        <div className="grid gap-2 md:col-span-2">
          <p className="text-sm text-slate-400">
            预算上限（未配置价格，仅统计 tokens）
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {(
              [
                ['max_moves', '最大步数'],
                ['max_seconds', '最长秒数'],
                ['max_tool_calls', '工具调用'],
                ['max_tokens', '最大 tokens'],
                ['turn_timeout', '单轮超时'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="grid gap-1 text-xs">
                <span>{key}</span>
                <input
                  aria-label={key}
                  type="number"
                  min={1}
                  className="rounded bg-slate-950 px-2 py-1.5"
                  value={budget[key]}
                  onChange={(event) =>
                    updateBudget(key, event.target.value)
                  }
                />
                <span className="text-slate-500">{label}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="grid gap-2 md:col-span-2">
          <p className="text-sm text-slate-400">
            可选参数覆盖（留空沿用 provider 默认）
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-xs">
              <span>temperature</span>
              <input
                aria-label="params_temperature"
                className="rounded bg-slate-950 px-2 py-1.5"
                value={temperature}
                onChange={(event) => setTemperature(event.target.value)}
              />
              <span className="text-slate-500">0 到 2，留空不覆盖</span>
            </label>
            <label className="grid gap-1 text-xs">
              <span>max_tokens</span>
              <input
                aria-label="params_max_tokens"
                type="number"
                min={1}
                className="rounded bg-slate-950 px-2 py-1.5"
                value={maxTokens}
                onChange={(event) => setMaxTokens(event.target.value)}
              />
              <span className="text-slate-500">留空不覆盖</span>
            </label>
          </div>
        </div>
        <div className="flex items-center gap-3 md:col-span-2">
          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            启动 run
          </button>
          {formError && (
            <p role="alert" className="text-sm text-rose-300">
              {formError}
            </p>
          )}
        </div>
      </form>
    </div>
  )
}

export default function NewRunPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const providers = useProviders()
  const benchmarks = useBenchmarks()
  const create = useMutation({
    mutationFn: api.runs.create,
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: qk.runs })
      navigate(`/runs/${encodeURIComponent(data.id)}`)
    },
  })

  if (providers.isPending || benchmarks.isPending) {
    return <p className="text-sm text-slate-400">加载中…</p>
  }

  return (
    <NewRunView
      providers={providers.data ?? []}
      benchmarks={benchmarks.data ?? []}
      onCreate={async (payload) => {
        await create.mutateAsync(payload)
      }}
    />
  )
}
```

新建 `frontend/src/pages/RunsPage.tsx`：

```tsx
import { Link } from 'react-router-dom'
import { useRuns, useProviders, useBenchmarks } from '../api/queries'
import type {
  BenchmarkSummary,
  Provider,
  Run,
} from '../api/types'
import { shortId, statusLabel } from '../lib/format'

export interface RunsViewProps {
  runs: Run[]
  providers: Provider[]
  benchmarks: BenchmarkSummary[]
}

export function RunsView({
  runs,
  providers,
  benchmarks,
}: RunsViewProps) {
  const providerNames = new Map(
    providers.map((provider) => [provider.id, provider.name]),
  )
  const benchmarkNames = new Map(
    benchmarks.map((benchmark) => [benchmark.id, benchmark.name]),
  )
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Runs</h1>
        <Link
          className="rounded bg-emerald-600 px-4 py-2 text-sm text-white"
          to="/runs/new"
        >
          New Run
        </Link>
      </div>
      {runs.length === 0 ? (
        <p className="text-sm text-slate-400">还没有运行记录。</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-slate-400">
              <th className="py-2">run</th>
              <th>provider</th>
              <th>benchmark</th>
              <th>状态</th>
              <th>创建时间</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr
                key={run.id}
                data-testid="run-row"
                className="border-b border-slate-900"
              >
                <td className="py-2">
                  <Link
                    className="text-emerald-400"
                    to={`/runs/${run.id}`}
                  >
                    {shortId(run.id)}
                  </Link>
                </td>
                <td>{providerNames.get(run.provider_id) ?? run.provider_id}</td>
                <td>
                  {benchmarkNames.get(run.benchmark_id) ?? run.benchmark_id}
                </td>
                <td>{statusLabel(run.status)}</td>
                <td>{new Date(run.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default function RunsPage() {
  const runs = useRuns()
  const providers = useProviders()
  const benchmarks = useBenchmarks()
  if (runs.isPending) return <p>加载中…</p>
  if (runs.error) {
    return <p className="text-rose-300">{runs.error.message}</p>
  }
  return (
    <RunsView
      runs={runs.data ?? []}
      providers={providers.data ?? []}
      benchmarks={benchmarks.data ?? []}
    />
  )
}
```

把 `frontend/src/App.tsx` 中相关占位路由替换为：

```tsx
import NewRunPage from './pages/NewRunPage'
import RunsPage from './pages/RunsPage'
...
        <Route path="runs" element={<RunsPage />} />
        <Route path="runs/new" element={<NewRunPage />} />
```

- [ ] **Step 4: 运行测试**

Run:

```bash
cd frontend
npm run test:run -- src/pages/NewRunPage.test.tsx
npm run typecheck
```

Expected: 3 passed；类型检查通过。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/pages/NewRunPage.tsx frontend/src/pages/NewRunPage.test.tsx frontend/src/pages/RunsPage.tsx frontend/src/App.tsx
git commit -m "feat: New Run 与 Runs 历史页"
```

---

### Task 12: 3D 纯函数（贴纸映射、走法、涂色）

**Files:**
- Create: `frontend/src/cube/facelets.ts`
- Create: `frontend/src/cube/moves.ts`
- Create: `frontend/src/cube/repaint.ts`
- Test: `frontend/src/cube/facelets.test.ts`
- Test: `frontend/src/cube/moves.test.ts`
- Test: `frontend/src/cube/repaint.test.ts`

**Interfaces:**
- Produces:
  - `Vec3`、`FACE_ORDER`、`FACE_FRAME`、`sizeOf(cube)`、`coord(i,size)`
  - `stickerPlacement(face,row,col,size) -> {position, normal}`
  - `slotKey(v)`、`cubieSlots(size)`
  - `parseMove(move,size) -> MoveSpec`、`rotateVec`、`rotateSlot`、`layerSlots`
  - `paintPlan(state) -> StickerPaint[]`、`paintForSlot`、`MATERIAL_NORMALS`、`materialIndex`

- [ ] **Step 1: 写失败测试**

新建 `frontend/src/cube/facelets.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { cubieSlots, stickerPlacement } from './facelets'

describe('facelets', () => {
  it('maps 2x2 stickers to backend coordinates', () => {
    expect(stickerPlacement('U', 0, 0, 2).position).toEqual([-1, 1, -1])
    expect(stickerPlacement('U', 1, 0, 2).position).toEqual([-1, 1, 1])
    expect(stickerPlacement('R', 0, 0, 2).position).toEqual([1, 1, 1])
    expect(stickerPlacement('F', 0, 0, 2).position).toEqual([-1, 1, 1])
  })

  it('maps 3x3 stickers to backend coordinates', () => {
    expect(stickerPlacement('U', 0, 0, 3).position).toEqual([-2, 2, -2])
    expect(stickerPlacement('U', 2, 2, 3).position).toEqual([2, 2, 2])
    expect(stickerPlacement('R', 0, 0, 3).position).toEqual([2, 2, 2])
    expect(stickerPlacement('F', 0, 0, 3).position).toEqual([-2, 2, 2])
    expect(stickerPlacement('D', 2, 2, 3).position).toEqual([2, -2, -2])
    expect(stickerPlacement('B', 0, 0, 3).position).toEqual([2, 2, -2])
  })

  it('builds cubie slots without the 3x3 core', () => {
    expect(cubieSlots(2)).toHaveLength(8)
    expect(cubieSlots(3)).toHaveLength(26)
    expect(cubieSlots(3)).not.toContainEqual([0, 0, 0])
  })
})
```

新建 `frontend/src/cube/moves.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { layerSlots, parseMove, rotateSlot } from './moves'

describe('moves', () => {
  it('parses R variants', () => {
    expect(parseMove('R', 2)).toEqual({
      face: 'R',
      amount: 1,
      axis: 0,
      sign: 1,
      layer: 1,
      turns: 3,
    })
    expect(parseMove("R'", 2).turns).toBe(1)
    expect(parseMove('R2', 2).turns).toBe(2)
  })

  it('rejects malformed moves', () => {
    expect(() => parseMove('X', 2)).toThrow('invalid move')
    expect(() => parseMove('R3', 2)).toThrow('invalid move')
  })

  it('rotates slots like the backend', () => {
    expect(rotateSlot([1, 1, 1], parseMove('R', 2))).toEqual([1, 1, -1])
    expect(rotateSlot([1, 1, 1], parseMove('U', 2))).toEqual([-1, 1, 1])
    expect(rotateSlot([-1, 1, 1], parseMove('F', 2))).toEqual([1, 1, 1])
  })

  it('selects the layer for a move', () => {
    const slots: [number, number, number][] = [
      [1, 1, 1],
      [1, 1, -1],
      [-1, 1, 1],
      [-1, 1, -1],
    ]
    expect(layerSlots(slots, parseMove('R', 2))).toEqual([
      [1, 1, 1],
      [1, 1, -1],
    ])
  })
})
```

新建 `frontend/src/cube/repaint.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import type { CubeState } from '../api/types'
import {
  materialIndex,
  paintForSlot,
  paintPlan,
} from './repaint'

function solved2x2(): CubeState {
  return {
    cube: '2x2',
    faces: {
      U: [['white', 'white'], ['white', 'white']],
      R: [['red', 'red'], ['red', 'red']],
      F: [['green', 'green'], ['green', 'green']],
      D: [['yellow', 'yellow'], ['yellow', 'yellow']],
      L: [['orange', 'orange'], ['orange', 'orange']],
      B: [['blue', 'blue'], ['blue', 'blue']],
    },
  }
}

const afterR: CubeState = {
  cube: '2x2',
  faces: {
    U: [['white', 'green'], ['white', 'green']],
    R: [['red', 'red'], ['red', 'red']],
    F: [['green', 'yellow'], ['green', 'yellow']],
    D: [['yellow', 'blue'], ['yellow', 'blue']],
    L: [['orange', 'orange'], ['orange', 'orange']],
    B: [['white', 'blue'], ['white', 'blue']],
  },
}

describe('repaint', () => {
  it('paints solved 2x2 corner colors', () => {
    const paints = paintPlan(solved2x2())
    expect(paints).toHaveLength(24)
    const colors = paintForSlot(paints, '1,1,1')
    expect(colors.get(materialIndex([1, 0, 0]))).toBe('red')
    expect(colors.get(materialIndex([0, 1, 0]))).toBe('white')
    expect(colors.get(materialIndex([0, 0, 1]))).toBe('green')
  })

  it('paints the state after R', () => {
    const colors = paintForSlot(paintPlan(afterR), '1,1,1')
    expect(colors.get(materialIndex([1, 0, 0]))).toBe('red')
    expect(colors.get(materialIndex([0, 1, 0]))).toBe('green')
    expect(colors.get(materialIndex([0, 0, 1]))).toBe('yellow')
  })

  it('maps all six material normals', () => {
    expect(materialIndex([1, 0, 0])).toBe(0)
    expect(materialIndex([-1, 0, 0])).toBe(1)
    expect(materialIndex([0, 1, 0])).toBe(2)
    expect(materialIndex([0, -1, 0])).toBe(3)
    expect(materialIndex([0, 0, 1])).toBe(4)
    expect(materialIndex([0, 0, -1])).toBe(5)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run:

```bash
cd frontend
npm run test:run -- src/cube
```

Expected: FAIL，模块不存在。

坐标系约定（改前必读）：`coord(i,size)=2i-(size-1)`，`position = normal*(size-1) + right*coord(col) + up*coord(size-1-row)`，`FACE_FRAME` 与 `src/mofang/cube/geometry.py` 逐项一致。据此 2x2 的 U 面 row 0 是**靠后**一行（`up=(0,0,-1)`），所以 `U(0,0)` 落在 `[-1,1,-1]`、`U(1,0)` 落在 `[-1,1,1]`、`R(0,0)` 落在 `[1,1,1]`。这些值是从后端公式推出来的，不要凭直觉把 U 面的坐标“改正”成正 z；3x3 的六个值与 `F(0,0)=[-2,2,2]` 可互相校验。

- [ ] **Step 3: 实现 facelets**

新建 `frontend/src/cube/facelets.ts`：

```ts
import type { CubeKind, Face } from '../api/types'

export type Vec3 = [number, number, number]

export const FACE_ORDER: Face[] = ['U', 'R', 'F', 'D', 'L', 'B']

export const FACE_FRAME: Record<
  Face,
  { normal: Vec3; right: Vec3; up: Vec3 }
> = {
  U: { normal: [0, 1, 0], right: [1, 0, 0], up: [0, 0, -1] },
  R: { normal: [1, 0, 0], right: [0, 0, -1], up: [0, 1, 0] },
  F: { normal: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0] },
  D: { normal: [0, -1, 0], right: [1, 0, 0], up: [0, 0, 1] },
  L: { normal: [-1, 0, 0], right: [0, 0, 1], up: [0, 1, 0] },
  B: { normal: [0, 0, -1], right: [-1, 0, 0], up: [0, 1, 0] },
}

export function sizeOf(cube: CubeKind): 2 | 3 {
  return cube === '2x2' ? 2 : 3
}

export function coord(index: number, size: number): number {
  return 2 * index - (size - 1)
}

export function stickerPlacement(
  face: Face,
  row: number,
  col: number,
  size: number,
): { position: Vec3; normal: Vec3 } {
  const { normal, right, up } = FACE_FRAME[face]
  const depth = size - 1 - row
  return {
    position: [
      normal[0] * (size - 1) +
        right[0] * coord(col, size) +
        up[0] * coord(depth, size),
      normal[1] * (size - 1) +
        right[1] * coord(col, size) +
        up[1] * coord(depth, size),
      normal[2] * (size - 1) +
        right[2] * coord(col, size) +
        up[2] * coord(depth, size),
    ],
    normal,
  }
}

export function slotKey(slot: Vec3): string {
  return `${slot[0]},${slot[1]},${slot[2]}`
}

export function cubieSlots(size: number): Vec3[] {
  const values = Array.from({ length: size }, (_, index) =>
    coord(index, size),
  )
  const slots: Vec3[] = []
  for (const x of values) {
    for (const y of values) {
      for (const z of values) {
        if (size === 3 && x === 0 && y === 0 && z === 0) continue
        slots.push([x, y, z])
      }
    }
  }
  return slots
}
```

- [ ] **Step 4: 实现 moves**

新建 `frontend/src/cube/moves.ts`：

```ts
import type { Face } from '../api/types'
import { FACE_FRAME, FACE_ORDER, type Vec3 } from './facelets'

export interface MoveSpec {
  face: Face
  amount: 1 | 2 | 3
  axis: 0 | 1 | 2
  sign: 1 | -1
  layer: number
  turns: number
}

export function parseMove(move: string, size: number): MoveSpec {
  const face = move[0] as Face
  if (!FACE_ORDER.includes(face)) {
    throw new Error(`invalid move: ${move}`)
  }
  const suffix = move.slice(1)
  const amount = suffix === '' ? 1 : suffix === '2' ? 2 : suffix === "'" ? 3 : 0
  if (amount === 0) {
    throw new Error(`invalid move: ${move}`)
  }
  const normal = FACE_FRAME[face].normal
  const axis = normal.findIndex((value) => value !== 0) as 0 | 1 | 2
  const sign = normal[axis] as 1 | -1
  return {
    face,
    amount,
    axis,
    sign,
    layer: sign * (size - 1),
    turns: ((-sign * amount) % 4 + 4) % 4,
  }
}

export function rotateVec(
  value: Vec3,
  axis: 0 | 1 | 2,
  quarterTurns: number,
): Vec3 {
  let [x, y, z] = value
  const turns = ((quarterTurns % 4) + 4) % 4
  for (let index = 0; index < turns; index += 1) {
    if (axis === 0) {
      ;[y, z] = [-z, y]
    } else if (axis === 1) {
      ;[x, z] = [z, -x]
    } else {
      ;[x, y] = [-y, x]
    }
  }
  return [x, y, z]
}

export function rotateSlot(slot: Vec3, spec: MoveSpec): Vec3 {
  return rotateVec(slot, spec.axis, spec.turns)
}

export function layerSlots(slots: Vec3[], spec: MoveSpec): Vec3[] {
  return slots.filter((slot) => slot[spec.axis] === spec.layer)
}
```

- [ ] **Step 5: 实现涂色计划**

新建 `frontend/src/cube/repaint.ts`：

```ts
import type { CubeState, ColorName } from '../api/types'
import {
  FACE_ORDER,
  sizeOf,
  slotKey,
  stickerPlacement,
  type Vec3,
} from './facelets'

export const MATERIAL_NORMALS: Vec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
]

export interface StickerPaint {
  slot: string
  normal: Vec3
  color: ColorName
}

export function materialIndex(normal: Vec3): number {
  return MATERIAL_NORMALS.findIndex(
    (candidate) =>
      candidate[0] === normal[0] &&
      candidate[1] === normal[1] &&
      candidate[2] === normal[2],
  )
}

export function paintPlan(state: CubeState): StickerPaint[] {
  const size = sizeOf(state.cube)
  const paints: StickerPaint[] = []
  for (const face of FACE_ORDER) {
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        const { position, normal } = stickerPlacement(
          face,
          row,
          col,
          size,
        )
        paints.push({
          slot: slotKey(position),
          normal,
          color: state.faces[face][row][col],
        })
      }
    }
  }
  return paints
}

export function paintForSlot(
  paints: StickerPaint[],
  slot: string,
): Map<number, ColorName> {
  const result = new Map<number, ColorName>()
  for (const paint of paints) {
    if (paint.slot === slot) {
      result.set(materialIndex(paint.normal), paint.color)
    }
  }
  return result
}
```

- [ ] **Step 6: 运行测试**

Run:

```bash
cd frontend
npm run test:run -- src/cube
npm run typecheck
```

Expected: 10 项左右全部通过；类型检查通过。

- [ ] **Step 7: 提交**

```bash
git add frontend/src/cube
git commit -m "feat: 3D 贴纸映射、走法与涂色纯函数"
```

---

### Task 13: CubeView 与动画队列

**Files:**
- Create: `frontend/src/cube/animation.ts`
- Create: `frontend/src/cube/animation.test.ts`
- Create: `frontend/src/cube/CubeView.tsx`
- Modify: `frontend/src/cube/facelets.test.ts`
- Modify: `frontend/src/cube/moves.test.ts`
- Modify: `frontend/src/cube/repaint.test.ts`

**Interfaces:**
- Consumes: Task 12 的全部纯函数（`rotateVec`、`rotateSlot`、`layerSlots`、`parseMove`、`MoveSpec`、`cubieSlots`、`sizeOf`、`slotKey`、`FACE_FRAME`、`FACE_ORDER`、`paintPlan`、`materialIndex`、`MATERIAL_NORMALS`）、`colorHex`。
- Produces:
  - `animation.ts`：
    ```ts
    export function rotateOffset(value: Vec3, axis: 0 | 1 | 2, angle: number): Vec3
    export function specAngle(spec: MoveSpec): number
    ```
  - `CubeView`、`MoveBatch`、`CubeViewProps`（props 见 Step 5）
  - `data-testid="cube-canvas"`

动画必须是**刚性旋转**：层内 cubie 的位置绕轴公转、朝向同步旋转。只转朝向会让 cubie 原地打转再跳到新槽位；位置与落地方向不一致会让每步末尾回跳。CubeView 本身没有 WebGL 单测，靠 `rotateOffset` 的纯函数用例、E2E 与手动运行验收。

- [ ] **Step 1: 写 animation 失败测试**

新建 `frontend/src/cube/animation.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { rotateOffset, specAngle } from './animation'
import { FACE_ORDER, type Vec3 } from './facelets'
import { parseMove, rotateVec } from './moves'

const SAMPLES: Vec3[] = [
  [1, 1, 1],
  [1, -1, 1],
  [-1, 1, -1],
  [0, 1, 0],
  [1, 0, -1],
]

const MOVES = FACE_ORDER.flatMap((face) =>
  [1, 2, 3].map((amount) => ({
    move: amount === 1 ? face : amount === 2 ? `${face}2` : `${face}'`,
  })),
)

describe('rotateOffset', () => {
  it.each(MOVES)('$move 的动画角度与落地方向一致', ({ move }) => {
    const spec = parseMove(move, 3)
    for (const sample of SAMPLES) {
      const animated = rotateOffset(sample, spec.axis, specAngle(spec))
      const landed = rotateVec(sample, spec.axis, spec.turns)
      animated.forEach((value, index) => {
        expect(value).toBeCloseTo(landed[index], 10)
      })
    }
  })

  it('刚性：绕轴旋转保持到轴的距离', () => {
    const sample: Vec3 = [1, 2, -3]
    const length = Math.hypot(...sample)
    for (const axis of [0, 1, 2] as const) {
      for (const angle of [0.3, 1.1, Math.PI / 2, 3.7]) {
        expect(Math.hypot(...rotateOffset(sample, axis, angle))).toBeCloseTo(
          length,
          10,
        )
      }
    }
  })

  it('0 角度保持原位', () => {
    for (const sample of SAMPLES) {
      rotateOffset(sample, 1, 0).forEach((value, index) => {
        expect(value).toBeCloseTo(sample[index], 10)
      })
    }
  })

  it('turns=3 走短弧且落点不变', () => {
    const spec = parseMove('R', 3)
    expect(spec.turns).toBe(3)
    expect(specAngle(spec)).toBeCloseTo(-Math.PI / 2, 12)
    expect(Math.abs(specAngle(spec))).toBeLessThanOrEqual(Math.PI)
  })
})
```

- [ ] **Step 2: 实现 animation.ts**

新建 `frontend/src/cube/animation.ts`：

```ts
import type { Vec3 } from './facelets'
import type { MoveSpec } from './moves'

// 与 rotateVec 同一约定：绕 +axis 的右手旋转，angle 以弧度计。
export function rotateOffset(
  value: Vec3,
  axis: 0 | 1 | 2,
  angle: number,
): Vec3 {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const [x, y, z] = value
  if (axis === 0) return [x, y * cos - z * sin, y * sin + z * cos]
  if (axis === 1) return [x * cos + z * sin, y, -x * sin + z * cos]
  return [x * cos - y * sin, x * sin + y * cos, z]
}

export function specAngle(spec: MoveSpec): number {
  // turns 是落地方向的整数表示：3 等价于 -1 个 90°，动画走短弧。
  const turns = spec.turns === 3 ? -1 : spec.turns
  return (turns * Math.PI) / 2
}
```

- [ ] **Step 3: 运行 animation 测试**

Run:

```bash
cd frontend
npm run test:run -- src/cube/animation.test.ts
```

Expected: 21 passed（6 面 × 3 数量 + 刚性 + 零角 + 短弧）。

- [ ] **Step 4: 补 Task 12 评审携带的覆盖**

在 `frontend/src/cube/facelets.test.ts` 的 `describe` 内追加：

```ts
  it('maps L stickers to backend coordinates', () => {
    // L 的 right 是 +z、up 是 +y；镜像写反也能骗过只测 U/R/F 的用例。
    expect(stickerPlacement('L', 0, 0, 2).position).toEqual([-1, 1, -1])
    expect(stickerPlacement('L', 1, 1, 2).position).toEqual([-1, -1, 1])
    expect(stickerPlacement('L', 0, 0, 3).position).toEqual([-2, 2, -2])
  })
```

在 `frontend/src/cube/moves.test.ts` 的 `describe` 内追加：

```ts
  it('parses negative-normal faces', () => {
    expect(parseMove('L', 2)).toEqual({
      face: 'L',
      amount: 1,
      axis: 0,
      sign: -1,
      layer: -1,
      turns: 1,
    })
    expect(rotateSlot([-1, 1, 1], parseMove('L', 2))).toEqual([-1, -1, 1])
  })
```

在 `frontend/src/cube/repaint.test.ts` 中把类型导入改为 `import type { ColorName, CubeState } from '../api/types'`，追加 3x3 夹具与用例：

```ts
function solved3x3(): CubeState {
  const face = (color: ColorName) => [
    [color, color, color],
    [color, color, color],
    [color, color, color],
  ]
  return {
    cube: '3x3',
    faces: {
      U: face('white'),
      R: face('red'),
      F: face('green'),
      D: face('yellow'),
      L: face('orange'),
      B: face('blue'),
    },
  }
}
```

```ts
  it('paints a solved 3x3', () => {
    const paints = paintPlan(solved3x3())
    expect(paints).toHaveLength(54)
    const corner = paintForSlot(paints, '2,2,2')
    expect(corner.get(materialIndex([1, 0, 0]))).toBe('red')
    expect(corner.get(materialIndex([0, 1, 0]))).toBe('white')
    expect(corner.get(materialIndex([0, 0, 1]))).toBe('green')
    const frontCenter = paintForSlot(paints, '0,0,2')
    expect(frontCenter.get(materialIndex([0, 0, 1]))).toBe('green')
    const upCenter = paintForSlot(paints, '0,2,0')
    expect(upCenter.get(materialIndex([0, 1, 0]))).toBe('white')
  })
```

Run:

```bash
cd frontend
npm run test:run -- src/cube
```

Expected: 全部通过。

- [ ] **Step 5: 实现 CubeView**

新建 `frontend/src/cube/CubeView.tsx`。命令语义：`state` + `resetToken` 一起构成一次“吸附到该局面”的命令（单独变 `state` 不生效）；`batch` 入队，按 `eventId` 去重；`speed >= 100` 视为 instant，直接吸附到队列末状态；`skipToken` 递增一次跳一次；`paused` 冻结帧推进。

```tsx
import { OrbitControls } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { CubeState } from '../api/types'
import { colorHex } from '../lib/format'
import { rotateOffset, specAngle } from './animation'
import { cubieSlots, sizeOf, slotKey, type Vec3 } from './facelets'
import { layerSlots, parseMove, rotateSlot, type MoveSpec } from './moves'
import { MATERIAL_NORMALS, materialIndex, paintPlan } from './repaint'

const CUBIE_SIZE = 0.94
const DARK = '#0f172a'
const UNIT = 0.5
const BASE_DURATION_MS = 220
const INSTANT_SPEED = 100

const AXES = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1),
]

export interface MoveBatch {
  eventId: number
  moves: string[]
  state: CubeState
}

export interface CubeViewProps {
  state: CubeState | null
  resetToken: number
  batch: MoveBatch | null
  speed: number
  paused: boolean
  skipToken: number
}

interface Entry {
  index: number
  mesh: THREE.Mesh
  materials: THREE.MeshStandardMaterial[]
  slot: Vec3
  quat: THREE.Quaternion
}

interface CurrentMove {
  batch: MoveBatch
  moveIndex: number
  spec: MoveSpec
  elapsed: number
  duration: number
  entries: Entry[]
}

function Scene(props: CubeViewProps) {
  const size = props.state ? sizeOf(props.state.cube) : 2
  const slots = useMemo(() => cubieSlots(size), [size])
  const group = useRef<THREE.Group | null>(null)
  const entries = useRef<Entry[]>([])
  const queue = useRef<MoveBatch[]>([])
  const current = useRef<CurrentMove | null>(null)
  const pausedRef = useRef(props.paused)
  const speedRef = useRef(props.speed)
  const latestTarget = useRef<CubeState | null>(props.state)
  const lastBatchId = useRef<number | null>(null)
  const scratchPosition = useRef(new THREE.Vector3())
  const scratchQuat = useRef(new THREE.Quaternion())

  useEffect(() => {
    pausedRef.current = props.paused
  }, [props.paused])

  useEffect(() => {
    speedRef.current = props.speed
  }, [props.speed])

  function repaint(state: CubeState) {
    const plans = new Map<string, Map<number, string>>()
    for (const paint of paintPlan(state)) {
      let slotPlan = plans.get(paint.slot)
      if (!slotPlan) {
        slotPlan = new Map()
        plans.set(paint.slot, slotPlan)
      }
      slotPlan.set(materialIndex(paint.normal), paint.color)
    }
    for (const entry of entries.current) {
      const slotPlan = plans.get(slotKey(entry.slot))
      entry.materials.forEach((material, index) => {
        const color = slotPlan?.get(index)
        material.color.set(color ? colorHex(color) : DARK)
      })
    }
  }

  function place(entry: Entry, slot: Vec3) {
    entry.slot = slot
    entry.quat.identity()
    entry.mesh.position.set(slot[0] * UNIT, slot[1] * UNIT, slot[2] * UNIT)
    entry.mesh.quaternion.identity()
  }

  function snapTo(state: CubeState | null) {
    queue.current = []
    current.current = null
    latestTarget.current = state
    entries.current.forEach((entry) => {
      place(entry, slots[entry.index])
    })
    if (state) repaint(state)
  }

  useEffect(() => {
    const parent = group.current
    if (!parent) return
    const built: Entry[] = slots.map((slot, index) => {
      const geometry = new THREE.BoxGeometry(
        CUBIE_SIZE,
        CUBIE_SIZE,
        CUBIE_SIZE,
      )
      const materials = MATERIAL_NORMALS.map(
        () =>
          new THREE.MeshStandardMaterial({
            color: DARK,
            roughness: 0.45,
            metalness: 0,
          }),
      )
      const mesh = new THREE.Mesh(geometry, materials)
      mesh.position.set(slot[0] * UNIT, slot[1] * UNIT, slot[2] * UNIT)
      parent.add(mesh)
      return { index, mesh, materials, slot, quat: new THREE.Quaternion() }
    })
    entries.current = built
    if (latestTarget.current) repaint(latestTarget.current)
    return () => {
      for (const entry of built) {
        parent.remove(entry.mesh)
        entry.mesh.geometry.dispose()
        entry.materials.forEach((material) => material.dispose())
      }
      entries.current = []
    }
  }, [slots])

  // state 只在 resetToken 递增时吸附；实时 state 的更新不得打断动画。
  // 事件 id 在同一 run 内单调，换 run/换题会从 1 重来，所以吸附时清掉去重标记。
  useEffect(() => {
    lastBatchId.current = null
    snapTo(props.state)
  }, [props.resetToken])

  useEffect(() => {
    const batch = props.batch
    if (!batch) return
    if (batch.eventId === lastBatchId.current) return
    lastBatchId.current = batch.eventId
    latestTarget.current = batch.state
    queue.current.push(batch)
  }, [props.batch])

  useEffect(() => {
    if (props.skipToken > 0) snapTo(latestTarget.current)
  }, [props.skipToken])

  function beginMove(batch: MoveBatch, moveIndex: number): CurrentMove {
    const spec = parseMove(batch.moves[moveIndex], sizeOf(batch.state.cube))
    const keys = new Set(
      layerSlots(
        entries.current.map((entry) => entry.slot),
        spec,
      ).map(slotKey),
    )
    return {
      batch,
      moveIndex,
      spec,
      elapsed: 0,
      duration: BASE_DURATION_MS / speedRef.current,
      entries: entries.current.filter((entry) =>
        keys.has(slotKey(entry.slot)),
      ),
    }
  }

  function startNextMove() {
    const batch = queue.current[0]
    if (!batch) return
    current.current = beginMove(batch, 0)
  }

  function applyFrame(move: CurrentMove, angle: number) {
    const quat = scratchQuat.current.setFromAxisAngle(
      AXES[move.spec.axis],
      angle,
    )
    const position = scratchPosition.current
    for (const entry of move.entries) {
      const [x, y, z] = rotateOffset(entry.slot, move.spec.axis, angle)
      position.set(x * UNIT, y * UNIT, z * UNIT)
      entry.mesh.position.copy(position)
      entry.mesh.quaternion.copy(quat).multiply(entry.quat)
    }
  }

  function commitMove(move: CurrentMove) {
    const full = scratchQuat.current.setFromAxisAngle(
      AXES[move.spec.axis],
      specAngle(move.spec),
    )
    for (const entry of move.entries) {
      entry.quat.premultiply(full)
      entry.slot = rotateSlot(entry.slot, move.spec)
      entry.mesh.position.set(
        entry.slot[0] * UNIT,
        entry.slot[1] * UNIT,
        entry.slot[2] * UNIT,
      )
      entry.mesh.quaternion.copy(entry.quat)
    }
  }

  function finishMove(move: CurrentMove) {
    commitMove(move)
    const nextIndex = move.moveIndex + 1
    if (nextIndex < move.batch.moves.length) {
      current.current = beginMove(move.batch, nextIndex)
      return
    }
    queue.current.shift()
    current.current = null
    for (const entry of entries.current) {
      entry.quat.identity()
      entry.mesh.quaternion.identity()
    }
    repaint(move.batch.state)
  }

  useFrame((_, delta) => {
    if (pausedRef.current) return
    if (speedRef.current >= INSTANT_SPEED) {
      if (current.current || queue.current.length > 0) {
        snapTo(latestTarget.current)
      }
      return
    }
    if (!current.current) startNextMove()
    const move = current.current
    if (!move) return
    move.elapsed += delta * 1000
    const progress = Math.min(1, move.elapsed / move.duration)
    const eased = progress * progress * (3 - 2 * progress)
    applyFrame(move, specAngle(move.spec) * eased)
    if (progress >= 1) finishMove(move)
  })

  return (
    <>
      <ambientLight intensity={0.85} />
      <directionalLight position={[5, 8, 6]} intensity={1.5} />
      <directionalLight position={[-5, -4, -6]} intensity={0.55} />
      <group ref={group} />
      <OrbitControls
        enablePan={false}
        minDistance={4}
        maxDistance={14}
        minPolarAngle={Math.PI / 6}
        maxPolarAngle={(Math.PI * 5) / 6}
        enableDamping
      />
    </>
  )
}

export function CubeView(props: CubeViewProps) {
  const size = props.state ? sizeOf(props.state.cube) : 2
  // r3f 的 camera 只在 Canvas 挂载时生效，尺寸切换必须重建 Canvas。
  return (
    <div data-testid="cube-canvas" className="h-[420px] w-full">
      <Canvas
        key={size}
        camera={{
          position: size === 2 ? [3.2, 3.2, 4.2] : [5, 5, 6.5],
          fov: 45,
        }}
      >
        <Scene {...props} />
      </Canvas>
    </div>
  )
}
```

- [ ] **Step 6: 类型检查与构建**

Run:

```bash
cd frontend
npm run typecheck
npm run build
```

Expected: 通过。若 JSX 类型报错，确认 `@react-three/fiber` 版本 ≥9 且 `three` 类型已随包提供；不要把 `three` 降到 r150 之前。

- [ ] **Step 7: 跑前端全量测试**

Run:

```bash
cd frontend
npm run test:run
```

Expected: 全部通过（新增 animation 21 条 + L 面/负号/3x3 各 1 条）。

- [ ] **Step 8: 提交**

```bash
git add frontend/src/cube/animation.ts frontend/src/cube/animation.test.ts frontend/src/cube/facelets.test.ts frontend/src/cube/moves.test.ts frontend/src/cube/repaint.test.ts
git commit -m "feat: 动画旋转纯函数与贴纸覆盖补强"
git add frontend/src/cube/CubeView.tsx
git commit -m "feat: 3D cube 视图与动画队列"
```

---

### Task 14: 实时事件 reducer 与 useRunEvents

**Files:**
- Create: `frontend/src/hooks/liveReducer.ts`
- Create: `frontend/src/hooks/liveReducer.test.ts`
- Create: `frontend/src/hooks/useRunEvents.ts`
- Create: `frontend/src/hooks/useRunEvents.test.tsx`

**Interfaces:**
- Consumes: `RunEvent`、`Snapshot`、`Episode`、`CubeState`、`api.runs.snapshot`、`api.runs.eventsUrl`
- Produces:
  - `liveReducer(state, action)`
  - `LiveState`：run、episodes、currentEpisode、logs、usage、progress、lastEventId、connection、latestBatch、firstInvalidCall、error、snapshotState、snapshotToken、episodeToken
  - `useRunEvents(runId) -> LiveState`

- [ ] **Step 1: 写 reducer 失败测试**

新建 `frontend/src/test/fixtures.ts`：

```ts
import type { Episode, Run } from '../api/types'

export function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 'r1',
    provider_id: 'p1',
    benchmark_id: 'b1',
    tool_mode: 'both',
    prompt_version: 'v1',
    status: 'running',
    totals: null,
    error: null,
    created_at: '2026-10-26T00:00:00+00:00',
    started_at: '2026-10-26T00:00:01+00:00',
    finished_at: null,
    budget: {
      max_moves: 30,
      max_tool_calls: 50,
      max_tokens: 300000,
      max_seconds: 300,
      turn_timeout: 120,
    },
    ...overrides,
  }
}

export function makeEpisode(overrides: Partial<Episode> = {}): Episode {
  return {
    id: 'e1',
    run_id: 'r1',
    task_id: 'b1:t1',
    task_key: 't1',
    status: 'running',
    solved: false,
    moves_used: 0,
    reference_length: 1,
    efficiency: null,
    progress_ratio: null,
    protocol_errors: 0,
    tokens_in: 0,
    tokens_out: 0,
    latency_ms: null,
    failure_code: null,
    error: null,
    started_at: '2026-10-26T00:00:02+00:00',
    finished_at: null,
    ...overrides,
  }
}
```

新建 `frontend/src/hooks/liveReducer.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import type { AggregateReport, CubeState, RunEvent } from '../api/types'
import { makeEpisode, makeRun } from '../test/fixtures'
import {
  initialLiveState,
  liveReducer,
  type LiveAction,
} from './liveReducer'

function event<T extends RunEvent['type']>(
  type: T,
  data: unknown,
  id = 1,
  episodeId: string | null = 'e1',
): RunEvent {
  return {
    id,
    type,
    run_id: 'r1',
    episode_id: episodeId,
    ts: '2026-10-26T00:00:03+00:00',
    data,
  } as RunEvent
}

function apply(state = initialLiveState(), action: LiveAction) {
  return liveReducer(state, action)
}

describe('liveReducer', () => {
  it('applies a snapshot and resets live data', () => {
    const run = makeRun()
    const episode = makeEpisode()
    const state = apply(initialLiveState(), {
      type: 'snapshot',
      run,
      episodes: [episode],
      lastEventId: 3,
      snapshotState: null,
      reset: true,
    })
    expect(state.run?.id).toBe('r1')
    expect(state.currentEpisode?.id).toBe('e1')
    expect(state.lastEventId).toBe(3)
    expect(state.progress).toEqual([{ moves: 0, length: 1 }])
    expect(state.snapshotToken).toBe(1)
  })

  it('tracks episode, usage, logs, progress and first invalid call', () => {
    let state = apply(initialLiveState(), {
      type: 'snapshot',
      run: makeRun(),
      episodes: [],
      lastEventId: 0,
      snapshotState: null,
      reset: true,
    })
    state = apply(state, {
      type: 'event',
      event: event(
        'episode.started',
        { task_id: 'b1:t1', reference_length: 1 },
        1,
      ),
    })
    expect(state.currentEpisode?.task_key).toBe('t1')
    expect(state.episodeToken).toBe(1)
    state = apply(state, {
      type: 'event',
      event: event(
        'model.message',
        {
          content: 'thinking',
          tool_calls: 1,
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        },
        2,
      ),
    })
    expect(state.logs.at(-1)?.text).toBe('thinking')
    expect(state.usage).toEqual({
      prompt_tokens: 10,
      completion_tokens: 5,
    })
    state = apply(state, {
      type: 'event',
      event: event(
        'tool.result',
        {
          call_id: 'c1',
          tool: 'turn',
          ok: false,
          payload: { error: 'invalid_face' },
        },
        3,
      ),
    })
    expect(state.firstInvalidCall).toEqual({
      tool: 'turn',
      message: 'invalid_face',
    })
    state = apply(state, {
      type: 'event',
      event: event(
        'move.applied',
        {
          moves: ["R'"],
          state: {
            cube: '2x2',
            faces: {
              U: [['white', 'white'], ['white', 'white']],
              R: [['red', 'red'], ['red', 'red']],
              F: [['green', 'green'], ['green', 'green']],
              D: [['yellow', 'yellow'], ['yellow', 'yellow']],
              L: [['orange', 'orange'], ['orange', 'orange']],
              B: [['blue', 'blue'], ['blue', 'blue']],
            },
          },
          moves_used: 1,
          solved: true,
          reference_length_after: 0,
        },
        4,
      ),
    })
    expect(state.latestBatch?.moves).toEqual(["R'"])
    expect(state.progress.at(-1)).toEqual({ moves: 1, length: 0 })
    expect(state.currentEpisode?.solved).toBe(true)
    expect(state.currentEpisode?.moves_used).toBe(1)
  })

  it('deduplicates event ids and closes on run.finished', () => {
    let state = apply(initialLiveState(), {
      type: 'snapshot',
      run: makeRun(),
      episodes: [],
      lastEventId: 1,
      snapshotState: null,
      reset: true,
    })
    const duplicate = event(
      'model.message',
      {
        content: 'old',
        tool_calls: 0,
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
      1,
    )
    state = apply(state, { type: 'event', event: duplicate })
    expect(state.logs).toHaveLength(0)
    state = apply(state, {
      type: 'event',
      event: event(
        'run.finished',
        { status: 'finished', totals: null },
        2,
        null,
      ),
    })
    expect(state.run?.status).toBe('finished')
    expect(state.connection).toBe('closed')
  })

  it('resets per-episode data on a new episode', () => {
    let state = apply(initialLiveState(), {
      type: 'snapshot',
      run: makeRun(),
      episodes: [makeEpisode()],
      lastEventId: 1,
      snapshotState: null,
      reset: true,
    })
    state = apply(state, {
      type: 'event',
      event: event(
        'model.message',
        {
          content: 'first',
          tool_calls: 0,
          usage: { prompt_tokens: 2, completion_tokens: 3 },
        },
        2,
      ),
    })
    state = apply(state, {
      type: 'event',
      event: event(
        'episode.started',
        { task_id: 'b1:t2', reference_length: 2 },
        3,
        'e2',
      ),
    })
    expect(state.currentEpisode?.id).toBe('e2')
    expect(state.logs).toHaveLength(0)
    expect(state.usage).toEqual({
      prompt_tokens: 0,
      completion_tokens: 0,
    })
    expect(state.progress).toEqual([{ moves: 0, length: 2 }])
    expect(state.episodeToken).toBe(1)
  })

  it('keeps live data on a reconnect snapshot', () => {
    let state = apply(initialLiveState(), {
      type: 'snapshot',
      run: makeRun(),
      episodes: [],
      lastEventId: 0,
      snapshotState: null,
      reset: true,
    })
    state = apply(state, {
      type: 'event',
      event: event(
        'model.message',
        {
          content: 'kept',
          tool_calls: 0,
          usage: { prompt_tokens: 5, completion_tokens: 6 },
        },
        1,
      ),
    })
    const token = state.snapshotToken
    const snapshotState: CubeState = {
      cube: '2x2',
      faces: {
        U: [['white', 'white'], ['white', 'white']],
        R: [['red', 'red'], ['red', 'red']],
        F: [['green', 'green'], ['green', 'green']],
        D: [['yellow', 'yellow'], ['yellow', 'yellow']],
        L: [['orange', 'orange'], ['orange', 'orange']],
        B: [['blue', 'blue'], ['blue', 'blue']],
      },
    }
    state = apply(state, {
      type: 'snapshot',
      run: makeRun(),
      episodes: [makeEpisode({ id: 'e2', task_key: 't2' })],
      lastEventId: 1,
      snapshotState,
      reset: false,
    })
    expect(state.logs).toHaveLength(1)
    expect(state.usage).toEqual({
      prompt_tokens: 5,
      completion_tokens: 6,
    })
    expect(state.snapshotToken).toBe(token + 1)
    expect(state.snapshotState).toEqual(snapshotState)
    expect(state.currentEpisode?.id).toBe('e2')
  })

  it('merges finish totals and marks run.error as failed', () => {
    const totals: AggregateReport = {
      benchmark_id: 'b1',
      benchmark_hash: 'h1',
      benchmark_total_tasks: 1,
      partial: false,
      totals: { tasks: 1, solved: 1, solve_rate: 1, ci95: [1, 1] },
      by_bin: {},
      episodes: [],
    }
    let state = apply(initialLiveState(), {
      type: 'snapshot',
      run: makeRun(),
      episodes: [],
      lastEventId: 0,
      snapshotState: null,
      reset: true,
    })
    state = apply(state, {
      type: 'event',
      event: event('run.finished', { status: 'finished', totals }, 1, null),
    })
    expect(state.run?.status).toBe('finished')
    expect(state.run?.totals?.totals.solve_rate).toBe(1)
    expect(state.connection).toBe('closed')

    state = apply(initialLiveState(), {
      type: 'snapshot',
      run: makeRun(),
      episodes: [],
      lastEventId: 0,
      snapshotState: null,
      reset: true,
    })
    state = apply(state, {
      type: 'event',
      event: event('run.error', { message: 'boom' }, 1, null),
    })
    expect(state.run?.status).toBe('failed')
    expect(state.run?.error).toBe('boom')
    expect(state.error).toBe('boom')
    expect(state.connection).toBe('closed')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd frontend && npm run test:run -- src/hooks/liveReducer.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 reducer**

新建 `frontend/src/hooks/liveReducer.ts`：

```ts
import type {
  CubeState,
  Episode,
  ProgressPoint,
  Run,
  RunEvent,
  Usage,
} from '../api/types'

export type ConnectionState =
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'closed'

export interface LiveLog {
  id: number
  kind: 'model' | 'tool'
  text: string
  data: unknown
}

export interface MoveBatch {
  eventId: number
  moves: string[]
  state: CubeState
}

export interface LiveState {
  run: Run | null
  episodes: Episode[]
  currentEpisode: Episode | null
  logs: LiveLog[]
  usage: Usage
  progress: ProgressPoint[]
  lastEventId: number
  connection: ConnectionState
  latestBatch: MoveBatch | null
  firstInvalidCall: { tool: string; message: string } | null
  error: string | null
  snapshotState: CubeState | null
  snapshotToken: number
  episodeToken: number
}

export type LiveAction =
  | {
      type: 'snapshot'
      run: Run
      episodes: Episode[]
      lastEventId: number
      snapshotState: CubeState | null
      reset: boolean
    }
  | { type: 'event'; event: RunEvent }
  | { type: 'connection'; connection: ConnectionState }

export function initialLiveState(): LiveState {
  return {
    run: null,
    episodes: [],
    currentEpisode: null,
    logs: [],
    usage: { prompt_tokens: 0, completion_tokens: 0 },
    progress: [],
    lastEventId: 0,
    connection: 'connecting',
    latestBatch: null,
    firstInvalidCall: null,
    error: null,
    snapshotState: null,
    snapshotToken: 0,
    episodeToken: 0,
  }
}

function episodeFromStarted(event: RunEvent): Episode {
  if (event.type !== 'episode.started') {
    throw new Error('not an episode.started event')
  }
  const taskId = event.data.task_id
  return {
    id: event.episode_id ?? `episode-${event.id}`,
    run_id: event.run_id,
    task_id: taskId,
    task_key: taskId.split(':').slice(-1)[0],
    status: 'running',
    solved: false,
    moves_used: 0,
    reference_length: event.data.reference_length,
    efficiency: null,
    progress_ratio: null,
    protocol_errors: 0,
    tokens_in: 0,
    tokens_out: 0,
    latency_ms: null,
    failure_code: null,
    error: null,
    started_at: event.ts,
    finished_at: null,
  }
}

export function liveReducer(
  state: LiveState,
  action: LiveAction,
): LiveState {
  if (action.type === 'connection') {
    return { ...state, connection: action.connection }
  }
  if (action.type === 'snapshot') {
    const current = action.episodes.at(-1) ?? null
    return {
      ...state,
      run: action.run,
      episodes: action.episodes,
      currentEpisode: current,
      lastEventId: action.reset
        ? action.lastEventId
        : Math.max(state.lastEventId, action.lastEventId),
      snapshotState: action.snapshotState,
      snapshotToken: state.snapshotToken + 1,
      error: action.run.error,
      connection:
        action.run.status === 'queued' || action.run.status === 'running'
          ? state.connection
          : 'closed',
      ...(action.reset
        ? {
            logs: [],
            usage: { prompt_tokens: 0, completion_tokens: 0 },
            progress: current
              ? [{ moves: current.moves_used, length: current.reference_length }]
              : [],
            latestBatch: null,
            firstInvalidCall: null,
          }
        : {}),
    }
  }

  const event = action.event
  if (event.id <= state.lastEventId) return state
  const next = { ...state, lastEventId: event.id }

  switch (event.type) {
    case 'episode.started': {
      const episode = episodeFromStarted(event)
      const episodes = [
        ...state.episodes.filter((item) => item.id !== episode.id),
        episode,
      ]
      return {
        ...next,
        episodes,
        currentEpisode: episode,
        logs: [],
        usage: { prompt_tokens: 0, completion_tokens: 0 },
        progress: [{ moves: 0, length: episode.reference_length }],
        latestBatch: null,
        firstInvalidCall: null,
        episodeToken: state.episodeToken + 1,
      }
    }
    case 'model.message': {
      const logs = event.data.content
        ? [
            ...state.logs,
            {
              id: event.id,
              kind: 'model' as const,
              text: event.data.content,
              data: event.data,
            },
          ]
        : state.logs
      return { ...next, logs, usage: event.data.usage }
    }
    case 'tool.call': {
      return {
        ...next,
        logs: [
          ...state.logs,
          {
            id: event.id,
            kind: 'tool',
            text: `${event.data.tool} ${JSON.stringify(
              event.data.arguments ?? {},
            )}`,
            data: event.data,
          },
        ],
      }
    }
    case 'tool.result': {
      const ok = event.data.ok
      const message = String(event.data.payload.error ?? 'failed')
      return {
        ...next,
        logs: [
          ...state.logs,
          {
            id: event.id,
            kind: 'tool',
            text: `${event.data.tool} → ${ok ? 'ok' : message}`,
            data: event.data,
          },
        ],
        firstInvalidCall:
          !ok && !state.firstInvalidCall
            ? { tool: event.data.tool, message }
            : state.firstInvalidCall,
      }
    }
    case 'move.applied': {
      const current = state.currentEpisode
        ? {
            ...state.currentEpisode,
            moves_used: event.data.moves_used,
            solved: event.data.solved,
          }
        : null
      return {
        ...next,
        currentEpisode: current,
        episodes: current
          ? state.episodes.map((item) =>
              item.id === current.id ? current : item,
            )
          : state.episodes,
        progress: [
          ...state.progress,
          {
            moves: event.data.moves_used,
            length: event.data.reference_length_after,
          },
        ],
        latestBatch: {
          eventId: event.id,
          moves: event.data.moves,
          state: event.data.state,
        },
      }
    }
    case 'episode.finished': {
      const current = state.currentEpisode
        ? {
            ...state.currentEpisode,
            status: event.data.status,
            solved: event.data.solved,
            moves_used: event.data.moves_used,
          }
        : null
      return {
        ...next,
        currentEpisode: current,
        episodes: current
          ? state.episodes.map((item) =>
              item.id === current.id ? current : item,
            )
          : state.episodes,
      }
    }
    case 'run.finished':
      return {
        ...next,
        run: state.run
          ? {
              ...state.run,
              status: event.data.status,
              totals: event.data.totals,
            }
          : state.run,
        connection: 'closed',
      }
    case 'run.error':
      return {
        ...next,
        run: state.run
          ? { ...state.run, status: 'failed', error: event.data.message }
          : state.run,
        error: event.data.message,
        connection: 'closed',
      }
    default:
      return next
  }
}
```

`snapshot` 动作无论 `reset` 与否都会更新 `snapshotState` 并递增 `snapshotToken`；RunPage 用 token 变化决定是否复位。`reset: true` 额外清空 logs/usage/progress/latestBatch。

- [ ] **Step 4: 运行 reducer 测试**

Run:

```bash
cd frontend
npm run test:run -- src/hooks/liveReducer.test.ts
```

Expected: 6 passed。

- [ ] **Step 5: 写 hook 测试**

新建 `frontend/src/hooks/useRunEvents.test.tsx`：

```tsx
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import type { Snapshot } from '../api/types'
import { makeEpisode, makeRun } from '../test/fixtures'
import { useRunEvents } from './useRunEvents'

class FakeEventSource {
  static instances: FakeEventSource[] = []
  listeners = new Map<string, EventListener>()
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  closed = false

  constructor(public url: string) {
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: EventListener) {
    this.listeners.set(type, listener)
  }

  close() {
    this.closed = true
  }

  emit(type: string, data: unknown) {
    const event = {
      data: JSON.stringify(data),
    } as MessageEvent
    this.listeners.get(type)?.(event as Event)
  }
}

const snapshot: Snapshot = {
  run: makeRun(),
  episodes: [],
  last_event_id: 3,
  current_state: null,
}

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
  vi.spyOn(api.runs, 'snapshot').mockResolvedValue(snapshot)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('useRunEvents', () => {
  it('loads snapshot then applies SSE events', async () => {
    const { result } = renderHook(() => useRunEvents('r1'))
    await waitFor(() => expect(result.current.run?.id).toBe('r1'))
    expect(FakeEventSource.instances[0]?.url).toBe(
      '/api/runs/r1/events?after=3',
    )
    const source = FakeEventSource.instances[0]
    act(() => {
      source.onopen?.()
      source.emit('run.finished', {
        id: 4,
        type: 'run.finished',
        run_id: 'r1',
        episode_id: null,
        ts: '2026-10-26T00:00:04+00:00',
        data: { status: 'finished', totals: null },
      })
    })
    await waitFor(() =>
      expect(result.current.run?.status).toBe('finished'),
    )
    expect(source.closed).toBe(true)
    expect(result.current.connection).toBe('closed')
  })

  it('enters reconnecting on stream error', async () => {
    const { result } = renderHook(() => useRunEvents('r1'))
    await waitFor(() => expect(result.current.run?.id).toBe('r1'))
    act(() => {
      FakeEventSource.instances[0].onerror?.()
    })
    await waitFor(() =>
      expect(result.current.connection).toBe('reconnecting'),
    )
  })

  it('ignores a stale snapshot after the run changes', async () => {
    let resolveStale!: (value: Snapshot) => void
    const stale = new Promise<Snapshot>((resolve) => {
      resolveStale = resolve
    })
    const fresh: Snapshot = {
      run: makeRun({ id: 'r2' }),
      episodes: [],
      last_event_id: 0,
      current_state: null,
    }
    vi.spyOn(api.runs, 'snapshot').mockImplementation((id) =>
      id === 'r1' ? stale : Promise.resolve(fresh),
    )
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useRunEvents(id),
      { initialProps: { id: 'r1' } },
    )
    rerender({ id: 'r2' })
    await waitFor(() => expect(result.current.run?.id).toBe('r2'))
    await act(async () => {
      resolveStale(snapshot)
      await stale
    })
    expect(result.current.run?.id).toBe('r2')
  })

  it('does not open a stream for a finished run', async () => {
    vi.spyOn(api.runs, 'snapshot').mockResolvedValue({
      ...snapshot,
      run: makeRun({ status: 'finished' }),
    })
    const { result } = renderHook(() => useRunEvents('r1'))
    await waitFor(() => expect(result.current.connection).toBe('closed'))
    expect(FakeEventSource.instances).toHaveLength(0)
  })

  it('retries a failed first snapshot with reset and its own cursor', async () => {
    const snapshotSpy = vi
      .spyOn(api.runs, 'snapshot')
      .mockResolvedValue(snapshot)
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useRunEvents(id),
      { initialProps: { id: 'r1' } },
    )
    await waitFor(() => expect(result.current.run?.id).toBe('r1'))
    act(() => {
      FakeEventSource.instances[0].emit('model.message', {
        id: 4,
        type: 'model.message',
        run_id: 'r1',
        episode_id: 'e1',
        ts: '2026-10-26T00:00:04+00:00',
        data: {
          content: 'old log',
          tool_calls: 0,
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        },
      })
    })
    await waitFor(() => expect(result.current.logs).toHaveLength(1))

    const retry: Snapshot = {
      run: makeRun({ id: 'r2' }),
      episodes: [makeEpisode({ id: 'e2', task_key: 't2' })],
      last_event_id: 1,
      current_state: null,
    }
    snapshotSpy.mockRejectedValueOnce(new Error('offline'))
    snapshotSpy.mockResolvedValueOnce(retry)
    rerender({ id: 'r2' })
    await waitFor(() => expect(result.current.run?.id).toBe('r2'), {
      timeout: 2500,
    })
    expect(result.current.logs).toHaveLength(0)
    expect(result.current.progress).toEqual([{ moves: 0, length: 1 }])
    expect(FakeEventSource.instances.at(-1)?.url).toBe(
      '/api/runs/r2/events?after=1',
    )
  })

  it('backs off stream failures and keeps live data on reconnect', async () => {
    const timeoutSpy = vi.spyOn(window, 'setTimeout')
    const { result } = renderHook(() => useRunEvents('r1'))
    await waitFor(() => expect(result.current.run?.id).toBe('r1'))
    act(() => {
      FakeEventSource.instances[0].emit('model.message', {
        id: 4,
        type: 'model.message',
        run_id: 'r1',
        episode_id: 'e1',
        ts: '2026-10-26T00:00:04+00:00',
        data: {
          content: 'kept',
          tool_calls: 0,
          usage: { prompt_tokens: 2, completion_tokens: 2 },
        },
      })
    })
    await waitFor(() => expect(result.current.logs).toHaveLength(1))
    act(() => {
      FakeEventSource.instances[0].onerror?.()
    })
    await waitFor(
      () => expect(FakeEventSource.instances).toHaveLength(2),
      { timeout: 2500 },
    )
    expect(result.current.logs).toHaveLength(1)
    expect(FakeEventSource.instances[1].url).toBe(
      '/api/runs/r1/events?after=4',
    )
    act(() => {
      FakeEventSource.instances[1].onerror?.()
    })
    const delays = timeoutSpy.mock.calls
      .map((call) => call[1])
      .filter((delay): delay is number => typeof delay === 'number')
    expect(delays).toContain(2000)
  })
})
```

`makeRun` 与 `makeEpisode` 放在 `src/test/fixtures.ts`，reducer 与 hook 测试共用。

- [ ] **Step 6: 实现 hook**

新建 `frontend/src/hooks/useRunEvents.ts`：

```ts
import { useEffect, useReducer, useRef } from 'react'
import { api } from '../api/client'
import type { RunEvent } from '../api/types'
import {
  initialLiveState,
  liveReducer,
  type LiveState,
} from './liveReducer'

const EVENT_TYPES: RunEvent['type'][] = [
  'run.started',
  'episode.started',
  'model.turn.started',
  'model.message',
  'tool.call',
  'tool.result',
  'move.applied',
  'episode.finished',
  'run.finished',
  'run.error',
]

export function useRunEvents(runId: string): LiveState {
  const [state, dispatch] = useReducer(liveReducer, undefined, initialLiveState)
  const sourceRef = useRef<EventSource | null>(null)
  const retryRef = useRef(0)
  const lastEventIdRef = useRef(0)

  useEffect(() => {
    lastEventIdRef.current = state.lastEventId
  }, [state.lastEventId])

  useEffect(() => {
    // 每个 effect 实例独立的存活标记：runId 切换时旧 snapshot 的迟到响应必须作废。
    let alive = true
    // reset 只取决于“本 run 是否已有一份 snapshot 落地”，与第几次连接无关。
    let snapshotLanded = false
    let timer: number | undefined
    lastEventIdRef.current = 0
    retryRef.current = 0

    async function connect(initial: boolean) {
      dispatch({
        type: 'connection',
        connection: initial ? 'connecting' : 'reconnecting',
      })
      let snapshot
      try {
        snapshot = await api.runs.snapshot(runId)
      } catch {
        if (!alive) return
        dispatch({ type: 'connection', connection: 'reconnecting' })
        const delay = Math.min(10_000, 1_000 * 2 ** retryRef.current++)
        timer = window.setTimeout(() => void connect(false), delay)
        return
      }
      if (!alive) return
      dispatch({
        type: 'snapshot',
        run: snapshot.run,
        episodes: snapshot.episodes,
        lastEventId: snapshot.last_event_id,
        snapshotState: snapshot.current_state,
        reset: !snapshotLanded,
      })
      snapshotLanded = true
      if (
        snapshot.run.status !== 'queued' &&
        snapshot.run.status !== 'running'
      ) {
        dispatch({ type: 'connection', connection: 'closed' })
        return
      }

      const after = Math.max(
        snapshot.last_event_id,
        lastEventIdRef.current,
      )
      const source = new EventSource(api.runs.eventsUrl(runId, after))
      sourceRef.current?.close()
      sourceRef.current = source
      source.onopen = () => {
        retryRef.current = 0
        dispatch({ type: 'connection', connection: 'open' })
      }
      const handle = (raw: Event) => {
        const message = raw as MessageEvent
        let event: RunEvent
        try {
          event = JSON.parse(message.data) as RunEvent
        } catch {
          return
        }
        dispatch({ type: 'event', event })
        if (event.type === 'run.finished' || event.type === 'run.error') {
          source.close()
        }
      }
      for (const type of EVENT_TYPES) {
        source.addEventListener(type, handle)
      }
      source.onerror = () => {
        source.close()
        if (!alive) return
        dispatch({ type: 'connection', connection: 'reconnecting' })
        const delay = Math.min(10_000, 1_000 * 2 ** retryRef.current++)
        timer = window.setTimeout(() => void connect(false), delay)
      }
    }

    void connect(true)
    return () => {
      alive = false
      if (timer !== undefined) window.clearTimeout(timer)
      sourceRef.current?.close()
    }
  }, [runId])

  return state
}
```

注意：`reset` 只在“本 run 的第一份 snapshot 落地”时为真（首次 snapshot 失败后的重试也算首次），reducer 会清空 live 数据；重连时 `reset: false` 保留日志与 usage，`lastEventId` 取 `max`，`snapshotState` 更新、`snapshotToken` 递增，RunPage 会据此吸附到 snapshot 局面。退避计数只在 `onopen` 归零，流反复失败时按 1s→2s→4s→10s 递增。

- [ ] **Step 7: 运行 hook 测试**

Run:

```bash
cd frontend
npm run test:run -- src/hooks
npm run typecheck
```

Expected: reducer 6 项 + hook 6 项通过；类型检查通过。

- [ ] **Step 8: 提交**

```bash
git add frontend/src/hooks frontend/src/test/fixtures.ts
git commit -m "feat: 实时事件 reducer 与 useRunEvents"
```

---

### Task 15: Run 页（实时 + 结果 + 导出）

**Files:**
- Create: `frontend/src/components/StatusBadge.tsx`
- Create: `frontend/src/components/ProgressChart.tsx`
- Create: `frontend/src/components/ToolLog.tsx`
- Create: `frontend/src/components/ResultView.tsx`
- Create: `frontend/src/pages/RunPage.tsx`
- Create: `frontend/src/pages/RunPage.test.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.test.tsx`

**Interfaces:**
- Consumes: `useRun`、`useProviders`、`useBenchmark`、`useReport`、`useRunEvents`、`api.runs.cancel`、`CubeView`、`LiveState`
- Produces:
  - `RunLivePanel`、`ResultView`
  - `RunPage`（默认导出）
  - `data-testid`：`run-status`、`run-result`、`progress-path`、`tool-log`、`export-json`、`export-csv`、`export-md`、`episode-replay-link`
  - 速度档：0.5 / 1 / 2 / 100（instant）

- [ ] **Step 1: 写组件、结果页与页面接线失败测试**

新建 `frontend/src/pages/RunPage.test.tsx`：

```tsx
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  BenchmarkDetail,
  CubeState,
  Episode,
  Report,
  Run,
} from '../api/types'
import { initialLiveState, type LiveState } from '../hooks/liveReducer'
import RunPage, { RunLivePanel } from './RunPage'
import { ResultView } from '../components/ResultView'

vi.mock('../cube/CubeView', () => ({
  CubeView: (props: { state: CubeState | null; resetToken: number }) => (
    <div
      data-testid="cube-stub"
      data-cube={props.state?.cube ?? 'none'}
      data-token={props.resetToken}
    />
  ),
}))

const run: Run = {
  id: 'run12345678',
  provider_id: 'p1',
  benchmark_id: 'b1',
  tool_mode: 'both',
  prompt_version: 'v1',
  status: 'running',
  totals: null,
  error: null,
  created_at: '2026-10-26T00:00:00+00:00',
  started_at: new Date(Date.now() - 5000).toISOString(),
  finished_at: null,
  budget: {
    max_moves: 30,
    max_tool_calls: 50,
    max_tokens: 300000,
    max_seconds: 300,
    turn_timeout: 120,
  },
}

const episode: Episode = {
  id: 'e1',
  run_id: 'run12345678',
  task_id: 'b1:t1',
  task_key: 't1',
  status: 'running',
  solved: false,
  moves_used: 2,
  reference_length: 3,
  efficiency: null,
  progress_ratio: null,
  protocol_errors: 0,
  tokens_in: 10,
  tokens_out: 5,
  latency_ms: null,
  failure_code: null,
  error: null,
  started_at: '2026-10-26T00:00:00+00:00',
  finished_at: null,
}

const benchmark: BenchmarkDetail = {
  id: 'b1',
  name: 'demo',
  version: 'v1',
  kind: 'frozen',
  cube: '2x2',
  content_hash: 'hash',
  frozen_at: '2026-10-26T00:00:00+00:00',
  task_count: 1,
  tasks: [
    {
      id: 't1',
      cube: '2x2',
      scramble: ["R'"],
      scramble_depth: 1,
      state: {
        cube: '2x2',
        faces: {
          U: [['white', 'white'], ['white', 'white']],
          R: [['red', 'red'], ['red', 'red']],
          F: [['green', 'green'], ['green', 'green']],
          D: [['yellow', 'yellow'], ['yellow', 'yellow']],
          L: [['orange', 'orange'], ['orange', 'orange']],
          B: [['blue', 'blue'], ['blue', 'blue']],
        },
      },
      reference_length: 1,
      reference_kind: 'exact',
      bin: '1',
    },
  ],
}

const report: Report = {
  run_id: run.id,
  provider_id: run.provider_id,
  benchmark_id: run.benchmark_id,
  status: 'finished',
  started_at: run.started_at,
  finished_at: '2026-10-26T00:00:10+00:00',
  benchmark_hash: 'hash',
  benchmark_total_tasks: 1,
  partial: false,
  totals: {
    tasks: 1,
    solved: 1,
    solve_rate: 1,
    ci95: [0.2, 1],
  },
  by_bin: {
    '1': {
      total: 1,
      solved: 1,
      solve_rate: 1,
      ci95: [0.2, 1],
      mean_moves: 1,
    },
  },
  episodes: [
    {
      ...episode,
      status: 'solved',
      solved: true,
      moves_used: 1,
    },
  ],
}

function liveState(): LiveState {
  return {
    ...initialLiveState(),
    run,
    episodes: [episode],
    currentEpisode: episode,
    logs: [
      { id: 1, kind: 'model', text: 'thinking', data: {} },
      { id: 2, kind: 'tool', text: "apply_moves {\"moves\":[\"R'\"]}", data: {} },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
    progress: [
      { moves: 0, length: 3 },
      { moves: 2, length: 1 },
    ],
    lastEventId: 2,
    connection: 'open',
  }
}

describe('RunLivePanel', () => {
  it('shows stats, progress and logs', () => {
    render(
      <RunLivePanel
        live={liveState()}
        run={run}
        benchmark={benchmark}
        provider={{
          id: 'p1',
          name: 'local',
          base_url: 'http://localhost/v1',
          model: 'm',
          api_key_ref: 'KEY',
          params: {},
          key_configured: true,
          created_at: '2026-10-26T00:00:00+00:00',
        }}
        onCancel={vi.fn()}
        cancelling={false}
      />,
    )
    expect(screen.getByText('local / m')).toBeInTheDocument()
    expect(screen.getByText('2/30')).toBeInTheDocument()
    expect(screen.getByTestId('progress-path')).toHaveAttribute(
      'd',
      expect.stringContaining('M'),
    )
    expect(screen.getByTestId('tool-log')).toHaveTextContent('thinking')
    expect(screen.getByTestId('tool-log')).toHaveTextContent('apply_moves')
  })
})

describe('ResultView', () => {
  it('renders totals, rows and export links', () => {
    render(
      <MemoryRouter>
        <ResultView
          report={report}
          run={{ ...run, status: 'finished' }}
          provider={null}
          benchmark={benchmark}
        />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('run-result')).toHaveTextContent('1 / 1')
    expect(screen.getByTestId('run-result')).toHaveTextContent('部分结果')
    expect(screen.getAllByTestId('episode-replay-link')[0]).toHaveAttribute(
      'href',
      '/episodes/e1',
    )
    expect(screen.getByTestId('export-csv')).toHaveAttribute(
      'href',
      '/api/runs/run12345678/export?format=csv',
    )
    expect(screen.getByTestId('export-json')).toHaveAttribute(
      'href',
      '/api/runs/run12345678/report',
    )
    expect(screen.getByTestId('export-md')).toHaveAttribute(
      'href',
      '/api/runs/run12345678/export?format=md',
    )
    expect(screen.getByTestId('run-result')).toHaveTextContent('100.0%')
  })
})

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    statusText: status < 400 ? 'OK' : 'Error',
    json: async () => body,
  }
}

class FakeEventSource {
  static instances: FakeEventSource[] = []
  listeners = new Map<string, EventListener>()
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  url: string

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: EventListener) {
    this.listeners.set(type, listener)
  }

  close() {
    this.closed = true
  }

  emit(type: string, data: unknown) {
    const event = { data: JSON.stringify(data) } as MessageEvent
    this.listeners.get(type)?.(event as Event)
  }
}

afterEach(() => {
  FakeEventSource.instances = []
  vi.unstubAllGlobals()
})

function renderPage(options: { snapshotState: CubeState | null }) {
  const fetchMock = vi.fn(async (input: string) => {
    if (input === '/api/runs/run12345678') {
      return jsonResponse({ run, episodes: [episode] })
    }
    if (input === '/api/runs/run12345678/snapshot') {
      return jsonResponse({
        run,
        episodes: [episode],
        last_event_id: 3,
        current_state: options.snapshotState,
      })
    }
    if (input === '/api/benchmarks/b1') return jsonResponse(benchmark)
    if (input === '/api/providers') return jsonResponse([])
    if (input === '/api/runs/run12345678/report') {
      return jsonResponse(report)
    }
    return jsonResponse({ detail: 'not found' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('EventSource', FakeEventSource)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/runs/run12345678']}>
        <Routes>
          <Route path="/runs/:id" element={<RunPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('RunPage', () => {
  it('falls back to the task state when the snapshot has no live state', async () => {
    renderPage({ snapshotState: null })
    await waitFor(() =>
      expect(screen.getByTestId('cube-stub')).toHaveAttribute(
        'data-cube',
        '2x2',
      ),
    )
  })

  it('snaps the cube to the final state when the run finishes', async () => {
    renderPage({ snapshotState: benchmark.tasks[0].state })
    await waitFor(() =>
      expect(screen.getByTestId('cube-stub')).toHaveAttribute(
        'data-token',
        '1',
      ),
    )
    await waitFor(() =>
      expect(FakeEventSource.instances).toHaveLength(1),
    )
    expect(FakeEventSource.instances[0].url).toBe(
      '/api/runs/run12345678/events?after=3',
    )
    const cube = screen.getByTestId('cube-stub')
    const source = FakeEventSource.instances[0]
    act(() => {
      source.onopen?.()
      source.emit('run.finished', {
        id: 4,
        type: 'run.finished',
        run_id: 'run12345678',
        episode_id: null,
        ts: '2026-10-26T00:00:04+00:00',
        data: { status: 'finished', totals: null },
      })
    })
    // ResultView 的加载态也带 run-result，findByTestId 会先命中“报告加载中…”；
    // 这里要等报告数据替换掉加载态，断言文本本身不变。
    await waitFor(() =>
      expect(screen.getByTestId('run-result')).toHaveTextContent(
        '1 / 1',
      ),
    )
    await waitFor(() => expect(cube).toHaveAttribute('data-token', '2'))
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd frontend && npm run test:run -- src/pages/RunPage.test.tsx`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现小组件**

新建 `frontend/src/components/StatusBadge.tsx`：

```tsx
import { statusLabel } from '../lib/format'

const COLORS: Record<string, string> = {
  running: 'bg-sky-900/60 text-sky-300',
  queued: 'bg-slate-800 text-slate-300',
  solved: 'bg-emerald-900/60 text-emerald-300',
  finished: 'bg-emerald-900/60 text-emerald-300',
  failed: 'bg-rose-900/60 text-rose-300',
  cancelled: 'bg-amber-900/60 text-amber-300',
  interrupted: 'bg-amber-900/60 text-amber-300',
  budget_exceeded: 'bg-amber-900/60 text-amber-300',
  timeout: 'bg-amber-900/60 text-amber-300',
  protocol_error: 'bg-rose-900/60 text-rose-300',
  provider_error: 'bg-rose-900/60 text-rose-300',
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      data-testid="status-badge"
      className={`rounded px-2 py-0.5 text-xs ${
        COLORS[status] ?? 'bg-slate-800 text-slate-300'
      }`}
    >
      {statusLabel(status)}
    </span>
  )
}
```

新建 `frontend/src/components/ProgressChart.tsx`：

```tsx
import type { ProgressPoint } from '../api/types'

export function ProgressChart({
  points,
  maxMoves,
}: {
  points: ProgressPoint[]
  maxMoves: number
}) {
  if (points.length === 0) {
    return <p className="text-xs text-slate-500">暂无进度</p>
  }
  const width = 320
  const height = 120
  const pad = 8
  const maxLength = Math.max(
    1,
    ...points.map((point) => point.length ?? 0),
  )
  const x = (moves: number) =>
    pad +
    (Math.min(moves, maxMoves) / Math.max(1, maxMoves)) *
      (width - pad * 2)
  const y = (length: number) =>
    height - pad - (length / maxLength) * (height - pad * 2)
  const path = points
    .map(
      (point, index) =>
        `${index === 0 ? 'M' : 'L'} ${x(point.moves).toFixed(1)} ${y(
          point.length ?? 0,
        ).toFixed(1)}`,
    )
    .join(' ')
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      role="img"
      aria-label="进度曲线"
    >
      <path
        data-testid="progress-path"
        d={path}
        fill="none"
        stroke="#34d399"
        strokeWidth="2"
      />
    </svg>
  )
}
```

新建 `frontend/src/components/ToolLog.tsx`：

```tsx
import type { LiveLog } from '../hooks/liveReducer'

export function ToolLog({ logs }: { logs: LiveLog[] }) {
  if (logs.length === 0) {
    return <p className="text-xs text-slate-500">暂无工具日志</p>
  }
  return (
    <ul data-testid="tool-log" className="max-h-64 space-y-1 overflow-auto text-xs">
      {logs.slice(-80).map((log) => (
        <li
          key={log.id}
          className={
            log.kind === 'model' ? 'text-slate-300' : 'text-sky-300'
          }
        >
          <details>
            <summary className="cursor-pointer truncate">
              {log.kind === 'model' ? '模型' : '工具'}：{log.text}
            </summary>
            <pre className="mt-1 overflow-auto rounded bg-slate-950 p-2 text-[10px] text-slate-400">
              {JSON.stringify(log.data, null, 2)}
            </pre>
          </details>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 4: 实现 RunLivePanel 与结果页**

新建 `frontend/src/components/ResultView.tsx`：

```tsx
import { Link } from 'react-router-dom'
import { exportUrl, reportUrl } from '../api/client'
import type {
  BenchmarkDetail,
  Provider,
  Report,
  Run,
} from '../api/types'
import {
  formatPercent,
  statusLabel,
} from '../lib/format'

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-slate-800 bg-slate-900 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-medium">{value}</div>
    </div>
  )
}

export function ResultView({
  report,
  run,
  provider,
  benchmark,
  error = null,
}: {
  report: Report | null
  run: Run
  provider: Provider | null
  benchmark: BenchmarkDetail | null
  error?: string | null
}) {
  if (!report) {
    return (
      <section data-testid="run-result" className="text-sm">
        {error ? (
          <p role="alert" className="text-rose-300">
            {error}
          </p>
        ) : (
          <p className="text-slate-400">报告加载中…</p>
        )}
      </section>
    )
  }
  const failures = new Map<string, number>()
  for (const episode of report.episodes) {
    if (episode.failure_code) {
      failures.set(
        episode.failure_code,
        (failures.get(episode.failure_code) ?? 0) + 1,
      )
    }
  }
  return (
    <section data-testid="run-result" className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold">运行结果</h2>
        <span className="text-sm text-slate-400">
          {provider ? `${provider.name} / ${provider.model}` : run.provider_id}
          {' · '}
          {benchmark?.name ?? run.benchmark_id}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Card
          label="解出"
          value={`${report.totals.solved} / ${report.totals.tasks}`}
        />
        <Card
          label="解出率"
          value={formatPercent(report.totals.solve_rate)}
        />
        <Card
          label="CI95"
          value={`${formatPercent(report.totals.ci95[0])} – ${formatPercent(
            report.totals.ci95[1],
          )}`}
        />
        <Card
          label="部分结果"
          value={report.partial ? '是（未跑全）' : '否'}
        />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-slate-300">分箱</h3>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-slate-400">
              <th className="py-2">bin</th>
              <th>total</th>
              <th>solved</th>
              <th>solve_rate</th>
              <th>mean_moves</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(report.by_bin).map(([bin, stats]) => (
              <tr key={bin} className="border-b border-slate-900">
                <td className="py-2">{bin}</td>
                <td>{stats.total}</td>
                <td>{stats.solved}</td>
                <td>{formatPercent(stats.solve_rate)}</td>
                <td>{stats.mean_moves.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-slate-300">逐题</h3>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-slate-400">
              <th className="py-2">task</th>
              <th>状态</th>
              <th>步数</th>
              <th>参照</th>
              <th>效率</th>
              <th>失败码</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {report.episodes.map((episode) => (
              <tr
                key={episode.id}
                className="border-b border-slate-900"
              >
                <td className="py-2">{episode.task_key}</td>
                <td>{statusLabel(episode.status)}</td>
                <td>{episode.moves_used}</td>
                <td>{episode.reference_length}</td>
                <td>
                  {episode.efficiency == null
                    ? '—'
                    : episode.efficiency.toFixed(2)}
                </td>
                <td>{episode.failure_code ?? '—'}</td>
                <td>
                  <Link
                    data-testid="episode-replay-link"
                    className="text-emerald-400"
                    to={`/episodes/${episode.id}`}
                  >
                    回放
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {failures.size > 0 && (
        <p className="text-sm text-slate-400">
          失败分布：
          {[...failures.entries()]
            .map(([code, count]) => `${code} × ${count}`)
            .join('，')}
        </p>
      )}

      <div className="flex flex-wrap gap-3 text-sm">
        <a
          data-testid="export-json"
          className="rounded border border-slate-700 px-3 py-1.5"
          href={reportUrl(run.id)}
          download={`run-${run.id}.json`}
        >
          JSON
        </a>
        <a
          data-testid="export-csv"
          className="rounded border border-slate-700 px-3 py-1.5"
          href={exportUrl(run.id, 'csv')}
        >
          CSV
        </a>
        <a
          data-testid="export-md"
          className="rounded border border-slate-700 px-3 py-1.5"
          href={exportUrl(run.id, 'md')}
        >
          Markdown
        </a>
      </div>
    </section>
  )
}
```

新建 `frontend/src/pages/RunPage.tsx`：

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import {
  qk,
  useBenchmark,
  useProviders,
  useReport,
  useRun,
} from '../api/queries'
import type {
  BenchmarkDetail,
  CubeState,
  Provider,
  Run,
} from '../api/types'
import { ProgressChart } from '../components/ProgressChart'
import { ResultView } from '../components/ResultView'
import { StatusBadge } from '../components/StatusBadge'
import { ToolLog } from '../components/ToolLog'
import { CubeView } from '../cube/CubeView'
import { useRunEvents } from '../hooks/useRunEvents'
import type { LiveState } from '../hooks/liveReducer'
import { describeError } from '../lib/errors'
import {
  formatDuration,
  formatTokens,
  shortId,
} from '../lib/format'

function useElapsed(startedAt: string | null): number | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return startedAt ? now - new Date(startedAt).getTime() : null
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="truncate text-slate-200">{value}</div>
    </div>
  )
}

export function RunLivePanel({
  live,
  run,
  benchmark,
  provider,
  onCancel,
  cancelling,
}: {
  live: LiveState
  run: Run
  benchmark: BenchmarkDetail | null
  provider: Provider | null
  onCancel: () => void
  cancelling: boolean
}) {
  const episode = live.currentEpisode
  const elapsed = useElapsed(run.started_at)
  const tokens =
    live.usage.prompt_tokens + live.usage.completion_tokens
  const completed = live.episodes.filter(
    (item) => item.status !== 'running',
  ).length
  return (
    <aside className="space-y-4 self-start rounded border border-slate-800 bg-slate-900 p-4 text-sm">
      <div className="grid grid-cols-2 gap-3">
        <Stat
          label="provider"
          value={
            provider
              ? `${provider.name} / ${provider.model}`
              : run.provider_id
          }
        />
        <Stat label="题集" value={benchmark?.name ?? run.benchmark_id} />
        <Stat
          label="进度"
          value={`${completed}/${benchmark?.tasks.length ?? '?'}`}
        />
        <Stat label="当前题" value={episode?.task_key ?? '—'} />
        <Stat
          label="步数"
          value={
            episode
              ? `${episode.moves_used}/${run.budget.max_moves}`
              : '—'
          }
        />
        <Stat
          label="参照长度"
          value={String(episode?.reference_length ?? '—')}
        />
        <Stat label="计时" value={formatDuration(elapsed)} />
        <Stat label="tokens" value={formatTokens(tokens)} />
      </div>
      <div className="flex items-center gap-2">
        <StatusBadge status={episode?.status ?? run.status} />
        <span className="text-xs text-slate-500">成本：未配置价格</span>
      </div>
      {live.firstInvalidCall && (
        <p className="text-amber-300">
          首次非法调用：{live.firstInvalidCall.tool} ·{' '}
          {live.firstInvalidCall.message}
        </p>
      )}
      {live.error && <p className="text-rose-300">{live.error}</p>}
      <ProgressChart
        points={live.progress}
        maxMoves={run.budget.max_moves}
      />
      <ToolLog logs={live.logs} />
      {(run.status === 'queued' || run.status === 'running') && (
        <button
          type="button"
          onClick={onCancel}
          disabled={cancelling}
          className="rounded border border-rose-700 px-3 py-1.5 text-rose-300 disabled:opacity-50"
        >
          取消 run
        </button>
      )}
    </aside>
  )
}

export default function RunPage() {
  const { id } = useParams()
  const queryClient = useQueryClient()
  const runQuery = useRun(id)
  const providers = useProviders()
  const live = useRunEvents(id ?? '')
  const benchmark = useBenchmark(runQuery.data?.run.benchmark_id)
  const run = live.run ?? runQuery.data?.run ?? null
  const finished = run
    ? !['queued', 'running'].includes(run.status)
    : false
  const report = useReport(id, finished)
  const cancel = useMutation({
    mutationFn: () => api.runs.cancel(id!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.run(id!) })
    },
  })
  const [speed, setSpeed] = useState(1)
  const [paused, setPaused] = useState(false)
  const [skipToken, setSkipToken] = useState(0)
  const [cubeReset, setCubeReset] = useState<{
    state: CubeState | null
    token: number
  }>({ state: null, token: 0 })
  const snapshotApplied = useRef(0)
  const episodeApplied = useRef(0)

  // snapshot 的 current_state 优先；为空且已有 episode 时回退到该题 task.state（spec §4.3）。
  // snapshotApplied 防止题集后到时重复吸附，把已经播出的批次拉回旧局面。
  useEffect(() => {
    if (live.snapshotToken === 0) return
    if (snapshotApplied.current === live.snapshotToken) return
    const taskState = benchmark.data?.tasks.find(
      (item) => item.id === live.currentEpisode?.task_key,
    )?.state
    const target = live.snapshotState ?? taskState ?? null
    if (!target) return
    if (!live.snapshotState && live.latestBatch) return
    snapshotApplied.current = live.snapshotToken
    setCubeReset((current) => ({
      state: target,
      token: current.token + 1,
    }))
  }, [
    live.snapshotToken,
    live.snapshotState,
    live.latestBatch,
    live.currentEpisode?.task_key,
    benchmark.data,
  ])

  // 终态清空动画队列：run.finished / run.error 之后不再有批次（spec §6.3）。
  useEffect(() => {
    if (!finished) return
    setCubeReset((current) => ({
      state:
        live.latestBatch?.state ?? live.snapshotState ?? current.state,
      token: current.token + 1,
    }))
  }, [finished])

  // 切题时按题初始局面复位；episodeApplied 防题集后到重复吸附，
  // latestBatch 存在时说明新题已经开播，不能再拉回起点。
  useEffect(() => {
    if (live.episodeToken === 0) return
    if (episodeApplied.current === live.episodeToken) return
    const task = benchmark.data?.tasks.find(
      (item) => item.id === live.currentEpisode?.task_key,
    )
    if (!task || live.latestBatch) return
    episodeApplied.current = live.episodeToken
    setCubeReset((current) => ({
      state: task.state,
      token: current.token + 1,
    }))
  }, [
    live.episodeToken,
    live.currentEpisode?.task_key,
    live.latestBatch,
    benchmark.data,
  ])

  if (!id) return null
  if (runQuery.isPending) {
    return <p className="text-sm text-slate-400">加载中…</p>
  }
  if (runQuery.error) {
    return <p className="text-rose-300">{describeError(runQuery.error)}</p>
  }
  if (!run) {
    return <p className="text-sm text-slate-400">run 不存在。</p>
  }
  const provider =
    providers.data?.find((item) => item.id === run.provider_id) ?? null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">
          Run {shortId(run.id)}
        </h1>
        <span data-testid="run-status">
          <StatusBadge status={run.status} />
        </span>
        <Link className="text-sm text-slate-400" to="/runs">
          返回历史
        </Link>
      </div>
      {cancel.error && (
        <p role="alert" className="text-rose-300">
          {describeError(cancel.error)}
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-3">
          <CubeView
            state={cubeReset.state}
            resetToken={cubeReset.token}
            batch={live.latestBatch}
            speed={speed}
            paused={paused}
            skipToken={skipToken}
          />
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              <span className="text-slate-400">速度</span>
              <select
                className="rounded bg-slate-900 px-2 py-1"
                value={speed}
                onChange={(event) =>
                  setSpeed(Number(event.target.value))
                }
              >
                <option value={0.5}>0.5×</option>
                <option value={1}>1×</option>
                <option value={2}>2×</option>
                <option value={100}>instant</option>
              </select>
            </label>
            <button
              type="button"
              className="rounded border border-slate-700 px-3 py-1"
              onClick={() => setPaused((current) => !current)}
            >
              {paused ? '继续' : '暂停'}
            </button>
            <button
              type="button"
              className="rounded border border-slate-700 px-3 py-1"
              onClick={() => setSkipToken((current) => current + 1)}
            >
              跳到最新
            </button>
          </div>
        </div>

        {!finished && (
          <RunLivePanel
            live={live}
            run={run}
            benchmark={benchmark.data ?? null}
            provider={provider}
            onCancel={() => cancel.mutate()}
            cancelling={cancel.isPending}
          />
        )}
      </div>

      {finished && (
        <ResultView
          report={report.data ?? null}
          run={run}
          provider={provider}
          benchmark={benchmark.data ?? null}
          error={report.error ? describeError(report.error) : null}
        />
      )}
    </div>
  )
}
```

把 `frontend/src/App.tsx` 中 Run 占位路由替换为：

```tsx
import RunPage from './pages/RunPage'
...
        <Route path="runs/:id" element={<RunPage />} />
```

`frontend/src/App.test.tsx` 的导入区加一段 mock：路由表静态导入 `RunPage`，其模块链会加载 `three`；jsdom 用不到 WebGL，mock 掉 `CubeView` 可避免依赖的 CJS 弃用告警污染测试输出：

```tsx
// 路由表静态导入 RunPage → CubeView → three；jsdom 用不到 WebGL。
vi.mock('./cube/CubeView', () => ({
  CubeView: () => <div data-testid="cube-stub" />,
}))
```

- [ ] **Step 5: 运行测试与构建**

Run:

```bash
cd frontend
npm run test:run -- src/pages/RunPage.test.tsx
npm run typecheck
npm run build
```

Expected: 4 passed；类型检查与构建通过。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/components frontend/src/pages/RunPage.tsx frontend/src/pages/RunPage.test.tsx frontend/src/App.tsx
git commit -m "feat: Run 实时页、结果页与导出"
```

---

### Task 16: Episode 单题回放

**Files:**
- Create: `frontend/src/pages/EpisodePage.tsx`
- Create: `frontend/src/pages/EpisodePage.test.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `useEpisode`、`useSteps`、`useRun`、`useBenchmark`、`CubeView`
- Produces:
  - `EpisodeView`
  - `data-testid="step-row"`
  - 点击工具步骤可把该步 applied moves 作为动画批次播放

- [ ] **Step 1: 写失败测试**

新建 `frontend/src/pages/EpisodePage.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  BenchmarkDetail,
  CubeState,
  Episode,
  Run,
  Step,
} from '../api/types'
import EpisodePage, { EpisodeView } from './EpisodePage'

// 页面模块静态导入 CubeView → three；用例不渲染 3D，mock 掉避免把 three 带进 jsdom。
vi.mock('../cube/CubeView', () => ({
  CubeView: (props: {
    state: CubeState | null
    resetToken: number
    batch: { moves: string[] } | null
  }) => (
    <div
      data-testid="cube-stub"
      data-cube={props.state?.cube ?? 'none'}
      data-token={props.resetToken}
      data-moves={props.batch?.moves.join(',') ?? ''}
    />
  ),
}))

const state: CubeState = {
  cube: '2x2',
  faces: {
    U: [['white', 'white'], ['white', 'white']],
    R: [['red', 'red'], ['red', 'red']],
    F: [['green', 'green'], ['green', 'green']],
    D: [['yellow', 'yellow'], ['yellow', 'yellow']],
    L: [['orange', 'orange'], ['orange', 'orange']],
    B: [['blue', 'blue'], ['blue', 'blue']],
  },
}

const episode: Episode = {
  id: 'e1',
  run_id: 'r1',
  task_id: 'b1:t1',
  task_key: 't1',
  status: 'solved',
  solved: true,
  moves_used: 1,
  reference_length: 1,
  efficiency: 1,
  progress_ratio: 1,
  protocol_errors: 0,
  tokens_in: 10,
  tokens_out: 5,
  latency_ms: 1000,
  failure_code: null,
  error: null,
  started_at: '2026-10-26T00:00:00+00:00',
  finished_at: '2026-10-26T00:00:01+00:00',
}

const steps: Step[] = [
  {
    id: 's1',
    seq: 0,
    kind: 'model_message',
    tool_name: null,
    arguments: { tool_calls: ['apply_moves'] },
    result: { content: 'solving' },
    state,
    reference_length_after: 1,
  },
  {
    id: 's2',
    seq: 1,
    kind: 'tool_result',
    tool_name: 'apply_moves',
    arguments: { moves: ["R'"] },
    result: { applied: ["R'"], state },
    state,
    reference_length_after: 0,
  },
]

const run: Run = {
  id: 'r1',
  provider_id: 'p1',
  benchmark_id: 'b1',
  tool_mode: 'both',
  prompt_version: 'v1',
  status: 'finished',
  totals: null,
  error: null,
  created_at: '2026-10-26T00:00:00+00:00',
  started_at: '2026-10-26T00:00:00+00:00',
  finished_at: '2026-10-26T00:00:01+00:00',
  budget: {
    max_moves: 30,
    max_tool_calls: 50,
    max_tokens: 300000,
    max_seconds: 300,
    turn_timeout: 120,
  },
}

const benchmark: BenchmarkDetail = {
  id: 'b1',
  name: 'demo',
  version: 'v1',
  kind: 'frozen',
  cube: '2x2',
  content_hash: 'hash',
  frozen_at: '2026-10-26T00:00:00+00:00',
  task_count: 1,
  tasks: [
    {
      id: 't1',
      cube: '2x2',
      scramble: ["R'"],
      scramble_depth: 1,
      state,
      reference_length: 1,
      reference_kind: 'exact',
      bin: '1',
    },
  ],
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    statusText: status < 400 ? 'OK' : 'Error',
    json: async () => body,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderEpisodePage(id: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/episodes/${id}`]}>
        <Routes>
          <Route path="/episodes/:id" element={<EpisodePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('EpisodeView', () => {
  it('lists steps, selects one and plays its moves', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onPlayBatch = vi.fn()
    render(
      <MemoryRouter>
        <EpisodeView
          episode={episode}
          steps={steps}
          selected={1}
          onSelect={onSelect}
          onPlayBatch={onPlayBatch}
          cube={<div data-testid="cube-stub" />}
        />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('cube-stub')).toBeInTheDocument()
    expect(screen.getAllByTestId('step-row')).toHaveLength(2)
    expect(screen.getAllByTestId('step-row')[0]).toHaveTextContent(
      'model_message',
    )
    await user.click(screen.getAllByTestId('step-row')[1])
    expect(onSelect).toHaveBeenCalledWith(1)
    await user.click(
      screen.getByRole('button', { name: '播放本步' }),
    )
    expect(onPlayBatch).toHaveBeenCalledWith(1, ["R'"], state)
  })
})

describe('EpisodePage', () => {
  it("plays a step's moves from its previous state", async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (input === '/api/episodes/e1') return jsonResponse(episode)
        if (input === '/api/episodes/e1/steps') return jsonResponse(steps)
        if (input === '/api/runs/r1') {
          return jsonResponse({ run, episodes: [episode] })
        }
        if (input === '/api/benchmarks/b1') return jsonResponse(benchmark)
        return jsonResponse({ detail: 'not found' }, 404)
      }),
    )
    renderEpisodePage('e1')
    const rows = await screen.findAllByTestId('step-row')
    await user.click(rows[1])
    const before = Number(
      screen.getByTestId('cube-stub').getAttribute('data-token'),
    )
    await user.click(
      screen.getByRole('button', { name: '播放本步' }),
    )
    const cube = screen.getByTestId('cube-stub')
    expect(cube).toHaveAttribute('data-moves', "R'")
    expect(
      Number(cube.getAttribute('data-token')),
    ).toBe(before + 1)
  })

  it('shows the API error instead of loading forever', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ detail: 'episode not found' }, 404),
      ),
    )
    renderEpisodePage('missing')
    expect(await screen.findByText(/未找到该记录/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd frontend && npm run test:run -- src/pages/EpisodePage.test.tsx`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现页面**

新建 `frontend/src/pages/EpisodePage.tsx`：

```tsx
import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useBenchmark, useEpisode, useRun, useSteps } from '../api/queries'
import type {
  CubeState,
  Episode,
  Step,
} from '../api/types'
import { StatusBadge } from '../components/StatusBadge'
import { CubeView } from '../cube/CubeView'
import type { MoveBatch } from '../cube/CubeView'
import { describeError } from '../lib/errors'
import {
  formatDuration,
  formatPercent,
  formatTokens,
} from '../lib/format'

export interface EpisodeViewProps {
  episode: Episode
  steps: Step[]
  selected: number
  onSelect: (index: number) => void
  onPlayBatch: (stepIndex: number, moves: string[], state: CubeState) => void
  cube: ReactNode
}

export function EpisodeView({
  episode,
  steps,
  selected,
  onSelect,
  onPlayBatch,
  cube,
}: EpisodeViewProps) {
  const step = selected >= 0 ? steps[selected] : null
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">
          题目 {episode.task_key}
        </h1>
        <StatusBadge status={episode.status} />
        <Link className="text-sm text-slate-400" to={`/runs/${episode.run_id}`}>
          返回 run
        </Link>
      </div>
      <div className="grid gap-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
        <div>
          <div className="text-xs text-slate-500">解出</div>
          <div>{episode.solved ? '是' : '否'}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">步数 / 参照</div>
          <div>
            {episode.moves_used} / {episode.reference_length}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">效率</div>
          <div>
            {episode.efficiency == null
              ? '—'
              : formatPercent(episode.efficiency)}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">耗时</div>
          <div>{formatDuration(episode.latency_ms)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">tokens</div>
          <div>
            {formatTokens(
              (episode.tokens_in ?? 0) + (episode.tokens_out ?? 0),
            )}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">失败码</div>
          <div>{episode.failure_code ?? '—'}</div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        {cube}
        <aside className="space-y-3 rounded border border-slate-800 bg-slate-900 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onSelect(-1)}
              className={`rounded px-2 py-1 text-xs ${
                selected === -1
                  ? 'bg-emerald-700 text-white'
                  : 'bg-slate-800 text-slate-300'
              }`}
            >
              初始局面
            </button>
            {steps.map((item, index) => (
              <button
                key={item.id}
                type="button"
                data-testid="step-row"
                onClick={() => onSelect(index)}
                className={`rounded px-2 py-1 text-xs ${
                  selected === index
                    ? 'bg-emerald-700 text-white'
                    : 'bg-slate-800 text-slate-300'
                }`}
              >
                #{item.seq} {item.kind}
                {item.tool_name ? ` · ${item.tool_name}` : ''}
              </button>
            ))}
          </div>

          {step && (
            <div className="space-y-2 border-t border-slate-800 pt-3">
              <div className="text-slate-300">
                kind：{step.kind}
                {step.tool_name ? ` · ${step.tool_name}` : ''}
              </div>
              <div className="text-slate-400">
                参照长度：{step.reference_length_after ?? '—'}
              </div>
              {Array.isArray(step.result?.applied) &&
                step.result.applied.length > 0 &&
                step.state && (
                  <button
                    type="button"
                    className="rounded border border-slate-700 px-3 py-1 text-xs"
                    onClick={() =>
                      onPlayBatch(
                        selected,
                        step.result!.applied as string[],
                        step.state!,
                      )
                    }
                  >
                    播放本步
                  </button>
                )}
              <details>
                <summary className="cursor-pointer text-xs text-slate-500">
                  参数
                </summary>
                <pre className="mt-1 overflow-auto rounded bg-slate-950 p-2 text-[10px] text-slate-400">
                  {JSON.stringify(step.arguments, null, 2)}
                </pre>
              </details>
              <details>
                <summary className="cursor-pointer text-xs text-slate-500">
                  结果
                </summary>
                <pre className="mt-1 overflow-auto rounded bg-slate-950 p-2 text-[10px] text-slate-400">
                  {JSON.stringify(step.result, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

export default function EpisodePage() {
  const { id } = useParams()
  const episodeQuery = useEpisode(id)
  const stepsQuery = useSteps(id)
  const runQuery = useRun(episodeQuery.data?.run_id)
  const benchmarkQuery = useBenchmark(runQuery.data?.run.benchmark_id)
  const [selected, setSelected] = useState(-1)
  const [batch, setBatch] = useState<MoveBatch | null>(null)
  const [resetToken, setResetToken] = useState(1)

  // 先看错误再看 loading：run/benchmark 依赖上游数据，上游失败时它们会一直 pending。
  const failure =
    episodeQuery.error ??
    stepsQuery.error ??
    runQuery.error ??
    benchmarkQuery.error
  if (failure) {
    return <p className="text-rose-300">{describeError(failure)}</p>
  }
  if (
    episodeQuery.isPending ||
    stepsQuery.isPending ||
    runQuery.isPending ||
    benchmarkQuery.isPending
  ) {
    return <p className="text-sm text-slate-400">加载中…</p>
  }
  const episode = episodeQuery.data
  const steps = stepsQuery.data ?? []
  if (!episode) return null
  const task = benchmarkQuery.data?.tasks.find(
    (item) => item.id === episode.task_key,
  )
  // 选中步没有落库局面时，回退到它之前最近一个有局面的步骤，再回退到题初始局面。
  function stateFor(index: number): CubeState | null {
    for (let cursor = index; cursor >= 0; cursor -= 1) {
      const candidate = steps[cursor]?.state
      if (candidate) return candidate
    }
    return task?.state ?? null
  }
  const state = stateFor(selected)

  function select(index: number) {
    setSelected(index)
    setBatch(null)
    setResetToken((current) => current + 1)
  }

  function playBatch(
    stepIndex: number,
    moves: string[],
    finalState: CubeState,
  ) {
    setSelected(Math.max(-1, stepIndex - 1))
    setResetToken((current) => current + 1)
    setBatch({ eventId: Date.now(), moves, state: finalState })
  }

  return (
    <EpisodeView
      episode={episode}
      steps={steps}
      selected={selected}
      onSelect={select}
      onPlayBatch={playBatch}
      cube={
        <CubeView
          state={state}
          resetToken={resetToken}
          batch={batch}
          speed={1}
          paused={false}
          skipToken={0}
        />
      }
    />
  )
}
```

把 `frontend/src/App.tsx` 中 Episode 占位路由替换为：

```tsx
import EpisodePage from './pages/EpisodePage'
...
        <Route path="episodes/:id" element={<EpisodePage />} />
```

此时 `Placeholder` 已无路由使用，`noUnusedLocals` 会报错；一并删除该占位组件。

- [ ] **Step 4: 运行测试与构建**

Run:

```bash
cd frontend
npm run test:run -- src/pages/EpisodePage.test.tsx
npm run typecheck
npm run build
```

Expected: 3 passed；类型检查与构建通过。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/pages/EpisodePage.tsx frontend/src/pages/EpisodePage.test.tsx frontend/src/App.tsx
git commit -m "feat: Episode 单题回放"
```

---

### Task 17: mock OpenAI 服务与 Playwright E2E

**Files:**
- Create: `scripts/fake_openai_server.py`
- Create: `tests/test_fake_openai_server.py`
- Create: `frontend/playwright.config.ts`
- Create: `frontend/e2e/workbench.spec.ts`
- Modify: `.gitignore`

**Interfaces:**
- mock：`POST /v1/chat/completions`，`GET /health`
- Playwright 三进程：mock `20129`、API `8000`、Vite `5173`
- E2E 数据：provider `mock` + 2x2 / depth 1 / seed 3 / per_depth 1 基准集

- [ ] **Step 1: 写 mock 策略失败测试**

新建 `tests/test_fake_openai_server.py`：

```python
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.fake_openai_server import build_completion  # noqa: E402


def test_build_completion_returns_tool_call_then_content() -> None:
    tools = [
        {
            "type": "function",
            "function": {"name": "apply_moves"},
        }
    ]
    first = build_completion(
        {"messages": [{"role": "user", "content": "go"}], "tools": tools},
        ["R'"],
    )
    call = first["choices"][0]["message"]["tool_calls"][0]
    assert call["function"]["name"] == "apply_moves"
    assert call["function"]["arguments"] == '{"moves": ["R\'"]}'

    second = build_completion(
        {
            "messages": [
                {"role": "user", "content": "go"},
                {"role": "tool", "content": "ok"},
            ],
            "tools": tools,
        },
        ["R'"],
    )
    assert second["choices"][0]["message"]["content"] == "solved"


def test_build_completion_handles_probe() -> None:
    response = build_completion(
        {
            "messages": [{"role": "user", "content": "Reply with ok."}],
            "tools": [
                {
                    "type": "function",
                    "function": {"name": "ping"},
                }
            ],
        },
        ["R'"],
    )
    assert response["choices"][0]["message"]["content"] == "ok"
```

- [ ] **Step 2: 运行确认失败**

Run: `uv run pytest tests/test_fake_openai_server.py -q`

Expected: FAIL，`ModuleNotFoundError: scripts.fake_openai_server`。

- [ ] **Step 3: 实现 mock 服务**

新建 `scripts/fake_openai_server.py`：

```python
from __future__ import annotations

import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


def build_completion(
    payload: dict[str, Any], moves: list[str]
) -> dict[str, Any]:
    tools = payload.get("tools") or []
    has_apply = any(
        (tool.get("function") or {}).get("name") == "apply_moves"
        for tool in tools
    )
    messages = payload.get("messages") or []
    last = messages[-1] if messages else {}
    if has_apply and last.get("role") != "tool":
        message = {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "call-1",
                    "type": "function",
                    "function": {
                        "name": "apply_moves",
                        "arguments": json.dumps({"moves": moves}),
                    },
                }
            ],
        }
        finish_reason = "tool_calls"
    elif has_apply:
        message = {"role": "assistant", "content": "solved"}
        finish_reason = "stop"
    else:
        message = {"role": "assistant", "content": "ok"}
        finish_reason = "stop"
    return {
        "id": "chatcmpl-fake",
        "object": "chat.completion",
        "model": payload.get("model", "fake"),
        "choices": [
            {
                "index": 0,
                "message": message,
                "finish_reason": finish_reason,
            }
        ],
        "usage": {
            "prompt_tokens": 10,
            "completion_tokens": 5,
            "total_tokens": 15,
        },
    }


class Handler(BaseHTTPRequestHandler):
    moves: list[str] = ["R'"]

    def do_GET(self) -> None:
        if self.path == "/health":
            self._json({"ok": True})
            return
        self.send_error(404)

    def do_POST(self) -> None:
        if not self.path.endswith("/chat/completions"):
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length) or b"{}")
        self._json(build_completion(payload, self.moves))

    def _json(self, body: dict[str, Any]) -> None:
        raw = json.dumps(body).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, format: str, *args: Any) -> None:
        return


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=20129)
    parser.add_argument("--move", action="append", dest="moves")
    args = parser.parse_args()
    if args.moves:
        Handler.moves = args.moves
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"fake openai listening on {args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
```

`build_completion` 的三个分支分别是：首次对话返回 `apply_moves` 工具调用；已有 tool 结果时返回 `solved` 文本；probe（无 `apply_moves` 工具）返回 `ok` 文本。

E2E 用 2x2 / depth 1 / seed 3，`generate_scramble` 对它的产出是 `["R'"]`，mock 默认动作就是 `R'`。`R'` 的阶为 4：初始打乱一次后再应用到第 3 次才回到单位元，所以这一题用 3 步解出、重放里有 3 个 `apply_moves` 步骤（实测确认）。生成器或种子若变化，E2E 会在结果/步数断言处失败——这是有意的强约束，不要放宽成“跑完即可”。

- [ ] **Step 4: 运行 mock 测试**

Run: `uv run pytest tests/test_fake_openai_server.py -q`

Expected: 2 passed。

- [ ] **Step 5: 写 Playwright 配置**

新建 `frontend/playwright.config.ts`：

```ts
import { defineConfig, devices } from '@playwright/test'

const dbPath = `data/e2e-${Date.now()}.db`

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command:
        'uv run python scripts/fake_openai_server.py --port 20129',
      cwd: '..',
      url: 'http://127.0.0.1:20129/health',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `uv run mofang serve --port 8000 --db ${dbPath}`,
      cwd: '..',
      url: 'http://127.0.0.1:8000/api/benchmarks',
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        OPENAI_API_KEY: 'test',
      },
    },
    {
      command: 'npm run dev -- --port 5173 --strictPort',
      cwd: '.',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
```

在仓库根 `.gitignore` 追加（Playwright 失败时留下的产物不应入库；数据库已由 `data/*.db*` 覆盖）：

```
test-results/
playwright-report/
```

- [ ] **Step 6: 写 E2E 用例**

新建 `frontend/e2e/workbench.spec.ts`：

```ts
import { expect, test } from '@playwright/test'

test('provider → benchmark → live run → result → replay', async ({
  page,
}) => {
  await page.goto('/providers')
  await page.getByLabel('名称').fill('mock')
  await page.getByLabel('模型').fill('mock-model')
  await page
    .getByLabel('base_url')
    .fill('http://127.0.0.1:20129/v1')
  await page
    .getByLabel('API key 环境变量')
    .fill('OPENAI_API_KEY')
  await page.getByRole('button', { name: '保存 provider' }).click()
  await expect(page.getByTestId('provider-card')).toContainText('mock')
  await page.getByRole('button', { name: '探测' }).click()
  await expect(page.getByText('支持 tool calling')).toBeVisible()

  await page.goto('/benchmarks')
  await page.getByLabel('名称').fill('e2e')
  await page.getByLabel('深度 1', { exact: true }).check()
  await page.getByLabel('每档题数').fill('1')
  await page.getByLabel('seed').fill('3')
  await page.getByRole('button', { name: '生成基准集' }).click()
  await expect(page).toHaveURL(/\/benchmarks\/e2e-2x2-3$/)
  await expect(page.getByTestId('benchmark-task-row')).toHaveCount(1)

  await page
    .getByRole('link', { name: '用此题集新建 run' })
    .click()
  await expect(page).toHaveURL(
    /\/runs\/new\?benchmark=e2e-2x2-3/,
  )
  await page.getByRole('button', { name: '启动 run' }).click()
  await expect(page).toHaveURL(/\/runs\/[0-9a-f]+$/)
  await expect(page.getByTestId('cube-canvas')).toBeVisible()
  await expect(page.getByTestId('run-status')).toContainText('已完成', {
    timeout: 30_000,
  })
  await expect(page.getByTestId('run-result')).toContainText('1 / 1')

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-csv').click(),
  ])
  expect(download.suggestedFilename()).toContain('.csv')

  await page.getByTestId('episode-replay-link').first().click()
  await expect(page.getByTestId('cube-canvas')).toBeVisible()
  // scramble 是 R'，mock 固定回 R'：R' 的阶为 4，要 3 步才解出。
  await expect(
    page.getByTestId('step-row').filter({ hasText: 'apply_moves' }),
  ).toHaveCount(3)
})
```

- [ ] **Step 7: 安装浏览器并运行 E2E**

Run:

```bash
cd frontend
npx playwright install chromium
npm run e2e
```

Expected: 1 passed。若 8000/5173/20129 被占用，先停止遗留进程；不要用 `reuseExistingServer: true` 掩盖端口冲突。若浏览器下载被网络阻断，报告 BLOCKED 并附原始错误，不要自行切换 `channel`；CDN 抖动时可先试 `NODE_OPTIONS=--dns-result-order=ipv4first PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT=120000 npx playwright install chromium`（本次实测该方式成功）。

- [ ] **Step 8: 提交**

```bash
git add scripts/fake_openai_server.py tests/test_fake_openai_server.py frontend/playwright.config.ts frontend/e2e/workbench.spec.ts
git commit -m "test: mock OpenAI 服务与 M3 Playwright E2E"
```

---

### Task 18: 文档、全套验证与真模型冒烟

**Files:**
- Modify: `README.md`
- Modify: `PROJECT-PASSPORT.md`
- Modify: `docs/superpowers/plans/2026-10-26-m3-workbench.md`（记录实测修正）

**Interfaces:**
- Produces: M3 启动/构建/E2E 文档；PASSPORT 的端口、阶段与前端依赖。

- [ ] **Step 1: 更新 README**

在“本地 API”之后增加：

````markdown
## 前端工作台

开发期两个进程：

```bash
# 终端 1
export OPENAI_API_KEY=...
uv run mofang serve

# 终端 2
cd frontend
npm install
npm run dev
```

打开 `http://127.0.0.1:5173`。流程：Providers 新建 provider（填环境变量名）→
Probe → Benchmarks 生成题集 → New Run → 实时 3D → 结果与导出 →
Episode 回放。

单端口演示：

```bash
cd frontend && npm run build
cd ..
uv run mofang serve
```

打开 `http://127.0.0.1:8000`（FastAPI 托管 `frontend/dist`）。

只用 API、不托管前端时：`uv run mofang serve --web-dir ""`（或 `MOFANG_WEB_DIR=`）。

无真实模型时可用 mock：

```bash
uv run python scripts/fake_openai_server.py --port 20129
export OPENAI_API_KEY=test
uv run mofang serve
```

Provider 填 `http://127.0.0.1:20129/v1`；生成 2x2、depth 1、seed 3 题集
（scramble 为 `R'`）。mock 每轮返回 `apply_moves ["R'"]`，第四步（第三次
应用）后工具结果判定解出，随后一轮返回纯文本收尾。

前端验证：

```bash
cd frontend
npm run typecheck
npm run test:run
npm run build
npx playwright install chromium   # 首次
npm run e2e
```
````

- [ ] **Step 2: 更新 PROJECT-PASSPORT**

- 阶段改为“Plan 1/2/3 本地完成，M4 对比页待做”。
- 依赖增加：Node 24、npm 11、React 19、Vite、Tailwind v4、TanStack Query、three、r3f、drei、Vitest、Playwright。
- 端口：M3 前端 `127.0.0.1:5173`；单端口演示 `8000`。
- 数据目录：`frontend/dist` 为构建产物（gitignored）。
- 记录 E2E 三进程与 mock 端口 `20129`。
- 记录真实网关 UI 冒烟结果（模型可未解出，但链路、动画、报告、导出正常）。

- [ ] **Step 3: 全套验证**

Run:

```bash
uv run pytest -q
cd frontend
npm run typecheck
npm run test:run
npm run build
npm run e2e
```

Expected：后端全绿；前端类型/单测/构建通过；Playwright 1 passed。

- [ ] **Step 4: 真模型 UI 冒烟（手动）**

```bash
export OPENAI_API_KEY=...
uv run mofang serve
cd frontend && npm run dev
```

在 UI 中选择 `ollama/gpt-oss:120b`（或网关可用模型），生成 2x2 depth 1 题集，
预算设为 6 步 / 120 秒，启动 run。确认：

- 3D canvas 出现，工具日志与模型文本更新；
- 即使模型未解出，run 正常结束，结果页显示 `budget_exceeded` 或 `stopped_unsolved`；
- CSV/MD/JSON 导出可读；
- Episode 回放可见步骤。

该冒烟不进自动化测试；结果写入 PASSPORT。

- [ ] **Step 5: 提交**

```bash
git add README.md PROJECT-PASSPORT.md docs/superpowers/plans/2026-10-26-m3-workbench.md
git commit -m "docs: M3 工作台运行说明与验证记录"
```

**实测修正：** 后端全套 `uv run pytest -q` 为 176 passed。`npm run test:run` 起初
以 1 个失败套件退出：Vitest 默认收集了 `frontend/e2e/workbench.spec.ts`，Playwright
的 `test()` 在 Vitest 下抛错；`frontend/vitest.config.ts` 需加
`exclude: [...configDefaults.exclude, 'e2e/**']`，排除后 156 passed、退出码 0。
`scripts/fake_openai_server.py` 按末条消息返回：不是工具结果时返回
`apply_moves ["R'"]`，是工具结果时返回纯文本 `solved`。seed 3、depth 1、2x2 题的
scramble 为 `R'`，episode 遇到纯文本会暂停并再次催促，故 `apply_moves ["R'"]` 共
应用 3 次；`R'` 四次复原，scramble `R'` 再加 3 次即恒等，第三次工具结果后立即解出。

---

## Self-Review

**Spec coverage：**

- §2 使用流程：Providers（Task 9）、Benchmarks（Task 10）、New Run（Task 11）、实时/结果（Task 15）、Episode 回放（Task 16）。
- §5 后端契约 7 项：Task 1–6。
- §6 3D 渲染与动画：Task 12–13；纯函数黄金测试；E2E 验证 canvas。
- §7 页面与交互：Task 9–16；Compare 明确不做。
- §8 错误与安全：key 仅环境变量、SSE 重连、404/空状态、取消。
- §9 测试：Vitest/RTL、后端契约、Playwright 三进程、手动真模型。
- §10 验收：Task 17 E2E + Task 18 全套命令；静态托管 Task 6；真模型 Task 18。
- §12 风险：facelet 黄金样例、批次末重涂、SSE `after`、snapshot 回退、E2E 串行。

**Placeholder scan：** 无 TBD/TODO；每个实现步骤有代码或明确命令。

**Type consistency：**

- 后端事件字段 `reference_length_after`、`usage` 与前端 `RunEvent`/`LiveState` 一致。
- `RunOut.budget` 与前端 `Run.budget` 一致。
- `RunEvent` 的 `episode.started` 使用 `task_id`，前端构造 `task_key`。
- `CubeView` 的 `MoveBatch` 与 `liveReducer.MoveBatch` 同名同形；`RunPage`/`EpisodePage` 直接传入。
- `snapshot` action 的 `snapshotState` 字段在 reducer、hook、测试中一致（Task 14 代码已按此实现）。
- `Export URLs` 与后端路由一致：`/api/runs/{id}/export?format=csv|md`、`/api/runs/{id}/report`。

**已知执行注意：**

- Task 14 的 `src/test/fixtures.ts` 必须创建，`makeRun`/`makeEpisode` 从 `liveReducer.test.ts` 移出，避免测试互相导入。
- Task 17 的 mock 必须按三分支实现（apply_moves 首次、apply_moves 后 tool 结果返回 `solved`、无 apply_moves 的 probe 返回 `ok`）。
- E2E 依赖 2x2 表；若 8000/5173/20129 被占用先停止进程。






