# mofang 前端体验升级 U1（视觉底座）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 U1 视觉底座——`@theme` token 扩容、原语升级与新增、Layout 壳精修、motion 接入——为 U2–U4 提供统一的样式与动效地基。

**Architecture:** 全部改动限定 `frontend/`。token 在 `index.css` 的 `@theme` 扩容（Tailwind v4 自动生成对应 utility）；原语层改 6 个、新增 4 个，全部向后兼容（现有调用点除 Button 默认 variant 重命名外零改动）；Toast 用 context + portal，动效统一走 motion（`MotionConfig reducedMotion="user"` 全局尊重系统设置）。

**Tech Stack:** React 19 + Tailwind v4 + Vitest + Testing Library + motion（唯一新增运行时依赖，^15）。

**Spec:** docs/superpowers/specs/2026-10-31-ui-upgrade-design.md

## Global Constraints

- 新增运行时依赖仅 `motion` 一个；不新增字体文件、图标库。
- 后端零改动；不改任何 SSE 事件契约。
- 现有 197 个前端测试全绿是硬门槛；原语向后兼容，调用点只做机械替换。
- CSS transition 一律引用 token（`duration-fast` / `duration-med` / `ease-standard`），不写裸毫秒。
- 色彩语义豁免维持：StatusBadge 与 Toast 的 sky/emerald/rose/amber 是运行状态语义，不收敛到主题 token（components/StatusBadge.tsx 内注释为惯例出处）。
- `prefers-reduced-motion` 必须被尊重（MotionConfig + CSS `@media` 兜底）。
- 验收命令：`npm run typecheck`、`npm run test:run`、`npm run build`、`npm run e2e`（在 frontend/ 下）。

---

### Task 1: motion 依赖与 token 扩容

**Files:**
- Modify: `frontend/package.json`（npm install 自动写入）
- Modify: `frontend/src/index.css`
- Test: `frontend/src/tokens.test.ts`（新建）

**Interfaces:**
- Consumes: 无。
- Produces: Tailwind utilities `bg-surface-2`、`bg-accent-soft`、`font-mono`、`duration-fast`、`duration-med`、`ease-standard`（后续所有任务使用）；`motion/react` 可导入。

- [ ] **Step 1: 安装 motion**

```bash
cd frontend && npm install motion
```

- [ ] **Step 2: 写 token 守卫测试**

```ts
// frontend/src/tokens.test.ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('theme tokens', () => {
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
  it.each([
    '--color-surface-2',
    '--color-accent-soft',
    '--font-mono',
    '--duration-fast',
    '--duration-med',
    '--ease-standard',
  ])('defines %s', (token) => {
    expect(css).toContain(`${token}:`)
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd frontend && npx vitest run src/tokens.test.ts`
Expected: FAIL（`--color-surface-2` 等未定义）

- [ ] **Step 4: 扩容 `@theme`**

`frontend/src/index.css` 的 `@theme` 块整体替换为：

```css
@theme {
  --color-canvas: #020617; /* slate-950 */
  --color-surface: #0f172a; /* slate-900 */
  --color-surface-2: #16213b; /* 卡片层：surface 亮半档 */
  --color-sunken: #020617; /* slate-950 */
  --color-line: #1e293b; /* slate-800 */
  --color-accent: #059669; /* emerald-600 */
  --color-accent-dim: #047857; /* emerald-700 */
  --color-accent-soft: rgba(5, 150, 105, 0.15); /* 选中态/徽标底 */
  --color-danger: #be123c; /* rose-700 */
  --color-warning: #d97706; /* amber-600 */
  --color-text-strong: #f1f5f9; /* slate-100 */
  --color-text: #cbd5e1; /* slate-300 */
  --color-text-dim: #94a3b8; /* slate-400 */
  --font-mono: ui-monospace, "Cascadia Mono", "Segoe UI Mono", Menlo,
    Consolas, monospace;
  --duration-fast: 150ms;
  --duration-med: 250ms;
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
}
```

文件末尾（`* { box-sizing: border-box; }` 之后）追加 reduced-motion 兜底：

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 5: 跑测试确认通过 + 构建验证**

Run: `cd frontend && npx vitest run src/tokens.test.ts && npm run build`
Expected: PASS，build 成功

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/index.css frontend/src/tokens.test.ts
git commit -m "feat: U1 token 扩容（surface-2/accent-soft/font-mono/动效 token）并接入 motion 依赖"
```

---

### Task 2: Button 升级（variant 重命名 + size + loading + focus ring）

**Files:**
- Modify: `frontend/src/ui/Button.tsx`
- Modify: `frontend/src/ui/primitives.test.tsx`（Button describe 块）
- Modify: `frontend/src/ui/primitives.test.tsx` 中 `variant="neutral"` 断言 → `"secondary"`

**Interfaces:**
- Consumes: `Spinner`（已存在 `frontend/src/ui/Spinner.tsx`）。
- Produces: `Button` props = `ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary'|'secondary'|'ghost'|'danger'|'warning'; size?: 'sm'|'md'; loading?: boolean }`；默认 `variant='secondary'`、`size='md'`。旧 `'neutral'` 移除（调用点检查见 Step 4）。

- [ ] **Step 1: 更新与新增 Button 测试**

`primitives.test.tsx` 的 `describe('Button')` 块整体替换为：

```tsx
import { Button } from './Button'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

describe('Button', () => {
  it.each([
    ['primary', 'bg-accent'],
    ['secondary', 'border-line'],
    ['ghost', 'text-text-dim'],
    ['danger', 'border-danger'],
    ['warning', 'border-warning'],
  ] as const)('renders %s variant class', (variant, expected) => {
    render(<Button variant={variant}>go</Button>)
    expect(screen.getByRole('button', { name: 'go' })).toHaveClass(expected)
  })

  it('defaults to secondary and passes through type and disabled', () => {
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

  it('size sm renders smaller padding and text', () => {
    render(<Button size="sm">go</Button>)
    expect(screen.getByRole('button', { name: 'go' })).toHaveClass('px-2.5')
    expect(screen.getByRole('button', { name: 'go' })).toHaveClass('text-xs')
  })

  it('loading shows spinner, disables and blocks clicks', async () => {
    const onClick = vi.fn()
    render(
      <Button loading onClick={onClick}>
        提交
      </Button>,
    )
    const button = screen.getByRole('button', { name: '提交' })
    expect(button).toBeDisabled()
    expect(button.querySelector('[role="status"]')).not.toBeNull()
    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('renders focus-visible accent ring class', () => {
    render(<Button>go</Button>)
    expect(screen.getByRole('button')).toHaveClass('focus-visible:outline-accent')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd frontend && npx vitest run src/ui/primitives.test.ts`
Expected: FAIL（ghost/size/loading 断言不通过）

- [ ] **Step 3: 重写 Button**

`frontend/src/ui/Button.tsx` 整体替换为：

```tsx
import type { ButtonHTMLAttributes } from 'react'
import { Spinner } from './Spinner'

const VARIANTS = {
  primary: 'bg-accent text-white hover:bg-accent-dim',
  secondary: 'border border-line text-text hover:bg-surface',
  ghost: 'text-text-dim hover:bg-surface hover:text-text',
  danger: 'border border-danger text-rose-300 hover:bg-rose-950/40',
  warning: 'border border-warning text-amber-300 hover:bg-amber-950/40',
} as const

export type ButtonVariant = keyof typeof VARIANTS

const SIZES = {
  sm: 'rounded-md px-2.5 py-1 text-xs',
  md: 'rounded-md px-3 py-1.5 text-sm',
} as const

export type ButtonSize = keyof typeof SIZES

const FOCUS =
  'transition-colors duration-fast ease-standard focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent'

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  className = '',
  disabled,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}) {
  return (
    <button
      className={`${VARIANTS[variant]} ${SIZES[size]} ${FOCUS} disabled:opacity-50 disabled:pointer-events-none ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <>
          <Spinner className="mr-1.5 align-[-2px]" />
          {children}
        </>
      ) : (
        children
      )}
    </button>
  )
}
```

- [ ] **Step 4: 检查旧 variant 调用点**

Run: `grep -rn 'variant="neutral"\|variant={.*neutral' frontend/src`
Expected: 无输出（生产代码只有 primary/danger/warning 显式 variant；默认值调用点随默认值切换到 secondary 视觉，属预期）。
若出现输出：把 `neutral` 机械替换为 `secondary`。

- [ ] **Step 5: 跑全量前端测试**

Run: `cd frontend && npm run test:run`
Expected: 全绿（若有页面测试断言 neutral 类名，按同样方式机械替换）

- [ ] **Step 6: Commit**

```bash
git add frontend/src/ui/Button.tsx frontend/src/ui/primitives.test.tsx
git commit -m "feat: Button 升级 variant/size/loading/focus ring，neutral 更名 secondary"
```

---

### Task 3: Input / Textarea label+error 附着，新增 Select

**Files:**
- Modify: `frontend/src/ui/Input.tsx`
- Modify: `frontend/src/ui/Textarea.tsx`
- Create: `frontend/src/ui/Select.tsx`
- Test: `frontend/src/ui/primitives.test.tsx`

**Interfaces:**
- Consumes: 无。
- Produces: `Input` / `Textarea` / `Select` 共同新增 props `{ label?: string; error?: string }`；有 label 或 error 时渲染包裹层（label + 控件 + 错误文案），否则渲染裸控件（现有调用点不受影响）。`Select` 与原生 select 同名 props 透传。

- [ ] **Step 1: 写失败测试**

在 `primitives.test.tsx` 追加（import 区补 `Select`）：

```tsx
describe('Input label/error', () => {
  it('renders bare input when no label and no error', () => {
    render(<Input aria-label="q" />)
    expect(screen.getByLabelText('q').tagName).toBe('INPUT')
  })

  it('wraps with label and error text and sets aria-invalid', () => {
    render(<Input label="名称" error="必填" />)
    expect(screen.getByText('名称')).toBeInTheDocument()
    expect(screen.getByText('必填')).toBeInTheDocument()
    expect(screen.getByLabelText('名称')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('名称')).toHaveClass('border-danger')
  })
})

describe('Select', () => {
  it('wraps with label and renders options', () => {
    render(
      <Select label="速度" defaultValue="1">
        <option value="1">1×</option>
        <option value="2">2×</option>
      </Select>,
    )
    expect(screen.getByLabelText('速度').tagName).toBe('SELECT')
    expect(screen.getByRole('option', { name: '2×' })).toBeInTheDocument()
  })

  it('shows error tone', () => {
    render(
      <Select aria-label="s" error="必选">
        <option>1</option>
      </Select>,
    )
    expect(screen.getByLabelText('s')).toHaveClass('border-danger')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd frontend && npx vitest run src/ui/primitives.test.ts`
Expected: FAIL（label/error 不存在、Select 无此导出）

- [ ] **Step 3: 重写 Input**

`frontend/src/ui/Input.tsx` 整体替换为：

```tsx
import { useId, type InputHTMLAttributes } from 'react'

const FIELD =
  'rounded-md bg-sunken px-3 py-2 text-sm transition-colors duration-fast placeholder:text-text-dim focus-visible:outline-2 focus-visible:outline-accent'

export function Input({
  label,
  error,
  className = '',
  id,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label?: string; error?: string }) {
  const autoId = useId()
  const inputId = id ?? autoId
  const field = (
    <input
      id={inputId}
      aria-invalid={error ? true : undefined}
      className={`${FIELD} ${error ? 'border border-danger' : 'border border-transparent'} ${className}`}
      {...rest}
    />
  )
  if (!label && !error) return field
  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={inputId} className="block text-xs text-text-dim">
          {label}
        </label>
      )}
      {field}
      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 4: 重写 Textarea（同构）**

`frontend/src/ui/Textarea.tsx` 整体替换为：

```tsx
import { useId, type TextareaHTMLAttributes } from 'react'

const FIELD =
  'rounded-md bg-sunken px-3 py-2 text-sm transition-colors duration-fast placeholder:text-text-dim focus-visible:outline-2 focus-visible:outline-accent'

export function Textarea({
  label,
  error,
  className = '',
  id,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; error?: string }) {
  const autoId = useId()
  const fieldId = id ?? autoId
  const field = (
    <textarea
      id={fieldId}
      aria-invalid={error ? true : undefined}
      className={`${FIELD} ${error ? 'border border-danger' : 'border border-transparent'} ${className}`}
      {...rest}
    />
  )
  if (!label && !error) return field
  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={fieldId} className="block text-xs text-text-dim">
          {label}
        </label>
      )}
      {field}
      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 5: 新建 Select**

`frontend/src/ui/Select.tsx`：

```tsx
import { useId, type SelectHTMLAttributes } from 'react'

export function Select({
  label,
  error,
  className = '',
  id,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label?: string; error?: string }) {
  const autoId = useId()
  const selectId = id ?? autoId
  const field = (
    <select
      id={selectId}
      aria-invalid={error ? true : undefined}
      className={`rounded-md bg-sunken px-2 py-2 text-sm transition-colors duration-fast focus-visible:outline-2 focus-visible:outline-accent ${error ? 'border border-danger' : 'border border-transparent'} ${className}`}
      {...rest}
    >
      {children}
    </select>
  )
  if (!label && !error) return field
  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={selectId} className="block text-xs text-text-dim">
          {label}
        </label>
      )}
      {field}
      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `cd frontend && npm run test:run`
Expected: 全绿

- [ ] **Step 7: Commit**

```bash
git add frontend/src/ui/Input.tsx frontend/src/ui/Textarea.tsx frontend/src/ui/Select.tsx frontend/src/ui/primitives.test.tsx
git commit -m "feat: Input/Textarea label+error 附着，新增 Select 原语"
```

---

### Task 4: Card / Table / StatusBadge 精修

**Files:**
- Modify: `frontend/src/ui/Card.tsx`
- Modify: `frontend/src/ui/Table.tsx`
- Modify: `frontend/src/components/StatusBadge.tsx`
- Test: `frontend/src/ui/primitives.test.tsx`

**Interfaces:**
- Consumes: Task 1 的 `bg-surface-2` / `duration-fast`。
- Produces: `Card`（surface-2 容器）、`Tr`（表格行组件，带 hover）；`StatusBadge` 形状统一、色彩不变。

- [ ] **Step 1: 更新/新增测试**

`primitives.test.tsx` 的 `describe('Card')` 块：把断言 `bg-surface` 改为 `bg-surface-2`（先读现有断言，其余断言保留）。追加：

```tsx
describe('Table row hover', () => {
  it('Tr renders hover transition class', () => {
    render(
      <table>
        <tbody>
          <Tr data-testid="row">
            <Td>cell</Td>
          </Tr>
        </tbody>
      </table>,
    )
    expect(screen.getByTestId('row')).toHaveClass('hover:bg-surface')
  })
})
```

import 区补 `Tr`。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd frontend && npx vitest run src/ui/primitives.test.ts`
Expected: FAIL（bg-surface-2 不存在类、Tr 未导出）

- [ ] **Step 3: 重写 Card**

```tsx
import type { HTMLAttributes } from 'react'

const SHADOW =
  'shadow-[0_1px_2px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.03)]'

export function Card({
  className = '',
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-lg border border-line bg-surface-2 ${SHADOW} ${className}`}
      {...rest}
    />
  )
}
```

- [ ] **Step 4: Table 加 Tr（Th/Td 不动）**

`frontend/src/ui/Table.tsx` 末尾追加：

```tsx
export function Tr({ className = '', ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={`transition-colors duration-fast hover:bg-surface ${className}`}
      {...rest}
    />
  )
}
```

（import 行补 `HTMLTableRowElement` 类型。）

- [ ] **Step 5: StatusBadge 形状统一**

`frontend/src/components/StatusBadge.tsx`：仅把 badge `className` 里的 `rounded` 改为 `rounded-md`，COLORS 映射与其余逻辑、豁免注释一律不动。

- [ ] **Step 6: 跑测试确认通过**

Run: `cd frontend && npm run test:run`
Expected: 全绿（App/页面测试若断言 Card 类名 bg-surface，机械替换为 bg-surface-2）

- [ ] **Step 7: Commit**

```bash
git add frontend/src/ui/Card.tsx frontend/src/ui/Table.tsx frontend/src/components/StatusBadge.tsx frontend/src/ui/primitives.test.tsx
git commit -m "feat: Card surface-2 浮起容器、Table 行 hover、StatusBadge 形状统一"
```

---

### Task 5: Toast 原语

**Files:**
- Create: `frontend/src/ui/Toast.tsx`
- Test: `frontend/src/ui/Toast.test.tsx`（新建）

**Interfaces:**
- Consumes: `motion/react`（Task 1）。
- Produces: `ToastProvider`（包在 Layout 内）、`useToast(): { success(msg: string): void; error(msg: string): void }`；toast 元素带 `data-testid="toast"`；4s 自动消失，同屏最多 4 条。U3 的 mutation 接入使用此 hook。

- [ ] **Step 1: 写失败测试**

```tsx
// frontend/src/ui/Toast.test.tsx
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ToastProvider, useToast } from './Toast'

function Fire({ onReady }: { onReady: () => void }) {
  const toast = useToast()
  return (
    <button
      type="button"
      onClick={() => {
        toast.success('已保存')
        toast.error('失败提示')
        onReady()
      }}
    >
      fire
    </button>
  )
}

describe('Toast', () => {
  it('renders success and error toasts via portal', async () => {
    render(
      <ToastProvider>
        <Fire onReady={() => {}} />
      </ToastProvider>,
    )
    await act(async () => {
      screen.getByRole('button', { name: 'fire' }).click()
    })
    const toasts = screen.getAllByTestId('toast')
    expect(toasts).toHaveLength(2)
    expect(screen.getByText('已保存')).toBeInTheDocument()
    expect(screen.getByText('失败提示')).toBeInTheDocument()
  })

  it('auto-dismisses after 4s', async () => {
    vi.useFakeTimers()
    try {
      render(
        <ToastProvider>
          <Fire onReady={() => {}} />
        </ToastProvider>,
      )
      await act(async () => {
        screen.getByRole('button', { name: 'fire' }).click()
      })
      expect(screen.getAllByTestId('toast')).toHaveLength(2)
      await act(async () => {
        vi.advanceTimersByTime(4100)
      })
      expect(screen.queryByTestId('toast')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
```

import 区补 `vi`。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd frontend && npx vitest run src/ui/Toast.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 Toast**

```tsx
// frontend/src/ui/Toast.tsx
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'

type ToastTone = 'success' | 'error'

interface ToastItem {
  id: number
  tone: ToastTone
  message: string
}

interface ToastApi {
  success: (message: string) => void
  error: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)
  const push = useCallback((tone: ToastTone, message: string) => {
    const id = nextId.current++
    setToasts((list) => [...list.slice(-3), { id, tone, message }])
    window.setTimeout(() => {
      setToasts((list) => list.filter((item) => item.id !== id))
    }, 4000)
  }, [])
  const api = {
    success: (message: string) => push('success', message),
    error: (message: string) => push('error', message),
  }
  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
          <AnimatePresence>
            {toasts.map((toast) => (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                data-testid="toast"
                role="status"
                className={`pointer-events-auto rounded-md border px-3 py-2 text-sm shadow-lg ${
                  toast.tone === 'success'
                    ? 'border-accent-dim bg-emerald-950/90 text-emerald-200'
                    : 'border-danger bg-rose-950/90 text-rose-200'
                }`}
              >
                {toast.message}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
```

（emerald/rose 语义色豁免：成功/失败反馈色，同 StatusBadge 惯例。）

- [ ] **Step 4: 跑测试确认通过**

Run: `cd frontend && npx vitest run src/ui/Toast.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/ui/Toast.tsx frontend/src/ui/Toast.test.tsx
git commit -m "feat: Toast 原语（context+portal，4s 自动消失，motion 进出场）"
```

---

### Task 6: EmptyState / PageHeader / Stat 原语

**Files:**
- Create: `frontend/src/ui/EmptyState.tsx`
- Create: `frontend/src/ui/PageHeader.tsx`
- Create: `frontend/src/ui/Stat.tsx`
- Test: `frontend/src/ui/EmptyState.test.tsx`、`frontend/src/ui/PageHeader.test.tsx`、`frontend/src/ui/Stat.test.tsx`（新建）

**Interfaces:**
- Consumes: `font-mono`（Task 1）、`Button`（Task 2）。
- Produces:
  - `EmptyState({ title: string; hint?: string; action?: ReactNode })`
  - `PageHeader({ title: ReactNode; subtitle?: string; back?: { to: string; label: string }; actions?: ReactNode })`
  - `Stat({ label: string; value: ReactNode; delta?: string })`（value 用 `font-mono`；U2/U4 大量使用）

- [ ] **Step 1: 写失败测试**

```tsx
// frontend/src/ui/EmptyState.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from './Button'
import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it('renders title, hint and action', () => {
    render(
      <EmptyState
        title="还没有 run"
        hint="先创建 provider"
        action={<Button>去创建</Button>}
      />,
    )
    expect(screen.getByText('还没有 run')).toBeInTheDocument()
    expect(screen.getByText('先创建 provider')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '去创建' })).toBeInTheDocument()
  })

  it('renders without hint and action', () => {
    render(<EmptyState title="空" />)
    expect(screen.getByText('空')).toBeInTheDocument()
  })
})
```

```tsx
// frontend/src/ui/PageHeader.test.tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { PageHeader } from './PageHeader'

describe('PageHeader', () => {
  it('renders title, subtitle, back link and actions', () => {
    render(
      <MemoryRouter>
        <PageHeader
          title="Run abc123"
          subtitle="2x2 depth 1"
          back={{ to: '/runs', label: '返回历史' }}
          actions={<button type="button">导出</button>}
        />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: 'Run abc123' })).toBeInTheDocument()
    expect(screen.getByText('2x2 depth 1')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '返回历史' })).toHaveAttribute(
      'href',
      '/runs',
    )
    expect(screen.getByRole('button', { name: '导出' })).toBeInTheDocument()
  })
})
```

```tsx
// frontend/src/ui/Stat.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Stat } from './Stat'

describe('Stat', () => {
  it('renders label, mono value and delta', () => {
    render(<Stat label="tokens" value="1,234" delta="+12" />)
    expect(screen.getByText('tokens')).toBeInTheDocument()
    expect(screen.getByText('1,234')).toHaveClass('font-mono')
    expect(screen.getByText('+12')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd frontend && npx vitest run src/ui/EmptyState.test.tsx src/ui/PageHeader.test.tsx src/ui/Stat.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现三个原语**

```tsx
// frontend/src/ui/EmptyState.tsx
import type { ReactNode } from 'react'

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line bg-surface-2/50 px-6 py-12 text-center">
      <p className="text-sm text-text">{title}</p>
      {hint && <p className="text-xs text-text-dim">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
```

```tsx
// frontend/src/ui/PageHeader.tsx
import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

export function PageHeader({
  title,
  subtitle,
  back,
  actions,
}: {
  title: ReactNode
  subtitle?: string
  back?: { to: string; label: string }
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {subtitle && <span className="text-sm text-text-dim">{subtitle}</span>}
      {actions && <div className="flex items-center gap-2">{actions}</div>}
      {back && (
        <Link className="text-sm text-text-dim hover:text-text" to={back.to}>
          {back.label}
        </Link>
      )}
    </div>
  )
}
```

```tsx
// frontend/src/ui/Stat.tsx
import type { ReactNode } from 'react'

export function Stat({
  label,
  value,
  delta,
}: {
  label: string
  value: ReactNode
  delta?: string
}) {
  return (
    <div className="rounded-lg border border-line bg-surface-2 px-3 py-2">
      <div className="text-xs text-text-dim">{label}</div>
      <div className="font-mono text-sm text-text-strong">
        {value}
        {delta && <span className="ml-1.5 text-xs text-text-dim">{delta}</span>}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd frontend && npx vitest run src/ui/`
Expected: 全绿

- [ ] **Step 5: Commit**

```bash
git add frontend/src/ui/EmptyState.tsx frontend/src/ui/PageHeader.tsx frontend/src/ui/Stat.tsx frontend/src/ui/EmptyState.test.tsx frontend/src/ui/PageHeader.test.tsx frontend/src/ui/Stat.test.tsx
git commit -m "feat: EmptyState/PageHeader/Stat 原语"
```

---

### Task 7: Layout 壳精修 + ToastProvider/MotionConfig 挂载

**Files:**
- Modify: `frontend/src/components/Layout.tsx`

**Interfaces:**
- Consumes: `ToastProvider`（Task 5）、`motion/react`（Task 1）。
- Produces: 全局 `MotionConfig reducedMotion="user"` 与 Toast portal 挂载点；U2/U3 直接消费 `useToast` 与 motion。

- [ ] **Step 1: 重写 Layout**

```tsx
import { NavLink, Outlet } from 'react-router-dom'
import { MotionConfig, motion } from 'motion/react'
import { ToastProvider } from '../ui/Toast'

const links = [
  { to: '/providers', label: 'Providers' },
  { to: '/benchmarks', label: 'Benchmarks' },
  { to: '/runs', label: 'Runs' },
  { to: '/runs/new', label: 'New Run' },
]

export function Layout() {
  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <div className="min-h-screen bg-canvas text-text-strong">
          <header className="sticky top-0 z-40 border-b border-line bg-surface/80 backdrop-blur">
            <div className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-3">
              <span className="flex items-center gap-2 text-lg font-semibold tracking-wide">
                <span
                  aria-hidden
                  className="grid h-4 w-4 grid-cols-2 gap-px overflow-hidden rounded-[3px] bg-line"
                >
                  <span className="bg-accent" />
                  <span className="bg-warning" />
                  <span className="bg-danger" />
                  <span className="bg-sky-500" />
                </span>
                mofang
              </span>
              <nav className="flex gap-1 text-sm">
                {links.map(({ to, label }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) =>
                      `relative rounded-md px-2.5 py-1.5 transition-colors duration-fast ${
                        isActive
                          ? 'text-accent'
                          : 'text-text-dim hover:bg-surface hover:text-text'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {label}
                        {isActive && (
                          <motion.span
                            layoutId="nav-underline"
                            className="absolute inset-x-2.5 -bottom-px h-0.5 rounded-full bg-accent"
                            transition={{
                              type: 'spring',
                              stiffness: 500,
                              damping: 40,
                            }}
                          />
                        )}
                      </>
                    )}
                  </NavLink>
                ))}
              </nav>
            </div>
          </header>
          <motion.main
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}
            className="mx-auto max-w-7xl px-6 py-6"
          >
            <Outlet />
          </motion.main>
        </div>
      </ToastProvider>
    </MotionConfig>
  )
}
```

- [ ] **Step 2: 全量验证**

Run: `cd frontend && npm run typecheck && npm run test:run && npm run build`
Expected: 全绿（App.test 的导航断言不受 sticky/样式影响；若导航类名断言失败，按新类名机械更新断言）

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Layout.tsx
git commit -m "feat: Layout 壳精修（sticky 毛玻璃顶栏、logo 色块、导航下划线滑动、内容淡入、Toast/MotionConfig 挂载）"
```

---

### Task 8: 机械替换收尾 + 全量验证 + 文档

**Files:**
- Modify: `frontend/src/pages/RunPage.tsx`（裸 `<select>` → `Select` 原语）
- Modify: `README.md`、`PROJECT-PASSPORT.md`

**Interfaces:**
- Consumes: `Select`（Task 3）。
- Produces: U1 完成态；U2–U4 的地基（token、原语、Toast、motion）全部就位。

- [ ] **Step 1: 替换 RunPage 裸 select**

`RunPage.tsx` 中速度选择器的裸 `<select className="rounded bg-surface px-2 py-1" ...>` 替换为：

```tsx
<Select
  aria-label="速度"
  value={speed}
  onChange={(event) => setSpeed(Number(event.target.value))}
>
  <option value={0.5}>0.5×</option>
  <option value={1}>1×</option>
  <option value={2}>2×</option>
  <option value={100}>instant</option>
</Select>
```

import 区补 `Select`（`from '../ui/Select'`）。

- [ ] **Step 2: 扫其余裸 select**

Run: `grep -rn '<select' frontend/src/pages frontend/src/components frontend/src/cube | grep -v ui/`
Expected: 若还有输出，逐个替换为 `Select` 原语（保持原 props 透传）；无输出则跳过。

- [ ] **Step 3: 裸样式值抽查**

Run: `grep -rn 'duration-\[\|duration-1\|duration-2\|duration-3' frontend/src --include=*.tsx`
Expected: 新增代码无裸毫秒 duration（存量 `duration-` 类使用不强制清理）。

- [ ] **Step 4: 全量验证（U1 验收门禁）**

Run: `cd frontend && npm run typecheck && npm run test:run && npm run build && npm run e2e`
Expected: typecheck 无错；vitest 全绿（≥200 tests）；build 成功；E2E 全绿。
若 E2E 因样式类名断言失败：修正测试选择器（用 data-testid / role 优先），不改功能。

- [ ] **Step 5: 更新文档**

`README.md`「前端工作台」小节末尾追加一行：

```markdown
U1 视觉底座已落地：`@theme` 语义 token 扩容（surface-2 / accent-soft /
font-mono / duration-fast·med / ease-standard），原语层 Button（variant/
size/loading）/ Input·Textarea·Select（label+error）/ Card / Table·Tr /
Toast / EmptyState / PageHeader / Stat；动效统一 motion，
`prefers-reduced-motion` 全局尊重。
```

`PROJECT-PASSPORT.md` 阶段行追加 `；前端 U1（视觉底座）完成`。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/RunPage.tsx frontend/src/pages frontend/src/components frontend/src/cube README.md PROJECT-PASSPORT.md
git commit -m "feat: U1 收尾——裸 select 接入 Select 原语，全量验证，更新文档"
```

---

## Self-Review 记录

1. **Spec 覆盖**：token 扩容（T1）、Button/Input/Textarea/Select/Card/Table/StatusBadge（T2–T4）、Toast/EmptyState/PageHeader/Stat（T5–T6）、Layout 壳（T7）、motion 约定（T5/T7 进出场与 layoutId；列表 stagger 归 U2/U3 落地时按需使用）、验收命令（T8）。无缺口。
2. **占位符扫描**：所有代码块完整可粘贴；无 TBD/TODO。
3. **类型一致性**：`ButtonVariant` 去除 `neutral` 后 T2 检查步骤兜底；`useToast` 返回 `{success, error}` 与 T7 挂载一致；`Select` props 与 T8 用法一致。
