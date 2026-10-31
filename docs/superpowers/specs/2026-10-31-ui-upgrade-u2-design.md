# UI 升级批次 U2：Run 观测体验 — 设计

父 spec：`docs/superpowers/specs/2026-10-31-ui-upgrade-design.md`（批次 U2 方向级条目在此细化）。
U1 视觉底座已合并 main（50e4dd8）：token、原语（Stat/Card/Button/Select/Toast）、motion、
MotionConfig reducedMotion="user" 全局挂载——本批全部消费这些地基。

## 决策记录（2026-10-31 用户确认）

| 决策点 | 选择 |
|---|---|
| 回放"播放"语义 | 连播：播完当前步自动进下一步继续，空格/暂停可停 |
| 3D 待机自转范围 | 仅 Run live 页 |
| thinking 面板位置 | 留在右侧 aside 内（max-h 内部滚动） |

## 约束（继承父 spec）

- 纯前端；SSE 事件契约、后端 API 不动；stepper 从现有 live 状态推导。
- 不引新运行时依赖（motion 之外）；动效尊重 `prefers-reduced-motion`。
- CubeView 动画内核（queue/current/snapTo/重绘机制）不动，只加可选交互层。
- ToolLog `slice(-80)` 裁剪不动；不做虚拟化。
- 现有前端测试全绿是硬门槛；新增能力全部可选 props / 新组件，向后兼容。

## 1. Live 面板重组（RunPage `RunLivePanel`）

### Stat 卡组 + 数字滚动

- 8 个本地 `Stat` 换成 U1 的 `ui/Stat` 原语（label + font-mono value），装进 `Card`，
  2×4 网格。
- 新增 `frontend/src/ui/AnimatedNumber.tsx`：motion `useSpring` 驱动的数字滚动组件，
  值变化时向新值过渡；reduced-motion 下（MotionConfig 全局兜底）直跳终值。
  仅用于会连续变化的三个值：进度 `x/y`、步数 `moves/max`、tokens。
  provider/题集/参照长度/计时等静态值不滚。

### 阶段 stepper

- 新组件 `frontend/src/components/PhaseStepper.tsx`：四态
  `排队 → 思考 → 工具 → 完成`。
- 推导逻辑为 `liveReducer.ts` 导出的纯函数
  `derivePhase(live: LiveState): 'queued' | 'thinking' | 'tooling' | 'done'`：
  - `!live.currentEpisode` → `queued`
  - `live.currentEpisode.status !== 'running'` → `done`
  - `live.thinking === true` → `thinking`
  - 日志尾部是 tool 类事件（`tool.call`/`tool.result`）→ `tooling`
  - 其余（模型消息落定、无工具在途）→ `thinking`（等待下一 turn）
- 当前节点 accent 高亮 + 微型旋转指示；已完成节点打勾；节点间连接线，
  活动指示用 `motion.layoutId` 滑动过渡。不依赖新后端事件。

### ThinkingPanel 抽组件

从 `RunLivePanel` 内联结构抽成 `frontend/src/components/ThinkingPanel.tsx`，
滚动逻辑放 `frontend/src/hooks/useFollowScroll.ts`：

- 容器 `max-h-72` 内部滚动。
- 跟随判定：`scrollTop + clientHeight >= scrollHeight - 8` 为跟随中；
  `thinking.delta` 到达且跟随中时自动滚到底。
- 用户上滚即脱离跟随；右下浮出「回到底部」浮标，点击恢复跟随并滚底。
- 复制按钮：`navigator.clipboard.writeText(thinkingText)`，成功后按钮文案短暂
  变为「已复制」（约 1.5s）后复原。
- 折叠状态由组件自持 `useState`：组件跨 turn 不卸载，记忆自然成立；
  turn 切换（`model.message` 清空 thinkingText）不清折叠态。
- 思考结束归档进 ToolLog 的现有行为不变。

### ToolLog 微标

每行左侧加类型微标：`模型`（accent 系）/ `工具`（warning 系）；
带 `thinking` 字段的行追加「含思考」小字标。展开交互与裁剪不动。

### ProgressChart

- 终点数据点加脉冲光环（CSS keyframes；reduced-motion 下静止，由 U1 的 CSS
  `@media` 兜底覆盖）。
- `max_moves` 参照线改虚线（`stroke-dasharray`）并加小字标注。

## 2. 3D 视角控制（CubeView 交互层）

`CubeView` 新增三个可选 props（不传 = 行为与现状完全一致）：

- `viewRequest?: { preset: 'front' | 'top' | 'iso' | 'reset'; token: number }`
  —— token 递增时相机在 `useFrame` 中向预设位置 lerp（约 400ms，ease-out），
  抵达或用户拖动（OrbitControls `start` 事件）即中止 lerp；`reset` 回到按尺寸
  计算的初始机位。视角预设按钮组（正视/顶视/等轴）+ 重置，悬浮于画布右上角
  （半透明底、小按钮），仅作为交互层叠加，不进动画内核。
- `idleSpin?: boolean` —— 待机缓慢自转（仅 Run live 页传 true）：无动画队列、
  无当前动画、用户未拖过时 group 绕 Y 轴缓慢旋转；收到批次或用户拖动后
  本轮静止（reset/换题恢复）。r3f 动画不受 MotionConfig 管辖，组件内用
  `matchMedia('(prefers-reduced-motion: reduce)')` 显式禁用。
- `onBatchComplete?: () => void` —— 动画队列清空时回调一次。这是唯一触碰
  动画内核的点（`finishMove` 收尾处触发），供回放连播推进使用。

## 3. 回放播放器化（EpisodePage）

### usePlayback hook

`frontend/src/hooks/usePlayback.ts`：收纳现有 `selected` / `batch` / `resetToken`
三态，新增：

- `playing: boolean`、`speed: number`（0.5/1/2/100，与 Run 页同规格 Select）
- `play()` / `pause()` / `stepPrev()` / `stepNext()` / `select(index)` /
  `handleBatchComplete()`
- **连播**：`play()` 从当前选中步开始；每步若 `result.applied` 有走法则经
  CubeView `onBatchComplete` 播完动画后自动选中下一步继续；无走法的步
  （纯思考/工具步）瞬间跳过；到末步或 `pause()` 即停。
- 选中步状态吸附沿用 `stateFor` 回退链（选中步无落库局面 → 向前找最近有
  局面的步 → 题初始局面）。

### PlayerBar UI

底部 `Card` 内固定条：上一步 / 播放暂停 / 下一步 + scrubber + 速度 Select +
当前步指示（`#seq kind`）。

- scrubber：`input[type=range]`，范围含「初始局面」位（-1），与步骤 chips
  双向联动；拖动 = 选中 + 吸附该步局面（不播动画）。
- 步骤 chips 保留，点击行为经 `select()` 与播放器状态同步。

### 键盘

`window` keydown 监听（`input/select/textarea` 聚焦时屏蔽）：
`←/→` 步进（吸附不播动画）、空格播放/暂停（`preventDefault` 防页面滚动）。

### 信息卡重排

选中步信息改用 `ui/Stat`（kind、参照长度 mono 展示）+ 现有 details
（参数/思考过程/结果）结构；「播放本步」按钮由播放器承接（选中该步后按
播放，单步播完即停）。

## 4. 测试与验收

- 单测：`derivePhase` 状态矩阵；`useFollowScroll`（跟随/上滚脱离/回到底部恢复）；
  `usePlayback`（连播推进、无走法跳步、暂停、末步停止、scrubber 选择）；
  AnimatedNumber / PhaseStepper / ThinkingPanel / PlayerBar 组件测试。
- E2E：thinking 面板手动上滚暂停跟随 + 回到底部浮标；scrubber 拖动；
  键盘 `←/→` 步进与空格播放暂停。
- `npm run typecheck` / `test:run` / `build` / `e2e` 全绿。
- 顺带修 U1 residual：ResultView 表格容器加 `overflow-auto`，使 sticky 表头生效。
