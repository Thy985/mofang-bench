# PROJECT-PASSPORT — mofang

- 项目：魔方模型能力测试台（后端核心 + CLI）
- 目录：`D:\Projects\Archive\mofang`
- 更新：2026-10-26
- 阶段：Plan 1（M0–M1）实施中

## 环境事实（来源：D:\Company\state\CURRENT-STATE.md，2026-09-18；2026-10-26 定点复核）

| 项 | 事实 |
|---|---|
| Python | 3.12.13（uv 管理，`python` 可解析） |
| uv | 0.12.7 |
| Node.js | 24.19.0（Plan 1 不使用；Plan 2 前端使用） |
| npm | 11.17.0 |
| Git | 2.55.0.windows.2 |
| Playwright | 1.63.0（Plan 2 E2E 使用） |
| 磁盘 | D: 约 141.9G 空闲（2026-09-17 账；求解器表 <1GB） |
| Docker | 未安装；本项目不需要 |

## 依赖与作用域

- Project 级依赖：全部装进项目 `.venv`，不装全局。
- 主依赖：`httpx`、`pydantic`。
- 开发依赖：`pytest`、`pytest-asyncio`、`hypothesis`、`respx`。
- 可选求解依赖：`RubikTwoPhase>=1.1.1`（GPLv3+），仅 3x3 worker 子进程导入。
- 不需要 Company/User 级新能力；若后续需要浏览器 E2E，Playwright 已 active。

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

## 数据目录

- `data/cache/`：求解器距离表缓存（gitignored）。
- `twophase/`：RubikTwoPhase 首次运行生成的求解表（约 80MB，gitignored）；库按相对路径 `twophase/` 查找，因此命令需在项目根执行。
- `data/benchmarks/`：冻结基准题 JSON。
- `data/reports/`：运行报告 JSON（gitignored）。

## 端口

- Plan 1：无服务端口。
- Plan 2：FastAPI `127.0.0.1:8000`，Vite `127.0.0.1:5173`。

## GPL 边界

- `src/mofang/cube/solver_worker.py` 是唯一允许 `import twophase` 的文件。
- 主进程通过 `RubikTwoPhaseClient` 以子进程 JSON lines 通信。
- 若分发，发布前必须复核 GPLv3+ 边界并确定主项目许可证；当前未发布。

## 已知限制

- 完整 2x2 距离表构建较慢、占用内存较高；测试使用浅档部分表。
- 3x3 首次建表约 30 分钟 / 80MB，且需要 `--extra solver`。
- 多模态、Web UI、SQLite/SSE 属于 Plan 2。
