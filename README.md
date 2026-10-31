# mofang

用魔方还原局面测试模型能力的本地工作台（后端 + CLI + Web 工作台）。

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

### 流式 thinking

Provider 默认以 `stream: true` 请求，模型的思考过程（`reasoning_content`
或 `<think>` 段）会实时流到 run 页面的思考面板，并随每个 turn 落库，
回放页可展开查看。网关不支持流式时（4xx 报错含 stream）自动降级为
非流式并把该 provider 记为 `stream: false`；如需强制非流式，在
provider 参数里设 `"stream": false`。注意不要把 `stream` 放进 provider 的
`params.extra`，否则会与 provider 级 stream 开关脱同步；网关的流式怪癖
一律用 params 级 `"stream": false` 或 `params.extra` 里的其他参数兜底。

限流网关（429 后 reset 窗口较长）可在 provider 参数里调大重试退避：
`"retry_delay": 12`（秒，默认 1，只接受正数）。4 次尝试共退避
`retry_delay × (1+2+4)`，例如 12s 可跨过 ~84s 的限流窗口。

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

一条命令启动开发环境（API + Vite）：

```bash
cd frontend && npm install   # 首次
cd ..
uv run mofang dev
```

打开 `http://127.0.0.1:5173`。`--open` 自动开浏览器；`--port` / `--ui-port`
可改端口。流程：Providers 新建 provider（API key 可直接保存在本机，或用
环境变量名回退）→ Probe → Benchmarks 生成题集 → New Run → 实时 3D →
结果与导出 → Episode 回放。

样式经 `frontend/src/ui` 原语与 `index.css` 的 `@theme` 语义色 token 收敛（正文只用
`text-text` / `text-text-dim` / `text-accent` 等 token，状态语义色集中在
StatusBadge/Alert 等原语内部）；路由均为 lazy 加载，three.js（FaceLegend）单独成
chunk，首屏约 289KB（gzip 91KB），3D 相关约 934KB 仅在需要时按需加载。

`mofang dev` 同时管理 API 与 Vite，Ctrl+C 会一并停止，不遗留后端进程。

单端口演示：

```bash
cd frontend && npm run build
cd ..
uv run mofang serve
```

打开 `http://127.0.0.1:8000`（FastAPI 托管 `frontend/dist`）。

只用 API、不托管前端时：`uv run mofang serve --web-dir ""`。

无真实模型时可用 mock：

```bash
uv run python scripts/fake_openai_server.py --port 20129
uv run mofang dev
```

Provider 填 `http://127.0.0.1:20129/v1`，API key 任填（mock 默认不校验；若给
mock 加 `--api-key test`，则必须填 `test`）。生成 2x2、depth 1、seed 3 题集
（scramble 为 `R'`）。mock 每轮返回 `apply_moves ["R'"]`，第三次应用后工具结果
判定解出（`R'` 的阶为 4）。

前端验证：

```bash
cd frontend
npm run typecheck
npm run test:run
npm run build
npx playwright install chromium   # 首次
npm run e2e
```

U1 视觉底座已落地：`@theme` 语义 token 扩容（surface-2 / accent-soft /
font-mono / duration-fast·med / ease-standard），原语层 Button（variant/
size/loading）/ Input·Textarea·Select（label+error）/ Card / Table·Tr /
Toast / EmptyState / PageHeader / Stat；动效统一 motion，
`prefers-reduced-motion` 全局尊重。语义色豁免范围 = run 状态徽章、toast
反馈、表单错误文案（rose）与 logo 装饰（sky）；`accent-soft` /
`duration-med` 为 U2–U4 预留 token。

U2 观测体验已落地：Run live 面板重组为 Stat 卡组（motion 数字滚动）+
四态阶段 stepper + 思考面板（内部滚动、自动跟随、可复制）；3D 画布支持
视角预设（正视/顶视/等轴/重置）与运行中待机自转（尊重
prefers-reduced-motion）；Episode 回放升级为播放器——连播（播完自动进下
一步）、scrubber 拖动选步、`←`/`→` 步进、空格播放/暂停。

## GPL 边界

`RubikTwoPhase` 是 GPLv3+。主进程不 `import twophase`；只有
`src/mofang/cube/solver_worker.py` 子进程导入它，通过 JSON lines 通信。
若未来分发本项目，需重新评估该边界与主项目许可证。
