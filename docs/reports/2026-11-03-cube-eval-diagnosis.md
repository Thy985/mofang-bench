# 魔方评测链只读诊断报告

- 日期：2026-11-03
- 范围：`src/mofang/runner`、`cube`、`eval`、`models`、`api`、`frontend` 关键默认值、`docs/superpowers/specs`、`data/mofang.db`
- 方式：只读。未修改代码、未提交、未启动真实网关长跑。

## 0. 一句话结论

**不是"模型不会解魔方"，而是评测链在模型真正开始解题前就把局判死了：22/37 局毁于网关/120s 单轮超时，剩余失败局主要死于"累计 3 次纯思考 turn 即终止"；同时推理模型的 thinking 占满单轮 16384 completion token，且思考内容不回灌上下文，导致模型每轮从零重推、几乎不产生有效走法。** "不给打乱序列、不给求解器"是项目的既定设计，也是与外部平台最大的结构性难度差。

---

## 1. 观测基线（`data/mofang.db`，混合了多个 provider 的调试局，仅作方向性证据）

| 状态 | 局数 | 平均走法 | 平均 tokens(in+out) | 平均耗时 |
|---|---:|---:|---:|---:|
| `solved` | 6 | 1.5 | 21,845 | 125s |
| `stopped_unsolved` | 8 | 4.4 | 57,828 | 297s |
| `timeout` | 6 | 0.2 | 3,497 | 167s |
| `provider_error` | 16 | 1.1 | 4,176 | 28s |
| `cancelled` | 1 | 0 | 0 | 36s |

关键轨迹：

- **6 个 solved 全是 2x2 depth=1**。其中最好的一局也用了 **3 步、38,822 completion tokens、221s** 才解出；另有 1 步局用了 19,561 tokens / 183s。说明即便"最优 1 步"，模型也要付出接近分钟级的推理成本。
- `3x3-3-3`（打乱 3 步、two-phase 参照长度 8）：**只走了 1 步、54,991 completion tokens、319s，最后 `stopped_unsolved`**。它的 3 次纯思考 turn 中间还夹着一次成功的 `turn`，仍然被累计计数判死。
- `2x2-5-1/5-2`：6–13 步、75k–85k completion tokens、454–477s，`progress_ratio=0`，`stopped_unsolved`。
- `timeout` 中多局 latency 精确为 120,000–120,358ms，`moves_used=0`、`tokens_in/out=0`：**网关 120s 内连一个 token/usage 都没返回**。
- `provider_error` 16 局里：429（含"reset after 8s/10s"）9 局、模型名不被支持 3 局、`No active credentials` 2 局、`Model is unavailable` 3 局、连接失败 1 局。**这部分是配置/账号/网关问题，不是模型能力问题。**

复现查询：

```sql
select status, count(*) n, avg(moves_used) mv, avg(tokens_in+tokens_out) tk
from episodes group by status;
select task_id,status,moves_used,reference_length,tokens_out,latency_ms,error
from episodes order by rowid desc;
-- steps 里 result 字段含 content/thinking/tool_calls
select seq,kind,tool_name,args_json,result_json from steps where episode_id=? order by seq;
```

---

## 2. 逐项审视（对应你列的 8 点）

### 2.1 system prompt / instruction

位置：`src/mofang/runner/context.py:17-45`（正文）、`:48-57`（task message）、`:60-67`（require_plan 追加段）。全文见附录 A。

事实与影响：

- 有任务目标、状态格式、记法、工具用法、预算提醒；**没有任何解题策略提示**（层先法/CFOP/逆打乱）。
- 明确写"**不要使用外部求解器或凭记忆猜测**"（`:20`）。这句会被模型理解为"不要调用已知公式/算法"，迫使它每轮从第一性原理重推——这是 42k–54k 字符级 thinking 的直接诱因之一。
- 初始状态**不在首条 user 消息里**，而是每轮以"当前局面（JSON）"追加（`:94-101`）；首条 task message 只说"用不超过 N 步还原"，**不含打乱序列**。
- `require_plan=true` 时追加"必须先提交计划、每阶段重新规划"，且前端 New Run 默认开启（`frontend/src/pages/NewRunPage.tsx:133`，DB 中实际 run 也多为 `v2-plan/require_plan=1`）。对 depth=1 的 2x2 也强制先规划，纯属额外回合。
- 工具 schema 是英文、prompt 是中文，术语需要模型自行对齐（摩擦，但非致命）。

### 2.2 工具定义

位置：`src/mofang/runner/tools.py:50-121`（TOOLS/PLAN_TOOL）、`:176-209`（turn/apply_moves）、`:251-295`（返回/错误）。

- 工具：`turn(face, amount)`、`apply_moves(moves)`、`get_state()`、`check_solved()`，计划模式下多一个 `submit_plan`。
- `turn` 的 `face` 是枚举 `U/R/F/D/L/B`，`amount` 是枚举 `1/2/3`；`apply_moves` 的 `moves` 只是 `array<string>`，**没有 enum/pattern**。
- 运行时只接受大写 `URFDLB` + 可选 `2`/`'`；小写、`Rw`、`x/M/E/S`、`R3`、`R2'` 都会被拒（`src/mofang/cube/moves.py:14,25-32`）。弯引号会被归一化。
- 返回是**完整状态**（`state` + `solved` + `moves_used/remaining` + `applied`），错误也带完整状态和 `detail`（`tools.py:265-295`），模型**可以据此自纠**。
- `apply_moves` 是**整批原子**：任一非法或超出剩余步数，整批不生效（`tools.py:200-206`）。一条多余注释就能毁掉最多 30 步的正确计划。
- `tool_mode` 只影响"广告给模型哪些工具"（`episode.py:144-157`），`execute` 并不校验模式（`tools.py:156-174`）——评测口径可被绕过。
- **每轮最多执行 5 个 tool call，但 prompt/tool schema 里完全没写**（`episode.py:121`）。

### 2.3 状态表示

位置：`src/mofang/cube/state.py:64-71`、`context.py:94-101`。

- 形态：嵌套 JSON + 英文颜色名。`{"cube":"2x2","faces":{"U":[["white",...]],...}}`。
- 实测长度：**2x2 = 304 字符，3x3 = 581 字符**（`data/mofang.db: tasks.state_json`）。**不存在状态过大/截断问题**。
- 每 turn 重发最新完整状态；历史只保留最近 6 个 TurnRecord（`context.py:71,88-90`），但状态本身永远是最新的、不截断。
- 真正的问题不是长度，而是**可读性**：模型没有标准 54 字符 facelet 串、没有 net 展开图，也没有打乱序列，只能从嵌套颜色矩阵反推朝向与邻接。DB 里的 thinking 反复出现"parse the state / establish orientation"。

### 2.4 回合与预算

位置：`src/mofang/runner/budget.py:6-13`、`src/mofang/service/factory.py:15-30`、`episode.py:235-263,279-281,390-421`。

默认预算：

| cube | max_moves | max_seconds | max_tool_calls | max_tokens | turn_timeout |
|---|---:|---:|---:|---:|---:|
| 2x2 | 30 | 300s | 50 | 300,000 | 120s |
| 3x3 | 100 | 900s | 150 | 1,000,000 | 120s |

终止路径：

- 墙钟：`max_seconds` 到点 → `TIMEOUT`（`episode.py:240-243`）。
- 单轮：`turn_timeout` 到点 → `TIMEOUT`（`episode.py:260-263`）。
- 步数/tool call：`outcome.budget_exhausted` 或 `moves_used>=max_moves` → `BUDGET_EXCEEDED`（`:393-398`）。
- token：`tokens_in+tokens_out > max_tokens` → `BUDGET_EXCEEDED`（`:279-281`），且在**执行本轮 tool call 之前**就 break。
- 协议错误：`protocol_errors>=5` → `PROTOCOL_ERROR`（`:399-401,410-412`）。
- 纯思考 turn：`nudges += 1; if nudges > 2` → `STOPPED_UNSOLVED`（`:418-421`）。

**关键缺陷：`nudges` 是全局累计，成功走法后不清零。** 也就是说，一局里只要出现 **3 次"没有 tool call"的 turn（不必连续）**，即使中间一直在正确走棋，也会被判死。DB 中 `2x2-5-2` 和 `3x3-3-3` 都是这种"夹着成功 turn 仍被累计计数杀掉"的轨迹。

nudge 文案：`"你还没有解出魔方。请继续调用工具；如果确实无法继续，请明确说明。"`（`:422-425`）。如果同时 `require_plan` 且还没交计划，这句会被计划催促覆盖（`:426-435`），模型可能永远看不到"你还没解出"的提醒。

### 2.5 失败成本

- 非法 move **不消耗步数**，但消耗 1 次 tool call，并计入 `protocol_errors`（`tools.py:157-161,278-295`；`_PROTOCOL_ERRORS` 见 `:123-130`）。
- 错误文案包含 `error` + `detail` + 完整 state + 剩余步数，**可自纠**。
- 但：`apply_moves` 整批原子；5 次协议错误即杀局；每轮第 6 个及以后的 tool call **被静默丢弃且计为协议错误**（`episode.py:310-324,402-403`），模型拿不到被丢弃调用的任何 tool result，可能误以为已执行。
- 步数预算也是"整批判定"：`moves_used + len(moves) > max_moves` 直接 `budget_exhausted`，不会执行能解出的前缀（`tools.py:205-206`）。

### 2.6 token / 上下文 / 流式

- 默认单轮 `max_tokens=16384`（`factory.py:79`）；provider 拒绝时自动降级到 **8192**（`openai_compat.py:14,144-154`）。对 reasoning 模型是"越降越死"。
- thinking 通过 SSE 流式回传（`openai_compat.py:231-314`），但 **`ModelTurn.reasoning` 只写进 step/SSE，不写回 messages**：`assistant = {"role":"assistant","content": turn.content or ""}`（`episode.py:294-297`），`context.py` 里没有任何 reasoning/thinking 处理。
- 后果：上一轮的 42k–54k 字符思考在下一轮**完全不可见**；模型只有"最近 6 轮的空 content + 最新状态 + 完整 move_history"。它每轮都在重新推导，无法把"我已经分析出 R U' F2..."带下去。
- `finish_reason` 被解析（`openai_compat.py:313`）但 **runner 从不检查**。当 thinking 把 16384 用完、finish_reason=length、tool_calls 为空时，runner 把它当成"模型主动不调用工具"，只发 nudge；下一轮重复，3 次后判死。
- 历史轮次会累积：最近 6 个 TurnRecord，每次 tool call 的 result 都含完整状态（304/581 字符），最多约 `6×5×581 ≈ 17KB`，加上当前状态与 move_history；DB 实测 `tokens_in` 3k–10k/turn。**不是爆炸式增长，但 `max_tokens` 是按"每轮输入重复累计"计的**：2x2 30 步 × 10k ≈ 300k，刚好会在终局附近撞上 token 预算。

### 2.7 求解器旁路

- 2x2 距离表与 3x3 two-phase **只被 runner/eval 使用**：`src/mofang/cube/solver.py:16-22,85-89`、`src/mofang/cube/table2x2.py:150-173`、`src/mofang/cube/solver_worker.py:70`。
- 模型可用工具里**没有** `solve` / `distance` / `apply_solution`，也拿不到 `task.scramble`（`context.py:48-57`）。
- 这是**设计使然**：spec 明确"不提供求解器、提示、距离、参照解或打乱序列"（`docs/superpowers/specs/2026-10-26-rubiks-cube-model-bench-design.md:236`）、"首条 user 消息给出初始状态与预算，不给出打乱序列"（`:295`）。
- 反证：CLI 的 fake provider 正是用 `invert_moves(task.scramble)` **一步通关**（`src/mofang/cli.py:19-32`）。捷径在系统内部存在，但评测时对模型关闭。这是"外部平台快、我们慢"最可能的结构性差异。

### 2.8 判分口径与难度预算匹配

- 判分只认**最终态 == solved**，不接受"接近"；`progress_ratio` 只做归因展示（`src/mofang/eval/scorer.py:6-14`）。
- 2x2 距离表是**精确最优**；3x3 的 `distance` 是 **two-phase 解的长度，不是最优**（`solver.py:85-89`；`solver_worker.py:70` 用 `solve(facelets,20,10)`）。DB 实测：打乱 3 步的 3x3，`reference_length` 分别是 **10、10、8**。所以 3x3 的 `progress_ratio`、`efficiency`、难度分箱都可能失真。
- 难度 vs 步数预算：**不匹配的方向是"预算过于宽松"，不是不够**。depth 1–3 的任务给 2x2 30 步 / 3x3 100 步，步数完全够。**真正的瓶颈是墙钟、单轮超时和无 tool call 终止，不是 max_steps。**

---

## 3. 根因清单（按影响权重）

### P0-1｜22/37 局根本没得到一次公平的模型尝试（环境/配置，不是模型能力）

**判定：环境侧 + 调参缺陷。**

- 16 局 `provider_error`：429（"reset after 8s/10s"）9、模型名不支持 3、无凭证 2、上游不可用 3、连接失败 1。
- 6 局 `timeout`：多局 120s 内 `tokens=0`，网关连首 token 都没给。
- 代码侧的放大器：`retry_delay` 默认 **1.0s**，4 次尝试退避 1+2+4=**7s**，而 429 明确写 "reset after 8s/10s"（`src/mofang/service/factory.py:48-62`、`src/mofang/models/openai_compat.py:318-345`）——**重试窗口系统性短于限流窗口**。
- 影响：这部分直接把总解出率压到 16%，且与魔方难度无关。归因代码也把 `provider_error` 计为 run 错误（`src/mofang/eval/attribution.py`），不是"模型不会"。

### P0-2｜累计 3 次纯思考 turn 就 `STOPPED_UNSOLVED`，且计数不复位

**判定：实现缺陷（白送）。**

位置：`src/mofang/runner/episode.py:122,223-224,413-421`。

- `MAX_NUDGES=2`，`nudges` 从不清零；第 3 次无 tool call 的 turn 直接 `STOPPED_UNSOLVED`。
- DB 证据：`3x3-3-3` 的轨迹是 `无tool → turn成功 → 无tool → 无tool`，仍然被杀；`2x2-5-2` 同样是 `无tool → apply成功 → 无tool → apply成功 → 无tool`。**不是"连续发呆 3 次"，而是"整局累计 3 次"**。
- 对 reasoning 模型，"先想一轮、再动手"是正常行为；这条规则把正常的 planning turn 当成失败信号。

### P0-3｜thinking 占满单轮 16384 completion token，runner 不识别 `finish_reason=length`

**判定：实现缺陷。**

位置：`src/mofang/service/factory.py:79`（16384）、`openai_compat.py:14,144-154`（降级 8192）、`openai_compat.py:313`（解析但未使用）、`episode.py:279-297`。

- DB 证据：失败局单轮 thinking 42k–54k 字符（≈10k–14k token），正好逼近 16384；`tokens_out` 合计 54,991–84,730；tool_calls 为空。
- 机制：思考耗尽 completion 预算 → 没空间输出 tool call JSON → `finish_reason=length` → runner 只当作"无 tool call" → nudge → 再耗尽 → 3 次后 P0-2 杀局。
- 若 gateway 再触发 16384 降级到 8192，几乎必死。**这是"模型有能力但发不出动作"的核心机制。**

### P1-4｜墙钟/单轮预算与推理模型的真实延迟不匹配

**判定：预算失配（实现缺陷）。**

位置：`src/mofang/service/factory.py:15-30`、`episode.py:240-243,260-263`、`openai_compat.py:13`（HTTP timeout 120s）。

- 2x2 总共 300s、3x3 900s、单轮 120s；但实测**一个 depth=1 的 2x2 解出都要 221s/38k output**，depth=5 的 2x2 已到 454–477s。
- 3x3 每步都要一次模型往返；一个 8–10 步的 3x3 在 900s 内要完成 8–10 轮 40k+ 字符的思考，平均每轮 <90s——不现实。
- 6 局 `timeout` 的 120s 硬顶就是直接证据；`turn_timeout` 固定 120s，未随模型/网关能力调整。

### P1-5｜thinking 不回灌 + 只保留 6 轮 → 每轮从零重推，解不成连续计划

**判定：实现缺陷（浪费模型能力）。**

位置：`episode.py:294-297`、`context.py:71,76-101`；`context.py` 中不存在 reasoning/thinking 处理。

- 模型上一轮已经推导出的解法（甚至已经想好的下一步）在下一轮完全不可见；assistant content 往往是空字符串。
- 于是每轮重新"解析状态→建立朝向→重新规划"，DB 中正是 42k–54k 字符/轮的重复推导。
- 这不是"模型记不住魔方"，是**框架把它的思考丢掉了**。外部平台若保留 thinking 或允许一次性输出完整解法，差异会非常明显。

### P1-6｜每轮 5 个 tool call 的隐藏上限 + 静默截断 + 溢出计协议错误

**判定：实现缺陷（协议不透明）。**

位置：`episode.py:121,310-324,402-403`。

- prompt 与 tool schema 均未告知"最多 5 个/轮"。
- 第 6 个及以后**不执行、不返回 tool result、却计入 protocol_errors**；模型无法知道自己想执行的最后一步被吞了。
- 一回合发 10 个 call 就会瞬间累计 5 个协议错误 → `PROTOCOL_ERROR` 杀局。
- 与 spec 也不一致：spec 要求返回 `too_many_tool_calls` 结果，实现是静默截断。

### P1-7｜"无打乱序列、无求解器、无策略提示、嵌套颜色 JSON"——设计使然，但这是与外部平台最大的难度差

**判定：设计使然（应按此解释，而不是当 bug 修）。**

位置：`context.py:17-45,48-57`；spec `:236,:295`；`solver.py:16-22`；`cli.py:19-32`。

- 模型必须从 24/54 个颜色贴纸反推解法；系统内部的 2x2 精确表、3x3 two-phase、`task.scramble` 全部对模型关闭。
- 如果外部平台把打乱序列/求解器/一次性完整解法暴露给模型，模型只需逆序或调用；本平台按设计全部不给。**这是"同一个模型，别处快、这里慢"的结构性原因。**
- 注意：这不是"实现缺陷"，不应通过给模型开 solver 来"修复"，否则评测目标就变了。

### P2-8｜协议错误 5 次即杀局；批量原子失败；严格大写

**判定：实现缺陷（偏严，但当前 DB 中 `protocol_errors=0`，不是这些局的主因）。**

位置：`tools.py:123-130,190-209`；`episode.py:120,399-401`。

- 一次 `apply_moves` 里带一条 `R (clockwise)`、小写 `r`、或 `Rw`，整批 30 步全废，并计 1 个协议错误；5 次即结束。
- 对"模型喜欢写注释/小写"的供应商，这是高概率踩雷。当前失败局不是它主导，但一旦换模型就会显著抬高失败率。

### P2-9｜3x3 的 `distance` 非最优，`progress_ratio`/`efficiency`/分箱失真

**判定：度量缺陷。**

位置：`src/mofang/cube/solver.py:85-89`、`solver_worker.py:70`、`scorer.py:6-14`、`tasks/generator.py`。

- DB 实测 3x3 depth=3 的 `reference_length` = 10/10/8，而真实最优 ≤3。two-phase 解长度既不最优也不单调，`progress_ratio` 可能"走了正确步却显示 0 进度"。
- 这会让归因把"度量不降"误判为"模型没进展/预算太紧"，也会让 `efficiency` 与难度分箱失真。**不影响 solved 判定（最终态精确），但影响诊断与难度统计。**

### P2-10｜其它次要缺陷/摩擦

- `require_plan` 前端默认开启（`NewRunPage.tsx:133`），对 depth=1 也强制先交计划；计划催促还会覆盖"你还没解出"的 nudge（`episode.py:426-435`）。
- `get_state` 是冗余调用（状态本就每轮重发，`tools.py:251-252`），但仍消耗 `max_tool_calls`（2x2 只有 50 次，30 步走法只剩 20 次余量）。
- `tool_mode` 只影响广告、不强制（`episode.py:144-157` vs `tools.py:156-174`），评测口径可被模型绕过。
- 非计划 run 记录 `prompt_version=v1`，实际执行的是 v2 基础 prompt（`api/routes/runs.py:74-75`），审计口径不一致。
- `selfcheck` 用求解器解 + 批量 apply 自证链路（`runner/selfcheck.py`），**只能证明工具链自洽，证明不了预算/prompt/状态对人类可解**；它会给出"评测链路正常"的假安心。

---

## 4. "设计使然" vs "实现缺陷" 汇总

| 类别 | 条目 |
|---|---|
| **设计使然（本来就该难）** | 不给打乱序列；不给求解器/距离；无解题策略提示；严格 exact-solved 判分；facelet JSON 状态；depth 1–3 默认题集 |
| **实现缺陷（白白浪费模型能力）** | 累计 3 次纯思考 turn 即杀局且不复位；`finish_reason=length` 不处理；thinking 不回灌；120s/300s/900s 与推理延迟不匹配；隐藏 5 call/轮 + 静默截断；5 次协议错误杀局；批量原子失败；429 退避 7s < 8s reset；3x3 distance 非最优；`get_state` 消耗预算；`tool_mode` 不强制；`prompt_version` 标记错误 |

---

## 5. 已排除的怀疑（不要往这些方向修）

- **几何/记法错误**：`geometry.py` 的轴向与顺时针定义是标准 Singmaster；`selfcheck` 也能用同一引擎解出。没有证据表明"模型看到的 R 不是标准的 R"。
- **状态太大/被截断**：2x2 304 字符、3x3 581 字符，**很小**；每轮完整重发，不截断。
- **工具返回不完整/无法判合法**：每次调用都返回完整状态 + `solved` + `moves_used/remaining`；错误也带完整状态，可自纠。
- **max_steps 太小**：depth 1–3 给 30/100 步，**步数不是瓶颈**。不要先加 max_steps，先解决墙钟与无 tool call 终止。
- **2x2 判分/距离表**：2x2 距离是精确最优，`is_solved` 正确；2x2 的失败不是判分问题。
- **模型完全不会**：它确实解出过 2x2 depth=1（6 局），只是每次要 6k–38k output token、58–221s；能力被预算和终止规则截断。

---

## 6. 建议的最小验证（未执行，均不启动真实网关长跑）

1. 对一局 `stopped_unsolved`，把 `steps` 中每个 `model_message` 的 `thinking` 长度、`tool_calls`、`tokens_out` 拉出来（本报告已做），确认"thinking 饱和 → 无 call → 累计 3 次 → 停"的模式。
2. 若允许改代码，**只加观测**：把 `finish_reason`、每轮 `completion_tokens` 写进 StepRecord；这是判定 P0-3 的决定性证据，当前被丢掉了。
3. 用单题做 A/B（需真实网关，按你的要求未跑）：`max_tokens=32768` + `turn_timeout=300` + `MAX_NUDGES=10` + `require_plan=false`，与现状对比。若单题从 `stopped_unsolved` 变为 solved，即证明 P0-2/P0-3 是主因。
4. 轻量自检：`uv run pytest -m "not slow"` 只验证工具链，不验证 prompt/预算；不要用它替代上面的单题 A/B。

---

## 附录 A：system prompt / task prompt 全文

`src/mofang/runner/context.py:17-45`（`require_plan=false` 的基础版，`true` 时追加 `:37-44` 的计划段）：

```text
你是被评测的魔方操作者。目标是把魔方还原到六面同色。你只能通过工具操作魔方，
不能直接修改状态，也不要使用外部求解器或凭记忆猜测。

状态格式：工具返回 JSON，形如 {"cube":"2x2","faces":{"U":[[...]],...}}。
faces 的键为 U R F D L B；每个面是矩阵，行从上到下、列从左到右（从该面外侧看）；
颜色为 white/yellow/green/blue/red/orange。

记法：U/R/F/D/L/B 表示该面顺时针 90°（从该面外侧看），后缀 ' 表示逆时针 90°，
2 表示 180°。

工具：
- turn(face, amount)：转一层，amount=1/2/3 对应顺时针 90°/180°/逆时针 90°。
- apply_moves(moves)：原子执行一串走法，任一非法则整批不生效；单次最多 30 步。
- get_state()：读取当前局面、已用步数与剩余预算。
- check_solved()：检查是否已还原。
每次工具调用都会返回最新状态；以工具结果为准，不要凭记忆推断。
调用示例：turn {"face":"R","amount":3} 等价于 R'。

预算：步数与工具调用次数有限，超限会立即结束本局。已还原时停止调用工具。
如果局面反复回到同一状态，说明当前策略无效，应改用不同思路。
```

`require_plan=true` 追加（`:37-44`）：

```text
本局要求先规划再执行：在第一次转动之前，必须先调用 submit_plan 提交目标与分阶段计划。
计划至少包含 goal 与 phases；之后按阶段推进，阶段变化时用 submit_plan 更新。
计划本身不消耗步数。
```

`src/mofang/runner/context.py:48-57` task message：

```text
任务：用不超过 {max_moves} 步还原魔方。标准记法：U/R/F/D/L/B，后缀 ' 表示逆时针 90°，
2 表示 180°。只使用工具；不要输出无法执行的计划。
（require_plan=true 时追加：请先提交计划，再开始转动。）
```

## 附录 B：工具运行时约束

- `turn`：`face ∈ {U,R,F,D,L,B}`，`amount ∈ {1,2,3}`；非法 → `invalid_face/invalid_amount`（协议错误）。
- `apply_moves`：字符串数组，最多 30 条；只接受大写面 + 可选 `2`/`'`；整批原子；超剩余步数 → `budget_exceeded`（直接结束局）。
- `get_state`：返回完整状态；**状态本来就每轮重发**。
- `check_solved`：只返回 solved + moves_used/remaining。
- `submit_plan`：最多 4 次提交；超限只返回普通错误，不杀局。
- 每轮只执行前 5 个 call；溢出静默丢弃并计协议错误。

## 附录 C：DB 证据摘要

- 状态分布：6 solved / 8 stopped / 6 timeout / 16 provider_error / 1 cancelled（共 37）。
- 6 个 solved 全是 `simple-2x2-42:2x2-1-*`；最好局 3 步 / 38,822 out / 221s；最快局 1 步 / 6,248 out / 65s。
- `3x3-3-3`：1 步 / 54,991 out / 319s / stopped；轨迹中 3 次无 tool call 中间夹着成功 `turn`。
- `2x2-5-1`：6 步 / 75,392 out / 454s / stopped / progress 0。
- `2x2-5-2`：13 步 / 84,730 out / 477s / stopped / progress 0。
- timeout：120,000–120,358ms，多局 moves=0、tokens=0。
- 3x3 depth=3 的 `reference_length`：10 / 10 / 8。
