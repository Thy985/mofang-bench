# AGENTS.md — mofang

> 本文件遵循 AAIF（Linux 基金会旗下 Agentic AI Foundation）托管的开放 AGENTS.md 格式，
> OpenAI Codex、Claude Code、Cursor、Gemini CLI、Jules 等主流编码 agent 均可直接读取。
> 它回答「在这个仓库里应该怎么做」；当次任务的目标与验收标准仍由用户对话给出。
> 配套阅读：[README.md](README.md)（面向人类的使用与运维）、
> [PROJECT-PASSPORT.md](PROJECT-PASSPORT.md)（环境事实、端口、已知限制、冒烟账）、
> [docs/superpowers/specs/](docs/superpowers/specs/) 与 [docs/superpowers/plans/](docs/superpowers/plans/)（设计背景与实施计划）。

## 项目一句话

本地单用户的「魔方模型能力测试台」：配置任意 OpenAI-compatible 模型，按难度生成 2x2/3x3 打乱局面，
模型通过工具闭环操作魔方，自动判定解出率 / 效率 / 失败模式，Web 端实时 3D 回放。
Python 后端（FastAPI + SQLite）+ React 工作台（three.js），全部只绑 `127.0.0.1`。

## 环境事实

| 项 | 事实 |
|---|---|
| Python | >=3.12（uv 管理，命令一律走 `uv run`，不要直接用全局 python） |
| Node / npm | 24 / 11（仅 `frontend/` 使用，依赖在 `frontend/node_modules`） |
| 包管理 | 后端 `pyproject.toml` + `uv.lock`；前端 `package-lock.json`（不加锁文件外的新依赖） |
| 测试运行器 | pytest（后端）、Vitest（前端单测）、Playwright（E2E） |
| 不需要 | Docker；CI 不走真网（真网冒烟手写脚本，人工触发） |
| 端口 | API 8000、Vite 5173、mock provider 20129；E2E 三者任一被占即失败 |

## 常用命令

后端（项目根执行）：

```bash
uv sync --extra dev                      # 安装主依赖 + dev
uv run pytest -m "not slow"              # 常规门禁（slow = 需生成求解表 / 真实网络）
uv run pytest tests/runner/test_episode.py -v          # 指定文件
uv run pytest -m slow                    # 慢测试（需先建表）
uv run mofang --help                     # CLI：benchmark / run / report / serve / dev
uv run python scripts/build_2x2_table.py --max-depth 11 --out data/cache/2x2_distances.pkl
uv sync --extra dev --extra solver && uv run python scripts/build_3x3_tables.py   # 首次约 30min / 80MB
```

前端（`frontend/` 执行）：

```bash
npm install
npm run typecheck        # tsc -b；任何 TS 报错先修这里（本仓库无独立 lint 脚本）
npm run test:run         # Vitest
npm run build            # 产出 dist，供 FastAPI 单端口托管
npm run e2e              # Playwright；workers=1 串行；首次先 npx playwright install chromium
```

联调一条命令：`uv run mofang dev`（API 8000 + Vite 5173，Ctrl+C 一并收口）。注意首版后端**无热重载**：
改 Python 必须重启该命令；Vite 前端保留 HMR。无真实模型时先起 mock：
`uv run python scripts/fake_openai_server.py --port 20129`。

## 仓库地图

后端 `src/mofang/`（包名即项目名，pytest `pythonpath=["src"]`）：

| 模块 | 职责 |
|---|---|
| `cli.py` | argparse CLI 入口（`mofang`）；CLI 预算与 Web/factory 同源（`DEFAULT_BUDGETS`） |
| `dev.py` | `mofang dev`：线程跑 uvicorn + 子进程跑 Vite，统一信号处理与清扫 |
| `api/` | FastAPI。`app.py`（create_app、SPA catch-all 必须晚于 API 路由注册）、`routes/`（providers / benchmarks / runs / episodes / compare）、`events.py`（SSE `RunEventBus` + journal，支持 `?after=` / Last-Event-ID 续传）、`settings.py`（env：`MOFANG_DB` / `MOFANG_TABLE` / `MOFANG_WEB_DIR` / `MOFANG_HOST` / `MOFANG_PORT` / `MOFANG_MAX_PARALLEL_EPISODES`）、`schemas.py` |
| `cube/` | 纯逻辑：`state.py`（`CubeState` frozen dataclass + facelet JSON）、`moves.py` / `colors.py` / `scramble.py` / `geometry.py`、`table2x2.py`（BFS 距离表 pickle）、`solver.py`（`ReferenceSolver` Protocol：`distance()` / `solve()` / `distance_kind()`）、`solver_worker.py`（**唯一允许 `import twophase` 的文件**） |
| `models/` | `provider.py`（`ProviderAdapter` Protocol、`ModelTurn` / `ModelParams` / `ProviderError(kind, retryable)` / `FakeProvider`）、`openai_compat.py`（OpenAI-compatible adapter：原生 tool calling、流式 thinking 增量、429 退避、stream / max_tokens 自动降级） |
| `runner/` | 评测状态机。`episode.py`（`EpisodeRunner`：轮循环、预算、超时、取消、nudge、截断续跑、provider 断点续跑、事件广播）、`tools.py`（`ToolExecutor` + `TOOLS` / `PLAN_TOOL` / stage guard / OLL probe gate）、`context.py`（`ContextBuilder`：system prompt + 最新状态 + 紧凑走法历史 + 最近 K 轮）、`budget.py`、`selfcheck.py`（参照解走同一工具链）、`skills.py` / `stage.py`（ortega / lbl） |
| `service/` | `runs.py`（`RunService`：跨 run episode 信号量并发闸、事件发布、每轮落库、run 结束把降级参数持久化回 provider）、`factory.py`（`DEFAULT_BUDGETS`、`SKILL_MAX_MOVES`、`build_adapter`、`model_params_for`、`make_solver_factory`） |
| `store/` | `db.py`（SQLite WAL、SCHEMA、`initialize()` 里的 ALTER TABLE 增量迁移）、`providers.py` / `benchmarks.py` / `runs.py` |
| `tasks/` | `generator.py`（种子化打乱、去重、分箱、冻结哈希）、`models.py`（`Benchmark` / `Task`） |
| `eval/` | `scorer.py`（progress_ratio）、`aggregate.py`（Wilson CI 聚合）、`attribution.py`（环境侧 vs 模型侧归因）、`compare.py`（配对 bootstrap CI） |

前端 `frontend/src/`：

| 目录 | 职责 |
|---|---|
| `api/` | `client.ts` 是唯一 fetch 出口（`ApiError`、204 处理）；`queries.ts` TanStack Query；`types.ts` 与后端 schema 对齐 |
| `App.tsx` | 路由表；所有页面 lazy + Suspense |
| `pages/` / `components/` / `cube/` | 页面与组件；`cube/` 为 three.js 3D（`CubeView` / `FaceLegend` / `animation` / `viewControls`，单独 chunk 按需加载） |
| `hooks/` | `liveReducer`（SSE 事件 → 本地状态）、`useRunEvents`、`usePlayback`、`useFollowScroll` |
| `ui/` | 设计系统原语（Button / Input / Card / Table / Toast / Stat / PageSkeleton / StatusBadge…），样式经 `index.css` 的 `@theme` 语义 token 收敛 |
| `lib/` | `errors` / `format` / `validate` 纯函数 |

其他：`scripts/`（mock server、建表、baseline、skill pack 校验）、`tests/`（镜像 src 结构）、
`data/`（SQLite、冻结基准 JSON、报告、缓存，多数 gitignored）、`twophase/`（3x3 求解表 ~80MB，gitignored）。

## 领域约定（改代码前必读）

- **面序固定 `U R F D L B`**；颜色映射 `U=white, D=yellow, F=green, B=blue, R=red, L=orange`。
- 状态对外一律 facelet JSON，**颜色用全名**（不用单字母，避免 B/R 歧义）：
  `{"cube":"2x2","faces":{"U":[[...]],...}}`。改 `CubeState.to_json` / `from_json` 必须同步前端 `types.ts`。
- 走法 Singmaster：`U/R/F/D/L/B` + `'` / `2`；解析兼容 `'’′` 与空白，拒绝宽转/中层转。
  `turn` 工具用 `amount ∈ {1,2,3}`；`apply_moves` 整批原子，单次最多 30 步。
- 3x3 传给 Kociemba 的面片串按 **URFDLB** 顺序导出（与面序不同，别改错）。
- **2x2 解出判定 = 六面各自同色**（允许整体色向不同），与距离表「按整体旋转归一化」一致
  （恰好 3,674,160 态、最大距离 11；不归一化会膨胀到 88,179,840）。
- **公平性红线**：模型永远看不到参照解、参照长度、打乱序列、距离字段；工具结果与 system prompt 都不得出现。
- 3x3 参照是 Kociemba **近优**解（`reference_kind="near_optimal"`），文案只能写「近优参照」，不能写「最优」。
- 指标口径：解出率（Wilson 95% CI + N）、效率 = `moves_used / reference_length`、
  进度比 = `clamp((L0-Lfinal)/L0, 0, 1)`、协议错误计数。**不造单一总分**；小样本（N<10/档）必须标注。

## 状态机与失败归因

Episode 终态：`solved / stopped_unsolved / budget_exceeded / model_truncation_loop / timeout /
protocol_error / provider_error / cancelled / interrupted`（`runner/episode.py`）。

归因口径：`provider_error / timeout / interrupted` → **环境侧**；
`stopped_unsolved / budget_exceeded / protocol_error / model_truncation_loop` → **模型侧**。
改动状态判定或文案时保持这条分界（见 `eval/attribution.py` 与 run 报告「失败归因」区）。

SSE 事件顺序契约：`run.started → episode.started → model.turn.started → model.message /
tool.call / tool.result / move.applied / plan.updated → episode.finished → run.finished`。
`move.applied` 携带新状态，前端不自行推演走法——**服务端是唯一真相源**，前端只做渲染与快照恢复。

## 工程约定

- **GPL 边界**：`RubikTwoPhase` 是 GPLv3+。主进程任何地方不得 `import twophase`；
  仅 `cube/solver_worker.py` 子进程导入，经 `RubikTwoPhaseClient` 以 JSON lines 通信。新增求解器集成沿用此模式。
- **密钥**：`api_key_ref` 是环境变量名；Web 保存的 key 是本地 SQLite 明文（已知限制），
  响应 / 导出 / 日志不得回显。默认只绑 `127.0.0.1`；CORS 仅放行 `127.0.0.1:5173` 与 `localhost:5173`。
- **预算同源**：CLI 默认预算来自 `service/factory.DEFAULT_BUDGETS`，不要在 CLI 里另抄一份。
  `retry_delay`（provider params，默认 2s）的退避**计入** `Budget.turn_timeout`；调大需同步调大 run 预算。
- **降级持久化**：adapter 的 stream / max_tokens 自动降级会把结果写回该 provider 的 params
  （`set_provider_param`），保证后续 run 不重复踩坑；改动 factory / adapter 时保持这个模式。
- **并发**：同一 run 内 episode 串行；跨 run 由 `RunService` 的信号量控制（默认 3）。
  3x3 solve 子进程可能偏慢，全局超时 30s 后丢弃 worker，不要无限等待。
- **DB 迁移**：schema 变更走 `store/db.py::initialize()` 的 `ALTER TABLE ... ADD COLUMN` 增量模式，不重建表。
- **服务重启**：lifespan 里把残留 `running` episode 标 `interrupted`，不静默续跑。
- **前端样式**：新 UI 优先用 `ui/` 原语 + `@theme` token（正文 `text-text` / `text-text-dim` / `text-accent`），
  语义色集中在 StatusBadge / Alert 内部；路由继续 lazy。
- **数据目录**：`data/*.db*`、`data/cache/`、`data/reports/`、`twophase/`、`frontend/dist`、
  `node_modules`、`test-results` 均已 gitignore；不要把生成物写进提交。
- **pyproject**：`requires-python >=3.12`，`asyncio_mode="auto"`，marker `slow` 已注册。

## 验证闭环（Definition of Done）

**总则：改动完成前，对应门禁必须实际跑过并全绿；报告必须引用真实命令与真实结论。
本仓库没有「理论上没问题」这种完成状态。**

### 四道关卡（交付流水线）

1. **机器门**：L0 契约 + L1 单测必须在 PR 上全绿，才允许进入人的视野。任何一门禁红了，
   不得升级给人工审查——先修绿，再往下走。
2. **对抗性复审**：由**未参与本次变更的干净上下文代理会话**执行（新开会话，不带实现记忆）。
   输入只有三样：本次 diff、本文件、Verification 矩阵。findings 贴到 PR。
3. **人工检查**：只看四处，其余代码不逐行读——
   - **红线区**：GPL / exec 边界（`twophase` 仅允许出现在 `solver_worker.py`）、密钥回显、
     公平性（prompt 与工具结果不得出现参照解 / 距离 / 打乱序列）、网络策略（`127.0.0.1` 绑定 /
     CORS / base_url）、DB 迁移；
   - **协议 fixture diff**：SSE 事件序列、工具 payload、状态 JSON、前端 `types.ts`；
   - **意图与范围**：diff 是否只做该做的，有无顺手改动、夹带无关文件；
   - **真机行为抽查**：mock / fake provider 端到端冒烟；涉及模型行为变更时，用真实模型
     2x2 depth 1 小预算抽查。
4. **合并权**：只有维护者本人 merge。代理永远不执行 merge，也不得绕过上述关卡直接合入。

### Verification 矩阵（L0 契约 + L1 单测）

- **L0 契约**：跨模块 / 跨端协议测试——SSE 事件（`tests/api/test_events*.py`）、
  工具协议（`tests/runner/test_tools.py`）、状态与走法（`tests/cube/test_state.py`、
  `test_moves.py`）、API schema（`tests/api/*`）、前端契约（`types.ts` / `client.test.ts` /
  `tokens.test.ts`）。先跑；红了即协议被破坏，优先于一切。
- **L1 单测**：模块内部行为——后端 `uv run pytest -m "not slow"` 全量，
  前端 `npm run typecheck && npm run test:run`。

| 改动触及 | L0 契约（定向，必跑） | L1 单测（必跑） | E2E / 真机抽查（按需） |
|---|---|---|---|
| `cube/`（状态/走法/求解器） | `test_state.py`、`test_moves.py`（动 JSON / 记法时） | ✅ 全量 + 定向 `tests/cube` | 建表 / 求解链路；动 `types.ts` 则前端 ✅ |
| `runner/`（episode/tools/context/stage） | `test_tools.py`（工具协议）、`test_episode*.py`（状态机 / 事件） | ✅ 全量 + 定向 `tests/runner` | fake provider 跑通一个 episode |
| `api/`、`events.py`、SSE 契约 | `tests/api/test_events*.py`、`test_runs_api.py` | ✅ 全量 + 定向 `tests/api` | `curl -N .../events`；载荷变则前端 ✅ |
| `cli.py`、`service/factory.py` | `tests/test_cli.py`、`tests/service/*` | ✅ 全量 | CLI demo 跑通（benchmark → run） |
| `store/db.py`（schema） | `tests/store/test_db.py`（含迁移路径） | ✅ 全量 | 用旧库副本验证 ALTER 后启动 |
| `tasks/`、`eval/` | `tests/tasks/test_generator.py`、`tests/eval/*` | ✅ 全量 + 定向目录 | 生成题集并比对哈希 |
| 前端任何 TS/TSX | `types.ts` / `client.test.ts` / `tokens.test.ts`（随改动） | ✅ `npm run typecheck && npm run test:run` | 构建相关则 `npm run build`；页面手测 |
| 前端交互/页面 | 同上 + 受影响页面单测 | ✅ | ✅ `npm run e2e`（三端口须空闲） |
| 求解器 / 建表脚本 | — | `-m slow` 定向 | 完整建表约 30min，谨慎触发 |
| provider 接入 / 真网 | — | 无 CI；本地小预算冒烟并记录 | ✅ 2x2 depth 1 先行 |

### 失败处理规则

1. 门禁失败先修代码，再重跑，直到全绿；不允许停在「改完了但没验证」。
2. **不许把红刷绿**：不得新增 skip/xfail、删除测试、放宽断言、改基准值来让失败消失。
   若判定测试本身写错了，保留原意修正并在总结中说明理由。
3. 同一失败点最多自主诊断两轮；仍不解则停下来说明：已排除什么、需要什么信息，不要无限试。
4. 测试与实现一起改：行为变更必须同步新增/更新测试（后端 pytest、前端 Vitest；
   交互变更再加 E2E），即使没人要求。
5. **诚实标注未验证项**：缺求解表、需真网、端口被占、耗时过长而无法运行时，
   必须在总结里写「未验证 + 原因」，不得以沉默代替通过。

### 收尾证据（写进总结，不要只说“已完成”）

- 改动文件清单与意图（一两句）；
- 实际执行的命令及结果数字（如 `pytest -m "not slow"` → 312 passed；
  `tsc -b` → 0 error；`vitest run` → 47 passed）；
- 未验证项及原因；遗留风险与建议的后续动作；
- 提示用户 `git diff` 复核；**代理永不执行 merge**；commit / push 仅在维护者明确要求时进行。

### 范围纪律

- 最小正确改动：不顺手格式化、不重构无关文件、不升级依赖、不动已冻结数据。
- 需要人工确认的操作：删除 / 覆盖 `data/*.db*`、`twophase/`、`data/cache/`；
  `git reset --hard` / force push / 删分支；触碰 GPL 边界；任何回显密钥的改动。

## 测试技术约定

- 后端：`uv run pytest -m "not slow"` 是常规门禁；属性测试用 hypothesis（走法阶数、随机序列往返），
  HTTP 用 respx / `fake_openai_server.py` fixture，**CI 不触真网**。
- `tests/conftest.py` 有 autouse fixture 把 `MOFANG_WEB_DIR=""`，防止构建产物让 API 测试命中 SPA catch-all——保留。
- 前端：Vitest + Testing Library（jsdom）；E2E 三进程由 `playwright.config.ts` 拉起（临时 DB `data/e2e-<ts>.db`）。
- 修改状态格式 / 工具协议 / SSE 事件时，同步更新受影响的契约测试
  （`tests/api/test_events*.py`、`tests/runner/test_tools.py`、`tests/cube/*` 等）。

## 提交风格

Conventional Commits + 中文描述：`feat:` / `fix:` / `test:` / `docs:` / `chore:`，
一行摘要说清「做了什么 + 为什么」，必要时正文列验证结果。例：
`feat: 计划模式——submit_plan 工具…`、`fix: 409 冲突不再进 toast…`。
提交前确认 L0+L1 已绿、生成物未入库；AGENTS.md 是活文档，规则变化时同步更新它。

## 动手前的自检清单

1. 是否读了相关模块与其测试？改动是否触碰上述「红线」（GPL / 密钥 / 公平性 / 状态格式）？
2. 后端：`uv run pytest -m "not slow"` 通过；涉及慢路径再单独 `-m slow`。
3. 前端：`npm run typecheck && npm run test:run` 通过；动了交互再跑 `npm run e2e`。
4. 新增 CLI / API / 事件 / 工具：确认 README、PROJECT-PASSPORT、前端 `types.ts` 等文档同步。
5. 按 Verification 矩阵跑完所选行（L0+L1 全绿）；走完四道关卡：机器门 → 对抗性复审 findings 上 PR
   → 人工四查 → 维护者 merge；总结给出真实证据与未验证项，再交付。
