# U3 操作流反馈 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 mofang 前端所有 mutation 有 toast 反馈、三个表单有字段级校验、三个列表页有 EmptyState、全部 loading 态收敛到统一骨架组件。

**Architecture:** 页面直接接线（不加全局抽象）：toast 在页面级组件（default export）的 mutateAsync 包装处触发，View 组件保持纯展示；字段校验用每页 `fieldErrors: Record<string, string>` state，展示走 Input/Textarea/Select 原语已有 `error` prop；共享件只有 `ui/toastError.ts` 一个函数和 `ui/PageSkeleton.tsx` 一个展示组件。

**Tech Stack:** React 19 + TanStack Query + Tailwind v4 + motion（不新增依赖）。

**Spec:** `docs/superpowers/specs/2026-10-31-ui-upgrade-u3-design.md`（决策记录与约束以此为准）

## Global Constraints

- 纯前端；不引新运行时依赖；SSE 事件契约、后端 API 不动。
- `lib/validate.ts` 逻辑不变；现有中文校验文案原样保留（只换展示位置）。
- 现有前端测试全绿是硬门槛；formError 相关现有断言逐条过语义改写，不是硬改绿。
- 原语改动向后兼容：本批对原语唯一允许的改动是 `Toast.tsx` 导出 `ToastApi` 类型。
- 全量验证门槛：`npm run typecheck && npm run test:run && npm run build && npm run e2e`（在 `frontend/` 下）全绿。
- 决策 ①：页面级加载失败保留 Alert；提交类失败走 toast + 字段级错误（双通道，字段错误常驻、toast 即时）；`formError` 独立通道删除。
- 决策 ②：字段校验「提交时全显 + 输入即清」，不做 blur 即时校验。
- 决策 ③：页面直接接线 + 微量共享。
- Plan Ruling（spec 未覆盖处的裁定）：BenchmarksPage 409 冲突提示**保留行内展示**（因为它带「查看已有题集」跳转链接，toast 是纯文本放不下），只删除普通 formError 文案通道。

---

### Task 1: 共享件——ToastProvider 挂载、toastError、PageSkeleton

**Files:**
- Modify: `frontend/src/ui/Toast.tsx:21`（`interface ToastApi` → `export interface ToastApi`）
- Modify: `frontend/src/main.tsx`（挂载 ToastProvider）
- Create: `frontend/src/ui/toastError.ts`
- Create: `frontend/src/ui/PageSkeleton.tsx`
- Test: `frontend/src/ui/toastError.test.ts`
- Test: `frontend/src/ui/PageSkeleton.test.tsx`

**Interfaces:**
- Consumes: `useToast()`/Toast 原语现状（`ToastApi = { success(m): void; error(m): void }`）、`describeError(err: unknown): string`（`lib/errors.ts`）、`Skeleton`（`ui/Skeleton.tsx`，props `{ className?: string }`）。
- Produces: `export interface ToastApi`（从 Toast.tsx 导出）；`export function toastError(toast: ToastApi, err: unknown): void`；`export function PageSkeleton({ variant, rows = 4, count = 2, fields = 5 }: { variant: 'table' | 'cards' | 'form'; rows?: number; count?: number; fields?: number }): JSX.Element`。

- [ ] **Step 1: 写 toastError 失败测试**

```ts
// frontend/src/ui/toastError.test.ts
import { describe, expect, it, vi } from 'vitest'
import { describeError } from '../lib/errors'
import { toastError } from './toastError'

describe('toastError', () => {
  it('经 describeError 转译后调用 toast.error', () => {
    const toast = { success: vi.fn(), error: vi.fn() }
    const err = new Error('boom')
    toastError(toast, err)
    expect(toast.error).toHaveBeenCalledWith(describeError(err))
    expect(toast.success).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd frontend && npx vitest run src/ui/toastError.test.ts`
Expected: FAIL（`./toastError` 不存在）

- [ ] **Step 3: 实现 toastError 并导出 ToastApi**

`frontend/src/ui/toastError.ts`：

```ts
import { describeError } from '../lib/errors'
import type { ToastApi } from './Toast'

export function toastError(toast: ToastApi, err: unknown): void {
  toast.error(describeError(err))
}
```

`frontend/src/ui/Toast.tsx` 第 21 行 `interface ToastApi {` 改为 `export interface ToastApi {`（其余不动）。

- [ ] **Step 4: 写 PageSkeleton 失败测试**

```tsx
// frontend/src/ui/PageSkeleton.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PageSkeleton } from './PageSkeleton'

describe('PageSkeleton', () => {
  it('table 变体渲染 rows 行条目', () => {
    render(<PageSkeleton variant="table" rows={3} />)
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThanOrEqual(4)
  })

  it('cards 变体渲染 count 张卡片', () => {
    const { container } = render(<PageSkeleton variant="cards" count={3} />)
    expect(container.querySelectorAll('.grid > .space-y-2')).toHaveLength(3)
  })

  it('form 变体渲染 fields 组字段与按钮条', () => {
    const { container } = render(<PageSkeleton variant="form" fields={4} />)
    expect(container.querySelectorAll('.grid.gap-1')).toHaveLength(4)
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(4)
  })
})
```

- [ ] **Step 5: 运行确认失败**

Run: `npx vitest run src/ui/PageSkeleton.test.tsx`
Expected: FAIL（`./PageSkeleton` 不存在）

- [ ] **Step 6: 实现 PageSkeleton**

`frontend/src/ui/PageSkeleton.tsx`：

```tsx
import { Skeleton } from './Skeleton'

export function PageSkeleton({
  variant,
  rows = 4,
  count = 2,
  fields = 5,
}: {
  variant: 'table' | 'cards' | 'form'
  rows?: number
  count?: number
  fields?: number
}) {
  if (variant === 'table') {
    return (
      <div aria-busy="true" className="space-y-2">
        <Skeleton className="h-8 w-1/2" />
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton
            key={i}
            className={i % 2 === 0 ? 'h-4 w-full' : 'h-4 w-11/12'}
          />
        ))}
      </div>
    )
  }
  if (variant === 'cards') {
    return (
      <div aria-busy="true" className="grid gap-3 md:grid-cols-2">
        {Array.from({ length: count }, (_, i) => (
          <div
            key={i}
            className="space-y-2 rounded border border-line bg-surface p-4"
          >
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ))}
      </div>
    )
  }
  return (
    <div
      aria-busy="true"
      className="grid gap-3 rounded border border-line bg-surface p-4 md:grid-cols-2"
    >
      {Array.from({ length: fields }, (_, i) => (
        <div key={i} className="grid gap-1">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
      <div className="md:col-span-2">
        <Skeleton className="h-9 w-32" />
      </div>
    </div>
  )
}
```

- [ ] **Step 7: 运行两个新测试确认通过**

Run: `npx vitest run src/ui/toastError.test.ts src/ui/PageSkeleton.test.tsx`
Expected: PASS

- [ ] **Step 8: main.tsx 挂载 ToastProvider**

在 `frontend/src/main.tsx`：加 `import { ToastProvider } from './ui/Toast'`；在 `<QueryClientProvider client={queryClient}>` 的直接子层外包一层 `<ToastProvider>…</ToastProvider>`（ToastProvider 在 QueryClientProvider 内侧、现有应用子树外侧）。Toast 原语此前零消费所以不挂也能编译，本步让 `useToast()` 全树可用。

- [ ] **Step 9: 全量测试回归**

Run: `npm run typecheck && npm run test:run`
Expected: 全绿（255+3 用例）

- [ ] **Step 10: Commit**

```bash
git add frontend/src/ui/toastError.ts frontend/src/ui/toastError.test.ts frontend/src/ui/PageSkeleton.tsx frontend/src/ui/PageSkeleton.test.tsx frontend/src/ui/Toast.tsx frontend/src/main.tsx
git commit -m "feat: U3 共享件——ToastProvider 挂载、toastError 转译 helper、PageSkeleton 三变体"
```

---

### Task 2: ProvidersPage——toast 接入 + 字段级校验 + 空态 + 骨架

**Files:**
- Modify: `frontend/src/pages/ProvidersPage.tsx`
- Test: `frontend/src/pages/ProvidersPage.test.tsx`

**Interfaces:**
- Consumes: Task 1 的 `toastError(toast, err)`、`PageSkeleton`、`ToastApi` 导出；`EmptyState`（props `{ title: string; hint?: string; action?: ReactNode; icon?: ReactNode }`）；Input/Textarea 原语 `error?: string` prop 与原语内建 id 生成（本任务显式传 `id`）。
- Produces: 页面级 toast 接线模式（后续任务同构复用）：`onXxx={async (args) => { try { await xxx.mutateAsync(args); toast.success('文案') } catch (err) { toastError(toast, err); throw err } }}`；View 层 catch 吞掉提交类错误（不再设 formError），keyErrors/probes 页面内展示保留（决策 ① 双通道）。

**字段与 id 映射（提交聚焦顺序 = 校验顺序）：**

| fieldErrors key | 输入 id | 校验文案（原文案不动） |
|---|---|---|
| base_url | provider-base-url | base_url 必须是 http(s) |
| max_tokens | provider-max-tokens | max_tokens 必须是正整数 |
| temperature | provider-temperature | temperature 必须是 0 到 2 之间的数值 |
| extra | provider-extra | extra 必须是 JSON 对象 / extra 必须是合法 JSON |
| api_key | provider-api-key | API key 与环境变量名至少填一个 |

- [ ] **Step 1: 写失败测试（字段校验 + 空态）**

在 `frontend/src/pages/ProvidersPage.test.tsx` 追加（沿用文件内现有 View 渲染 helper 与 props 工厂；`user` 为 `userEvent.setup()`）：

```tsx
describe('ProvidersView field errors', () => {
  it('提交时全显所有字段错误并聚焦第一个错误字段', async () => {
    const utils = render(<ProvidersView {...props({ providers: [] })} />)
    const baseUrl = screen.getByLabelText('base_url')
    await user.clear(baseUrl)
    await user.clear(screen.getByLabelText('max_tokens'))
    await user.click(screen.getByRole('button', { name: '保存 provider' }))
    expect(screen.getByText('base_url 必须是 http(s)')).toBeInTheDocument()
    expect(screen.getByText('max_tokens 必须是正整数')).toBeInTheDocument()
    expect(screen.getByText('API key 与环境变量名至少填一个')).toBeInTheDocument()
    expect(document.activeElement).toBe(screen.getByLabelText('base_url'))
  })

  it('输入即清：修正字段后该字段错误消失，其余保留', async () => {
    render(<ProvidersView {...props({ providers: [] })} />)
    const baseUrl = screen.getByLabelText('base_url')
    await user.clear(baseUrl)
    await user.click(screen.getByRole('button', { name: '保存 provider' }))
    expect(screen.getByText('base_url 必须是 http(s)')).toBeInTheDocument()
    await user.type(baseUrl, 'http://localhost/v1')
    expect(screen.queryByText('base_url 必须是 http(s)')).not.toBeInTheDocument()
    expect(screen.getByText('API key 与环境变量名至少填一个')).toBeInTheDocument()
  })

  it('空列表渲染 EmptyState 引导', () => {
    render(<ProvidersView {...props({ providers: [] })} />)
    expect(screen.getByText('还没有 provider')).toBeInTheDocument()
  })
})
```

注意：现有测试里 label 文本通过外层 `<label><span>…</span>` 关联（getByLabelText 可命中）；若断言文案节点与 Input 内建 error 文案重复，改用 `getAllByText` 或收窄容器——以断言语义为准，不许硬改绿。`document.activeElement` 断言需在文件头有 `document` 可用（jsdom 默认有）。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/pages/ProvidersPage.test.tsx`
Expected: 新增 3 例 FAIL（无 EmptyState、错误仍是 formError 单条）

- [ ] **Step 3: 改 View——fieldErrors 校验**

`ProvidersView` 内：删 `formError` state，加 `const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})`。`update` 改为：

```tsx
function update(key: keyof typeof initialForm, value: string) {
  setForm((current) => ({ ...current, [key]: value }))
  setFieldErrors((current) => {
    if (!(key in current)) return current
    const next = { ...current }
    delete next[key]
    return next
  })
}
```

文件顶部（组件外）加顺序与 id 表：

```tsx
const FIELD_IDS: Record<string, string> = {
  base_url: 'provider-base-url',
  max_tokens: 'provider-max-tokens',
  temperature: 'provider-temperature',
  extra: 'provider-extra',
  api_key: 'provider-api-key',
}
const FIELD_ORDER = ['base_url', 'max_tokens', 'temperature', 'extra', 'api_key']

function focusFirstError(errors: Record<string, string>) {
  const key = FIELD_ORDER.find((k) => errors[k])
  if (!key) return
  const el = document.getElementById(FIELD_IDS[key])
  if (!el) return
  el.focus()
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
}
```

`handleSubmit` 整体替换为（校验收集全部字段错误，文案逐字保留）：

```tsx
async function handleSubmit(event: React.FormEvent) {
  event.preventDefault()
  const errors: Record<string, string> = {}
  if (
    !form.base_url.startsWith('http://') &&
    !form.base_url.startsWith('https://')
  ) {
    errors.base_url = 'base_url 必须是 http(s)'
  }
  const maxTokens = readPositiveInt(form.max_tokens)
  if (maxTokens === null) {
    errors.max_tokens = 'max_tokens 必须是正整数'
  }
  const temperature = readNumberInRange(form.temperature, 0, 2)
  if (temperature === null) {
    errors.temperature = 'temperature 必须是 0 到 2 之间的数值'
  }
  let extra: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(form.extra || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      errors.extra = 'extra 必须是 JSON 对象'
    } else {
      extra = parsed as Record<string, unknown>
    }
  } catch {
    errors.extra = 'extra 必须是合法 JSON'
  }
  const apiKey = form.api_key.trim()
  const apiKeyRef = form.api_key_ref.trim()
  if (!apiKey && !apiKeyRef) {
    errors.api_key = 'API key 与环境变量名至少填一个'
  }
  setFieldErrors(errors)
  if (
    Object.keys(errors).length > 0 ||
    maxTokens === null ||
    temperature === null
  ) {
    focusFirstError(errors)
    return
  }
  try {
    await onCreate({
      name: form.name,
      base_url: form.base_url,
      model: form.model,
      api_key_ref: apiKeyRef,
      ...(apiKey ? { api_key: apiKey } : {}),
      params: {
        temperature,
        max_tokens: maxTokens,
        extra,
      },
    })
    setForm(initialForm)
    setFieldErrors({})
  } catch {
    // 提交失败反馈走页面层 toast（决策 ①），字段错误已常驻
  }
}
```

- [ ] **Step 4: 改 View JSX——error prop + 提交行 + 空态 + 骨架**

表单区逐个输入替换（保留 `required`/`type`/`autoComplete`/`placeholder` 等原有属性；每个 `onChange` 不变仍走 `update`）：

- 名称 Input 加 `id="provider-name"`（无校验错误，不加 error prop）
- 模型 Input 加 `id="provider-model"`
- base_url Input 加 `id="provider-base-url" error={fieldErrors.base_url}`
- API key Input 加 `id="provider-api-key" error={fieldErrors.api_key}`
- API key 环境变量 Input 加 `id="provider-api-key-ref"`
- temperature Input 加 `id="provider-temperature" error={fieldErrors.temperature}`
- max_tokens Input 加 `id="provider-max-tokens" error={fieldErrors.max_tokens}`
- extra Textarea 加 `id="provider-extra" error={fieldErrors.extra}`

提交行替换（Button 原语 `loading` 内建 spinner，删除手动 Spinner 与 formError 段）：

```tsx
<div className="flex items-center gap-3 md:col-span-2">
  <Button variant="primary" type="submit" loading={submitting}>
    保存 provider
  </Button>
</div>
```

列表区骨架与空态替换：

```tsx
{loading ? (
  <PageSkeleton variant="cards" count={2} />
) : providers.length === 0 ? (
  // 加载失败时只留错误横幅，不再叠一句“还没有 provider”的引导文案
  error ? null : (
    <EmptyState
      title="还没有 provider"
      hint="可在上方表单直接保存 API key，或用环境变量名回退。"
    />
  )
) : (
```

imports 调整：删 `import { Skeleton }` 与 `import { Spinner }`（确认文件内无其他使用点后）；加 `import { EmptyState } from '../ui/EmptyState'`、`import { PageSkeleton } from '../ui/PageSkeleton'`。

- [ ] **Step 5: 改页面层——toast 接线**

`ProvidersPage`（default export）加 `const toast = useToast()`，四个 handler 包装（View 的 handleSetKey/handleClearKey/handleProbe 内部 catch 保留 keyErrors/probes 展示不动——它们 rethrow 到这里）：

```tsx
import { useToast } from '../ui/Toast'
import { toastError } from '../ui/toastError'
...
onCreate={async (payload) => {
  try {
    await create.mutateAsync(payload)
    toast.success('Provider 已创建')
  } catch (err) {
    toastError(toast, err)
    throw err
  }
}}
onProbe={async (id) => {
  try {
    return await probe.mutateAsync(id)
  } catch (err) {
    toastError(toast, err)
    throw err
  }
}}
onSetKey={async (id, key) => {
  try {
    await setKey.mutateAsync({ id, key })
    toast.success('API key 已保存')
  } catch (err) {
    toastError(toast, err)
    throw err
  }
}}
onClearKey={async (id) => {
  try {
    await clearKey.mutateAsync(id)
    toast.success('API key 已清除')
  } catch (err) {
    toastError(toast, err)
    throw err
  }
}}
```

- [ ] **Step 6: 迁移受影响旧断言**

文件内所有断言 `formError` 文案或表单区 `role="alert"` 的用例：字段校验类改为断言字段错误文案（如 `getByText('base_url 必须是 http(s)')`）；提交失败类改写到 Task 2 Step 7 的页面级 toast 测试。逐条过语义，禁止纯删。

- [ ] **Step 7: 写页面级 toast 测试**

在 `ProvidersPage.test.tsx` 追加（脚手架仿照 `BenchmarksPage.test.tsx` 的 `BenchmarksPage` describe：`vi.stubGlobal('fetch', fetchMock)` + `QueryClientProvider` + `MemoryRouter`，外面包一层 `<ToastProvider>`）：

```tsx
import { ToastProvider } from '../ui/Toast'
import ProvidersPage from './ProvidersPage' // 若文件已 default import 则复用

describe('ProvidersPage toast', () => {
  it('创建成功出成功 toast', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? {
            ok: true,
            status: 201,
            statusText: 'Created',
            json: async () => ({ id: 'p1', name: 'n', base_url: 'u', model: 'm', api_key_ref: '', params: {}, key_configured: false, key_stored: false, created_at: '2026-10-31T00:00:00+00:00' }),
          }
        : { ok: true, status: 200, statusText: 'OK', json: async () => [] },
    )
    vi.stubGlobal('fetch', fetchMock)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter>
            <ProvidersPage />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    )
    await user.type(screen.getByLabelText('名称'), 'n')
    await user.type(screen.getByLabelText('模型'), 'm')
    await user.type(screen.getByLabelText('API key（可选，保存后不回显）'), 'k')
    await user.click(screen.getByRole('button', { name: '保存 provider' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Provider 已创建')
  })

  it('创建失败经 toastError 出错误 toast', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? { ok: false, status: 500, statusText: 'Internal Server Error', json: async () => ({ detail: 'boom' }) }
        : { ok: true, status: 200, statusText: 'OK', json: async () => [] },
    )
    vi.stubGlobal('fetch', fetchMock)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter>
            <ProvidersPage />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    )
    await user.type(screen.getByLabelText('API key（可选，保存后不回显）'), 'k')
    await user.click(screen.getByRole('button', { name: '保存 provider' }))
    const toast = await screen.findByRole('alert')
    expect(toast).toHaveTextContent('boom')
  })
})
```

（失败文案以 `describeError` 对 500+detail 的实际输出为准——先跑一次看 toast 实际文案，若 detail 非中文前缀则断言 `toContainText('boom')`，与 `lib/errors.test.ts` 的转译规则一致，不猜。）

- [ ] **Step 8: 全量测试回归**

Run: `npm run typecheck && npm run test:run`
Expected: 全绿

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/ProvidersPage.tsx frontend/src/pages/ProvidersPage.test.tsx
git commit -m "feat: ProvidersPage toast 全接入与字段级校验，空态/骨架收敛"
```

---

### Task 3: BenchmarksPage——toast + 字段校验 + conflict 行内保留 + 空态 + 骨架

**Files:**
- Modify: `frontend/src/pages/BenchmarksPage.tsx`
- Test: `frontend/src/pages/BenchmarksPage.test.tsx`

**Interfaces:**
- Consumes: 同 Task 2 模式；`readConflict`（文件内已有，409 解析）不动。
- Produces: fieldErrors keys：`name` / `depths` / `per_depth` / `seed`；conflict 提示保留为提交行内 `role="alert"`（Plan Ruling：带跳转链接，不进 toast）。

**字段与 id 映射（提交聚焦顺序 = 校验顺序）：**

| fieldErrors key | 输入 id / 聚焦目标 | 校验文案 |
|---|---|---|
| name | benchmark-name | 名称不能包含 / # ? |
| depths | 容器 `#benchmark-depths` 内第一个 checkbox | 至少选择一个深度 |
| per_depth | benchmark-per-depth | 每档题数必须是正整数 |
| seed | benchmark-seed | seed 必须是整数 |

- [ ] **Step 1: 写失败测试**

在 `BenchmarksPage.test.tsx` 的 View describe 内追加（沿用现有 props 工厂与渲染 helper）：

```tsx
it('提交时字段错误全显并聚焦（depths 聚焦到第一个 checkbox）', async () => {
  render(<BenchmarksView {...viewProps} />)
  await user.type(screen.getByLabelText('每档题数'), 'x') // 触发 per_depth 非法
  await user.click(screen.getByRole('button', { name: '生成基准集' }))
  expect(screen.getByText('至少选择一个深度')).toBeInTheDocument()
  expect(screen.getByText('每档题数必须是正整数')).toBeInTheDocument()
  expect(document.activeElement).toHaveAttribute('type', 'checkbox')
})

it('空列表渲染 EmptyState', () => {
  render(<BenchmarksView {...viewProps({ benchmarks: [], error: null })} />)
  expect(screen.getByText('还没有基准集')).toBeInTheDocument()
})
```

（`viewProps` 为文件内现有 props 构造方式，按实际签名适配；'x' 输入到 number input 在 jsdom 中 value 为 'x'——若 `readPositiveInt('x')` 语义不达，改为 `clear` 后提交，断言同文案。以实测为准，不猜。）

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/pages/BenchmarksPage.test.tsx`
Expected: 新增用例 FAIL

- [ ] **Step 3: 改 View——fieldErrors + conflict 拆分**

state：删 `formError`，加 `fieldErrors`；`conflictId` 保留。`update` 加输入即清（同 Task 2 Step 3 模式）；`toggleDepth` 与 `setCube` 里加 `setFieldErrors((current) => ({ ...current, depths: undefined }))` 的等价清除（用 Task 2 的 delete-next 模式清 `depths` key）。

组件外加：

```tsx
const FIELD_IDS: Record<string, string> = {
  name: 'benchmark-name',
  depths: 'benchmark-depths',
  per_depth: 'benchmark-per-depth',
  seed: 'benchmark-seed',
}
const FIELD_ORDER = ['name', 'depths', 'per_depth', 'seed']

function focusFirstError(errors: Record<string, string>) {
  const key = FIELD_ORDER.find((k) => errors[k])
  if (!key) return
  if (key === 'depths') {
    const box = document.querySelector(
      '#benchmark-depths input[type=checkbox]',
    )
    if (box) {
      ;(box as HTMLElement).focus()
      box.scrollIntoView({ block: 'center', behavior: 'smooth' })
      return
    }
  }
  const el = document.getElementById(FIELD_IDS[key])
  if (!el) return
  el.focus()
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
}
```

`handleSubmit` 校验段整体替换（全部收集，逐字文案）：

```tsx
const errors: Record<string, string> = {}
if (FORBIDDEN_NAME_CHARS.some((char) => form.name.includes(char))) {
  errors.name = '名称不能包含 / # ?'
}
if (form.depths.length === 0) {
  errors.depths = '至少选择一个深度'
}
const perDepth = readPositiveInt(form.per_depth)
if (perDepth === null) {
  errors.per_depth = '每档题数必须是正整数'
}
const seed = readInteger(form.seed)
if (seed === null) {
  errors.seed = 'seed 必须是整数'
}
setFieldErrors(errors)
if (
  Object.keys(errors).length > 0 ||
  perDepth === null ||
  seed === null
) {
  focusFirstError(errors)
  return
}
```

catch 段：conflict 分支保留 `setConflictId(...)`，`setFormError(...)` 调用删除；else 分支整个删除（toast 在页面层）：

```tsx
} catch (err) {
  const conflict = readConflict(err)
  if (conflict) {
    setConflictId(conflict.id)
  }
  // 非 409 失败走页面层 toast（决策 ①）
} finally {
```

- [ ] **Step 4: 改 View JSX**

- 名称 Input 加 `id="benchmark-name" error={fieldErrors.name}`
- 每档题数 Input 加 `id="benchmark-per-depth" error={fieldErrors.per_depth}`
- seed Input 加 `id="benchmark-seed" error={fieldErrors.seed}`
- 打乱深度容器 `<div className="flex flex-wrap gap-3">` 外层（`grid gap-1 text-sm md:col-span-2` 的 div）加 `id="benchmark-depths"`；depths 错误文案渲染在该容器之后：`{fieldErrors.depths && <p role="alert" className="text-xs text-rose-300">{fieldErrors.depths}</p>}`（注意与现有「3x3 生成需要已构建 twophase 表」提示共存，放其后面）
- 提交行：`<Button variant="primary" type="submit" loading={submitting}>生成基准集</Button>`（删手动 Spinner）；formError 段替换为 conflict 行内（Plan Ruling）：

```tsx
{conflictId !== null && (
  <p role="alert" className="text-sm text-rose-300">
    {conflictId ? `已存在同 id 题集：${conflictId}` : '已存在同 id 题集'}
    {conflictId && (
      <Link
        className="ml-2 text-accent underline"
        to={`/benchmarks/${encodeURIComponent(conflictId)}`}
      >
        查看已有题集
      </Link>
    )}
  </p>
)}
```

- 列表区：`loading ? <PageSkeleton variant="table" rows={4} /> : benchmarks.length === 0 ? (error ? null : <EmptyState title="还没有基准集" hint="用下方表单生成第一份题集。" />) : (...)`。
- imports：删 `Skeleton`/`Spinner`（确认无他用）；加 `EmptyState`、`PageSkeleton`。

- [ ] **Step 5: 页面层 toast + 测试迁移**

`BenchmarksPage`（default export）加 `useToast`，`onCreate` 包装：

```tsx
onCreate={async (payload) => {
  try {
    await create.mutateAsync(payload)
    toast.success('题集已生成')
  } catch (err) {
    toastError(toast, err)
    throw err
  }
}}
```

现有测试迁移：`maps a non-conflict backend error through describeError`（约 ：173）与 `maps a load failure through describeError`（约 ：486）——前者是 View 级提交失败断言（formError 上屏英文 detail），改为页面级 toast 断言（参照 Task 2 Step 7 脚手架包 ToastProvider，断言 `findByRole('alert')` 含 describeError 输出；注意与 conflict 行内 `role="alert"` 的数量区分，用 `getAllByRole('alert')` + textContent 匹配）；后者是列表加载失败 Alert（页面级加载失败，保留不动，仅确认仍绿）。409 conflict 测试（约 ：380 的「查看已有题集」）断言结构不变，确认仍绿。

- [ ] **Step 6: 全量测试回归**

Run: `npm run typecheck && npm run test:run`
Expected: 全绿

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/BenchmarksPage.tsx frontend/src/pages/BenchmarksPage.test.tsx
git commit -m "feat: BenchmarksPage toast/字段级校验，409 冲突行内保留，空态/骨架收敛"
```

---

### Task 4: NewRunPage——toast + 字段校验（validate() 重构）+ 骨架

**Files:**
- Modify: `frontend/src/pages/NewRunPage.tsx`
- Test: `frontend/src/pages/NewRunPage.test.tsx`

**Interfaces:**
- Consumes: 同 Task 2 模式。
- Produces: `validate(): { errors: Record<string, string>; budget: Budget | null; params: Record<string, number> }`（替换现有 `parseBudget`/`parseParams` 两个函数——它们返回 `Budget | string` 的双态签名与全显语义冲突）。

**字段与 id 映射（提交聚焦顺序 = 校验顺序）：**

| fieldErrors key | 输入 id | 校验文案 |
|---|---|---|
| providerId | newrun-provider | 请选择 provider 和 benchmark |
| max_moves | newrun-budget-max_moves | max_moves 必须是正整数 |
| max_tool_calls | newrun-budget-max_tool_calls | max_tool_calls 必须是正整数 |
| max_tokens | newrun-budget-max_tokens | max_tokens 必须是正整数 |
| max_seconds | newrun-budget-max_seconds | max_seconds 必须是正数 |
| turn_timeout | newrun-budget-turn_timeout | turn_timeout 必须是正数 |
| temperature | newrun-temperature | temperature 必须是 0 到 2 之间的数值 |
| params_max_tokens | newrun-params-max-tokens | max_tokens 必须是正整数 |

（`params_max_tokens` 与预算 `max_tokens` 是两个不同字段，key 必须区分；输入框 aria-label `params_temperature` / `params_max_tokens` 保留。）

- [ ] **Step 1: 写失败测试**

`NewRunPage.test.tsx` 的 View describe 追加（沿用现有 View 渲染 helper；测试数据里有 provider/benchmark）：

```tsx
it('预算字段错误全显并聚焦首个错误', async () => {
  render(<NewRunView {...viewProps} />)
  const maxMoves = screen.getByLabelText('max_moves')
  await user.clear(maxMoves)
  const seconds = screen.getByLabelText('max_seconds')
  await user.clear(seconds)
  await user.click(screen.getByRole('button', { name: '启动 run' }))
  expect(screen.getByText('max_moves 必须是正整数')).toBeInTheDocument()
  expect(screen.getByText('max_seconds 必须是正数')).toBeInTheDocument()
  expect(document.activeElement).toBe(maxMoves)
})

it('清空可选参数不报错（留空沿用 provider 默认）', async () => {
  render(<NewRunView {...viewProps} />)
  await user.clear(screen.getByLabelText('params_temperature'))
  await user.clear(screen.getByLabelText('params_max_tokens'))
  await user.click(screen.getByRole('button', { name: '启动 run' }))
  expect(screen.queryByText('temperature 必须是 0 到 2 之间的数值')).not.toBeInTheDocument()
})
```

（`viewProps` 按文件内现有 View props 构造适配。）

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/pages/NewRunPage.test.tsx`
Expected: 新增用例 FAIL

- [ ] **Step 3: 重构校验为 validate()**

删 `formError` state 加 `fieldErrors`；删 `parseBudget`/`parseParams` 两个函数，组件内加（留空语义与文案逐字保留）：

```tsx
function validate(): {
  errors: Record<string, string>
  budget: Budget | null
  params: Record<string, number>
} {
  const errors: Record<string, string> = {}
  if (!providerId || !benchmarkId) {
    errors.providerId = '请选择 provider 和 benchmark'
  }
  const budgetOut: Partial<Budget> = {}
  let budgetOk = true
  for (const key of ['max_moves', 'max_tool_calls', 'max_tokens'] as const) {
    const value = readPositiveInt(budget[key])
    if (value === null) {
      errors[key] = `${key} 必须是正整数`
      budgetOk = false
    } else {
      budgetOut[key] = value
    }
  }
  for (const key of ['max_seconds', 'turn_timeout'] as const) {
    const value = readPositiveNumber(budget[key])
    if (value === null) {
      errors[key] = `${key} 必须是正数`
      budgetOk = false
    } else {
      budgetOut[key] = value
    }
  }
  const params: Record<string, number> = {}
  if (temperature.trim() !== '') {
    const value = readNumberInRange(temperature, 0, 2)
    if (value === null) {
      errors.temperature = 'temperature 必须是 0 到 2 之间的数值'
    } else {
      params.temperature = value
    }
  }
  if (maxTokens.trim() !== '') {
    const value = readPositiveInt(maxTokens)
    if (value === null) {
      errors.params_max_tokens = 'max_tokens 必须是正整数'
    } else {
      params.max_tokens = value
    }
  }
  return {
    errors,
    budget: budgetOk ? (budgetOut as Budget) : null,
    params,
  }
}

const FIELD_IDS: Record<string, string> = {
  providerId: 'newrun-provider',
  max_moves: 'newrun-budget-max_moves',
  max_tool_calls: 'newrun-budget-max_tool_calls',
  max_tokens: 'newrun-budget-max_tokens',
  max_seconds: 'newrun-budget-max_seconds',
  turn_timeout: 'newrun-budget-turn_timeout',
  temperature: 'newrun-temperature',
  params_max_tokens: 'newrun-params-max-tokens',
}
const FIELD_ORDER = [
  'providerId',
  'max_moves',
  'max_tool_calls',
  'max_tokens',
  'max_seconds',
  'turn_timeout',
  'temperature',
  'params_max_tokens',
]

function focusFirstError(errors: Record<string, string>) {
  const key = FIELD_ORDER.find((k) => errors[k])
  if (!key) return
  const el = document.getElementById(FIELD_IDS[key])
  if (!el) return
  el.focus()
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
}
```

（`FIELD_IDS`/`FIELD_ORDER`/`focusFirstError` 放组件外；`validate` 用到组件 state 放组件内。）

`handleSubmit` 替换：

```tsx
async function handleSubmit(event: React.FormEvent) {
  event.preventDefault()
  const { errors, budget: parsedBudget, params: parsedParams } = validate()
  setFieldErrors(errors)
  if (Object.keys(errors).length > 0 || parsedBudget === null) {
    focusFirstError(errors)
    return
  }
  try {
    await onCreate({
      provider_id: providerId,
      benchmark_id: benchmarkId,
      tool_mode: toolMode,
      params: parsedParams,
      budget: parsedBudget,
    })
  } catch {
    // toast 由页面层出（决策 ①）
  }
}
```

输入即清：`updateBudget` 清 `budget[key]` 对应错误；`setTemperature` 的 onChange 处清 `temperature`；`setMaxTokens` 的 onChange 处清 `params_max_tokens`；`setProviderId` 的 onChange 处清 `providerId`（模式同 Task 2 的 delete-next）。

- [ ] **Step 4: 改 JSX + 骨架 + 页面层 toast**

- Provider Select 加 `id="newrun-provider"`；预算五个 Input 加 `id={`newrun-budget-${key}`}`（aria-label 保留）并传 `error={fieldErrors[key]}`；temperature Input 加 `id="newrun-temperature" error={fieldErrors.temperature}`；max_tokens Input 加 `id="newrun-params-max-tokens" error={fieldErrors.params_max_tokens}`。
- 提交行：`<Button variant="primary" type="submit" loading={submitting}>启动 run</Button>`，删 formError 段。（`submitting` local state 保留。）
- 页面 default export 的 pending 分支：三行 Skeleton 换 `<PageSkeleton variant="form" fields={5} />`（`useEffect` 预算回填等逻辑不动）。
- 页面层 toast：`const toast = useToast()`；`onCreate` 包装：

```tsx
onCreate={async (payload) => {
  try {
    await create.mutateAsync(payload)
    toast.success('Run 已创建')
  } catch (err) {
    toastError(toast, err)
    throw err
  }
}}
```

- imports：删 `Skeleton`（确认无他用）；加 `PageSkeleton`、`useToast`、`toastError`。

- [ ] **Step 5: 测试迁移 + 全量回归**

现有 `maps a rejected create through describeError`（约 ：205）改为页面级 toast 断言（脚手架同 Task 2 Step 7，包 ToastProvider；该测试若已渲染 NewRunPage 则只需包 provider 并改断言目标为 toast）。Run：`npm run typecheck && npm run test:run`，全绿。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/NewRunPage.tsx frontend/src/pages/NewRunPage.test.tsx
git commit -m "feat: NewRunPage validate() 全显字段校验与 toast，form 骨架收敛"
```

---

### Task 5: RunPage cancel toast + RunsPage 空态 + 详情页骨架

**Files:**
- Modify: `frontend/src/pages/RunPage.tsx`（cancel mutation）
- Modify: `frontend/src/pages/RunsPage.tsx`（空态 + 骨架）
- Modify: `frontend/src/pages/BenchmarkDetailPage.tsx`（骨架）
- Modify: `frontend/src/pages/EpisodePage.tsx`（骨架）
- Test: `frontend/src/pages/RunPage.test.tsx`
- Test: `frontend/src/pages/NewRunPage.test.tsx`（RunsPage 空态用例所在文件，约 ：492/:531 的 RunsView/RunsPage describe）

**Interfaces:**
- Consumes: `toastError`、`PageSkeleton`、`EmptyState`、`useToast`。
- Produces: 无新接口。

- [ ] **Step 1: 写失败测试**

`RunPage.test.tsx`：`renderPage` helper 的渲染树（约 ：295）在 QueryClientProvider 内层包 `<ToastProvider>`，追加用例：

```tsx
it('取消成功出「已取消」toast', async () => {
  renderPage({ snapshotState: null })
  const user = userEvent.setup()
  const cancelBtn = screen.getByRole('button', { name: '取消' })
  await user.click(cancelBtn)
  expect(await screen.findByRole('status')).toHaveTextContent('已取消')
})
```

（取消按钮的可达性以现渲染树为准：若 `renderPage` 的 run 状态非 running 导致无取消按钮，用其现有 mock 让 run 为 running——`renderPage` 内 mock 数据已经提供，实施者按实际 mock 调整触发方式，断言 toast 文案不变。api.runs.cancel 已在 renderPage 的 api mock 里 stub 成功。）

`NewRunPage.test.tsx` 的 RunsPage describe（约 ：492）追加：

```tsx
it('RunsView 空数据渲染 EmptyState 与引导链接', () => {
  render(
    <MemoryRouter>
      <RunsView runs={[]} providers={[]} benchmarks={[]} />
    </MemoryRouter>,
  )
  expect(screen.getByText('还没有运行记录')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '去创建 Run' })).toHaveAttribute(
    'href',
    '/runs/new',
  )
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/pages/RunPage.test.tsx src/pages/NewRunPage.test.tsx`
Expected: 新增 2 例 FAIL

- [ ] **Step 3: 实现**

`RunPage.tsx` default export：`const toast = useToast()`；cancel mutation 改为（onError 里既有 invalidate 保留——409 已结束时刷状态的行为不动）：

```tsx
const cancel = useMutation({
  mutationFn: () => api.runs.cancel(id!),
  onSuccess: () => {
    toast.success('已取消')
    void queryClient.invalidateQueries({ queryKey: qk.run(id!) })
  },
  // spec §8：409（已结束/不可取消）时刷新状态，别让界面停在旧的“运行中”。
  onError: (err) => {
    toastError(toast, err)
    void queryClient.invalidateQueries({ queryKey: qk.run(id!) })
    void queryClient.invalidateQueries({ queryKey: qk.runs })
  },
})
```

imports 加 `useToast`、`toastError`。

`RunsPage.tsx`：RunsView 空分支替换：

```tsx
{runs.length === 0 ? (
  <EmptyState
    title="还没有运行记录"
    action={
      <Link
        className="rounded bg-accent px-4 py-2 text-sm text-white"
        to="/runs/new"
      >
        去创建 Run
      </Link>
    }
  />
) : (
```

default export pending 分支换 `<PageSkeleton variant="table" rows={4} />`；imports 加 `EmptyState`、`PageSkeleton`，删 `Skeleton`。

`BenchmarkDetailPage.tsx`：isPending 分支换 `<PageSkeleton variant="form" fields={4} />`；imports 同步。

`EpisodePage.tsx`：四 query isPending 分支换 `<PageSkeleton variant="form" fields={4} />`；imports 同步。

- [ ] **Step 4: 全量测试回归**

Run: `npm run typecheck && npm run test:run`
Expected: 全绿

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/RunPage.tsx frontend/src/pages/RunPage.test.tsx frontend/src/pages/RunsPage.tsx frontend/src/pages/BenchmarkDetailPage.tsx frontend/src/pages/EpisodePage.tsx frontend/src/pages/NewRunPage.test.tsx
git commit -m "feat: RunPage 取消 toast、Runs 空态引导、详情页骨架统一"
```

---

### Task 6: E2E + README + 全量验证

**Files:**
- Modify: `frontend/e2e/workbench.spec.ts`
- Modify: `README.md`（U3 段落）

**Interfaces:**
- Consumes: 前五个任务全部落地；workbench spec 现有 provider→benchmark→run→result→replay 流程。
- Produces: 无。

- [ ] **Step 1: E2E 追加 toast 断言**

在 `workbench.spec.ts` 现有流程创建 provider 成功后（提交动作之后、跳转或列表刷新之前后均可，以流程实际顺序为准）追加：

```ts
await expect(page.getByTestId('toast')).toHaveTextContent('Provider 已创建')
```

toast 4 秒自动消失、流程后续还有操作——断言紧跟提交动作放，不做超时放宽（默认 5s 覆盖）。

- [ ] **Step 2: README 更新**

README 的 U1/U2 段落后补 U3 一句：toast 全接入、字段级校验（提交时全显+输入即清）、EmptyState、PageSkeleton；语义色豁免清单追加「toast 反馈」已有项确认（U1 已写入，无需改动则跳过）。

- [ ] **Step 3: 全量验证四连**

Run（frontend/ 下）: `npm run typecheck && npm run test:run && npm run build && npm run e2e`
Expected: 四连全绿；报告记录各自输出摘要（用例数、build 耗时、e2e 通过数）。

- [ ] **Step 4: Commit**

```bash
git add frontend/e2e/workbench.spec.ts README.md
git commit -m "test: E2E provider 创建 toast 断言；README 注记 U3 操作流反馈"
```

---

## Self-Review

1. **Spec 覆盖**：spec §1 toast 清单 7 个 mutation → Task 2（providers×4）/ Task 3（benchmarks）/ Task 4（newrun）/ Task 5（run cancel）；`toastError` helper 与 `ToastApi` 导出 → Task 1；§2 三表单字段级校验 + 聚焦滚动 + 提交 loading → Task 2/3/4；§3 三页空态 → Task 2/3/5；§4 骨架统一（四数据页 + 两详情页）→ Task 2/3/4/5；§5 测试与四连验收 → 各任务测试步骤 + Task 6。无缺口。
2. **占位符扫描**：无 TBD/TODO；测试代码均给出实体（个别标注「按文件内现有 helper 适配」的是既有脚手架引用，非占位）。Task 2 Step 7 失败文案给了实测指引而非猜测值。
3. **类型一致性**：`toastError(toast: ToastApi, err: unknown)` 在 Task 1 定义、Task 2-5 消费一致；`PageSkeleton` props（variant/rows/count/fields）在 Task 1 定义、Task 2 用 cards、Task 3/5 用 table、Task 4/5 用 form，一致；fieldErrors 均为 `Record<string, string>`；`validate()` 返回结构在 Task 4 定义与消费一致。
