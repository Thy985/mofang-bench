# UI 升级批次 U3：操作流反馈 — 设计

父 spec：`docs/superpowers/specs/2026-10-31-ui-upgrade-design.md`（批次 U3 方向级条目在此细化）。
U1 视觉底座（50e4dd8）与 U2 Run 观测体验（0a2728c）均已合并 main。本批消费的地基：
Toast 原语（`ui/Toast.tsx`，含 `useToast()`，U1 建成后至今零页面消费）、EmptyState
（`ui/EmptyState.tsx`，同样零消费）、Button `loading` 态、Input/Textarea/Select 的
`label + error` props、`ui/Skeleton` 原语、`lib/errors.ts` 的 `describeError`。

## 现状盘点（2026-10-31 核对）

- 全部 mutation 已是 react-query `useMutation`：ProvidersPage（create/probe/setKey/
  clearKey）、NewRunPage（create）、BenchmarksPage（create）、RunPage（cancel）。
- 提交失败现在走页面内 `formError` state + Alert；`describeError` 已普遍接入文案层。
- `lib/validate.ts` 是通用读取器（`readPositiveInt` 等），不出文案——文案由各页
  自己出的分工不变。
- 四个数据页 loading 态是相同的三行 `Skeleton h-4 w-1/3 / w-full / w-5/6` 重复组合。
- 三列表页空态是裸 `<p className="text-sm text-text-dim">还没有…</p>`。

## 决策记录（2026-10-31 用户确认）

| 决策点 | 选择 |
|---|---|
| 失败反馈通道 | 分层收敛：页面级加载失败保留 Alert；提交类失败走 toast + 字段级错误；`formError` 独立通道删除 |
| 字段级校验时机 | 提交时全显 + 输入即清（不做 blur 即时校验） |
| 接线方式 | 页面直接接线 + 微量共享（toastError helper + PageSkeleton 变体），不加全局抽象 |

## 约束（继承父 spec）

- 纯前端；不引新运行时依赖；SSE 事件契约、后端 API 不动。
- `lib/validate.ts` 逻辑不变；现有中文校验文案原样保留（只是换展示位置）。
- 现有前端测试全绿是硬门槛；formError 相关现有断言逐条过语义改写，不是硬改绿。
- `prefers-reduced-motion` 全局尊重（motion 与 CSS 兜底已在位，本批不新增动效）。
- 原语改动向后兼容（本批预期零原语改动，只消费）。

## 1. Toast 全接入

### 共享 helper

新增 `frontend/src/ui/toastError.ts`：

```ts
import type { ToastApi } from './Toast'
import { describeError } from '../lib/errors'

export function toastError(toast: ToastApi, err: unknown): void {
  toast.error(describeError(err))
}
```

`Toast.tsx` 需导出 `ToastApi` 类型（`export interface ToastApi`），除此之外不动。

### 覆盖清单（成功 / 失败文案）

| 页面 | mutation | 成功 toast | 失败处理 |
|---|---|---|---|
| ProvidersPage | create provider | 「Provider 已创建」 | toastError |
| ProvidersPage | setKey | 「API key 已保存」 | toastError |
| ProvidersPage | clearKey | 「API key 已清除」 | toastError |
| ProvidersPage | probe | **不出成功 toast**（页面内 probe 结果面板即反馈，避免冗余） | toastError；页面内 `describeProbeError` 展示保留 |
| BenchmarksPage | create | 「题集已生成」 | toastError |
| NewRunPage | create | 「Run 已创建」 | toastError |
| RunPage | cancel | 「已取消」 | toastError |

- toast 文案为固定中文短句，成功语义 `success`、失败语义 `error`（Toast 原语
  已有 role/status 与 role/alert 区分，不动）。
- 页面级加载失败（providers / benchmarks / runs 列表的 query error → Alert）不进
  toast，维持现状——toast 4 秒即逝，页面级错误需要常驻可回看。

## 2. 表单字段级校验（Providers / NewRun / Benchmarks 三页）

### 状态结构

每页新增 `fieldErrors: Record<string, string>` state（key = 字段名，value = 页面
现有中文文案）。`handleSubmit` 内现有的逐项检查（如 BenchmarksPage 的
`form.depths.length === 0`）拆为向 `fieldErrors` 写入，校验逻辑与文案不动。
`formError` state 与其 Alert 渲染删除。

### 交互

- 提交时：跑全部字段检查 → 有错则 `setFieldErrors(map)`，然后聚焦并滚动到首个
  错误字段：按页面字段声明顺序取第一个错误 key，
  `document.getElementById(fieldId)?.focus()` +
  `el.scrollIntoView({ block: 'center', behavior: 'smooth' })`（behavior 交给
  CSS `prefers-reduced-motion` 兜底）。
- 输入即清：字段 `onChange` 里 `setFieldErrors` 置空该字段 key（不重跑其他字段）。
- 字段错误经原语展示：Input / Textarea / Select 已支持 `error` prop（红边 +
  下方文案 + `aria-invalid`），直接传 `error={fieldErrors.xxx}`；id 用原语自动
  生成的 id 或显式 id（供聚焦用，显式 id 更稳，页面显式写）。

### 提交按钮

- 提交按钮接 Button 原语 `loading={xxx.isPending}`（react-query 提供）；loading
  时按钮已 `disabled`（Button 原语内建 `disabled={disabled || loading}`）。
- 提交处理函数入口 `if (form is submitting) return` 由 `isPending` 判定，防重复
  提交（现有实现若无此守卫则一并补上）。

## 3. 空态（三列表页）

| 页面 | 现状 | EmptyState 用法 |
|---|---|---|
| RunsPage | 「还没有运行记录。」 | `title="还没有运行记录"` + action = react-router `Link to="/runs/new"` 内嵌 Button（与 RunsPage 现有「New Run」链接写法一致） |
| BenchmarksPage | 「还没有基准集。」 | `title="还没有基准集"` + `hint` 指向下方表单（生成表单就在同页，无按钮） |
| ProvidersPage | 「还没有 provider。可在上方直接保存 API key，或用环境变量名回退。」 | `title="还没有 provider"` + `hint` 保留现文案语义 |

- 三处都保留「加载失败时不叠空态」的现有条件（error 时只留 Alert）。
- icon 位：暂不填充（YAGNI，等有现成内联 SVG 再说）。

## 4. 骨架屏统一

新增 `frontend/src/ui/PageSkeleton.tsx`，内部复用 `ui/Skeleton`，三种预设变体：

- `<PageSkeleton variant="table" rows={4} />`：标题行 + rows 行表格骨架（Runs /
  Benchmarks 列表用）。
- `<PageSkeleton variant="cards" count={2} />`：count 张卡片骨架（Providers 用）。
- `<PageSkeleton variant="form" fields={5} />`：label + 输入条 × fields + 底部
  按钮条（NewRun / 详情页用）。

四个数据页 + BenchmarkDetailPage / EpisodePage 的三行重复组合全部替换为对应
变体；各页 loading 判定逻辑（isPending 条件）不动。变体内部行的宽度节奏（w-1/3
/ w-full / w-5/6 类）在组件内统一实现，页面不再手写。

## 5. 测试与验收

- 单测新增：
  - toast 触发：providers create 成功/失败各一（断言 `data-testid="toast"` 出现
    与文案）；Benchmarks/NewRun/Run cancel 各至少一条失败路径 toastError。
  - 字段校验：提交空表单 → 字段红字全显 + 首错字段聚焦（jsdom 下断言
    `document.activeElement`）；改动字段 → 该字段错误清除。
  - 空态：三页空数据渲染 EmptyState（title 文案断言）；加载失败时不出空态。
  - PageSkeleton：三变体 smoke（rows/count/fields 数量）。
- 现有测试改写：formError/Alert 相关断言逐条按决策 ① 语义迁移（toast + 字段
  错误），不允许纯删断言硬改绿。
- E2E（workbench.spec.ts）：mock 流程中 provider 创建成功 toast 出现一次断言。
- 全量验证：`npm run typecheck && npm run test:run && npm run build && npm run
  e2e` 四连全绿。
