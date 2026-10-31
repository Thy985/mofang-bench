# U4 信息密度 设计 spec

日期：2026-10-31。承接 U1（视觉底座）/ U2（Run 观测）/ U3（操作流反馈），批次 U4
做三件事：Runs 列表的信息密度（筛选/排序/对比入口）、报告可视化、跨 run 对比页。
**后端零改动**；**零新增依赖**（图表手写 SVG，U1 既定）。

## 现状盘点（2026-10-31，main @ 44dd1c6）

- `GET /api/runs`（src/mofang/api/routes/runs.py:62）无任何查询参数，前端拿到全部
  run 本地拼表；[RunsPage.tsx](../../../frontend/src/pages/RunsPage.tsx) 是 6 列纯
  表格，零筛选/排序/多选。
- `GET /api/compare?run_ids=a,b`（routes/compare.py:10 → eval/compare.py）**已存在
  且前端从未消费**：恰好 2 个 run、要求 benchmark id 与 content_hash 一致，返回
  `{benchmark_id, content_hash, tasks, runs, solve_rate_first, solve_rate_second,
  solve_rate_diff, ci95: [low, high], pairs: [{task_id, first_solved,
  second_solved, delta}]}`。pairs 只覆盖两 run episode 的 task_id 交集，
  delta = second − first（solved 计 1）。
- report 的 `by_bin: Record<string, BinStats>`（BinStats = `{total, solved,
  solve_rate, ci95: [number, number], mean_moves}`）在 ResultView 只是纯表格；
  逐题表（report.episodes，Episode 含 `tokens_in/tokens_out/latency_ms`）未渲染
  tokens 与耗时列。
- U3 已落地：EmptyState/PageSkeleton/Toast/字段级校验/恒定 wrapper 原语。

## 决策记录（三条，用户编号选项确认）

1. **Runs 筛选 = 方案一，纯客户端**：`/api/runs` 不加查询参数；provider/benchmark/
   状态三筛 + 两列可排序在浏览器内完成。自用规模（几十上百 run）足够；不为
   假想的数据量提前做后端分页。
2. **报告可视化 = 方案一**：by_bin 画条形图（solve_rate + CI95 须线）替代纯表格；
   逐题表补 tokens（in+out 合计）与耗时（latency_ms → 秒）两列。不做跨 run
   趋势图（需新聚合端点，超出本批次）。
3. **对比入口 = 方案一**：Runs 页勾选恰 2 个 run → `/compare?runs=a,b` 新路由
   消费 `/api/compare`。后端已限定恰好 2 个，UI 不做更多；对比不做导出。

## 约束

- 后端与 API client 之外的文件零改动；`client.ts` 仅**追加** `api.compare`。
- 图表手写 SVG；动效若加必须尊重 `prefers-reduced-motion`（MotionConfig 全局已
  处理 motion 库动画；SVG/CSS 手写动画需自查）。
- 原语（ui/ 目录）零改动——U3 的恒定 wrapper 豁免不外溢。
- 语义色沿用现有 token/豁免清单（StatusBadge/Toast/表单错误/logo）；条形图用
  `bg-accent` 同源的 accent token，失败/降序指示不引入新语义色。
- 测试基线：276 用例全绿；每任务独立可验证；最终四连
  `typecheck && test:run && build && e2e`。

## §1 Runs 页改造（frontend/src/pages/RunsPage.tsx）

### 筛选栏

- 三个 Select（复用 ui/Select 原语）：provider（选项 = providers 数据）、
  benchmark（选项 = benchmarks 数据）、状态（选项 = 数据中实际出现的
  status 值集合，含全部）。默认「全部」用空串哨兵，不占选项位。
- 筛选状态进 URL search params：`?provider=…&benchmark=…&status=…`
  （useSearchParams）。刷新/分享保留；修改任一筛选项即 replace 导航。
- 任一筛选激活时显示「清除筛选」按钮（清三个参数）； Runs 数据为空或全部
  被筛掉时分别处理：
  - 数据本来就空 → 沿用 U3 EmptyState（还没有运行记录 + 去创建 Run）。
  - 有数据但筛完为空 → EmptyState 变体「无匹配 run」+「清除筛选」动作按钮。

### 排序

- 可排序列：创建时间、解出率。Th 内按钮式表头（无障碍：`aria-sort`），点击在
  升/降间切换；默认创建时间降序（= 现状后端顺序）。排序键也写 URL
  （`?sort=solve_rate&order=asc`），不激活时不写参数。
- 其余列（run/provider/benchmark/状态）不排序。

### 多选对比入口

- 表头首列 + 每行 checkbox（原生 input，aria-label 用 run shortId）。
- 头部（RunsHeader 右侧）显示「已选 n/2」与「对比」按钮：恰好 2 个可点，
  否则 disabled（aria-disabled 语义照 ui/Button 现状）；点击导航
  `/compare?runs=<id1>,<id2>`。
- 选中状态 = `Set<string>`（React state，不进 URL）；筛选只影响可见行，
  选中集合跨筛选保留。

### 数据流

- RunsPage 现有 `RunsView` 三数据源（runs/providers/benchmarks）不变；
  筛选/排序/选中全部是派生状态（useMemo 链），不新增 query。
- 页面级 pending/error 分支沿用 U3 的 PageSkeleton/Alert，不动。

## §2 报告可视化（ResultView + BinChart）

### BinChart（新文件 frontend/src/components/BinChart.tsx）

- 输入：`{ byBin: Record<string, BinStats> }`。渲染为纵向排列的横向条形图：
  每箱一行 = 标签（`箱 · solved/total`）+ 条（宽 = solve_rate×100%）+
  CI95 须线（以条形同尺度定位，区间两端短竖线 + 连线）。
- SVG 实现（viewBox 固定宽度，条区自适应）；顺序按 bin 名排序（现表格顺序，
  即 bin_for_length 生成序）。
- 无动画（信息密度优先，避免动效噪音）；复用 ProgressChart 的 SVG 先例与
  text-dim/accent token。
- **替代** ResultView 现有 by_bin 纯表格（数字进标签行，无信息丢失）。

### 逐题表加两列

- tokens：`tokens_in + tokens_out`（任一为 null 时按 null 处理，显示「—」）。
- 耗时：`latency_ms / 1000` 保留一位小数 +「s」（null 显示「—」）。
- 列插在「效率」之后、「失败」之前；表头文案 tokens / 耗时。

### 不动项

4 个 Stat 卡、失败码分布行、导出链接、RunPage live 面板全部不动。

## §3 Compare 页（frontend/src/pages/ComparePage.tsx + 路由）

### 数据层

- `types.ts` 追加 `ComparePair` / `CompareResult` 类型（与后端返回逐字段一致）。
- `client.ts` 追加 `api.compare(runIds: [string, string])` → GET
  `/api/compare?run_ids=a,b`；`queries.ts` 追加 `useCompare(runIds)`（key 含
  两个 id；id 非两个时不发请求直接返回 null/error）。
- Run 元信息（provider/benchmark 展示名）从 `useRuns` 列表现有数据派生，与
  RunsPage 同法；不新增 per-run 请求。

### 页面结构（自上而下）

1. 标题「Run 对比」+ 返回 Runs 链接。
2. 两列 run 卡片：shortId（链接到 run 详情）/ provider 名 / benchmark 名 /
   解出率 + CI95（取各自 run.totals；totals 为 null 显示「—」）。
3. 差值卡：`solve_rate_diff` 大数字（AnimatedNumber 复用）+ bootstrap CI95
   区间文案 +「共同题数 n」。
4. 逐题 pairs 表：task / run1（✓/✗）/ run2（✓/✗）/ delta；按 |delta| 降序、
   再按 task_id 排；解出状态不同的行加 `bg-surface-2` 高亮。pairs 为交集，
   表头上注明「仅统计两 run 共同题」。

### 错误与边界

- URL 参数解析：`runs` 参数拆分后非恰 2 个非空 id → 不发请求，直接 Alert
  「链接不完整，需要恰好两个 run id」+ 返回链接。
- 后端 400（benchmark 不一致/hash 不匹配）/ 404（run 不存在）→
  describeError Alert + 返回链接（沿用 U3 页面级失败 = Alert 的分层）。
- 路由注册进 App.tsx 现有 lazy 路由组。

## §4 测试与验收

- **RunsPage.test**：筛选单选/组合/清除；排序切换与默认序；勾选计数与按钮
  enable 边界（0/1/2/3）；URL 参数写入与回读；无匹配空态。
- **BinChart.test**：行数 = bin 数；标签含 solved/total；CI 须线元素存在；
  空 byBin 渲染空态提示。
- **ResultView.test**（或并入现有）：tokens/耗时两列取值与 null 兜底。
- **ComparePage.test**（mock fetch）：成功渲染差值与 pairs、不同行高亮；
  400/404 错误路径；非法 runs 参数不发请求。
- **E2E（workbench.spec.ts）**：现有流程追加 Runs 筛选断言（选状态筛后行数
  变化）；compare 页需两个 run，由单测覆盖、不进 E2E。
- **顺手项**：BenchmarksPage.test.tsx:100 过时测试名（「jsdom 净化为空」→
  与实测一致的新名）。
- 收尾：README U4 段落；四连验证全绿。

## 验收口径

1. Runs 页可在不离开页面的情况下按 provider/benchmark/状态找到目标 run 并按
   时间/解出率排序，筛选状态刷新后仍在。
2. Runs 页勾选任意两个同 benchmark run 可进入对比页，看到差值 + CI + 逐题
   delta，解出不同的题一眼可辨。
3. ResultView 的深度分箱以图形呈现（条 + CI 须线），逐题表能看出每题的
   token 消耗与耗时。
4. 后端与既有测试零改动；276+ 新增用例全绿；四连全绿。
