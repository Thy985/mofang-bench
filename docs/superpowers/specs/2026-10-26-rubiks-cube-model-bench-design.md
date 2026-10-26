# 魔方模型能力测试台 — 设计文档

- 日期：2026-10-26
- 状态：待评审
- 项目目录：`D:\Projects\Archive\mofang`
- 实现路线：Python 核心 + FastAPI + React/three.js

## 1. 背景与定位

### 1.1 一句话

一个本地运行的单用户工作台：配置模型 API，按难度生成魔方局面，让模型通过工具实时操作魔方，前端同步 3D 回放，并自动判定解出率、效率与失败模式。

### 1.2 已有工作与差异

- **Cube Bench**（Monash，2025-12，[arXiv:2512.20595](https://arxiv.org/abs/2512.20595)）已经把"用魔方测多模态大模型"做成五技能基准：从图像/文本重建状态、选最优下一步、预测动作结果、多步执行与纠错、自检修正；用统一的"到复原状态的距离"打分，横向测了 7 个 MLLM。
- 更早有 Noever & Burdick（2021）用 2,400 个魔方样本评估 GPT-2 的空间推理；机器人领域也有用魔方做操作基准的工作（IEEE RA-L）。
- **本项目的差异**：不是再做一个静态题集，而是做"可配置模型 + 工具驱动 + 实时回放"的交互式测试台。核心价值在：
  1. 模型通过工具闭环操作，而不是一次性答题；
  2. 文本轨道先行，多模态后置；
  3. 2x2 + 3x3 难度阶梯，能测出能力边界而不是单一总分；
  4. 本地配置任意 OpenAI-compatible API，结果、成本、失败模式都留在本机；
  5. 3D 实时回放既是调试工具，也是内容呈现的主界面。

本项目不声称提出新的学术 benchmark。若后续要做公开对比或论文级结论，需要另行冻结公开题集、扩大样本量，并与 Cube Bench 等已有基准做对齐说明。

### 1.3 目标与非目标

**目标**
- 用同一套协议公平比较不同模型在魔方任务上的能力。
- 让"模型到底会不会解、卡在哪一步"一眼可见。
- 支持 2x2/3x3、多种难度、单步与批量工具、多次 trial。
- 所有运行可复现、可回放、可导出。

**非目标（MVP 不做）**
- 多模态图片输入（第二期）。
- 公网榜单、多用户、账号体系。
- 人机对战、速拧计时器、教学训练器。
- 机器人/真机操作。
- 求解器辅助模式（允许模型调用求解器会改变被测能力，后续单独做并标注）。
- 视频/GIF 导出（后续）。

## 2. 使用流程

1. 在 `Providers` 页填写 `base_url`、API key、模型名与参数，点击"测试连接"；平台同时探测是否支持原生 tool calling。
2. 在 `New Run` 页选择题集（冻结基准集或随机局）、2x2/3x3、难度档、题数、trial 次数、工具模式与预算；页面显示预估成本。
3. 启动后进入实时运行页：3D 魔方随模型的工具调用逐帧转动，侧栏显示走法、工具日志、计时、tokens、成本、剩余预算。
4. 单题结束后记录状态；运行结束后进入结果页，看逐题结果、失败分类、曲线与导出。
5. 在 `Compare` 页选择同一基准集下的多次运行，比较解出率、效率、成本与配对差异。

## 3. 范围与判定口径

### 3.1 MVP 范围

- 本地单用户，默认只绑定 `127.0.0.1`。
- 文本轨道：JSON 六面矩阵作为状态。
- 模型通过 `turn` / `apply_moves` 操作；`get_state` 可随时读取；每次成功操作的工具结果都推送最新状态。
- 2x2 + 3x3；难度档 1/2/3/5/10/20 步打乱（2x2 不含 20 档）。
- 自动判定、失败分类、成本/延迟统计、运行历史、同基准对比。
- 3D 实时回放为主界面。

### 3.2 指标

**主指标**
- 按难度档的**解出率** = solved / 总题数，带 Wilson 95% 置信区间与样本数。
- `pass@1` 为主；多次 trial 时 `pass@k` 单列，不与 `pass@1` 混写。

**次指标**
- **步数效率** = `moves_used / reference_length`。
  - 2x2：精确最优长度。
  - 3x3：Kociemba 近优解长度，报告中明确写"近优参照"，不写"最优"。
  - 模型可能找到比参照更短的解，效率 < 1 属正常，记录但不惩罚。
- **进度比** = `clamp((L0 - Lfinal) / L0, 0, 1)`，其中 `L` 为参照解长度。2x2 为精确距离；3x3 为启发式参照。解出记为 1。
- **有效走法率** = 合法走法数 / 尝试走法数。
- **协议错误**：无效参数、非法记法、未知工具、参数 JSON 解析失败、单轮工具调用超限。
- **运行错误**：provider 错误、超时、预算耗尽、取消、中断。
- **成本**：tokens、USD（若配置了价格）、墙钟时间、工具调用数。
- **循环/停滞**：重复状态计数、连续无进展步数、最大重复次数。

**不造单一总分。** 结果页与对比页并列展示维度；若后续需要综合分，必须显式配置权重并标注。

### 3.3 难度与题集

- **两种题集**：
  - `基准集`：固定、版本化、冻结后不再改动；跨模型对比必须使用同一基准集。
  - `随机局`：运行开始时按 seed 生成，题目随 run 落库，可复现，用于内容演示。
- **打乱深度**：1/2/3/5/10/20 步。每步是一次面转（90° 或 180°），生成时避免同面连续与立即抵消。
- **实际难度**：每题同时记录 `scramble_depth` 与 `reference_length`；展示曲线按 `reference_length` 分箱（1、2、3、4–5、6–10、11–20），避免"20 步打乱其实 16 步能解"的误导。
- **2x2**：精确距离表，分箱严格按实际最优距离。
- **3x3**：Kociemba 近优长度用作参照与分箱依据，标注 `reference_kind = "near_optimal"`。
- **去重**：按内部 cubie 状态去重；同一基准集内不允许重复状态。
- **样本量**：默认 5 题/档、1 trial；正式对比建议 ≥10 题/档、3 trial。启动前显示预估成本。样本量小必须在报告中显式提示置信区间很宽。

### 3.4 预算与公平性

- 默认预算（可配置）：
  - 2x2：最多 30 步、5 分钟、50 次工具调用、300k tokens。
  - 3x3：最多 100 步、15 分钟、150 次工具调用、1M tokens。
  - 单次运行 USD 上限默认 5 美元；未配置价格时只统计 tokens。
- 超预算判 `budget_exceeded`，不算解出，单独统计。
- 公平性约束：
  - 同一对比使用同一基准集、同一 prompt 版本、同一工具集、同一预算、同一温度设置。
  - 模型永远看不到参照解、参照长度、打乱序列或"距离"字段，只看到当前局面与走法历史。
  - 记录模型名、provider 返回的模型版本（若有）、运行日期、温度、max_tokens 等参数。
  - 模型静默升级会导致结果漂移；报告必须带运行日期。

## 4. 系统架构

### 4.1 组件图

```
React + three.js ──REST/SSE── FastAPI
                                  │
                    ┌─────────────┴─────────────┐
                Episode Runner              Task/Benchmark Store
                    │                              │
        ┌───────────┼───────────┐                  │
  Provider Adapter  Cube Engine  Evaluator         │
        │                │           │             │
  OpenAI-compatible   Moves/State  Kociemba/2x2 tables
                    │
              SQLite (runs / episodes / steps / artifacts)
```

### 4.2 模块职责

| 模块 | 职责 | 依赖 |
|---|---|---|
| `cube-core` | 2x2/3x3 状态、走法、cubie/facelet 转换、JSON 序列化、解出判定 | 无 |
| `reference-solver` | 2x2 精确距离表；3x3 Kociemba 封装；统一 `distance()` / `solve()` | cube-core |
| `task-generator` | 种子化打乱、参照长度计算、分箱、去重、基准集冻结 | cube-core, reference-solver |
| `provider-adapter` | OpenAI-compatible 调用、tool call 解析、错误映射、重试 | 外部 API |
| `episode-runner` | 状态机、预算、超时、取消、事件广播、落库 | adapter, cube-core, evaluator |
| `evaluator` | 解出、效率、进度、协议错误、成本、聚合 | cube-core, reference-solver |
| `api` | REST + SSE | runner, store |
| `web` | 配置、实时回放、结果、对比 | api |

**状态所有权**：服务端是唯一真相源。前端不自行推演走法，只消费 `move.applied`（含新状态）等事件；断线重连从事件流或快照恢复。

### 4.3 运行时序

```
User → API: POST /runs
API → Runner: start run (benchmark, provider, budget)
Runner → TaskStore: load tasks
loop per episode:
  Runner → Adapter: chat(messages, tools)
  Adapter → Runner: tool_calls / text / usage
  Runner → CubeEngine: validate + apply (atomic)
  Runner → DB: write step
  Runner → SSE: move.applied（含新状态）
  Runner → Evaluator: update progress
  check solved / budget / timeout
Runner → API: run.finished
Web ← SSE: live updates
```

## 5. 魔方核心

### 5.1 状态表示

- 内部规范表示：**cubie 表示**（角块/棱块的排列与朝向）。用于走法、索引、求解器转换。
- 对外序列化：**facelet JSON**。用于模型输入、数据库存储、前端渲染。
- 颜色映射（固定）：
  - U = white
  - D = yellow
  - F = green
  - B = blue
  - R = red
  - L = orange
- 面序固定为 `U, R, F, D, L, B`；每个面按"从外看、行从上到下、列从左到右"给出 3×3（2x2 为 2×2）矩阵。
- 使用**颜色全名**而不是单字母，避免 `B`（Blue/Back）与 `R`（Red/Right）歧义。

状态 JSON：

```json
{
  "cube": "3x3",
  "faces": {
    "U": [["white", "white", "white"], ["white", "white", "white"], ["white", "white", "white"]],
    "R": [["red", "red", "red"], ["red", "red", "red"], ["red", "red", "red"]],
    "F": [["green", "green", "green"], ["green", "green", "green"], ["green", "green", "green"]],
    "D": [["yellow", "yellow", "yellow"], ["yellow", "yellow", "yellow"], ["yellow", "yellow", "yellow"]],
    "L": [["orange", "orange", "orange"], ["orange", "orange", "orange"], ["orange", "orange", "orange"]],
    "B": [["blue", "blue", "blue"], ["blue", "blue", "blue"], ["blue", "blue", "blue"]]
  }
}
```

### 5.2 走法与记法

- 支持标准 Singmaster 面转：`U, R, F, D, L, B`，可选后缀 `'`（逆时针 90°）与 `2`（180°）。
- `turn` 工具用 `amount ∈ {1,2,3}`：1=顺时针 90°，2=180°，3=逆时针 90°。
- `apply_moves` 接受标准记法字符串数组，如 `["R", "U'", "F2"]`。
- 解析时兼容 `'`、`’`、`′` 和空白；不接受宽转/中层转（`r`、`M`、`x` 等）与非法面字母；非法整批拒绝。
- 每个面转的阶数为 4；`R` 与 `R'` 互逆；`R2` 自逆。全部由属性测试覆盖。

### 5.3 参照求解器

统一接口：

```python
class ReferenceSolver(Protocol):
    def solve(self, state: CubeState) -> list[str]: ...
    def distance(self, state: CubeState) -> int | None: ...
    def distance_kind(self) -> str: ...  # "exact" | "near_optimal"
```

- **2x2**：从复原态 BFS 全状态，距离 0–11。按整体旋转归一化（白红绿参考角固定到 UFR、白色朝 U），状态数恰为 3,674,160；不做归一化会膨胀到 88,179,840。MVP 使用构建脚本生成的 BFS 距离表并缓存到本地；构建时间与内存占用较高（见实施计划），1.8MB 级 4-bit 紧凑表作为后续优化。`distance()` 精确。
- **3x3**：Kociemba 两阶段求解器。首次建表约 80MB，构建脚本一次性生成并缓存。`solve()` 返回近优解；`distance()` 返回近优解长度，仅供参照与进度，不是精确距离。
- 3x3 的精确最优距离不进入 MVP；若后续需要，可对浅局面用 IDA* + 模式数据库补充。
- **许可证**：实现前核对所选 Kociemba 库的许可证（原实现与 Python 包可能不同）。若与分发方式冲突，改为子进程隔离或换用许可兼容的实现；此检查是 M0 的门禁。

### 5.4 任务生成

- `scramble(cube, depth, seed)`：生成 `depth` 步随机面转，避免同面连续、避免立即抵消。
- 每题记录：`scramble`, `scramble_depth`, `seed`, `state`, `reference_length`, `reference_kind`, `bin`。
- 2x2 用精确距离做严格分箱；3x3 用近优长度分箱并标注。
- 去重按内部 cubie 状态；不按整体旋转归一化，因为模型看到的是固定朝向。
- 基准集落盘为版本化 JSON（`data/benchmarks/<name>/v1/tasks.json`），并记录内容哈希；冻结后不再改动。
- 随机局在 run 开始时生成，作为该 run 的私有基准集落库，保证可复现。

## 6. 工具协议

### 6.1 工具清单

| 工具 | 参数 | 语义 |
|---|---|---|
| `turn` | `face: U\|R\|F\|D\|L\|B`, `amount: 1\|2\|3` | 转一个面；返回新状态 |
| `apply_moves` | `moves: string[]`，单次最多 30 步 | 标准记法批量；整批原子校验 |
| `get_state` | 无 | 返回当前状态、是否解出、已用步数、剩余预算 |
| `check_solved` | 无 | 只返回是否解出 |

不提供求解器、提示、距离、参照解或打乱序列。

### 6.2 工具结果

成功返回字段：

- `ok`: `true`
- `applied`: 实际应用的走法数组，如 `["R", "U'", "F2"]`
- `state`: 5.1 的完整状态 JSON（当前局面）
- `solved`: 是否解出
- `moves_used`: 已用步数
- `moves_remaining`: 剩余步数

失败返回字段：

- `ok`: `false`
- `error`: 6.3 的错误码
- `detail`: 人类可读的说明，如 `"M is not a supported face move"`
- `state`: 当前状态 JSON（失败时状态不变）
- `moves_used` / `moves_remaining`: 同上

规则：
- `apply_moves` 整批原子：任一非法，整批不执行，状态不变。
- 单轮多个 tool call 按顺序执行；每个 call 独立返回结果；非法 call 不改变状态，后续 call 继续执行。
- 单轮工具调用上限默认 5；超出的调用返回 `too_many_tool_calls`，计入协议错误。
- 成功结果必须带最新状态（推送）；`get_state` 提供拉取。
- 结果中不出现距离、参照解、打乱序列或"还差几步"。

### 6.3 错误码

| 错误码 | 含义 | 是否计入协议错误 |
|---|---|---|
| `invalid_face` | face 不在 U/R/F/D/L/B | 是 |
| `invalid_amount` | amount 不在 1/2/3 | 是 |
| `invalid_move` | 批量中有非法记法/宽转/中层转 | 是 |
| `invalid_arguments` | 参数 JSON 解析失败或类型错误 | 是 |
| `unknown_tool` | 调用了不存在的工具 | 是 |
| `too_many_tool_calls` | 单轮调用超过上限 | 是 |
| `budget_exceeded` | 步数/调用/token/时间超限 | 否（运行错误） |
| `provider_error` | provider 返回错误且重试失败 | 否（运行错误） |
| `timeout` | 单轮或整局超时 | 否（运行错误） |
| `cancelled` | 用户取消 | 否（运行错误） |
| `interrupted` | 服务重启导致中断 | 否（运行错误） |

### 6.4 上下文管理

长局不能把每一步的完整状态都留在上下文里。`ContextBuilder` 每轮只组装：

1. system prompt（固定）；
2. 当前完整状态 JSON（最新一份）；
3. 紧凑走法历史（如 `1. R U' F2 | 2. U F'`，只含走法，不含旧状态）；
4. 最近 K 轮（默认 3）工具结果；错误结果优先保留；
5. 最近 K 条 assistant 文本/工具调用（旧消息折叠进走法历史）。

这样单轮上下文大致有界，100 步也不会线性爆炸。`ContextBuilder` 用快照测试固定输出格式。

### 6.5 Prompt

- system prompt 包含：目标、记法说明、状态 JSON 结构、工具使用规则、预算、停止条件、禁止使用外部求解器/猜测、循环时自我纠正的建议。
- 首条 user 消息给出初始状态与预算，不给出打乱序列。
- 提供一个简短的 tool call / tool result 示例，降低协议错误。
- prompt 版本化（`v1`），随 run 保存完整快照。
- 温度：模型支持时默认 0；不支持则记录实际参数。`max_tokens` 按 provider 限制设置，默认 4096。

## 7. 模型接入

### 7.1 Adapter 接口

```python
class ProviderAdapter(Protocol):
    async def probe_tools(self) -> ToolSupport: ...
    async def chat(
        self,
        messages: list[Message],
        tools: list[ToolSpec],
        params: ModelParams,
    ) -> ModelTurn: ...
```

`ModelTurn` 包含：`content`、`tool_calls`、`usage`、`raw`、`finish_reason`。
`ProviderError` 分类：`auth`、`rate_limit`、`server`、`timeout`、`bad_request`、`unsupported_tools`。

### 7.2 OpenAI-compatible

- 通过 `base_url` + `api_key` + `model` 配置；默认走 `/v1/chat/completions`。
- MVP 只支持**原生 tool calling**；`probe_tools()` 在配置时发一次最小 tool 请求验证。
- 不支持 tool calling 的模型直接报 `unsupported_tool_calling`，不进入运行。
- 非流式调用：跨 provider 兼容性最好；前端靠工具事件与轮次状态做实时感。
- 流式推理展示后置；后续可对支持 reasoning 的 provider 单独开启。
- 请求头、key 不进日志；provider 原始响应写入 `artifacts`，用于审计与复现。

### 7.3 重试与限速

- 429/5xx/超时：指数退避 1s、2s、4s，最多 3 次；仍失败记 `provider_error`。
- auth/bad_request：不重试，直接失败并提示配置问题。
- 同一 provider 运行内串行或按配置并发（默认演示 1、批量 3）；并发时做简单令牌桶限速。
- 单轮超时默认 120s；整局超时按第 3.4 节预算。

## 8. 评测与数据

### 8.1 Episode 状态机

```
pending → running → solved
                  → stopped_unsolved
                  → budget_exceeded
                  → timeout
                  → protocol_error
                  → provider_error
                  → cancelled
                  → interrupted
```

- 解出：每次工具应用后检查内部状态；解出立即结束，不再接受后续调用。
- 模型停手（无 tool call 的最终文本）且未解出：最多 2 次系统提醒继续；仍停手记 `stopped_unsolved`。
- 协议错误达到上限（默认 5 次）→ `protocol_error`。
- 预算/超时/取消/服务重启 → 对应状态，均不算解出。

### 8.2 评分

- 解出：最终内部状态 `solved == true`。
- 效率：`moves_used / reference_length`；`reference_length == 0` 的题不进入效率统计。
- 进度比：见 3.2；每步记录 `reference_length_after`。
- 协议错误、运行错误、循环、重复状态分别计数。
- 成本：provider 返回的 usage；缺失时记 null，不估算。
- 延迟：总墙钟时间与每轮延迟。

### 8.3 聚合与对比

- 按 `cube × reference_length bin` 聚合解出率，给 Wilson 95% CI 与 N。
- 多次 trial：`pass@1`（第一次）与 `pass@k`（任一成功）分列。
- 跨模型对比：仅允许同一 `benchmark_id`；按 `task_id` 配对，计算逐题差异，用 bootstrap 给配对差异的 95% CI。
- 小样本（N < 10/档）在 UI 上显式标注"探索性结果"。
- 不输出跨难度加权的单一总分。

### 8.4 数据模型

```sql
providers(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,
  api_key_ref TEXT NOT NULL,      -- 环境变量名或 keyring 条目名，不存明文
  params_json TEXT NOT NULL,
  created_at TEXT NOT NULL
)

benchmarks(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  kind TEXT NOT NULL,             -- frozen | random
  cube TEXT NOT NULL,             -- 2x2 | 3x3
  config_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  frozen_at TEXT NOT NULL
)

tasks(
  id TEXT PRIMARY KEY,
  benchmark_id TEXT NOT NULL REFERENCES benchmarks(id),
  cube TEXT NOT NULL,
  scramble TEXT NOT NULL,
  scramble_depth INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  reference_length INTEGER NOT NULL,
  reference_kind TEXT NOT NULL,   -- exact | near_optimal
  bin TEXT NOT NULL
)

runs(
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id),
  benchmark_id TEXT NOT NULL REFERENCES benchmarks(id),
  tool_mode TEXT NOT NULL,        -- both | turn_only | batch_only
  prompt_version TEXT NOT NULL,
  params_json TEXT NOT NULL,
  budget_json TEXT NOT NULL,
  status TEXT NOT NULL,
  totals_json TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
)

episodes(
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
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
  started_at TEXT,
  finished_at TEXT
)

steps(
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES episodes(id),
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,             -- model_message | tool_call | tool_result | state
  tool_name TEXT,
  args_json TEXT,
  result_json TEXT,
  state_json TEXT,
  reference_length_after INTEGER,
  created_at TEXT NOT NULL
)

artifacts(
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES episodes(id),
  kind TEXT NOT NULL,             -- raw_response | prompt_snapshot
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
)
```

- SQLite WAL；索引 `episodes(run_id)`、`steps(episode_id, seq)`、`tasks(benchmark_id, bin)`。
- 密钥：通过环境变量或 Windows Credential Manager（`keyring`）提供；DB 只存引用名。前端只显示掩码。
- 原始响应与 prompt 快照落 `artifacts`，便于复现与审计。

### 8.5 基准集版本

- 冻结基准集生成后计算内容哈希，写入 `benchmarks.content_hash`。
- 任何题目变更必须出新版本（`v2`），不得原地修改 `v1`。
- 对比页要求 `benchmark_id` 与 `content_hash` 一致；不一致直接拒绝比较。

### 8.6 API 契约

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/providers` | 新建 provider |
| GET | `/api/providers` | 列表（key 掩码） |
| POST | `/api/providers/{id}/probe` | 测试连接与 tool calling |
| GET | `/api/benchmarks` | 基准集列表 |
| POST | `/api/benchmarks` | 生成/冻结基准集 |
| GET | `/api/benchmarks/{id}` | 题目与版本详情 |
| POST | `/api/runs` | 启动 run |
| GET | `/api/runs` | 运行历史 |
| GET | `/api/runs/{id}` | run 详情与汇总 |
| GET | `/api/runs/{id}/snapshot` | 当前/最近 episode 快照，供断线重连 |
| GET | `/api/runs/{id}/events` | SSE；支持 `Last-Event-ID` |
| POST | `/api/runs/{id}/cancel` | 取消 |
| GET | `/api/episodes/{id}` | 单题详情 |
| GET | `/api/episodes/{id}/steps` | 逐步记录 |
| GET | `/api/runs/{id}/report` | JSON 报告 |
| GET | `/api/runs/{id}/export?format=csv\|md` | 导出 |
| GET | `/api/compare?run_ids=a,b` | 同基准集对比 |

SSE 事件：

- `run.started`、`episode.started`、`model.turn.started`、`model.message`、`tool.call`、`tool.result`、`move.applied`（含新状态）、`episode.finished`、`run.finished`、`run.error`。
- 每个事件带 `id`、`type`、`run_id`、`episode_id`、`ts`、`data`。
- 重连：先 `GET /api/runs/{id}/snapshot` 拿当前状态与最近事件序号，再带 `Last-Event-ID` 续传。

## 9. 前端

### 9.1 页面

| 路由 | 内容 |
|---|---|
| `/providers` | provider 列表、新建/编辑、测试连接、tool calling 探测 |
| `/runs/new` | 题集/尺寸/难度/题数/trial/工具模式/预算；预估成本 |
| `/runs/[id]` | 实时运行与结果（运行中自动切换） |
| `/episodes/[id]` | 单题回放：逐步状态、走法、工具日志、进度曲线 |
| `/compare` | 同一基准集的多 run 对比 |
| `/benchmarks` | 基准集列表、生成、冻结、查看 seed 与参照长度 |

### 9.2 实时运行页

- 3D 魔方居中；走法队列逐帧播放；速度 0.5×/1×/2×/instant；可跳过、暂停、停止。
- 侧栏：模型名、题号、状态、已用步数/剩余预算、计时、tokens、成本；工具调用日志可展开看原始参数与结果。
- 进度曲线：参照解长度随步数变化；解出时标记终点。
- 模型输出文本按轮显示（MVP 非流式）；不展示思维链时显示"思考中"。
- 失败时高亮：首次非法调用、进入循环、预算耗尽、停手未解。
- 并发生 >1 时，实时页显示 run 总进度与"最近活动"的 episode；单题回放从结果页进入。

### 9.3 3D 渲染约定

- `@react-three/fiber` + `@react-three/drei`（OrbitControls）。
- 3x3 用 26 个 cubie、2x2 用 8 个；每个 cubie 六面材质，内侧深色。
- 颜色严格按 5.1 的映射；界面提供面标签（U/F/R）与配色图例。
- 动画与 runner 解耦：runner 推事件，渲染队列消费；UI 卡顿不阻塞评测。
- 断线重连：先拉 `run.snapshot`，再从 `Last-Event-ID` 续传；丢失的事件从 `steps` 重建。

### 9.4 结果与对比

- 结果页：逐题卡片（解出/未解出、步数、效率、成本、失败码）、按难度曲线、失败分类饼图、导出 JSON/CSV/Markdown。
- 对比页：同基准集多 run 的解出率-距离曲线、配对差异、成本/延迟对比；小样本标注。
- 单题回放可分享本地链接（仅本机可访问）。

## 10. 错误处理与安全

- **密钥**：不落库、不下发前端、不写日志；默认只绑 `127.0.0.1`；CORS 只允许本地前端源。
- **预算**：步数、工具调用、tokens、墙钟时间四重上限；运行级 USD 上限；UI 显示剩余额度。
- **provider 错误**：分类映射，重试策略见 7.3；provider 错误不计入模型能力。
- **协议错误**：返回给模型可纠正的错误信息；达到上限终止；单独统计。
- **服务重启**：启动时把 `running` 的 episode 标为 `interrupted`，不静默续跑；用户可重跑。
- **取消**：取消标志 + 中断在途 HTTP 请求；已完成的步骤保留。
- **并发**：同一 run 内按配置串行/并发；跨 run 不并发，避免成本与限速混乱。
- **工具安全**：只执行白名单工具；无 shell、无文件、无网络工具；参数严格校验。
- **日志**：结构化日志；请求头与 key 脱敏；原始响应只落本地 artifacts。

## 11. 测试策略

遵循 TDD；每个模块先写失败测试再实现。

**后端**
- `cube-core`：面转阶数为 4、逆操作、随机序列往返、解出判定、cubie/facelet JSON 往返、非法输入。
- `reference-solver`：2x2 距离表对已知状态与最大距离 11；3x3 返回解应用后必须解出；参照长度一致；缓存缺失时 fail fast。
- `task-generator`：同 seed 可复现、无重复、分箱与 `reference_length` 一致、冻结哈希稳定。
- `provider-adapter`：录制的 tool call、畸形 JSON、429、超时、auth 错误 fixture；CI 不走真网。
- `episode-runner`：脚本化假 provider 覆盖 1 步解出、循环、畸形参数、超预算、超时、取消、停手提醒；验证状态机与事件顺序。
- `evaluator`：给定步骤序列的评分黄金样例；Wilson CI 与配对 bootstrap 的数值测试。
- `api`：REST 契约、SSE 事件顺序、`Last-Event-ID` 重放、取消。
- 集成：假 provider 跑完整 run，检查 DB、SSE、报告一致。

**前端**
- Vitest + React Testing Library：配置表单、结果卡片、错误态。
- Playwright E2E：配置假 provider → 启动 run → 看到 3D 动画 → 结果页 → 导出。
- 3D 渲染的快照/视觉检查不作为硬门禁，但要有"状态到颜色"的单元测试。

**真模型 smoke（可选）**
- 环境变量开关；只跑 2x2 一步题；记录成本；不进 CI。

**MVP 验收**
1. 配置 OpenAI-compatible provider 并成功探测 tool calling。
2. 冻结一个 2x2 基准集（1/2/3/5/10 档）。
3. 假 provider 解出 2x2 一步题；前端动画正确；结果页显示解出。
4. 真模型跑通 2x2 一步题，记录 tokens/成本/耗时。
5. 3x3 运行能算出参照长度、执行预算、正确结束。
6. SSE 断线重连与取消可用。
7. 导出 JSON/CSV/Markdown。
8. 后端 pytest、前端 Vitest、Playwright 全绿。

## 12. 风险与对策

| 风险 | 对策 |
|---|---|
| 完整 3x3 对多数模型为 0 分（地板效应） | 2x2 + 浅档先拿非零信号；完整 3x3 只作最高档；主图用解出率-距离曲线 |
| Kociemba / 2x2 距离表构建慢、占盘 | 一次性构建脚本 + 缓存 + 启动健康检查；缺失时明确报错；2x2 可先用浅档部分表验证链路 |
| provider 工具调用行为不一致 | 契约测试 + 配置时能力探测 + 协议错误单列 |
| 成本失控 | 四重预算 + 运行级 USD 上限 + 启动前预估 + 可取消 |
| 密钥泄露 | 环境变量/keyring、掩码、日志脱敏、默认本地绑定 |
| 非确定性 | 温度 0（支持时）、记录模型版本/日期、多次 trial、固定基准集 |
| "最优"口径被夸大 | 2x2 精确、3x3 近优明确标注；不造单一总分 |
| 求解器许可证冲突 | M0 核对许可；必要时子进程隔离或换实现 |
| 长局上下文爆炸 | ContextBuilder 只保留最新状态 + 走法历史 + 最近 K 轮 |
| 动画积压/UI 卡顿 | 事件队列、调速/跳过、runner 与渲染解耦 |
| 服务重启丢运行 | 标 `interrupted`，保留已落库步骤，不静默续跑 |
| 小样本过度解读 | Wilson CI + N + "探索性"标注；对比要求同基准集 |

## 13. MVP 里程碑

- **M0（地基）**：`cube-core`、2x2 距离表、3x3 Kociemba 封装、许可证核对、单测与属性测试。
- **M1（可评测）**：任务生成、基准集 v1 冻结、评分器、CLI runner（假 provider）、报告 JSON。
- **M2（接真模型）**：FastAPI + SQLite + SSE + OpenAI-compatible adapter；真模型跑通 2x2/3x3；预算与错误分类。
- **M3（可演示）**：React/three.js 实时回放、Provider 配置、运行配置、结果页；Playwright E2E。
- **M4（可对比）**：对比页、配对差异、导出、UI 打磨。
- **后置**：多模态（两张对角视图 + 状态重建评分）、原生 Anthropic/Gemini、文本协议回退、视频导出、公网/多用户。

## 14. 开工前置

本机由 `D:\Company` 治理，实质性开发前必须补 Project Onboarding：

1. 读 `D:\Company\ONBOARDING.md` 与 `docs\ONBOARDING-WORKFLOW.md` 的项目级阶段。
2. 核对 `state\capability-map.yaml`：Python/`uv`、Node/包管理器、浏览器/Playwright、磁盘空间（求解器表约 80MB+）。
3. Project 级能自决的直接解决；Company/User 级缺口登记 `requests\REQ-*.md`。
4. 写项目根 `PROJECT-PASSPORT.md`：依赖、启动命令、端口、数据目录、求解器表构建方式。
5. 再进入 M0。

## 15. 后续决策（已明确后置）

- **多模态输入**：两张对角 3D 视图（覆盖 6 面）还是一条六面展开图，届时再定；需要新增"状态重建准确率"评分，并与执行分数分开。
- **文本协议回退**：无原生 tool calling 的模型是否允许用 JSON 文本协议；若允许，单独统计，不与原生 tool calling 混比。
- **求解器辅助模式**：允许模型调用求解器工具，测的是工具编排而非魔方推理；必须单独标注。
- **公开榜单**：需要账号、防作弊、提交沙箱、配额与公开题集，另立 spec。
- **3x3 精确最优**：浅局面用 IDA* + 模式数据库；深局面仍用近优参照。
- **视频导出**：基于回放事件生成 GIF/MP4，作为内容化能力，另立 spec。
