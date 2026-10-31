# mofang 前端体验升级设计（U1–U4）

- 日期：2026-10-31
- 状态：已批准（分节讨论：A/B/C+D 逐节确认）
- 前置：批次 1（全流式 reasoning）已完成并合并 main
- 关联：批次 2（多 trial/pass@k）、批次 3（max_usd 删除等）、M4 对比页

## 决策记录

| 决策点 | 选择 |
|---|---|
| 升级方向 | 视觉档次 + Run 观测 + 操作流 + 信息密度（全选） |
| 视觉基调 | 深色精修（保持深色单主题，token 体系扩容，不引入双主题） |
| 依赖政策 | 允许 1–2 个小依赖；最终引入 `motion`（framer-motion 继任者，约 18KB gzip）一个 |
| 图表 | 继续手写 SVG（扩展 ProgressChart 模式），不引 recharts（约 100KB，不值） |
| 落地节奏 | 底座（U1）先行 + U2/U3/U4 分批，每批独立可验收 |

## 非目标

- 不做浅色主题 / 主题切换。
- 不做路由级页面切换过渡（收益低）。
- 不引入视觉回归截图测试。
- 不引入组件库（Radix 等）——原语手写路线延续。
- 不改任何后端契约与 SSE 事件结构；U2 stepper 从现有 live 状态推导。
- 不做 ToolLog 虚拟化（`slice(-80)` 裁剪足够）。
- Runs 筛选不做 URL 参数同步（数据量小，纯前端过滤）。

## 批次 U1：视觉底座（详设，本 spec 的实施主体）

### Token 扩容（frontend/src/index.css `@theme`）

全部向后兼容，现有类名与语义不变：

- 表面层级：新增 `--color-surface-2`（比 surface 亮半档，卡片容器用）、
  `--color-accent-soft`（accent 低透明度底色，选中态/徽标底）。
- 数据字体：`--font-mono` token；token 数、facelets、JSON、耗时、百分比等
  数据位一律 mono；正文保持系统 sans。
- 动效 token：`--duration-fast: 150ms`、`--duration-med: 250ms`、
  `--ease-standard: cubic-bezier(0.2, 0, 0, 1)`；CSS transition 一律引用 token。
- 圆角与阴影：卡片 `rounded-lg`、控件 `rounded-md`；卡片 = 提亮 1px 边 +
  极淡投影 + 内侧高光线（slate-950 画布上的浮起感）。

### 原语升级（frontend/src/ui，改 6 个、新增 4 个）

- **Button**：`variant`（primary/secondary/ghost/danger/warning）+ `size`
  （sm/md）+ `loading`（内置 Spinner、禁点）+ 全员 `focus-visible` accent ring。
- **Input / Textarea**：`label` / `error` props 附着渲染；error 态红边 + 文案。
  **Select** 同步。
- **Card**：surface-2 + border + rounded-lg 的标准容器。
- **Table**：sticky 表头、行 hover 提亮、数字列右对齐 mono 的约定。
- **新增 Toast**：context + portal，成功/失败两色，4s 自动消失，右下角堆叠；
  mutation 接入在 U3。
- **新增 EmptyState**：图标位 + 主文案 + 动作按钮。
- **新增 PageHeader**：标题 + 副文案 + 右侧 actions + 返回链接。
- **新增 Stat**：label + mono value + 可选 delta。
- **StatusBadge**：仅统一形状（rounded-md、内边距对齐）；色彩维持运行状态
  语义豁免（components/StatusBadge.tsx 内注释已声明 sky/emerald/rose/amber
  不收敛到主题 token），不改色。

### Layout 壳（frontend/src/components/Layout.tsx）

- 顶栏 sticky + 毛玻璃（`bg-surface/80` + backdrop-blur）。
- 当前页 accent 下划线滑动过渡。
- logo 位加 2x2 魔方小色块标识（纯 CSS，不引资源）。
- 内容区 `max-w-7xl` 不变。

### motion 约定

- 列表项进出：fade + y 8px slide，stagger 30ms。
- 面板/details 展开：高度动画（thinking 面板、结果区）。
- 内容区首次挂载 fade（页面切换不做过渡）。
- `prefers-reduced-motion` 全局尊重（motion 内建支持 + CSS 侧 `@media` 兜底）。

### U1 测试与验收

- 新原语单测补齐变体/状态断言（沿用 Testing Library 风格）。
- 原语改动向后兼容：现有 197 个测试全绿，调用点只做机械替换。
- `npm run typecheck` / `test:run` / `build` / `e2e` 全绿。
- 人工验收：全部页面过一遍无裸值颜色/间距（grep 检查 + 目测）。

## 批次 U2：Run 观测体验（方向级，实施前细化）

纯前端；SSE 事件契约不动。

- **Live 面板重组**（RunPage `RunLivePanel`）：
  - 8 个 Stat 改 Stat 卡组（2×4），数字 mono；tokens/进度用 motion 数字滚动。
  - 阶段 stepper：`排队 → 思考 → 工具 → 完成`；从现有 live 状态推导
    （`thinkingText` 非空 = 思考中，收到 `tool.call` = 工具中，
    episode.finished = 完成）；当前节点 accent 高亮 + 旋转指示；不加后端事件。
  - thinking 流式面板：内容跟随自动滚动；用户手动上滚即暂停跟随（滚动位置
    检测），新内容时显示"回到底部"浮标；max-h 内部滚动；复制按钮；折叠状态
    跨 turn 记忆。
  - ToolLog：每行类型微标（模型/工具/思考归档）；展开交互保留；裁剪不动。
  - ProgressChart：终点脉冲点 + max_moves 参照虚线。
- **3D 视角控制**（CubeView 交互层，动画内核不动）：
  - 相机预设按钮组（正视/顶视/等轴）+ 重置视角，位置 lerp 平滑过渡。
  - 待机态缓慢自转（无批次播放时），有批次或用户拖动后静止；
    `prefers-reduced-motion` 禁用。
- **回放播放器化**（EpisodePage）：
  - 底部播放器条：按步 scrubber、上一步/下一步、播放/暂停（复用
    `playBatch`/`resetToken` 机制）、速度选择与 Run 页同规格
    （0.5×/1×/2×/instant）。
  - 键盘：←/→ 步进、空格播放暂停（输入框聚焦时屏蔽）。
  - 步骤 chips 与播放器联动；选中步信息卡用 Stat + details 重排，功能不变。
- 测试：stepper/自动滚动逻辑组件测试；E2E 增加 scrubber 与键盘步进断言；
  thinking 面板"手动上滚暂停跟随"在 E2E 验证。

## 批次 U3：操作流反馈（方向级）

- **Toast 全接入**：provider 创建/存 key/删 key/probe、题集生成、run 创建/
  取消等全部 mutation 成功/失败出 toast；失败文案走 `describeError`；
  probe 的页面内结果展示保留。
- **表单体验**：ProvidersPage / NewRunPage / BenchmarksPage 的校验
  （`validate.ts` 逻辑不变）改字段级红边 + 错误文案，提交时聚焦滚动到首个
  错误字段；提交按钮接 `loading` 态。
- **空态**：Runs / Benchmarks / Providers 三列表页接入 EmptyState（文案 +
  引导动作）。
- **骨架屏统一**：四个数据页 loading 态统一为页面级骨架组合。
- 测试：现有交互断言不受影响（toast 走 portal 追加）；新增 toast 触发与
  表单错误态组件测试。

## 批次 U4：信息密度（方向级）

- **Runs 列表**（RunsPage）：
  - 筛选行：status 多选 chips + provider 下拉，纯前端过滤。
  - 行信息：解出率/tokens/耗时 mono 右对齐；失败行显示 failure_code 徽标。
  - 每行"对比"勾选框 → 底部浮动条"对比所选（≥2）→ 跳 `/compare`"；
    M4 对比页未做前该入口显示引导空态。
- **报告页**（ResultView）：
  - 顶部 stat 卡化（解出率 + CI、均值步数、总 tokens、总时长）。
  - 失败分布：手写 SVG 横条图（按 failure_code 计数排序）。
  - by_bin 表格加解出率 mini bar，表格保留。
  - 逐题表：失败行按 failure_code 着色左边条。
- **Benchmark 详情**：任务列表头部加难度分布 mini 条图（按
  reference_length 计数）。
- 测试：筛选与对比勾选组件测试；SVG 图表做数据断言（条数/比例，不做像素
  断言）。

## 依赖与约束

- 新增运行时依赖仅 `motion` 一个；类型依赖随之。
- 不新增字体文件 / 图标库；图标用少量内联 SVG 或 CSS。
- 全部改动限定 `frontend/`；后端零改动。
- 每批完成标准：typecheck + vitest + build + e2e 全绿 + README/PROJECT-PASSPORT
  相应更新。
