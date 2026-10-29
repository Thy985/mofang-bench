# PROJECT-PASSPORT — mofang

- 项目：魔方模型能力测试台（后端 + 本地 API + Web 工作台）
- 目录：`D:\Projects\Archive\mofang`
- 更新：2026-10-29
- 阶段：Plan 1/2/3 本地完成（M0–M1 核心、M2 API 工作台、M3 Web 工作台），M4 对比页待做

## 环境事实（来源：D:\Company\state\CURRENT-STATE.md，2026-09-18；2026-10-26 定点复核）

| 项 | 事实 |
|---|---|
| Python | 3.12.13（uv 管理，`python` 可解析） |
| uv | 0.12.7 |
| Node.js | 24.19.0（前端开发与 E2E 使用） |
| npm | 11.17.0 |
| Git | 2.55.0.windows.2 |
| Playwright | 1.64.1（M3 E2E 使用，2026-10-26 复核） |
| 磁盘 | D: 约 141.9G 空闲（2026-09-17 账；求解器表 <1GB） |
| Docker | 未安装；本项目不需要 |

## 依赖与作用域

- Project 级依赖：全部装进项目 `.venv`，不装全局。
- 主依赖：`httpx`、`pydantic`、`fastapi`、`uvicorn`。
- 开发依赖：`pytest`、`pytest-asyncio`、`hypothesis`、`respx`。
- 可选求解依赖：`RubikTwoPhase>=1.1.1`（GPLv3+），仅 3x3 worker 子进程导入。
- 不需要 Company/User 级新能力；Playwright 已 active 并用于 M3 E2E。
- 前端工具链（`frontend/`，Node 24 / npm 11）：React 19、Vite、Tailwind v4、
  TanStack Query、three、@react-three/fiber、@react-three/drei、Vitest、
  Testing Library、Playwright。依赖装在 `frontend/node_modules`，不涉及全局。

## 启动与验证命令

```bash
uv sync --extra dev
uv run pytest -m "not slow"
uv run mofang --help
```

3x3：

```bash
uv sync --extra dev --extra solver
uv run python scripts/build_3x3_tables.py
uv run pytest tests/cube/test_solver_3x3.py -m slow -v
```

2x2：

```bash
uv run python scripts/build_2x2_table.py --max-depth 11 --out data/cache/2x2_distances.pkl
```

前端（`frontend/`）：

```bash
npm install
npm run typecheck
npm run test:run
npm run build
npm run e2e
```

E2E 由 Playwright 拉起三个进程（`workers: 1` 串行）：mock OpenAI
`127.0.0.1:20129`、`uv run mofang serve --port 8000`（临时 DB）、
Vite `npm run dev -- --port 5173 --strictPort`；三个端口被占用时会直接失败。

## 数据目录

- `data/cache/`：求解器距离表缓存（gitignored）。
- `twophase/`：RubikTwoPhase 首次运行生成的求解表（约 80MB，gitignored）；库按相对路径 `twophase/` 查找，因此命令需在项目根执行。
- `data/mofang.db`：本地 SQLite；`providers.api_key` 为 Web 中保存的明文 key
  （gitignored，仅本机账户可读）。
- `data/benchmarks/`：冻结基准题 JSON。
- `data/reports/`：运行报告 JSON（gitignored）。
- `data/e2e-<timestamp>.db`：Playwright E2E 临时 DB（gitignored）。
- `frontend/dist/`：Vite 构建产物，由 FastAPI 托管（gitignored）；`frontend/node_modules` 同样不入库。
- `frontend/test-results/`、`frontend/playwright-report/`：E2E 产物（gitignored）。

## 端口

- Plan 1：CLI，无服务端口。
- M2：FastAPI `127.0.0.1:8000`（`uv run mofang serve`）；DB 默认 `data/mofang.db`。
- M3 开发：`uv run mofang dev` 一条命令拉起 API（`127.0.0.1:8000`）与 Vite
  （`127.0.0.1:5173`），Ctrl+C 一并收口；`--port` / `--ui-port` 可改端口。
  CORS 仅放行 `127.0.0.1:5173` 与 `localhost:5173`（Vite 代理 `/api`）。
- M3 单端口演示：先 `npm run build`，再由 FastAPI `127.0.0.1:8000` 托管 `frontend/dist`；
  `--web-dir ""` 可关闭托管，只留 API；`MOFANG_WEB_DIR` 仅对 `Settings.from_env()`
  生效，`mofang serve` 不使用它。
- E2E mock OpenAI：`127.0.0.1:20129`（`scripts/fake_openai_server.py`）。

## 模型接入

- 本地 9router：`http://localhost:20128/v1`（需手动启动）。API key 可在 Web 的 provider 表单中保存到本地 SQLite（明文，`data/mofang.db`，gitignored），或用 `api_key_ref` 指向环境变量；API 响应、导出与日志不回显 key。
- 已验证可用：`my-combo`（路由到 agnes-3.0-flash）、`ollama/gpt-oss:120b`、`sensenova/glm-5.2`。
- 网关兼容性：普通 JSON 可能附加 `data: [DONE]`；部分后端必须显式 `stream:false`（adapter 已固定发送，`probe_tools` 亦然——否则网关返回 SSE 分片导致 probe 报 `bad_response`）；`sensenova/kimi-k3` 只接受 temperature=1；`agnes1/agnes-2.5-pro` 需实名认证。
- 真实冒烟（2026-10-26，`ollama/gpt-oss:120b`，2x2 depth 1）：CLI 链路与工具调用正常，模型未解出（0/1，10 步预算耗尽）。报告在 `data/reports/real-smoke-gptoss.json`（gitignored）。
- M2 API 冒烟（2026-10-26）：`mofang serve` + provider/probe + benchmark + run + SSE 全链路通过；事件 `run.started → … → tool.call/tool.result/move.applied → episode.finished → run.finished`，报告与 CSV/MD 导出可读。该次 run 使用 6 步预算，模型同样未解出（`budget_exceeded`，0/1）。
- M3 Web 冒烟（2026-10-29，`ollama/gpt-oss:120b`，2x2 depth 1，预算 6 步（最长秒数 120））：UI 全链路通过——新建 provider + probe（支持 tool calling）→ 生成题集 → New Run → 实时 canvas 与工具日志 → 结果页 → CSV/MD/JSON 导出可读 → Episode 回放含 10 条步骤记录；模型未解出，run 正常以 `budget_exceeded` 结束（0/1），无浏览器控制台错误。冒烟使用独立临时 DB（已删除），截图与摘要留在 `frontend/test-results/smoke/`（gitignored）。
- 温度默认 0，但 provider 的 `params` 与 run 的 `params` 都可覆盖 `temperature` / `max_tokens` / `extra`。

## GPL 边界

- `src/mofang/cube/solver_worker.py` 是唯一允许 `import twophase` 的文件。
- 主进程通过 `RubikTwoPhaseClient` 以子进程 JSON lines 通信。
- 若分发，发布前必须复核 GPLv3+ 边界并确定主项目许可证；当前未发布。

## 已知限制

- 完整 2x2 距离表构建较慢、占用内存较高；测试使用浅档部分表。
- 3x3 首次建表约 30 分钟 / 80MB，且需要 `--extra solver`。
- 多模态、3x3 精确最优、多 trial / pass@k 尚未实现。
- M4 对比页（`/api/compare` 已有后端端点）尚未实现前端。
- 同一 run 内 episode 串行；跨 run 由 `RunService` 的锁串行，长跑会排队。
- 保存的 API key 为本地 SQLite 明文；拿到 `data/mofang.db` 即可读取，靠文件系统与账户权限保护。
- `mofang dev` 首版不重启后端热重载：改 Python 代码需重启命令；Vite 前端保留 HMR。
