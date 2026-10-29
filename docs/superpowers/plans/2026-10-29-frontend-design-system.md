# 前端设计系统级打磨 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 颜色收敛为 @theme 语义 token、样式收敛为 ui/ 原语、lazy 路由切包、还清 M3 展示欠账（三列/探测错误码/3D 面图例）。

**Architecture:** `index.css` 定义 Tailwind v4 `@theme` 语义色；`frontend/src/ui/` 放 8 个零依赖原语组件；App.tsx 路由改 `React.lazy` 把 three.js 切出首屏 chunk；展示欠账作为纯前端增量叠加在迁移完成后的页面上。

**Tech Stack:** React 19、Tailwind v4、Vite 8、TS strict、Vitest + RTL、Playwright。零新依赖。

**Spec:** `docs/superpowers/specs/2026-10-29-frontend-design-system-design.md`

## Global Constraints

- 仅本地提交，仓库无 remote，禁止推送。
- 提交信息按 diff 现写，禁套历史标题；提交后 `git log --oneline -1` 自检。
- 所有 npm 命令在 `frontend/` 目录下执行：`npm run typecheck`、`npm run test:run`、`npm run build`。
- 既有测试断言零修改为目标；唯一例外：Task 10 中 App.test.tsx 的同步 `getByRole` 改 `findByRole`（lazy 导致首帧是 Suspense fallback）。
- 零新 npm 依赖；不改 DOM 语义、role、testid、中文文案。
- 原语组件全部放 `frontend/src/ui/`，每文件一个默认导出前先具名导出（项目惯例是具名导出）。
- Tailwind v4 语义类名：`bg-canvas` `bg-surface` `bg-sunken` `border-line` `bg-accent` `bg-accent-dim` `border-danger` `border-warning` `text-text-strong` `text-text` `text-text-dim`。

---

### Task 1: index.css @theme 主题 token 层

**Files:**
- Modify: `frontend/src/index.css`（整文件重写）

**Interfaces:**
- Produces: Tailwind 语义色类（`bg-surface` 等），Task 2-10 全部消费；CSS 变量 `--color-*` 供 body 使用。

- [ ] **Step 1: 重写 index.css**

```css
@import "tailwindcss";

@theme {
  --color-canvas: #020617; /* slate-950 */
  --color-surface: #0f172a; /* slate-900 */
  --color-sunken: #020617; /* slate-950 */
  --color-line: #1e293b; /* slate-800 */
  --color-accent: #059669; /* emerald-600 */
  --color-accent-dim: #047857; /* emerald-700 */
  --color-danger: #be123c; /* rose-700 */
  --color-warning: #d97706; /* amber-600 */
  --color-text-strong: #f1f5f9; /* slate-100 */
  --color-text: #cbd5e1; /* slate-300 */
  --color-text-dim: #94a3b8; /* slate-400 */
}

:root {
  color-scheme: dark;
}

body {
  margin: 0;
  background: var(--color-canvas);
  color: var(--color-text-strong);
  font-family:
    ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}

* {
  box-sizing: border-box;
}
```

- [ ] **Step 2: 构建验证 token 生成**

Run（在 frontend/ 下）: `npm run build`
Expected: 构建成功，无 CSS 报错。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/index.css
git commit -m "feat: index.css 建立 @theme 语义色 token 层"
```

---

### Task 2: ui 原语 — Button / Input / Textarea / Card

**Files:**
- Create: `frontend/src/ui/Button.tsx`
- Create: `frontend/src/ui/Input.tsx`
- Create: `frontend/src/ui/Textarea.tsx`
- Create: `frontend/src/ui/Card.tsx`
- Test: `frontend/src/ui/primitives.test.tsx`

**Interfaces:**
- Consumes: Task 1 的语义色类。
- Produces（Task 4-10 依赖的精确签名）:
  - `Button({ variant?: 'primary' | 'neutral' | 'danger' | 'warning', className?: string, ...rest: ButtonHTMLAttributes<HTMLButtonElement> })` — 不给 `type` 默认值，透传。
  - `Input({ className?: string, ...rest: InputHTMLAttributes<HTMLInputElement> })`
  - `Textarea({ className?: string, ...rest: TextareaHTMLAttributes<HTMLTextAreaElement> })`
  - `Card({ className?: string, children })` — 基类不含 padding，调用方用 className 传 `p-3`/`p-4`。

- [ ] **Step 1: 写失败测试**

`frontend/src/ui/primitives.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from './Button'
import { Card } from './Card'
import { Input } from './Input'
import { Textarea } from './Textarea'

describe('Button', () => {
  it.each([
    ['primary', 'bg-accent'],
    ['neutral', 'border-line'],
    ['danger', 'border-danger'],
    ['warning', 'border-warning'],
  ])('renders %s variant class', (variant, expected) => {
    render(<Button variant={variant}>go</Button>)
    expect(screen.getByRole('button', { name: 'go' })).toHaveClass(expected)
  })

  it('defaults to neutral and passes through type and disabled', () => {
    render(
      <Button type="submit" disabled>
        保存
      </Button>,
    )
    const button = screen.getByRole('button', { name: '保存' })
    expect(button).toHaveAttribute('type', 'submit')
    expect(button).toBeDisabled()
    expect(button).toHaveClass('border-line')
  })

  it('appends caller className', () => {
    render(<Button className="w-full">go</Button>)
    expect(screen.getByRole('button')).toHaveClass('w-full')
  })
})

describe('Input / Textarea', () => {
  it('applies sunken field styling and value props', () => {
    render(
      <>
        <Input aria-label="名称" defaultValue="x" />
        <Textarea aria-label="extra" defaultValue="{}" rows={2} />
      </>,
    )
    expect(screen.getByLabelText('名称')).toHaveClass('bg-sunken')
    expect(screen.getByLabelText('extra')).toHaveClass('bg-sunken')
  })

  it('appends caller className to Input', () => {
    render(<Input aria-label="q" className="font-mono" />)
    expect(screen.getByLabelText('q')).toHaveClass('font-mono')
  })
})

describe('Card', () => {
  it('renders surface container without padding and keeps testid', () => {
    render(
      <Card className="p-4" data-testid="box">
        内容
      </Card>,
    )
    const card = screen.getByTestId('box')
    expect(card).toHaveClass('bg-surface', 'border-line')
    expect(card).toHaveClass('p-4')
    expect(card).not.toHaveClass('p-3')
    expect(card).toHaveTextContent('内容')
  })
})
```

注意：`Card` 需要 `data-testid` 透传，实现签名里 rest 要含 `HTMLAttributes<HTMLDivElement>`。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test:run -- src/ui/primitives.test.tsx`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现四个原语**

`frontend/src/ui/Button.tsx`：

```tsx
import type { ButtonHTMLAttributes } from 'react'

const VARIANTS = {
  primary:
    'rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50',
  neutral:
    'rounded border border-line px-3 py-1.5 text-sm text-text hover:bg-surface',
  danger:
    'rounded border border-danger px-3 py-1.5 text-sm text-rose-300 hover:bg-rose-950/40',
  warning:
    'rounded border border-warning px-3 py-1.5 text-sm text-amber-300',
} as const

export type ButtonVariant = keyof typeof VARIANTS

export function Button({
  variant = 'neutral',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button className={`${VARIANTS[variant]} ${className}`} {...rest} />
}
```

`frontend/src/ui/Input.tsx`：

```tsx
import type { InputHTMLAttributes } from 'react'

export function Input({
  className = '',
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`rounded bg-sunken px-3 py-2 text-sm ${className}`} {...rest} />
}
```

`frontend/src/ui/Textarea.tsx`：

```tsx
import type { TextareaHTMLAttributes } from 'react'

export function Textarea({
  className = '',
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`rounded bg-sunken px-3 py-2 text-sm ${className}`}
      {...rest}
    />
  )
}
```

`frontend/src/ui/Card.tsx`：

```tsx
import type { HTMLAttributes } from 'react'

export function Card({
  className = '',
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded border border-line bg-surface ${className}`} {...rest} />
}
```

- [ ] **Step 4: 运行测试确认通过 + typecheck**

Run: `npm run test:run -- src/ui/primitives.test.tsx && npm run typecheck`
Expected: PASS，typecheck 无错误。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/ui/Button.tsx frontend/src/ui/Input.tsx frontend/src/ui/Textarea.tsx frontend/src/ui/Card.tsx frontend/src/ui/primitives.test.tsx
git commit -m "feat: ui 原语 Button/Input/Textarea/Card"
```

---

### Task 3: ui 原语 — Alert / Table / Skeleton / Spinner

**Files:**
- Create: `frontend/src/ui/Alert.tsx`
- Create: `frontend/src/ui/Table.tsx`
- Create: `frontend/src/ui/Skeleton.tsx`
- Create: `frontend/src/ui/Spinner.tsx`
- Test: 追加到 `frontend/src/ui/primitives.test.tsx`

**Interfaces:**
- Produces:
  - `Alert({ tone?: 'danger' | 'info', className?: string, children, ...rest: HTMLAttributes<HTMLParagraphElement> })` — 渲染 `<p role="alert">`。
  - `Table({ className?, ...rest: HTMLAttributes<HTMLTableElement> })`、`Th({ children, className? })`、`Td({ children, className? })`。
  - `Skeleton({ className?: string })` — `<div data-testid="skeleton" aria-hidden>`。
  - `Spinner({ className?: string })` — `<span role="status" aria-label="加载中">`。

- [ ] **Step 1: 追加失败测试**（加到 primitives.test.tsx 末尾）

```tsx
import { Alert } from './Alert'
import { Skeleton } from './Skeleton'
import { Spinner } from './Spinner'
import { Table, Td, Th } from './Table'

describe('Alert', () => {
  it('renders role=alert with danger tone by default', () => {
    render(<Alert>boom</Alert>)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('boom')
    expect(alert).toHaveClass('border-danger', 'text-rose-300')
  })

  it('renders info tone', () => {
    render(<Alert tone="info">note</Alert>)
    expect(screen.getByRole('alert')).toHaveClass('border-line', 'bg-surface')
  })
})

describe('Table', () => {
  it('renders th/td with converged styles', () => {
    render(
      <Table>
        <thead>
          <tr>
            <Th>列</Th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <Td>值</Td>
          </tr>
        </tbody>
      </Table>,
    )
    expect(screen.getByRole('columnheader', { name: '列' })).toHaveClass(
      'text-text-dim',
      'border-line',
    )
    expect(screen.getByRole('cell', { name: '值' })).toHaveClass('border-line/50')
  })
})

describe('Skeleton / Spinner', () => {
  it('renders pulse skeleton and spinning status', () => {
    render(
      <>
        <Skeleton className="h-4 w-full" />
        <Spinner />
      </>,
    )
    expect(screen.getByTestId('skeleton')).toHaveClass('animate-pulse')
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', '加载中')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test:run -- src/ui/primitives.test.tsx`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现四个原语**

`frontend/src/ui/Alert.tsx`：

```tsx
import type { HTMLAttributes } from 'react'

const TONES = {
  danger: 'border-danger bg-rose-950/40 text-rose-300',
  info: 'border-line bg-surface text-text',
} as const

export function Alert({
  tone = 'danger',
  className = '',
  ...rest
}: HTMLAttributes<HTMLParagraphElement> & {
  tone?: keyof typeof TONES
}) {
  return <p role="alert" className={`rounded border p-3 text-sm ${TONES[tone]} ${className}`} {...rest} />
}
```

`frontend/src/ui/Table.tsx`：

```tsx
import type { HTMLAttributes, ThHTMLAttributes, TdHTMLAttributes } from 'react'

export function Table({
  className = '',
  ...rest
}: HTMLAttributes<HTMLTableElement>) {
  return <table className={`w-full border-collapse text-sm ${className}`} {...rest} />
}

export function Th({ className = '', ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={`border-b border-line py-2 text-left font-normal text-text-dim ${className}`}
      {...rest}
    />
  )
}

export function Td({ className = '', ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={`border-b border-line/50 py-2 ${className}`} {...rest} />
}
```

`frontend/src/ui/Skeleton.tsx`：

```tsx
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      data-testid="skeleton"
      aria-hidden
      className={`animate-pulse rounded bg-surface ${className}`}
    />
  )
}
```

`frontend/src/ui/Spinner.tsx`：

```tsx
export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="加载中"
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent ${className}`}
    />
  )
}
```

- [ ] **Step 4: 运行测试确认通过 + typecheck**

Run: `npm run test:run -- src/ui/primitives.test.tsx && npm run typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/ui/Alert.tsx frontend/src/ui/Table.tsx frontend/src/ui/Skeleton.tsx frontend/src/ui/Spinner.tsx frontend/src/ui/primitives.test.tsx
git commit -m "feat: ui 原语 Alert/Table/Skeleton/Spinner"
```

---

### Task 4: Providers 页迁移到原语

**Files:**
- Modify: `frontend/src/pages/ProvidersPage.tsx`
- Test（只跑不改）: `frontend/src/pages/ProvidersPage.test.tsx`

**迁移映射**（所有迁移任务共用，逐字执行）：

| 现状类串/元素 | 替换为 |
|---|---|
| `rounded border border-slate-800 bg-slate-900 p-4`（form/卡片容器） | `<Card className="p-4 ...">`（保留 grid 等其余类） |
| `rounded bg-slate-950 px-3 py-2`（input） | `<Input>` |
| `rounded bg-slate-950 px-3 py-2 font-mono text-xs`（textarea） | `<Textarea className="font-mono text-xs">` |
| `rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50` | `<Button variant="primary">` |
| `rounded border border-slate-700 px-3 py-1` | `<Button variant="neutral">` |
| `border-rose-700 text-rose-300` 按钮 | `<Button variant="danger">` |
| `role="alert"` 横幅 `<p className="rounded border border-rose-700 bg-rose-950/40 p-3 text-sm text-rose-300">` | `<Alert tone="danger">` |
| `<p role="alert" className="text-sm text-rose-300">`（表单内联错误） | `<Alert tone="danger" className="p-0 text-sm">`？**否**——内联短错误保持原样不动（只在块级横幅处用 Alert） |
| `<p className="text-sm text-slate-400">加载中…</p>` | Skeleton 组合（见下） |

加载态替换模板（列表页统一用这个三行骨架）：

```tsx
<div aria-busy="true" className="space-y-2">
  <Skeleton className="h-4 w-1/3" />
  <Skeleton className="h-4 w-full" />
  <Skeleton className="h-4 w-5/6" />
</div>
```

提交按钮 submitting 时加 Spinner（aria-hidden 不影响 accessible name）：

```tsx
<Button variant="primary" type="submit" disabled={submitting}>
  {submitting && <Spinner className="mr-2 border-slate-400 border-t-white" />}
  保存 provider
</Button>
```

**Steps:**

- [ ] **Step 1: 按映射表迁移 ProvidersPage.tsx**（表单 + 卡片 + 探测按钮 + 错误横幅 + 加载态）
- [ ] **Step 2: 全量验证**

Run: `npm run typecheck && npm run test:run`
Expected: 全部 PASS，零测试文件改动。`git diff --stat` 只含 ProvidersPage.tsx。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/ProvidersPage.tsx
git commit -m "refactor: Providers 页迁移到 ui 原语与语义色"
```

---

### Task 5: Benchmarks 与 BenchmarkDetail 页迁移

**Files:**
- Modify: `frontend/src/pages/BenchmarksPage.tsx`
- Modify: `frontend/src/pages/BenchmarkDetailPage.tsx`
- Test（只跑不改）: `frontend/src/pages/BenchmarksPage.test.tsx`

**Steps:**

- [ ] **Step 1: BenchmarksPage 迁移**——表单容器/输入/select（`<select>` 保持原生、类串换 `rounded bg-sunken px-3 py-2 text-sm`）/主按钮/横幅/列表卡片/加载态，全按 Task 4 映射表。
- [ ] **Step 2: BenchmarkDetailPage 迁移**——`<p>加载中…</p>`（无样式那个）换 Skeleton 组合；`role="alert" className="text-rose-300"` 换 `<Alert tone="danger">`；表格换 `<Table><Th><Td>`（thead 的 `border-b border-slate-800 text-left text-slate-400` 由 Th 承接，tbody 行 `border-b border-slate-900` 换 `border-line/50`）；详情副标题 `text-slate-400` 换 `text-text-dim`；两个 Link 的 `text-emerald-400` 换 `text-accent`（Tailwind v4 下 `text-accent` 由 `--color-accent` 生成）。
- [ ] **Step 3: 全量验证**

Run: `npm run typecheck && npm run test:run`
Expected: 全部 PASS，零测试文件改动。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/BenchmarksPage.tsx frontend/src/pages/BenchmarkDetailPage.tsx
git commit -m "refactor: Benchmarks 两页迁移到 ui 原语与语义色"
```

---

### Task 6: Runs / NewRun / Run / Episode 与共享组件迁移

**Files:**
- Modify: `frontend/src/pages/RunsPage.tsx`
- Modify: `frontend/src/pages/NewRunPage.tsx`
- Modify: `frontend/src/pages/RunPage.tsx`
- Modify: `frontend/src/pages/EpisodePage.tsx`
- Modify: `frontend/src/components/ResultView.tsx`
- Modify: `frontend/src/components/ToolLog.tsx`
- Modify: `frontend/src/components/StatusBadge.tsx`
- Modify: `frontend/src/components/Layout.tsx`
- Modify: `frontend/src/components/ProgressChart.tsx`
- Test（只跑不改）: 对应 *.test.tsx

**Steps:**

- [ ] **Step 1: 共享组件**——ResultView：Card（含 `p-3` 小卡）、表格三件套、错误横幅 Alert、`报告加载中…` 段保留 `data-testid="run-result"` 换成 Skeleton 组合（RunPage.test.tsx:345 注释依赖这个 testid，不能丢）。ToolLog/StatusBadge/Layout/ProgressChart：仅类名 token 化（`slate-*`→语义色，`emerald-`→`accent`），StatusBadge 的 COLORS 映射值换语义类（`bg-emerald-900 text-emerald-300` 这类状态色保留原样——它们是状态语义不是主题语义，加注释一行说明）。
- [ ] **Step 2: RunsPage**——表格三件套、New Run 链接换 `rounded bg-accent px-4 py-2 text-sm text-white`（Link 不是 Button，只换类不换元素）、重试按钮换 `<Button variant="neutral">`、加载态换 Skeleton、错误横幅换 Alert。
- [ ] **Step 3: NewRunPage**——表单/按钮/横幅/加载态按映射表。
- [ ] **Step 4: RunPage**——按钮（含 RunPage:276 的 amber 警示按钮 → `variant="warning"`）、横幅、加载态按映射表；分段控件若有时段按钮保持原样。
- [ ] **Step 5: EpisodePage**——同上；**EpisodePage:92/106 的分段选择按钮（bg-emerald-700/bg-slate-800 条件类）不上收为 Button，类名 token 化即可**（`emerald-700`→`accent-dim`、`slate-800`→`surface`）。
- [ ] **Step 6: 全量验证**

Run: `npm run typecheck && npm run test:run`
Expected: 全部 PASS，零测试文件改动。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/RunsPage.tsx frontend/src/pages/NewRunPage.tsx frontend/src/pages/RunPage.tsx frontend/src/pages/EpisodePage.tsx frontend/src/components/
git commit -m "refactor: 运行相关页与共享组件迁移到 ui 原语与语义色"
```

---

### Task 7: describeProbeError + 探测 kind 徽标

**Files:**
- Modify: `frontend/src/lib/errors.ts`
- Modify: `frontend/src/pages/ProvidersPage.tsx`
- Test: `frontend/src/lib/errors.test.ts`（追加）、`frontend/src/pages/ProvidersPage.test.tsx`（追加）

**Interfaces:**
- Produces: `describeProbeError(err: unknown): { kind: string | null; text: string }` — `err` 为 `ApiError` 且 detail 是含 string `kind` 的 JSON 对象时返回 `{ kind, text: message ?? detail }`；否则 `{ kind: null, text: describeError(err) }`。网络 TypeError 返回 `{ kind: null, text: '网络错误：无法访问后端，请确认服务已启动' }`。
- `describeError` 与 `readableDetail` 一行不动。

- [ ] **Step 1: 追加失败测试**（errors.test.ts 末尾）

```ts
describe('describeProbeError', () => {
  it('unwraps kind and message from the 502 dict detail', () => {
    const err = new ApiError(
      502,
      JSON.stringify({ kind: 'connection', message: 'connection refused' }),
    )
    expect(describeProbeError(err)).toEqual({
      kind: 'connection',
      text: 'connection refused',
    })
  })

  it('falls back to describeError when detail has no kind', () => {
    const err = new ApiError(400, 'base_url must be http(s)')
    const result = describeProbeError(err)
    expect(result.kind).toBeNull()
    expect(result.text).toBe('请求不合法（HTTP 400）：base_url must be http(s)')
  })

  it('maps network failure to the Chinese message', () => {
    expect(describeProbeError(new TypeError('Failed to fetch'))).toEqual({
      kind: null,
      text: '网络错误：无法访问后端，请确认服务已启动',
    })
  })
})
```

（import 行补 `describeProbeError`。）

- [ ] **Step 2: 运行确认失败**

Run: `npm run test:run -- src/lib/errors.test.ts`
Expected: FAIL（函数不存在）。

- [ ] **Step 3: 实现**（追加到 errors.ts 末尾）

```ts
export function describeProbeError(err: unknown): {
  kind: string | null
  text: string
} {
  if (!(err instanceof ApiError)) {
    return { kind: null, text: '网络错误：无法访问后端，请确认服务已启动' }
  }
  try {
    const parsed: unknown = JSON.parse(err.detail)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const kind = (parsed as { kind?: unknown }).kind
      if (typeof kind === 'string') {
        const message = (parsed as { message?: unknown }).message
        return {
          kind,
          text: typeof message === 'string' ? message : err.detail,
        }
      }
    }
  } catch {
    // 非 JSON detail 走通用描述
  }
  return { kind: null, text: describeError(err) }
}
```

- [ ] **Step 4: 追加 ProvidersPage 失败测试**

```tsx
it('shows the probe error kind as a badge next to the message', async () => {
  const user = userEvent.setup()
  const onProbe = vi.fn().mockRejectedValue(
    new ApiError(
      502,
      JSON.stringify({ kind: 'connection', message: 'connection refused' }),
    ),
  )
  render(
    <ProvidersView
      providers={[provider]}
      loading={false}
      error={null}
      onCreate={vi.fn()}
      onProbe={onProbe}
    />,
  )
  await user.click(screen.getByRole('button', { name: '探测' }))
  expect(await screen.findByTestId('probe-kind')).toHaveTextContent(
    'connection',
  )
  expect(screen.getByTestId('probe-error')).toHaveTextContent(
    'connection refused',
  )
})
```

- [ ] **Step 5: 运行确认失败**（probe-kind 不存在）
- [ ] **Step 6: 实现**——ProvidersPage 的 `probes` 状态改为 `Record<string, { kind: string | null; text: string }>`，成功路径存 `{ kind: null, text: '支持 tool calling' / '不支持 tool calling' }`，等待中存 `text: '探测中…'`；结果渲染：

```tsx
{probes[provider.id] && (
  <span className="flex items-center gap-2 text-slate-300">
    {probes[provider.id].kind && (
      <span
        data-testid="probe-kind"
        className="rounded border border-warning px-1.5 py-0.5 text-xs text-amber-300"
      >
        {probes[provider.id].kind}
      </span>
    )}
    <span data-testid="probe-error">{probes[provider.id].text}</span>
  </span>
)}
```

注意：既有测试 `shows key state and probe result` 断言 `findByText('支持 tool calling')` —— span 内文本仍可被 findByText 命中，不需要改；若该断言因嵌套结构失败，允许在该测试里把断言目标换成 `screen.getByTestId('probe-error')`（这是唯一的既有断言豁免点，需在提交信息里注明）。
- [ ] **Step 7: 全量验证 + Commit**

Run: `npm run typecheck && npm run test:run`

```bash
git add frontend/src/lib/errors.ts frontend/src/lib/errors.test.ts frontend/src/pages/ProvidersPage.tsx frontend/src/pages/ProvidersPage.test.tsx
git commit -m "feat: 探测失败显示错误类别徽标与消息"
```

---

### Task 8: 三列补显（created_at / frozen_at / 已解出列）

**Files:**
- Modify: `frontend/src/lib/format.ts`
- Modify: `frontend/src/pages/ProvidersPage.tsx`
- Modify: `frontend/src/pages/BenchmarksPage.tsx`
- Modify: `frontend/src/pages/BenchmarkDetailPage.tsx`
- Modify: `frontend/src/components/ResultView.tsx`
- Test: `frontend/src/lib/format.test.ts`（若无则建）、`ProvidersPage.test.tsx` / `BenchmarksPage.test.tsx` / `RunPage.test.tsx`（各追加）

**Interfaces:**
- Produces: `formatDate(value: string): string` = `new Date(value).toLocaleString()`（RunsPage:84 已有同款写法，本轮收敛进 format.ts）。

- [ ] **Step 1: format 失败测试**

```ts
import { formatDate } from './format'

describe('formatDate', () => {
  it('formats an ISO timestamp via toLocaleString', () => {
    const iso = '2026-10-29T00:00:00+00:00'
    expect(formatDate(iso)).toBe(new Date(iso).toLocaleString())
  })
})
```

- [ ] **Step 2: 确认失败 → 实现 formatDate → 确认通过**（TDD 循环）
- [ ] **Step 3: ProvidersPage 卡片加创建时间**（`created_at` 已在 Provider 类型与 fixture 里）：

```tsx
<div className="text-text-dim">
  环境变量：{provider.api_key_ref} · 创建于 {formatDate(provider.created_at)}
</div>
```

测试断言：`expect(screen.getByText(/创建于/)).toHaveTextContent('2026/10/29')`（toLocaleString 具体格式随环境，用年份断言避免脆断）。
- [ ] **Step 4: Benchmarks 列表行加冻结时间**：副标题行末尾追加 ` · 冻结 {formatDate(benchmark.frozen_at)}`；BenchmarkDetailPage 副标题同样追加。测试断言 `findByText(/冻结/)`。
- [ ] **Step 5: ResultView 逐题表加已解出列**——`<th>状态</th>` 后加 `<Th>已解出</Th>`，行内对应位置加：

```tsx
<Td>{episode.solved ? '✓' : '—'}</Td>
```

（`Report.episodes` 是 `Episode[]`，`solved: boolean` 已存在。）RunPage.test.tsx 追加断言：有 solved episode 的 fixture 行内出现 '✓'，失败行是 '—'。
- [ ] **Step 6: 全量验证 + Commit**

Run: `npm run typecheck && npm run test:run`

```bash
git add frontend/src/lib/format.ts frontend/src/lib/format.test.ts frontend/src/pages/ProvidersPage.tsx frontend/src/pages/ProvidersPage.test.tsx frontend/src/pages/BenchmarksPage.tsx frontend/src/pages/BenchmarksPage.test.tsx frontend/src/pages/BenchmarkDetailPage.tsx frontend/src/components/ResultView.tsx frontend/src/pages/RunPage.test.tsx
git commit -m "feat: 补显 provider 创建时间、benchmark 冻结时间与逐题已解出列"
```

---

### Task 9: FaceLegend 3D 面图例

**Files:**
- Create: `frontend/src/cube/FaceLegend.tsx`
- Modify: `frontend/src/pages/RunPage.tsx`、`frontend/src/pages/EpisodePage.tsx`（CubeView 容器处）
- Test: `frontend/src/cube/FaceLegend.test.tsx`

**Interfaces:**
- Consumes: `FACE_ORDER`（`cube/facelets.ts`，值 `['U','R','F','D','L','B']`）；`colorHex`（`lib/format.ts`）。
- Produces: `<FaceLegend />`，`data-testid="face-legend"`，绝对定位覆盖层。

后端配色依据（`src/mofang/cube/colors.py:15-21`）：U=white、R=red、F=green、D=yellow、L=orange、B=blue。

- [ ] **Step 1: 失败测试**

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FaceLegend } from './FaceLegend'

describe('FaceLegend', () => {
  it('renders all six faces with letters and swatches', () => {
    render(<FaceLegend />)
    const legend = screen.getByTestId('face-legend')
    expect(legend).toHaveTextContent('U')
    expect(legend).toHaveTextContent('R')
    expect(legend).toHaveTextContent('F')
    expect(legend).toHaveTextContent('D')
    expect(legend).toHaveTextContent('L')
    expect(legend).toHaveTextContent('B')
    expect(legend.querySelectorAll('span[aria-hidden]')).toHaveLength(6)
  })

  it('uses the backend face color mapping', () => {
    render(<FaceLegend />)
    const swatches = screen.getByTestId('face-legend').querySelectorAll(
      'span[aria-hidden]',
    )
    expect(swatches[0]).toHaveStyle({ background: '#f8fafc' }) // U → white
    expect(swatches[1]).toHaveStyle({ background: '#ef4444' }) // R → red
    expect(swatches[2]).toHaveStyle({ background: '#22c55e' }) // F → green
  })
})
```

- [ ] **Step 2: 确认失败**
- [ ] **Step 3: 实现**

```tsx
import type { ColorName } from '../api/types'
import { colorHex } from '../lib/format'
import { FACE_ORDER } from './facelets'

const FACE_COLORS: Record<(typeof FACE_ORDER)[number], ColorName> = {
  U: 'white',
  R: 'red',
  F: 'green',
  D: 'yellow',
  L: 'orange',
  B: 'blue',
}

export function FaceLegend() {
  return (
    <ul
      data-testid="face-legend"
      className="pointer-events-none absolute right-2 top-2 flex gap-1.5 rounded border border-line bg-sunken/70 p-1.5 text-xs"
    >
      {FACE_ORDER.map((face) => (
        <li key={face} className="flex items-center gap-1">
          <span
            aria-hidden
            className="inline-block h-3 w-3 rounded-sm"
            style={{ background: colorHex(FACE_COLORS[face]) }}
          />
          <span className="text-text-dim">{face}</span>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 4: 接入两个页面**——RunPage 与 EpisodePage 里包 CubeView 的容器（含 `relative` 定位的 div）内加 `<FaceLegend />`；若容器无 `relative` 则补上。定位约束：右上角、`pointer-events-none` 不挡 OrbitControls。
- [ ] **Step 5: 全量验证 + Commit**

Run: `npm run typecheck && npm run test:run`

```bash
git add frontend/src/cube/FaceLegend.tsx frontend/src/cube/FaceLegend.test.tsx frontend/src/pages/RunPage.tsx frontend/src/pages/EpisodePage.tsx
git commit -m "feat: 3D 视图加六面颜色图例"
```

---

### Task 10: lazy 路由切包

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.test.tsx`（唯一允许的既有测试修改）

**Steps:**

- [ ] **Step 1: App.tsx 改 lazy**

```tsx
import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Spinner } from './ui/Spinner'

const BenchmarkDetailPage = lazy(() => import('./pages/BenchmarkDetailPage'))
const BenchmarksPage = lazy(() => import('./pages/BenchmarksPage'))
const EpisodePage = lazy(() => import('./pages/EpisodePage'))
const NewRunPage = lazy(() => import('./pages/NewRunPage'))
const ProvidersPage = lazy(() => import('./pages/ProvidersPage'))
const RunPage = lazy(() => import('./pages/RunPage'))
const RunsPage = lazy(() => import('./pages/RunsPage'))

export default function App() {
  const suspense = (node: React.ReactNode) => (
    <Suspense fallback={<Spinner className="mx-auto mt-8" />}>{node}</Suspense>
  )
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/runs" replace />} />
        <Route path="providers" element={suspense(<ProvidersPage />)} />
        <Route path="benchmarks" element={suspense(<BenchmarksPage />)} />
        <Route
          path="benchmarks/:id"
          element={suspense(<BenchmarkDetailPage />)}
        />
        <Route path="runs" element={suspense(<RunsPage />)} />
        <Route path="runs/new" element={suspense(<NewRunPage />)} />
        <Route path="runs/:id" element={suspense(<RunPage />)} />
        <Route path="episodes/:id" element={suspense(<EpisodePage />)} />
      </Route>
    </Routes>
  )
}
```

- [ ] **Step 2: 更新 App.test.tsx**——首个测试的 `getByRole('heading', { name: 'Providers' })` 与 `getByRole('button', { name: '保存 provider' })` 改 `await findByRole(...)`，测试函数加 `async`；第 7 行注释改为：`// 路由 lazy 导入 RunPage → CubeView → three；vi.mock 对动态导入同样生效，jsdom 用不到 WebGL。`其余两个测试已是 `findBy*` 不动。
- [ ] **Step 3: 全量验证 + 体积记录**

Run: `npm run typecheck && npm run test:run && npm run build`
Expected: 全 PASS；构建输出记录各 chunk 体积（dist/assets 下 three 相关 chunk 应独立于首屏入口），把数字写进提交信息和 ledger。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.tsx frontend/src/App.test.tsx
git commit -m "perf: 路由改 lazy 导入，three.js 切出首屏 chunk"
```

---

### Task 11: 硬编码残留检查、E2E 与文档收口

**Files:**
- Modify: `README.md`、`PROJECT-PASSPORT.md`（如需）、`.superpowers/sdd/2026-10-26-m3-workbench/progress.md`（gitignored ledger，追加"后续变更 2026-10-29 设计系统轮"小节）

**Steps:**

- [ ] **Step 1: 残留 grep 门禁**——在 `frontend/src/pages` 与 `frontend/src/components` 下 grep `slate-|emerald-|rose-9|amber-`，白名单：StatusBadge 的状态色映射（有注释）、rose-300/rose-950/amber-300/amber-400 这类 Alert/徽标内部类（属原语与状态语义）。产出残留清单：每处要么收敛要么给一行理由；cube/ 目录（three 材质与 FaceLegend 的 style 背景色）不在门禁范围。
- [ ] **Step 2: E2E**

Run（frontend/ 下）: `npx playwright test`
Expected: 两条 spec 全绿（lazy 对 Playwright 透明）。

- [ ] **Step 3: mofang dev 手工冒烟**——仓库根 `uv run mofang dev`，浏览器确认：首屏加载、Providers/Benchmarks/Run 各页 chunk 按需加载（Network 面板）、Run 页可见面图例、探测 kind 徽标在真实失败时显示。结果记入 ledger。
- [ ] **Step 4: 文档**——README 前端小节补一句"样式经 ui/ 原语与 @theme 语义色收敛，路由 lazy 加载"；PROJECT-PASSPORT limitations 里删掉"1.27MB 单 bundle"并记录新体积。
- [ ] **Step 5: Commit**

```bash
git add README.md PROJECT-PASSPORT.md
git commit -m "docs: 记录设计系统收敛与新的首屏体积"
```
