# mofang

用魔方还原局面测试模型能力的本地工作台（后端核心 + CLI）。

## 快速开始

```bash
uv sync --extra dev
uv run pytest -m "not slow"
uv run mofang --help
```

3x3 求解需要额外的 GPLv3+ worker：

```bash
uv sync --extra dev --extra solver
uv run python scripts/build_3x3_tables.py   # 首次约 30 分钟 / 80MB
```

求解表生成在项目根的 `twophase/`（已 gitignore）。

## 2x2 距离表

```bash
uv run python scripts/build_2x2_table.py --max-depth 11 --out data/cache/2x2_distances.pkl
```

完整表按整体旋转归一化，恰好 3,674,160 个状态、最大距离 11；未归一化会膨胀到
88,179,840。测试与演示可先用 `--max-depth 3` 的浅表。

## 状态格式与走法约定

面序固定 `U R F D L B`；每面矩阵按"从面外看，行从上到下、列从左到右"排列。
走法为标准 Singmaster：`U/R/F/D/L/B` 顺时针 90°，`'` 逆时针 90°，`2` 为 180°。
3x3 传给求解器的面片串按 Kociemba 的 URFDLB 顺序导出。

## 运行假 provider（验证链路）

```bash
uv run mofang benchmark --name demo --cube 2x2 --depths 1,2,3 --per-depth 2 \
  --seed 7 --table data/cache/2x2_distances.pkl --out data/benchmarks/demo-2x2.json
uv run mofang run --provider fake --benchmark data/benchmarks/demo-2x2.json \
  --table data/cache/2x2_distances.pkl --out data/reports/demo.json
```

## 真实模型

```bash
export OPENAI_API_KEY=...
uv run mofang run --provider openai --model <model> --base-url <url> \
  --api-key-env OPENAI_API_KEY --benchmark <bench.json> --out <report.json>
```

报告包含逐题状态、步数、效率、协议错误、tokens 与耗时。

3x3 使用 `--solver rubik`，预算自动按 3x3 默认值（100 步 / 15 分钟 /
150 次调用 / 1M tokens），可用 `--max-*` 覆盖：

```bash
uv run mofang run --provider openai --model <model> --solver rubik \
  --benchmark <bench3x3.json> --out <report.json>
```

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

主要端点：`/api/providers`、`/api/benchmarks`、`/api/runs`（含
`snapshot`、`events`、`cancel`、`report`、`export`）、`/api/episodes`、
`/api/compare`。默认 DB 为 `data/mofang.db`，2x2 距离表为
`data/cache/2x2_distances.pkl`，可用 `--db` / `--table` 覆盖。

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

## GPL 边界

`RubikTwoPhase` 是 GPLv3+。主进程不 `import twophase`；只有
`src/mofang/cube/solver_worker.py` 子进程导入它，通过 JSON lines 通信。
若未来分发本项目，需重新评估该边界与主项目许可证。
