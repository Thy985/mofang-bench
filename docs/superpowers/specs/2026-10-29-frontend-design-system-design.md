# 前端设计系统级打磨 — 设计文档

日期：2026-10-29
状态：待评审
前置：M3 工作台已完成并合并 main（mofang dev + provider key 持久化之后）。

## 1. 背景与目标

前端功能完整（错误横幅、SSE 断线重试、key 状态、169 个测试 + 1 条 E2E），但视觉与工程层粗糙：

- 卡片/输入框/次要文字三类样式纯字符串复制（8 + 15 + 31 处），无主题变量层。
- 14 个 `<button>` 存在 5 种视觉变体，padding 漂移（py-1 / py-1.5）。
- 全站静态 import，three.js 打进主 chunk，bundle 1.27MB。
- M3 spec §7 记账在案的展示欠账：provider `created_at`、benchmark `frozen_at`、逐题表已解出列、探测错误码、3D 面图例。
- 加载态为 9 处纯文字"加载中…"，两种写法不一致。

目标：颜色收敛为语义 token、样式收敛为 ui/ 原语、lazy 路由切包、还清展示欠账。

## 2. 已定决策

| 决策点 | 选择 |
|---|---|
| 组件化方式 | 自建原语（`frontend/src/ui/`）+ Tailwind v4 `@theme` 变量，零新依赖 |
| 主题范围 | 仅暗色（保持 color-scheme: dark） |
| 代码分割 | App.tsx 路由改 `React.lazy`，Run 页（含 three.js）自然切出 |
| 展示欠账 | 一并做进本轮 |
| 非目标 | 明暗切换、视觉回归测试、页面级组合组件抽取、组件库依赖 |

## 3. 主题变量层（index.css）

`src/index.css` 在 `@import "tailwindcss"` 后新增 `@theme` 语义 token，全站 slate/emerald 硬编码收敛：

| Token | 值 | 用途 |
|---|---|---|
| `--color-canvas` | slate-950 | 页面背景（替换 body 硬编码 `#020617`） |
| `--color-surface` | slate-900 | 卡片/面板 |
| `--color-sunken` | slate-950 | 输入框/代码块 |
| `--color-line` | slate-800 | 边框 |
| `--color-accent` | emerald-600 | 主操作/成功 |
| `--color-accent-dim` | emerald-700 | 选中态背景 |
| `--color-danger` | rose-700 | 危险 |
| `--color-warning` | amber-600 | 警示 |
| `--color-text-strong` / `--color-text` / `--color-text-dim` | slate-100 / slate-300 / slate-400 | 三档文字 |

用法：`bg-surface`、`border-line`、`text-dim` 等。间距沿用 Tailwind 默认刻度，不新增 token；padding 漂移由原语组件收敛为单一实现。

## 4. ui/ 原语（frontend/src/ui/）

7 个函数组件，各 20–40 行，无外部依赖，DOM 语义与中文文案不变：

- **Button** — `variant: 'primary' | 'neutral' | 'danger' | 'warning'`，原生 props 透传。覆盖现有 5 种视觉变体（EpisodePage 分段选择按钮保留页内，不上收）。
- **Input / Textarea** — 统一 `bg-sunken` 圆角样式；label 组合留在各页。
- **Card** — surface + border 容器，替换 8 处卡片类串。
- **Alert** — `tone: 'danger' | 'info'`，统一 `role="alert"` 错误横幅（现有 6 处写法微异）。
- **Table** — thead/tbody/tr 样式收敛（边线、hover）。
- **Skeleton / Spinner** — 替换 9 处纯文字加载态：表格页用 Skeleton 行，按钮内用 Spinner。

约束：原语只做样式收敛，不改测试定位所依赖的 label/role/testid；现有 169 个 RTL 测试的断言原则上零改动（新增欠账功能的新测试除外）。

## 5. lazy 路由与代码分割

- App.tsx 全部页面路由改 `React.lazy(() => import(...))`，外层包一个 `<Suspense>`，fallback 用 Spinner 居中。
- Run 页 → CubeView → three.js/@react-three 链路随 lazy chunk 自然切出；providers/benchmarks/runs 等轻页面各自成 chunk。
- vite.config.ts 不加 manualChunks——lazy 已达成目标且更不易碎。
- 预期：首屏 chunk 从 1.27MB 降到 ~300KB 量级（构建后实测记录，不做自动化阈值断言）。
- App.test.tsx 的路由表静态导入注释需同步更新；jsdom 下 lazy 路由正常可测（React 19 + RTL 支持 Suspense）。

## 6. 展示欠账

### 6.1 三列补显（纯前端，字段后端均已返回）

- Providers 卡片：显示 `created_at`（复用 `lib/format` 的日期格式化）。
- Benchmarks 列表/详情：显示 `frozen_at`。
- ResultView 逐题表：新增"已解出"列，episode `status === 'solved'` 显 ✓ 否则 —（与状态列并存）。

### 6.2 探测错误码显形

现状：后端 probe 失败返回 502 `{kind, message}`，`lib/errors.ts` 的 `readableDetail` 只取 message 丢弃 kind。改法：

- 新增导出函数 `describeProbeError(err): { kind: string | null; text: string }`，从 ApiError.detail 解析出 kind 与 message。
- `describeError` 与 `readableDetail` 保持不动（其余 5 处调用点输出逐字不变）。
- ProvidersPage 探测结果区改用 `describeProbeError`：kind 徽标（如 `connection` / `auth` / `timeout`，未识别的 kind 原样显示）+ message。

### 6.3 3D 面图例

- 新组件 `cube/FaceLegend.tsx`：HTML 覆盖层（非 canvas 文字），列出 U/R/F/D/L/B 六面的色块 + 面名，颜色复用 `lib/format` 的 `colorHex`。
- 位置：RunPage 与 EpisodePage 的 CubeView 容器角落，不遮挡 OrbitControls。
- 纯展示组件，可独立 RTL 测试。

## 7. 错误与加载态收口

- 所有列表/详情页加载态换为 Skeleton（Providers、Benchmarks、Runs、Run 结果、Episode）；BenchmarkDetailPage 现在的裸 `<p>加载中…</p>` 一并换。
- 所有错误横幅换为 `Alert tone="danger"`，保持 `role="alert"` 与现有文案。

## 8. 测试与验证策略

- **不动的**：169 个既有测试断言零修改为目标；E2E 两条 spec 不改（lazy 对 Playwright 透明）。
- **新增**：ui/ 原语冒烟测试（Button 变体、Alert tone、Skeleton）；FaceLegend 渲染测试；三列补显断言；探测 kind 徽标测试。
- **验证门禁**：`npm run typecheck`、`npm run test:run`、`npm run build`（记录 chunk 体积）、Playwright E2E、`uv run mofang dev` 手工冒烟一次（确认 lazy 加载与图例可见）。
- 估算改动面：`index.css`、`App.tsx`、5 个 pages、4 个 components、新增 ui/ 7 件 + FaceLegend + 测试。

## 9. 风险

- lazy 改动触及 App.test.tsx 的路由表导入方式——预期小改导入为 lazy 形式，测试逻辑不变。
- `readableDetail`/`describeError` 不动，仅新增 `describeProbeError`；其余 5 处 `describeError` 调用点的输出必须逐字不变（有既有测试兜底）。
- Tailwind v4 `@theme` 语义色与现有类名同值不同名，属纯重命名风险，构建后用 grep 确认无残留 `slate-`/`emerald-` 硬编码（cube 三维模块内的 three.js 材质色除外）。
