# M3 本地工作台 — 设计文档

- 日期：2026-10-26
- 状态：待用户评审
- 上游设计：`docs/superpowers/specs/2026-10-26-rubiks-cube-model-bench-design.md` §9、§10、§11、§13
- 前置实现：Plan 1（后端核心 + CLI）、Plan 2（FastAPI + SQLite + SSE）

## 1. 目标

在现有本地 API 之上交付可演示的 Web 工作台：

1. 在 UI 内配置 OpenAI-compatible provider 并探测 tool calling。
2. 在 UI 内生成、查看冻结基准集。
3. 启动 run，实时看到模型工具调用驱动的 3D 魔方动画。
4. 运行结束展示解出率、置信区间、分箱、失败码，并导出 JSON/CSV/Markdown。
5. 从结果进入单题回放，逐步查看局面、工具参数与结果。

## 2. 范围与非目标

### 2.1 M3 范围

- 页面：Providers、Benchmarks（列表/生成/详情）、New Run、Runs 历史、Run（实时与结果同页）、Episode 回放。
- 2x2 与 3x3 的渲染与运行；E2E 只覆盖 2x2 一步题。
- 桌面优先、中文界面、本地单用户。
- 开发期 Vite `5173` 代理 `/api`；收尾支持 `mofang serve` 单端口托管 `frontend/dist`。

### 2.2 明确不做

- Compare 页（M4）。
- provider 编辑/删除（后端无 PUT/DELETE）。
- 循环/停滞检测（后端没有该指标，前端不造数）。
- USD 成本预估/价格表（无定价数据）。
- 多模态输入、多用户、鉴权、公网访问、移动端适配。
- 流式模型输出：仍是非流式轮次，实时感来自工具事件与 SSE。

## 3. 已确认决策

| 决策 | 选择 | 理由 |
|---|---|---|
| M3 页面范围 | 演示主路径 | 能完成建题→运行→回放闭环；Compare 留 M4 |
| E2E 假模型 | 独立 mock OpenAI 服务 | 生产代码不出现假模型；仍走真实 HTTP adapter |
| 前端栈 | Vite + React + TS + Tailwind v4 + TanStack Query | 依赖适中，表单/缓存/样式开发快 |
| API key | 仅环境变量 | key 不落库、不过前端、不写日志 |
| 实现路线 | slot 化 cubie + 动画队列 + SSE | 符合 spec 的 cubie 外观，断线恢复无需块身份重建 |

## 4. 架构与数据流

### 4.1 目录

```
frontend/
  src/
    api/            client.ts、types.ts、queries.ts
    cube/           facelets.ts、moves.ts、animation.ts、CubeView.tsx
    hooks/          useRunEvents.ts
    pages/          ProvidersPage、BenchmarksPage、NewRunPage、RunsPage、
                    RunPage、EpisodePage
    components/     布局、表单、状态徽章、进度线、工具日志、导出按钮
    lib/            格式化、错误处理
    main.tsx、App.tsx、index.css
  e2e/              workbench.spec.ts
scripts/
  fake_openai_server.py
```

### 4.2 前端状态分层

- **服务端状态**：TanStack Query 管 REST。query key：
  `providers`、`benchmarks`、`benchmark/{id}`、`runs`、`run/{id}`、`episode/{id}`、
  `steps/{episodeId}`、`report/{runId}`。
- **实时状态**：`useRunEvents` 内部 `useReducer`，不写入 Query 缓存。输入是 snapshot 与 SSE 事件；输出：
  - `run`、`episodes`、`currentEpisode`
  - `logs`（tool.call/tool.result/model.message）
  - `usage`（累计 tokens）、`progressPoints`（步数, reference_length_after）
  - `connection`（connecting/open/reconnecting/closed）
  - 动画命令流（move 批次 + 权威 state）
- **3D 状态**：动画队列在 ref 中，不触发 React 每帧渲染。前端不计算解出率、距离或参照长度。

### 4.3 运行页数据流

1. 进入 `/runs/:id`：先取 run detail；再以 `run.benchmark_id` 取 benchmark detail，并与 providers、snapshot 并行请求。
2. 用 snapshot 的 `current_state` 初始化 3D；若为空且已有 episode，用该题 `task.state`。
3. 打开 `GET /api/runs/{id}/events?after={snapshot.last_event_id}`。
4. 事件处理：
   - `run.started`：更新状态。
   - `episode.started`：切题，按题初始局面重置 3D，清空日志/进度。
   - `model.turn.started`：显示“思考中”。
   - `model.message`：追加文本与 tool 名称，更新累计 `usage`。
   - `tool.call` / `tool.result`：追加日志；失败结果标记首次非法调用。
   - `move.applied`：更新进度点，把 `moves` 与 `state` 入动画队列。
   - `episode.finished`：更新逐题状态与 run 进度。
   - `run.finished`：把 totals 并入 run，关闭 SSE，invalidate run/report，切换到结果视图。
   - `run.error`：把 run 置为 failed 并记录错误信息，显示错误横幅并关闭 SSE。
5. 事件按 `id` 去重；乱序或缺失以 snapshot 为准。

### 4.4 重连

- EventSource 断开：显示横幅，指数退避（1s→2s→4s，上限 10s）。
- 每次重连前重新取 snapshot，以 `last_event_id` 为 `after` 重建流；若 run 已结束则不再重连。
- snapshot 的 `current_state` 优先于事件重放；重放事件只推进日志与状态，避免回退动画。
- 服务重启后 run 为 `interrupted`，页面显示终态与已落库步骤，不显示为运行中。

## 5. 后端契约扩展

所有扩展先写失败测试，再实现。

| # | 位置 | 变更 | 原因 |
|---|---|---|---|
| 1 | `runner/episode.py` `move.applied` | data 增加 `reference_length_after: int \| null` | 实时进度曲线需要每题每步的参照距离 |
| 2 | `runner/episode.py` `model.message` | data 增加 `usage: {prompt_tokens, completion_tokens}`（该 episode 累计） | 侧栏实时 tokens |
| 3 | `api/schemas.py` `RunOut` | 增加 `budget: dict[str, Any]` | 运行页显示步数/时间/tokens 上限 |
| 4 | `api/routes/runs.py` SSE | 支持 `?after=N`，与 `Last-Event-ID` 取较大值 | EventSource 不能设置请求头 |
| 5 | `api/routes/runs.py` snapshot | 运行中的 episode 无 step 时，倒序扫描事件历史取最后一个 `move.applied` 的 `data.state` 或 `tool.result` 的 `data.payload.state`；再回退到该题 `task.state` | 当前 steps 只在 episode 结束后落库，snapshot 会返回 `{}` |
| 6 | `api/routes/benchmarks.py` | 同 `f"{name}-{cube}-{seed}"` 已存在时返回 409 | 避免重新生成但 `save_benchmark` 静默不入库的假成功 |
| 7 | `api/app.py` + `api/settings.py` + `cli.py` | `web_dir`（默认 `frontend/dist`，可用 `MOFANG_WEB_DIR` 或 `mofang serve --web-dir` 覆盖，空值禁用；目录存在才托管）；静态资源 + SPA 回退，`/api/*` 保持 JSON 404 | 单端口演示 |

约定：

- 事件字段只增不改，现有消费者不受影响。
- `reference_length_after` 对 3x3 是启发式距离，报告仍标注 `near_optimal`。
- `usage` 为累计值，不是单轮增量。
- SSE `after` 非法整数返回 422；`Last-Event-ID` 解析失败按 0。
- 静态托管不影响 `/docs`、`/openapi.json` 与 API 路由优先级。

## 6. 3D 渲染与动画

### 6.1 几何约定

与后端 `geometry.py` 完全一致：

- 坐标：`+x=R`、`+y=U`、`+z=F`。
- 槽位坐标：`coord(i, size) = 2i - (size-1)`；渲染时乘 `0.5`，使相邻槽位间距为 1。
- 面帧：

```text
FACE_FRAME = {
  U: (normal=(0,1,0), right=(1,0,0), up=(0,0,-1)),
  R: (normal=(1,0,0), right=(0,0,-1), up=(0,1,0)),
  F: (normal=(0,0,1), right=(1,0,0), up=(0,1,0)),
  D: (normal=(0,-1,0), right=(1,0,0), up=(0,0,1)),
  L: (normal=(-1,0,0), right=(0,0,1), up=(0,1,0)),
  B: (normal=(0,0,-1), right=(-1,0,0), up=(0,1,0)),
}
```

- facelet `(face,row,col)` 的世界位置：
  `normal*(size-1) + right*coord(col) + up*coord(size-1-row)`。
- 该位置即所属 cubie 的槽位；该面的外法线即贴纸朝向。

### 6.2 渲染

- 2x2 生成 8 个 cubie；3x3 生成 26 个（排除 `(0,0,0)` 核心）。
- 每个 cubie 用略小于间距的立方体网格与六面材质（首版 `BoxGeometry`，圆角作为视觉打磨后置）；外露面按 facelet 上色，内侧深色。
- 颜色映射：U 白、R 红、F 绿、D 黄、L 橙、B 蓝。
- 相机与 OrbitControls：固定初始视角可同时看到 U/F/R；禁用平移，限制极角；深色背景。
- `CubeView` 用受控 props 表达命令：`state` + `resetToken`（吸附）、`batch`（入队）、`speed`、`paused`、`skipToken`（跳到最新）；数据流保持单向。
- UI 控件：0.5×/1×/2×/instant、暂停/继续、跳到最新。面标签开关后置，首版不做。

### 6.3 上色与动画

- **上色**：按 facelet 把颜色写到“槽位 + 外法线”对应的 cubie 材质。不追踪块身份，因此断线/切题只需重涂。
- **动画**：
  1. 解析 move：面 → 轴、法线符号、层（坐标等于 `sign*(size-1)`）。
  2. 角度：`turns = (-sign * amount) mod 4` 表示落地方向（绕 `+axis` 右手）；动画取等价的短弧（`turns=3` 按 `-1` 个 90° 播），落点不变。
  3. 该层 cubie 刚性旋转：位置 = 槽位偏移绕同轴、同角旋转；朝向用同一旋转四元数，并累计到批次末；时长约 220ms / speed。
  4. 落地：层内 cubie 的槽位按同一整数旋转映射；位置吸附网格，朝向累计四元数保留到批次末。
  5. 一个批次全部播完后，先把朝向重置为单位四元数，再用事件里的权威 `state` 重涂所有 cubie（重涂以单位朝向为前提）。
- 批次内不做中途重涂：中间状态未下发，刚性旋转已由前一批次末的权威状态决定。
- 队列串行；新批次入队不打断当前批次。`instant` 直接按批次末状态吸附。
- 切题、重连、`run.finished`：清空队列；重连时直接吸附到 snapshot 状态。

### 6.4 纯函数测试

- `faceletPlacement(face,row,col,size)`：与后端 `sticker_geometry` 的已知输出对照。
- `moveSpec(move)`：R/R'/R2/U/F 等轴、层、方向。
- `rotateSlot(slot, move)`：旋转后槽位与后端 `rotate()` 对比。
- `stickerColor(state, slot, normal)`：解出态与已知 R 后状态的配色。
- 动画数学（连续角度旋转）抽成纯函数：90° 的整数倍必须与 `rotateSlot` 的整数映射一致，并保持到轴的距离。
- 动画队列 reducer：批次顺序、暂停、跳过、切题清空（列表项由 E2E 与手动运行验收）。

## 7. 页面与交互

### 7.1 全局

- 顶部导航：Providers / Benchmarks / Runs / New Run。
- 中文、桌面优先（≥1100px）、深色主题。
- 统一错误提示：API 错误显示 `detail`；后端不可达显示重试按钮。

### 7.2 Providers

- 列表：name、model、base_url、`key_configured`、created_at。
- 新建：name、base_url、model、api_key_ref、params（temperature、max_tokens、extra JSON）。
- 校验：base_url 必须 http(s)；api_key_ref 提示“环境变量名”；extra 非法 JSON 阻止提交并提示字段。
- Probe：按钮显示 loading，成功显示 tool calling 是否支持，失败显示错误码与消息。
- 不提供编辑/删除。

### 7.3 Benchmarks

- 列表：name、cube、task_count、hash 前 8 位、frozen_at、查看详情。
- 生成：name、cube、depths（1/2/3/5/10/20；2x2 禁 20）、per_depth、seed；solver 由 cube 决定。
- 详情：任务表（task id、scramble、scramble_depth、reference_length、reference_kind、bin）。
- 3x3 生成提示可能耗时；409 显示“已存在同 id 题集”，链接到已有详情。
- 创建成功后跳转详情并可一键 New Run。

### 7.4 New Run

- 选择 provider 与 benchmark；无数据时显示引导链接。
- tool_mode：both / turn_only / batch_only。
- 预算覆盖：max_moves、max_seconds、max_tool_calls、max_tokens、turn_timeout；按 benchmark.cube 预填默认值。
- 可选 params 覆盖：temperature、max_tokens。
- 不显示伪造成本预估；显示四重预算上限与“未配置价格，仅统计 tokens”。
- 提交后跳转 `/runs/{id}`。

### 7.5 Runs 历史

- 轻量列表：id 前 8 位、provider/benchmark 名称（用 providers 与 benchmarks 列表映射 id）、status、created_at、解出率（有 totals 时）。
- 点击进入 Run 页。

### 7.6 Run 页（实时 + 结果）

**实时布局**

- 左侧：3D canvas、播放控制、面标签/图例。
- 右侧：
  - run 状态、题号/总题数、当前 episode 状态
  - 已用步数 / max_moves；计时（started_at 起）；累计 tokens；成本显示“未配置价格”
  - reference_length 与当前 progress
  - 进度折线（步数 vs 参照距离，SVG）
  - 取消按钮（queued/running）
- 下方：工具日志（call/result，可展开原始 JSON）、模型文本轮次。
- 多题串行：`episode.started` 自动切题；run 总进度 = 完成题数 / benchmark 题数。
- 失败高亮：状态徽章；首次 `ok=false` 的工具结果；预算耗尽；provider 错误。

**结果视图**

- run 结束后同页切换：
  - 汇总：tasks、solved、solve_rate、CI95、partial 提示
  - 分箱表：total、solved、solve_rate、mean_moves
  - 逐题表：task id、status、solved、moves_used、reference_length、efficiency、failure_code、回放入口
  - 失败码分布
  - 导出：JSON（report 链接）、CSV、Markdown
- 若 run 为 `interrupted`/`failed`，显示错误与已完成部分，不显示为成功。

### 7.7 Episode 回放

- 头部：task id、status、solved、moves_used、reference_length、efficiency、耗时、tokens。
- 3D：按步骤状态吸附；工具步骤若有 applied moves，可播放该批次动画。
- 步骤列表/滑杆：seq、kind、tool、参数、结果、reference_length_after。
- 模型文本按轮显示。
- 数据链：episode → run → benchmark → task.state。

## 8. 错误处理与安全

- key 仍只存环境变量名；UI 不接收、不显示 key；probe/run 的密钥解析只在后端。
- 默认绑定 `127.0.0.1`；静态托管同源，CORS 保持现有白名单。
- SSE 断线与后端不可达：横幅 + 退避重试 + 手动重试；不静默假装运行中。
- 404：run/episode/benchmark 不存在显示明确页面。
- 取消：UI 调 `POST /api/runs/{id}/cancel`；409 时刷新状态。
- 前端不对模型输出做 HTML 注入；文本按纯文本渲染。
- 日志/URL 不含 key。

## 9. 测试策略

### 9.1 前端单元与组件（Vitest + RTL）

- 纯函数：facelet 映射、move 规格、槽位旋转、配色、进度序列、格式化。
- reducer：事件去重、切题、usage 累计、首次非法调用、run.finished。
- Hook：假 EventSource + 假 fetch，覆盖打开、断开、重连、snapshot 校准。
- 组件：Provider 表单校验、Benchmark 表单（2x2 禁 20）、结果卡片、导出链接、空状态。

### 9.2 后端

- 第 5 节 7 项契约扩展逐项测试。
- snapshot 运行中局面：构造 run/episode + 事件历史，验证返回值。
- 静态托管：临时 dist，验证 SPA 回退、assets、`/api/*` 404 不受影响。
- 现有 159 项测试保持全绿。

### 9.3 E2E（Playwright）

- `webServer` 三进程：
  1. `uv run python scripts/fake_openai_server.py --port 20129`
  2. `uv run mofang serve --port 8000 --db data/e2e-<timestamp>.db`，env `OPENAI_API_KEY=test`
  3. `npm run dev -- --port 5173 --strictPort`（Vite 代理 `/api` → `127.0.0.1:8000`）
- provider 的 `base_url` 指向 `http://127.0.0.1:20129/v1`，`api_key_ref=OPENAI_API_KEY`。
- mock 行为：
  - 请求 tools 含 `apply_moves` 且最后一条消息不是 tool 结果 → 返回 tool call `apply_moves {"moves":["R'"]}`；
  - 最后一条是 tool 结果 → 返回文本 “solved”；
  - 其余（如 probe 的 ping）→ 返回文本 “ok”。
- 用例（串行 workers=1）：
  1. UI 新建 provider，`key_configured` 为真，probe 成功。
  2. UI 生成 2x2、depth 1、seed 3 题集（已验证 scramble 为 `R'`），看到 reference_length 1。
  3. New Run 启动；run 页出现 canvas；状态变为 finished；solved 1/1。
  4. 结果页 1/1、CI、分箱可见；CSV 下载成功；Markdown 可打开。
  5. Episode 回放显示 `apply_moves` 与模型文本，3D 可见。
- 测试数据隔离：每次运行使用新 DB 路径；`data/*.db*` 已 gitignore。
- 浏览器缺失时执行 `npx playwright install chromium`（首次安装，需网络）。

### 9.4 手动验证

- 真实网关（gpt-oss，2x2 一步、小预算）走 UI 全流程；允许模型未解出，确认事件、动画、报告、导出正常。
- 断线：页面打开时停/启后端或浏览器 offline→online，确认 snapshot 校准与状态不倒退。

## 10. 验收标准

1. UI 内完成 provider 配置与 tool calling 探测。
2. UI 内生成并查看 2x2 基准集。
3. mock 模型跑通 2x2 一题，3D 播放 `R'` 并判定解出。
4. 结果页显示 1/1、CI、分箱、失败码；JSON/CSV/MD 可导出。
5. Episode 回放可逐步查看局面与工具参数/结果。
6. 断线重连后状态与 snapshot 一致；不出现倒退或重复计数。
7. `npm run build` 后仅启动 `mofang serve` 可在 8000 访问各路由，刷新不 404。
8. 真实网关 UI 冒烟通过（允许 0/1）。
9. 后端 pytest、前端 Vitest、Playwright 全绿；`npm run typecheck` 与 `npm run build` 通过。

## 11. 实施顺序（供计划细化）

1. 后端契约扩展 1–7 + 测试。
2. 前端脚手架：Vite、Tailwind、路由、QueryClient、布局。
3. API 客户端/类型 + Providers 页。
4. Benchmarks 页。
5. New Run 页。
6. SSE hook + Run 页实时骨架。
7. 3D 纯函数 + CubeView + 动画队列。
8. 结果视图 + 导出。
9. Episode 回放。
10. 静态托管 + 文档。
11. mock 服务 + Playwright E2E。
12. 全套验证与 `PROJECT-PASSPORT.md` / `README.md` 更新。

## 12. 风险与对策

| 风险 | 对策 |
|---|---|
| facelet 行/列方向再次弄反 | 前端映射与后端 `geometry.py` 逐样例对照测试；已知 R 后状态做黄金测试 |
| 3D 动画与权威状态漂移 | 批次末重涂；重连/切题直接吸附快照 |
| EventSource 无法设 Last-Event-ID | 后端支持 `?after`；重连前重新取 snapshot |
| 运行中 snapshot 无 state | 从事件历史回退；再回退题初始局面；加测试 |
| 3x3 生成慢或表缺失 | 生成按钮显示 loading；后端错误原样展示；文档说明建表命令 |
| 前端依赖版本不兼容（r3f/React 19） | 使用官方模板与兼容版本，锁 `package-lock.json`；先做最小 3D spike 再展开 |
| E2E 三进程不稳定 | 固定端口、串行、新 DB；mock 无外部依赖；失败时保留 trace |
| 轮询/事件重复 | 按事件 id 去重；snapshot 为最终权威 |

## 13. 后续

- M4：Compare 页、配对差异、成本/延迟对比、UI 打磨。
- 之后：provider 编辑/删除、循环/停滞指标、USD 定价、多 trial/pass@k、多模态。
