# UI 升级批次 U2：Run 观测体验 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run 观测体验升级——Live 面板重组（Stat 卡组 + 数字滚动 + 阶段 stepper + ThinkingPanel 跟随滚动）、CubeView 3D 视角控制与待机自转、Episode 回放播放器化（连播 + scrubber + 键盘）。

**Architecture:** 全部为前端增量：纯函数（derivePhase/视角计算/连播推进）放 reducer 与独立模块并用单测覆盖；CubeView 动画内核不动，只加三个可选 props（viewRequest/idleSpin/onBatchComplete）的交互层；回放把 selected/batch/resetToken 三态收进 usePlayback hook，EpisodeView 变纯展示。E2E 在现有 workbench.spec.ts 上追加。

**Tech Stack:** React 19 + TypeScript、motion v14（useSpring/useReducedMotion/layoutId）、@react-three/fiber + drei OrbitControls（makeDefault）、Tailwind v4 @theme token、vitest + @testing-library + Playwright。

**Spec:** `docs/superpowers/specs/2026-10-31-ui-upgrade-u2-design.md`（本计划从它论证；冲突以 spec 为准）

## Global Constraints

（复制自 spec「约束（继承父 spec）」节，逐字）

- 纯前端；SSE 事件契约、后端 API 不动；stepper 从现有 live 状态推导。
- 不引新运行时依赖（motion 之外）；动效尊重 `prefers-reduced-motion`。
- CubeView 动画内核（queue/current/snapTo/重绘机制）不动，只加可选交互层。
- ToolLog `slice(-80)` 裁剪不动；不做虚拟化。
- 现有前端测试全绿是硬门槛；新增能力全部可选 props / 新组件，向后兼容。

补充约束（全计划适用）：

- 全量验证命令（在 `frontend/` 下）：`npm run typecheck && npm run test:run && npm run build && npm run e2e`（E2E 首次需 `npx playwright install chromium`）。E2E 需要 API 后端：`uv run mofang dev` 或按 `frontend/e2e` 的 playwright 配置的 webServer（若配置了自动启动则无需手动起）。若 5173 端口被占用，先确认是本项目的残留 vite 进程再处理。
- 测试环境注意：`frontend/src/test/setup.ts` 已设 `MotionGlobalConfig.skipAnimations = true`（motion 动画在测试中跳变到终值）；jsdom 无布局（scrollTop/clientHeight/scrollHeight 需 `Object.defineProperty` 注入）、无 WebGL（页面测试继续 mock CubeView）、无 `navigator.clipboard`（用 `Object.defineProperty` 注入）。
- 提交信息按 diff 现写，禁止套用历史标题；每个 task 至少一个 commit。
- 不 push（无远端；推送需用户按批次单独授权）。

## Rulings（计划对 spec 的裁量，执行者按此为准）

1. **连播语义**：spec §3 信息卡小节的「单步播完即停」与决策记录「连播：播完当前步自动进下一步继续」冲突。以决策记录为准：`play()` = 连播，到末步或 `pause()` 即停；「播放本步」按钮移除，由 PlayerBar 的播放按钮承接。若用户在信息卡选中某步后按播放，从该步开始连播。
2. **键盘屏蔽范围**：spec 写 `input/select/textarea` 聚焦时屏蔽；本计划把 `BUTTON` 一并屏蔽——否则焦点在按钮上按空格会同时触发按钮 click 和播放切换（双重动作）。
3. **E2E thinking 跟随**：thinking 面板只在 run 进行中存在，mock 流式时长不可控，跟随断言做成**条件断言**（仅当 `pre` 实际溢出且面板仍在时断言浮标与回底），避免 E2E 常态化 flake；跟随逻辑本身由 ThinkingPanel 单测硬性覆盖。
4. **ViewPresets 挂载范围**：视角按钮组在 Run live 页与 Episode 回放页都挂载（spec §2 是 CubeView 交互层，未限定页面）；`idleSpin` 按决策记录仅 Run live 页。

---

### Task 1: derivePhase 阶段推导纯函数

**Files:**
- Modify: `frontend/src/hooks/liveReducer.ts`（文件末尾追加）
- Test: `frontend/src/hooks/liveReducer.test.ts`（文件末尾追加 describe）

**Interfaces:**
- Consumes: 现有 `LiveState`（liveReducer.ts 内已有）。
- Produces: `export type Phase = 'queued' | 'thinking' | 'tooling' | 'done'` 与 `export function derivePhase(live: LiveState): Phase`。Task 4（PhaseStepper）与 Task 8（RunLivePanel）按此签名消费。

- [ ] **Step 1: 写失败测试**

在 `frontend/src/hooks/liveReducer.test.ts` **末尾追加**（import 行按文件现有 import 合并，不重复导入）：

```ts
// —— derivePhase ——（以下为新增 describe，fixture 自包含）
import type { Episode } from '../api/types' // 若文件已导入则合并

const phaseEpisode = (status: Episode['status']): Episode => ({
  id: 'e1',
  run_id: 'r1',
  task_id: 'b1:t1',
  task_key: 't1',
  status,
  solved: false,
  moves_used: 0,
  reference_length: 3,
  efficiency: null,
  progress_ratio: null,
  protocol_errors: 0,
  tokens_in: 0,
  tokens_out: 0,
  latency_ms: null,
  failure_code: null,
  error: null,
  started_at: '2026-10-31T00:00:00+00:00',
  finished_at: null,
})

describe('derivePhase', () => {
  it('无当前题时为 queued', () => {
    expect(derivePhase(initialLiveState())).toBe('queued')
  })

  it('当前题结束时为 done（优先于日志尾的工具事件）', () => {
    expect(
      derivePhase({
        ...initialLiveState(),
        currentEpisode: phaseEpisode('solved'),
        logs: [{ id: 1, kind: 'tool', text: 'apply_moves', data: {} }],
      }),
    ).toBe('done')
  })

  it('thinking 时为 thinking（优先于日志尾）', () => {
    expect(
      derivePhase({
        ...initialLiveState(),
        currentEpisode: phaseEpisode('running'),
        thinking: true,
        logs: [{ id: 1, kind: 'tool', text: 'apply_moves', data: {} }],
      }),
    ).toBe('thinking')
  })

  it('日志尾部为工具事件时为 tooling', () => {
    expect(
      derivePhase({
        ...initialLiveState(),
        currentEpisode: phaseEpisode('running'),
        logs: [{ id: 1, kind: 'tool', text: 'apply_moves → ok', data: {} }],
      }),
    ).toBe('tooling')
  })

  it('模型消息落定后（无工具在途）回到 thinking', () => {
    expect(
      derivePhase({
        ...initialLiveState(),
        currentEpisode: phaseEpisode('running'),
        logs: [{ id: 1, kind: 'model', text: '回答', data: {} }],
      }),
    ).toBe('thinking')
  })

  it('running 且无日志无 thinking 时为 thinking（等待下一 turn）', () => {
    expect(
      derivePhase({
        ...initialLiveState(),
        currentEpisode: phaseEpisode('running'),
      }),
    ).toBe('thinking')
  })
})
```

并在文件顶部 import 处把 `derivePhase`、`initialLiveState` 加进 `./liveReducer` 的既有导入（`initialLiveState` 大概率已导入）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd frontend && npx vitest run src/hooks/liveReducer.test.ts`
Expected: FAIL —— `derivePhase is not exported` / 编译错误。

- [ ] **Step 3: 实现**

在 `frontend/src/hooks/liveReducer.ts` **末尾追加**：

```ts
export type Phase = 'queued' | 'thinking' | 'tooling' | 'done'

// 判定顺序有讲究：done 必须先于日志尾判断——题结束时最后一个事件是
// tool.result，若先看日志尾会把已完成的题显示成「工具」。
export function derivePhase(live: LiveState): Phase {
  if (!live.currentEpisode) return 'queued'
  if (live.currentEpisode.status !== 'running') return 'done'
  if (live.thinking) return 'thinking'
  const last = live.logs.at(-1)
  if (last && last.kind === 'tool') return 'tooling'
  return 'thinking'
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd frontend && npx vitest run src/hooks/liveReducer.test.ts`
Expected: PASS（含既有用例全绿）。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/liveReducer.ts frontend/src/hooks/liveReducer.test.ts
git commit -m "feat: liveReducer 导出 derivePhase 阶段推导纯函数"
```

---

### Task 2: AnimatedNumber 数字滚动原语

**Files:**
- Create: `frontend/src/ui/AnimatedNumber.tsx`
- Test: `frontend/src/ui/AnimatedNumber.test.tsx`

**Interfaces:**
- Consumes: `motion/react`（motion v14 已安装）；测试环境 `MotionGlobalConfig.skipAnimations = true` 已在 setup.ts 生效。
- Produces: `export function AnimatedNumber({ value, format }: { value: number; format?: (value: number) => string })`。Task 8 以 `<AnimatedNumber value={n} />` 与 `<AnimatedNumber value={n} format={formatTokens} />` 两种用法消费。

- [ ] **Step 1: 写失败测试**

`frontend/src/ui/AnimatedNumber.test.tsx`：

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AnimatedNumber } from './AnimatedNumber'

describe('AnimatedNumber', () => {
  it('渲染格式化后的当前值', () => {
    render(<AnimatedNumber value={42} />)
    expect(screen.getByText('42')).toBeInTheDocument()
  })

  it('支持自定义格式化', () => {
    render(
      <AnimatedNumber
        value={1500}
        format={(n) => `${(n / 1000).toFixed(1)}k`}
      />,
    )
    expect(screen.getByText('1.5k')).toBeInTheDocument()
  })

  it('值变化后渲染新值（测试环境动画跳变到终值）', async () => {
    const { rerender } = render(<AnimatedNumber value={1} />)
    rerender(<AnimatedNumber value={7} />)
    await waitFor(() =>
      expect(screen.getByText('7')).toBeInTheDocument(),
    )
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd frontend && npx vitest run src/ui/AnimatedNumber.test.tsx`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现**

`frontend/src/ui/AnimatedNumber.tsx`：

```tsx
import { useEffect } from 'react'
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'motion/react'

// motion useSpring 驱动的数字滚动；reduced-motion 用户直接渲染终值
// （r3f 之外 motion 有 MotionConfig 兜底，这里显式短路更稳）。
export function AnimatedNumber({
  value,
  format = (n: number) => String(n),
}: {
  value: number
  format?: (value: number) => string
}) {
  const reduceMotion = useReducedMotion()
  const raw = useMotionValue(value)
  const spring = useSpring(raw, { stiffness: 170, damping: 26 })
  const text = useTransform(spring, (n) => format(Math.round(n)))
  useEffect(() => {
    raw.set(value)
  }, [value, raw])
  if (reduceMotion) return <span>{format(value)}</span>
  return <motion.span>{text}</motion.span>
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd frontend && npx vitest run src/ui/AnimatedNumber.test.tsx`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/ui/AnimatedNumber.tsx frontend/src/ui/AnimatedNumber.test.tsx
git commit -m "feat: AnimatedNumber useSpring 数字滚动原语"
```

---

### Task 3: useFollowScroll + ThinkingPanel

**Files:**
- Create: `frontend/src/hooks/useFollowScroll.ts`
- Create: `frontend/src/components/ThinkingPanel.tsx`
- Test: `frontend/src/hooks/useFollowScroll.test.tsx`
- Test: `frontend/src/components/ThinkingPanel.test.tsx`

**Interfaces:**
- Consumes: `ui/Button`（variant="ghost" size="sm" 已存在）。
- Produces: `useFollowScroll<T extends HTMLElement>(dep: unknown)` 返回 `{ ref, following, onScroll, scrollToBottom }`；`export function ThinkingPanel({ text }: { text: string })`，testid `thinking-panel`（与现 RunPage 内联结构一致）与 `thinking-follow`（回到底部浮标）。Task 8 消费 ThinkingPanel。

- [ ] **Step 1: 写 useFollowScroll 失败测试**

`frontend/src/hooks/useFollowScroll.test.tsx`：

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { useFollowScroll } from './useFollowScroll'

function Harness({ text }: { text: string }) {
  const { ref, following, onScroll, scrollToBottom } =
    useFollowScroll<HTMLPreElement>(text)
  return (
    <div>
      <pre ref={ref} onScroll={onScroll} data-testid="scroll-box">
        {text}
      </pre>
      <span data-testid="following">{following ? 'yes' : 'no'}</span>
      <button type="button" onClick={scrollToBottom}>
        bottom
      </button>
    </div>
  )
}

function setBoxMetrics(
  box: HTMLElement,
  top: number,
  client: number,
  scroll: number,
) {
  Object.defineProperty(box, 'scrollTop', {
    value: top,
    configurable: true,
  })
  Object.defineProperty(box, 'clientHeight', {
    value: client,
    configurable: true,
  })
  Object.defineProperty(box, 'scrollHeight', {
    value: scroll,
    configurable: true,
  })
}

describe('useFollowScroll', () => {
  it('初始跟随，内容变化时自动滚到底', () => {
    const { rerender } = render(<Harness text="a" />)
    const box = screen.getByTestId('scroll-box')
    setBoxMetrics(box, 0, 100, 400)
    rerender(<Harness text="ab" />)
    expect(box.scrollTop).toBe(400)
  })

  it('上滚脱离跟随后内容变化不再滚动，回到底部恢复', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Harness text="a" />)
    const box = screen.getByTestId('scroll-box')
    setBoxMetrics(box, 0, 100, 400)
    fireEvent.scroll(box)
    expect(screen.getByTestId('following')).toHaveTextContent('no')
    rerender(<Harness text="ab" />)
    expect(box.scrollTop).toBe(0)
    await user.click(screen.getByRole('button', { name: 'bottom' }))
    expect(box.scrollTop).toBe(400)
    expect(screen.getByTestId('following')).toHaveTextContent('yes')
  })

  it('手动滚回底部即恢复跟随', () => {
    render(<Harness text="a" />)
    const box = screen.getByTestId('scroll-box')
    setBoxMetrics(box, 0, 100, 400)
    fireEvent.scroll(box)
    expect(screen.getByTestId('following')).toHaveTextContent('no')
    setBoxMetrics(box, 300, 100, 400)
    fireEvent.scroll(box)
    expect(screen.getByTestId('following')).toHaveTextContent('yes')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd frontend && npx vitest run src/hooks/useFollowScroll.test.tsx`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现 useFollowScroll**

`frontend/src/hooks/useFollowScroll.ts`：

```ts
import { useCallback, useEffect, useRef, useState } from 'react'

const FOLLOW_THRESHOLD = 8

// dep（如流式 thinking 文本）变化且仍处于跟随状态时自动滚到底；
// 用户上滚即脱离跟随，scrollToBottom() 恢复。
export function useFollowScroll<T extends HTMLElement>(dep: unknown) {
  const ref = useRef<T | null>(null)
  const [following, setFollowing] = useState(true)

  const onScroll = useCallback(() => {
    const el = ref.current
    if (!el) return
    setFollowing(
      el.scrollTop + el.clientHeight >= el.scrollHeight - FOLLOW_THRESHOLD,
    )
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el || !following) return
    el.scrollTop = el.scrollHeight
  }, [dep, following])

  const scrollToBottom = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    setFollowing(true)
  }, [])

  return { ref, following, onScroll, scrollToBottom }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd frontend && npx vitest run src/hooks/useFollowScroll.test.tsx`
Expected: PASS。

- [ ] **Step 5: 写 ThinkingPanel 失败测试**

`frontend/src/components/ThinkingPanel.test.tsx`：

```tsx
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThinkingPanel } from './ThinkingPanel'

describe('ThinkingPanel', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('渲染思考文本，复制成功后短暂显示已复制', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    render(<ThinkingPanel text="思考全文" />)
    expect(screen.getByTestId('thinking-panel')).toHaveTextContent(
      '思考全文',
    )
    await user.click(screen.getByRole('button', { name: '复制' }))
    expect(writeText).toHaveBeenCalledWith('思考全文')
    expect(
      screen.getByRole('button', { name: '已复制' }),
    ).toBeInTheDocument()
    await act(async () => {
      vi.advanceTimersByTime(1600)
    })
    expect(screen.getByRole('button', { name: '复制' })).toBeInTheDocument()
  })

  it('上滚出现回到底部浮标，点击恢复跟随并滚底', () => {
    render(<ThinkingPanel text="内容" />)
    const pre = screen.getByTestId('thinking-panel')
      .querySelector('pre') as HTMLElement
    Object.defineProperty(pre, 'scrollTop', { value: 0, configurable: true })
    Object.defineProperty(pre, 'clientHeight', {
      value: 100,
      configurable: true,
    })
    Object.defineProperty(pre, 'scrollHeight', {
      value: 400,
      configurable: true,
    })
    fireEvent.scroll(pre)
    expect(screen.getByTestId('thinking-follow')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('thinking-follow'))
    expect(pre.scrollTop).toBe(400)
    expect(screen.queryByTestId('thinking-follow')).not.toBeInTheDocument()
  })

  it('折叠状态跨内容更新保持（组件自持，不清空）', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ThinkingPanel text="第一段" />)
    await user.click(screen.getByText('思考中…'))
    rerender(<ThinkingPanel text="第二段" />)
    expect(screen.getByTestId('thinking-panel')).not.toHaveAttribute('open')
  })
})
```

- [ ] **Step 6: 跑测试确认失败**

Run: `cd frontend && npx vitest run src/components/ThinkingPanel.test.tsx`
Expected: FAIL —— 模块不存在。

- [ ] **Step 7: 实现 ThinkingPanel**

`frontend/src/components/ThinkingPanel.tsx`：

```tsx
import { useState } from 'react'
import { useFollowScroll } from '../hooks/useFollowScroll'
import { Button } from '../ui/Button'

// 流式思考面板：max-h-72 内部滚动 + 跟随滚动 + 复制。
// 折叠状态由本组件 useState 自持；组件跨 turn 不卸载，记忆自然成立。
export function ThinkingPanel({ text }: { text: string }) {
  const [open, setOpen] = useState(true)
  const [copied, setCopied] = useState(false)
  const { ref, following, onScroll, scrollToBottom } =
    useFollowScroll<HTMLPreElement>(text)

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // 剪贴板不可用（非安全上下文/权限拒绝）时静默失败
    }
  }

  return (
    <details
      open={open}
      data-testid="thinking-panel"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-sky-300">思考中…</summary>
      <div className="relative mt-1">
        <pre
          ref={ref}
          onScroll={onScroll}
          className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded bg-sunken p-2 text-xs text-text-dim"
        >
          {text}
        </pre>
        {!following && (
          <button
            type="button"
            data-testid="thinking-follow"
            onClick={scrollToBottom}
            className="absolute right-2 bottom-2 rounded bg-surface-2 px-2 py-1 text-xs text-text shadow"
          >
            回到底部
          </button>
        )}
        <div className="mt-1 flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            type="button"
            onClick={() => void copy()}
          >
            {copied ? '已复制' : '复制'}
          </Button>
        </div>
      </div>
    </details>
  )
}
```

- [ ] **Step 8: 跑测试确认通过**

Run: `cd frontend && npx vitest run src/components/ThinkingPanel.test.tsx src/hooks/useFollowScroll.test.tsx`
Expected: PASS。

- [ ] **Step 9: Commit**

```bash
git add frontend/src/hooks/useFollowScroll.ts frontend/src/hooks/useFollowScroll.test.tsx frontend/src/components/ThinkingPanel.tsx frontend/src/components/ThinkingPanel.test.tsx
git commit -m "feat: ThinkingPanel 抽组件与 useFollowScroll 跟随滚动"
```

---

### Task 4: PhaseStepper 阶段指示

**Files:**
- Create: `frontend/src/components/PhaseStepper.tsx`
- Test: `frontend/src/components/PhaseStepper.test.tsx`

**Interfaces:**
- Consumes: `Phase` 类型（Task 1，`../hooks/liveReducer`）；motion layoutId。
- Produces: `export function PhaseStepper({ phase }: { phase: Phase })`，每节点 testid `phase-queued|thinking|tooling|done` 且带 `data-state="done|active|pending"`。Task 8 消费。

- [ ] **Step 1: 写失败测试**

`frontend/src/components/PhaseStepper.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PhaseStepper } from './PhaseStepper'

describe('PhaseStepper', () => {
  it('渲染四个阶段节点', () => {
    render(<PhaseStepper phase="thinking" />)
    const stepper = screen.getByTestId('phase-stepper')
    expect(stepper).toHaveTextContent('排队')
    expect(stepper).toHaveTextContent('思考')
    expect(stepper).toHaveTextContent('工具')
    expect(stepper).toHaveTextContent('完成')
  })

  it('当前节点高亮、之前节点打勾、之后节点待定', () => {
    render(<PhaseStepper phase="tooling" />)
    expect(screen.getByTestId('phase-queued')).toHaveAttribute(
      'data-state',
      'done',
    )
    expect(screen.getByTestId('phase-thinking')).toHaveAttribute(
      'data-state',
      'done',
    )
    expect(screen.getByTestId('phase-tooling')).toHaveAttribute(
      'data-state',
      'active',
    )
    expect(screen.getByTestId('phase-done')).toHaveAttribute(
      'data-state',
      'pending',
    )
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd frontend && npx vitest run src/components/PhaseStepper.test.tsx`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现**

`frontend/src/components/PhaseStepper.tsx`：

```tsx
import { motion } from 'motion/react'
import type { Phase } from '../hooks/liveReducer'

const STEPS: { key: Phase; label: string }[] = [
  { key: 'queued', label: '排队' },
  { key: 'thinking', label: '思考' },
  { key: 'tooling', label: '工具' },
  { key: 'done', label: '完成' },
]

export function PhaseStepper({ phase }: { phase: Phase }) {
  const activeIndex = STEPS.findIndex((step) => step.key === phase)
  return (
    <ol
      data-testid="phase-stepper"
      className="flex flex-wrap items-center gap-1.5 text-xs"
    >
      {STEPS.map((step, index) => {
        const state =
          index < activeIndex
            ? 'done'
            : index === activeIndex
              ? 'active'
              : 'pending'
        return (
          <li key={step.key} className="flex items-center gap-1.5">
            {index > 0 && <span aria-hidden className="h-px w-4 bg-line" />}
            <span
              data-testid={`phase-${step.key}`}
              data-state={state}
              className={`relative flex items-center gap-1 rounded px-1.5 py-0.5 ${
                state === 'active' ? 'text-accent' : 'text-text-dim'
              }`}
            >
              {state === 'active' && (
                <motion.span
                  layoutId="phase-active"
                  className="absolute inset-0 rounded bg-accent-soft"
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                />
              )}
              <span className="relative flex items-center gap-1">
                {state === 'done' ? '✓' : step.label}
                {state === 'active' && (
                  <motion.span
                    aria-hidden
                    className="inline-block h-1.5 w-1.5 rounded-full bg-accent"
                    animate={{ rotate: 360 }}
                    transition={{
                      repeat: Infinity,
                      duration: 1,
                      ease: 'linear',
                    }}
                  />
                )}
              </span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd frontend && npx vitest run src/components/PhaseStepper.test.tsx`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/PhaseStepper.tsx frontend/src/components/PhaseStepper.test.tsx
git commit -m "feat: PhaseStepper 四态阶段指示（layoutId 滑动高亮）"
```

---

### Task 5: ToolLog 类型微标 + ProgressChart 上限虚线与终点脉冲

**Files:**
- Modify: `frontend/src/components/ToolLog.tsx`
- Modify: `frontend/src/components/ProgressChart.tsx`
- Modify: `frontend/src/index.css`（追加 keyframes）
- Test: `frontend/src/components/ProgressChart.test.tsx`（新建）

**Interfaces:**
- Consumes: 现有 `LiveLog`、`ProgressPoint` 类型。
- Produces: ToolLog/ProgressChart 对外 props 不变（RunPage.test 现有断言继续成立：`tool-log` 文本含 `thinking`/`apply_moves`，`progress-path` 的 d 含 `M`）；新增 testid `progress-limit`、`progress-pulse`。

- [ ] **Step 1: 写 ProgressChart 失败测试**

`frontend/src/components/ProgressChart.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ProgressChart } from './ProgressChart'

describe('ProgressChart', () => {
  it('渲染曲线、上限虚线与终点脉冲', () => {
    render(
      <ProgressChart
        points={[
          { moves: 0, length: 3 },
          { moves: 5, length: 1 },
        ]}
        maxMoves={30}
      />,
    )
    expect(screen.getByTestId('progress-path')).toHaveAttribute(
      'd',
      expect.stringContaining('M'),
    )
    expect(screen.getByTestId('progress-limit')).toHaveAttribute(
      'stroke-dasharray',
      '4 4',
    )
    expect(screen.getByTestId('progress-pulse')).toBeInTheDocument()
    expect(screen.getByText('上限')).toBeInTheDocument()
  })

  it('空数据时显示占位', () => {
    render(<ProgressChart points={[]} maxMoves={30} />)
    expect(screen.getByText('暂无进度')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd frontend && npx vitest run src/components/ProgressChart.test.tsx`
Expected: FAIL —— `progress-limit` 不存在。

- [ ] **Step 3: 实现 ProgressChart**

`frontend/src/components/ProgressChart.tsx` 整体替换为：

```tsx
import type { ProgressPoint } from '../api/types'

export function ProgressChart({
  points,
  maxMoves,
}: {
  points: ProgressPoint[]
  maxMoves: number
}) {
  if (points.length === 0) {
    return <p className="text-xs text-text-dim">暂无进度</p>
  }
  const width = 320
  const height = 120
  const pad = 8
  const maxLength = Math.max(
    1,
    ...points.map((point) => point.length ?? 0),
  )
  const x = (moves: number) =>
    pad +
    (Math.min(moves, maxMoves) / Math.max(1, maxMoves)) *
      (width - pad * 2)
  const y = (length: number) =>
    height - pad - (length / maxLength) * (height - pad * 2)
  const path = points
    .map(
      (point, index) =>
        `${index === 0 ? 'M' : 'L'} ${x(point.moves).toFixed(1)} ${y(
          point.length ?? 0,
        ).toFixed(1)}`,
    )
    .join(' ')
  const last = points[points.length - 1]
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      role="img"
      aria-label="进度曲线"
    >
      <line
        data-testid="progress-limit"
        x1={x(maxMoves)}
        x2={x(maxMoves)}
        y1={pad}
        y2={height - pad}
        stroke="#475569"
        strokeDasharray="4 4"
      />
      <text
        x={x(maxMoves)}
        y={pad + 10}
        textAnchor="middle"
        fill="#94a3b8"
        fontSize="9"
      >
        上限
      </text>
      <path
        data-testid="progress-path"
        d={path}
        fill="none"
        stroke="#34d399"
        strokeWidth="2"
      />
      <circle
        data-testid="progress-pulse"
        cx={x(last.moves)}
        cy={y(last.length ?? 0)}
        r="4"
        className="animate-pulse-ring fill-emerald-300/60"
      />
    </svg>
  )
}
```

- [ ] **Step 4: 追加 CSS keyframes**

`frontend/src/index.css` 末尾追加（放在既有 `@media (prefers-reduced-motion: reduce)` 块之后）：

```css
@keyframes pulse-ring {
  0% {
    transform: scale(1);
    opacity: 0.7;
  }
  100% {
    transform: scale(2.2);
    opacity: 0;
  }
}

.animate-pulse-ring {
  animation: pulse-ring 1.2s var(--ease-standard) infinite;
  /* SVG 圆点缩放需要 fill-box，否则 transform-origin 落在整张 SVG 上 */
  transform-box: fill-box;
  transform-origin: center;
}

@media (prefers-reduced-motion: reduce) {
  .animate-pulse-ring {
    animation: none;
  }
}
```

- [ ] **Step 5: ToolLog 加类型微标**

`frontend/src/components/ToolLog.tsx` 整体替换为（`slice(-80)` 裁剪与展开交互不动，只在 summary 行首加微标）：

```tsx
import type { LiveLog } from '../hooks/liveReducer'

export function ToolLog({ logs }: { logs: LiveLog[] }) {
  if (logs.length === 0) {
    return <p className="text-xs text-text-dim">暂无工具日志</p>
  }
  return (
    <ul data-testid="tool-log" className="max-h-64 space-y-1 overflow-auto text-xs">
      {logs.slice(-80).map((log) => (
        <li
          key={log.id}
          className={
            log.kind === 'model' ? 'text-text' : 'text-sky-300'
          }
        >
          {/* 带 thinking 的模型条目默认展开，保证思考过程可见（E2E 硬断言）。 */}
          <details open={log.kind === 'model' && !!log.thinking}>
            <summary className="cursor-pointer truncate">
              <span
                className={`mr-1 inline-block rounded px-1 py-px align-middle text-[10px] ${
                  log.kind === 'model'
                    ? 'bg-accent-soft text-accent'
                    : 'bg-warning/15 text-warning'
                }`}
              >
                {log.kind === 'model' ? '模型' : '工具'}
              </span>
              {log.thinking ? (
                <span className="mr-1 inline-block rounded bg-sunken px-1 py-px align-middle text-[10px] text-text-dim">
                  含思考
                </span>
              ) : null}
              {log.text}
            </summary>
            {log.kind === 'model' && log.thinking && (
              <details open data-testid="log-thinking" className="mt-1">
                <summary className="cursor-pointer text-sky-300">
                  思考过程
                </summary>
                <pre className="mt-1 overflow-auto whitespace-pre-wrap rounded bg-sunken p-2 text-[10px] text-text-dim">
                  {log.thinking}
                </pre>
              </details>
            )}
            <pre className="mt-1 overflow-auto rounded bg-sunken p-2 text-[10px] text-text-dim">
              {JSON.stringify(log.data, null, 2)}
            </pre>
          </details>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 6: 跑相关测试确认通过**

Run: `cd frontend && npx vitest run src/components/ProgressChart.test.tsx src/pages/RunPage.test.tsx`
Expected: PASS —— 新增断言通过；RunPage 既有 `tool-log`/`progress-path` 断言不受影响。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/ToolLog.tsx frontend/src/components/ProgressChart.tsx frontend/src/components/ProgressChart.test.tsx frontend/src/index.css
git commit -m "feat: ToolLog 类型微标与 ProgressChart 上限虚线/终点脉冲"
```

---

### Task 6: CubeView 交互层——视角预设 / 待机自转 / 批次完成回调

**Files:**
- Create: `frontend/src/cube/viewControls.ts`
- Create: `frontend/src/cube/ViewPresets.tsx`
- Modify: `frontend/src/cube/CubeView.tsx`
- Test: `frontend/src/cube/viewControls.test.ts`
- Test: `frontend/src/cube/ViewPresets.test.tsx`

**Interfaces:**
- Consumes: 现有 CubeView Scene 结构（queue/current/snapTo 内核不动）。
- Produces:
  - `export type ViewPreset = 'front' | 'top' | 'iso' | 'reset'`；`export interface ViewRequest { preset: ViewPreset; token: number }`；`export const VIEW_LERP_MS = 400`；`export function initialCameraPosition(size: number): [number, number, number]`；`export function presetCameraPosition(preset: ViewPreset, size: number): [number, number, number]`；`export function easeOutProgress(elapsedMs: number): number`。
  - CubeViewProps 新增可选 `viewRequest?: ViewRequest`、`idleSpin?: boolean`、`onBatchComplete?: () => void`（不传行为与现状一致）。
  - `export function ViewPresets({ onRequest }: { onRequest: (preset: ViewPreset) => void })`，按钮 testid `view-front|top|iso|reset`，容器 `view-presets`。
- 注意：`initialCameraPosition` 必须与 CubeView 现状相机位一致（2 阶 `[3.2, 3.2, 4.2]`，其余 `[5, 5, 6.5]`），OrbitControls 的 minDistance 4 / maxDistance 14 能容纳预设距离（6 / 9）。

- [ ] **Step 1: 写 viewControls 失败测试**

`frontend/src/cube/viewControls.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  easeOutProgress,
  initialCameraPosition,
  presetCameraPosition,
  VIEW_LERP_MS,
} from './viewControls'

describe('viewControls', () => {
  it('初始机位按尺寸区分且与现状一致', () => {
    expect(initialCameraPosition(2)).toEqual([3.2, 3.2, 4.2])
    expect(initialCameraPosition(3)).toEqual([5, 5, 6.5])
  })

  it('正视在 +Z、顶视在 +Y、等轴/重置回初始机位', () => {
    expect(presetCameraPosition('front', 2)).toEqual([0, 0, 6])
    expect(presetCameraPosition('top', 2)[1]).toBe(6)
    expect(presetCameraPosition('top', 2)[2]).toBeGreaterThan(0)
    expect(presetCameraPosition('iso', 3)).toEqual(initialCameraPosition(3))
    expect(presetCameraPosition('reset', 2)).toEqual(initialCameraPosition(2))
  })

  it('easeOutProgress 在时长内单调且超时收敛为 1', () => {
    expect(easeOutProgress(0)).toBe(0)
    expect(easeOutProgress(VIEW_LERP_MS)).toBe(1)
    expect(easeOutProgress(VIEW_LERP_MS + 1000)).toBe(1)
    let prev = 0
    for (let ms = 0; ms <= VIEW_LERP_MS; ms += 50) {
      const value = easeOutProgress(ms)
      expect(value).toBeGreaterThanOrEqual(prev)
      prev = value
    }
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd frontend && npx vitest run src/cube/viewControls.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现 viewControls**

`frontend/src/cube/viewControls.ts`：

```ts
export type ViewPreset = 'front' | 'top' | 'iso' | 'reset'

export interface ViewRequest {
  preset: ViewPreset
  token: number
}

export const VIEW_LERP_MS = 400

export function initialCameraPosition(size: number): [number, number, number] {
  return size === 2 ? [3.2, 3.2, 4.2] : [5, 5, 6.5]
}

export function presetCameraPosition(
  preset: ViewPreset,
  size: number,
): [number, number, number] {
  const distance = size === 2 ? 6 : 9
  switch (preset) {
    case 'front':
      return [0, 0, distance]
    case 'top':
      // 极角 0 会让 OrbitControls 方位角退化，留一点倾斜
      return [0, distance, 0.001]
    case 'iso':
    case 'reset':
      return initialCameraPosition(size)
  }
}

export function easeOutProgress(elapsedMs: number): number {
  const t = Math.min(1, Math.max(0, elapsedMs / VIEW_LERP_MS))
  return 1 - (1 - t) * (1 - t)
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd frontend && npx vitest run src/cube/viewControls.test.ts`
Expected: PASS。

- [ ] **Step 5: 写 ViewPresets 失败测试**

`frontend/src/cube/ViewPresets.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ViewPresets } from './ViewPresets'

describe('ViewPresets', () => {
  it('渲染四个预设按钮并回报点击', async () => {
    const user = userEvent.setup()
    const onRequest = vi.fn()
    render(<ViewPresets onRequest={onRequest} />)
    expect(screen.getByTestId('view-presets')).toHaveTextContent('正视')
    expect(screen.getByTestId('view-presets')).toHaveTextContent('顶视')
    expect(screen.getByTestId('view-presets')).toHaveTextContent('等轴')
    expect(screen.getByTestId('view-presets')).toHaveTextContent('重置')
    await user.click(screen.getByTestId('view-top'))
    expect(onRequest).toHaveBeenCalledWith('top')
  })
})
```

- [ ] **Step 6: 跑测试确认失败**

Run: `cd frontend && npx vitest run src/cube/ViewPresets.test.tsx`
Expected: FAIL —— 模块不存在。

- [ ] **Step 7: 实现 ViewPresets**

`frontend/src/cube/ViewPresets.tsx`：

```tsx
import type { ViewPreset } from './viewControls'

const PRESETS: { key: ViewPreset; label: string }[] = [
  { key: 'front', label: '正视' },
  { key: 'top', label: '顶视' },
  { key: 'iso', label: '等轴' },
  { key: 'reset', label: '重置' },
]

export function ViewPresets({
  onRequest,
}: {
  onRequest: (preset: ViewPreset) => void
}) {
  return (
    <div
      data-testid="view-presets"
      className="absolute right-2 top-2 z-10 flex gap-1 rounded bg-black/40 p-1 backdrop-blur-sm"
    >
      {PRESETS.map((item) => (
        <button
          key={item.key}
          type="button"
          data-testid={`view-${item.key}`}
          onClick={() => onRequest(item.key)}
          className="rounded px-1.5 py-0.5 text-xs text-white/80 transition-colors duration-fast hover:bg-white/10"
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 8: CubeView 接入三个可选 props**

对 `frontend/src/cube/CubeView.tsx` 做以下精确修改（动画内核 queue/current/snapTo/重绘逻辑不动）：

8a. import 区追加：

```tsx
import { Canvas, useFrame, useThree } from '@react-three/fiber'
```

（原 `import { Canvas, useFrame } from '@react-three/fiber'` 合并 `useThree`）

```tsx
import {
  easeOutProgress,
  initialCameraPosition,
  presetCameraPosition,
  VIEW_LERP_MS,
  type ViewRequest,
} from './viewControls'
```

8b. `CubeViewProps` 追加三个可选字段：

```tsx
export interface CubeViewProps {
  state: CubeState | null
  resetToken: number
  batch: MoveBatch | null
  speed: number
  paused: boolean
  skipToken: number
  viewRequest?: ViewRequest
  idleSpin?: boolean
  onBatchComplete?: () => void
}
```

8c. `Scene` 内、既有 ref 声明区之后追加（reducedMotion 只需挂载时判定一次）：

```tsx
  const camera = useThree((state) => state.camera)
  const controls = useThree((state) => state.controls) as
    | {
        addEventListener: (type: 'start', listener: () => void) => void
        removeEventListener: (type: 'start', listener: () => void) => void
      }
    | null
  const viewAnim = useRef<{
    from: THREE.Vector3
    to: THREE.Vector3
    elapsed: number
  } | null>(null)
  const lastViewToken = useRef(0)
  const userOrbited = useRef(false)
  const idleSpinRef = useRef(props.idleSpin === true)
  const onBatchCompleteRef = useRef(props.onBatchComplete)
  const reducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  ).matches

  useEffect(() => {
    idleSpinRef.current = props.idleSpin === true
  }, [props.idleSpin])

  useEffect(() => {
    onBatchCompleteRef.current = props.onBatchComplete
  }, [props.onBatchComplete])

  // 视角预设：token 递增时开始一次相机 lerp（guard 保证重复渲染不重触发）
  useEffect(() => {
    if (!props.viewRequest) return
    if (props.viewRequest.token === lastViewToken.current) return
    lastViewToken.current = props.viewRequest.token
    const size = props.state ? sizeOf(props.state.cube) : 2
    viewAnim.current = {
      from: camera.position.clone(),
      to: new THREE.Vector3(
        ...presetCameraPosition(props.viewRequest.preset, size),
      ),
      elapsed: 0,
    }
  }, [props.viewRequest, props.state, camera])

  // 用户开始拖动即中止相机 lerp，并停掉本轮待机自转
  useEffect(() => {
    if (!controls) return
    const onStart = () => {
      viewAnim.current = null
      userOrbited.current = true
    }
    controls.addEventListener('start', onStart)
    return () => controls.removeEventListener('start', onStart)
  }, [controls])
```

8d. 既有 `resetToken` effect（`lastBatchId.current = null; snapTo(props.state)` 那个）改为：

```tsx
  useEffect(() => {
    lastBatchId.current = null
    userOrbited.current = false
    group.current?.rotation.set(0, 0, 0)
    snapTo(props.state)
  }, [props.resetToken])
```

（reset/换题后恢复待机自转，并把 group 自转角度归零。）

8e. `finishMove` 末尾（`repaint(move.batch.state)` 之后）追加一行：

```tsx
    onBatchCompleteRef.current?.()
```

8f. `useFrame` 整体替换为（首段加相机 lerp，末段加待机自转，核心动画逻辑不变）：

```tsx
  useFrame((_, delta) => {
    if (viewAnim.current) {
      viewAnim.current.elapsed += delta * 1000
      camera.position.lerpVectors(
        viewAnim.current.from,
        viewAnim.current.to,
        easeOutProgress(viewAnim.current.elapsed),
      )
      if (viewAnim.current.elapsed >= VIEW_LERP_MS) viewAnim.current = null
    }
    if (pausedRef.current) return
    if (speedRef.current >= INSTANT_SPEED) {
      if (current.current || queue.current.length > 0) {
        snapTo(latestTarget.current)
      }
    } else {
      if (!current.current) startNextMove()
      const move = current.current
      if (move) {
        move.elapsed += delta * 1000
        const progress = Math.min(1, move.elapsed / move.duration)
        const eased = progress * progress * (3 - 2 * progress)
        applyFrame(move, specAngle(move.spec) * eased)
        if (progress >= 1) finishMove(move)
      }
    }
    if (
      idleSpinRef.current &&
      !reducedMotion &&
      !userOrbited.current &&
      !current.current &&
      queue.current.length === 0 &&
      group.current
    ) {
      group.current.rotation.y += delta * 0.3
    }
  })
```

8g. `OrbitControls` 加 `makeDefault`：

```tsx
      <OrbitControls
        makeDefault
        enablePan={false}
```

8h. `CubeView` 出口改用 `initialCameraPosition`：

```tsx
export function CubeView(props: CubeViewProps) {
  const size = props.state ? sizeOf(props.state.cube) : 2
  // r3f 的 camera 只在 Canvas 挂载时生效，尺寸切换必须重建 Canvas。
  return (
    <div data-testid="cube-canvas" className="h-[420px] w-full">
      <Canvas
        key={size}
        camera={{ position: initialCameraPosition(size), fov: 45 }}
      >
        <Scene {...props} />
      </Canvas>
    </div>
  )
}
```

- [ ] **Step 9: 回归验证**

Run: `cd frontend && npm run typecheck && npx vitest run`
Expected: 全绿。CubeView 本身无单测（WebGL），靠 typecheck 与页面测试（mock CubeView）兜底；页面测试的 mock 组件签名不接收新 props，运行时忽略即可。

- [ ] **Step 10: Commit**

```bash
git add frontend/src/cube/viewControls.ts frontend/src/cube/viewControls.test.ts frontend/src/cube/ViewPresets.tsx frontend/src/cube/ViewPresets.test.tsx frontend/src/cube/CubeView.tsx
git commit -m "feat: CubeView 视角预设/待机自转/批次完成回调交互层"
```

---

### Task 7: usePlayback 播放器 hook + PlayerBar

**Files:**
- Create: `frontend/src/hooks/usePlayback.ts`
- Create: `frontend/src/components/PlayerBar.tsx`
- Test: `frontend/src/hooks/usePlayback.test.tsx`
- Test: `frontend/src/components/PlayerBar.test.tsx`

**Interfaces:**
- Consumes: `Step`（`../api/types`）、`MoveBatch`（`../cube/CubeView` 已导出）。
- Produces:
  - `export interface Playback { active: number; playing: boolean; speed: number; viewState: CubeState | null; batch: MoveBatch | null; resetToken: number; select(index: number): void; play(): void; pause(): void; stepPrev(): void; stepNext(): void; setSpeed(speed: number): void; handleBatchComplete(): void }`；`export function usePlayback(steps: Step[], initialState: CubeState | null): Playback`。
  - `export function PlayerBar({ playback, steps }: { playback: Playback; steps: Step[] })`，testid `playback-scrubber`、`playback-position`。
- 语义（Ruling 1）：`play()` 连播——从 active 步开始（active=-1 从步 0），跳过无走法步，`handleBatchComplete()` 推进，末步停；`select/stepPrev/stepNext` 吸附不播动画；键盘 `←/→/空格` 内置于 hook（Ruling 2 含 BUTTON 屏蔽）。

- [ ] **Step 1: 写 usePlayback 失败测试**

`frontend/src/hooks/usePlayback.test.tsx`：

```tsx
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { CubeState, Step } from '../api/types'
import { usePlayback } from './usePlayback'

const state: CubeState = {
  cube: '2x2',
  faces: {
    U: [['white', 'white'], ['white', 'white']],
    R: [['red', 'red'], ['red', 'red']],
    F: [['green', 'green'], ['green', 'green']],
    D: [['yellow', 'yellow'], ['yellow', 'yellow']],
    L: [['orange', 'orange'], ['orange', 'orange']],
    B: [['blue', 'blue'], ['blue', 'blue']],
  },
}

function stepFixture(overrides: Partial<Step> & { id: string; seq: number }): Step {
  return {
    kind: 'tool_result',
    tool_name: 'apply_moves',
    arguments: {},
    result: { applied: ["R'"], state },
    state,
    reference_length_after: 0,
    ...overrides,
  }
}

// 步 0/2 为无走法的思考步，步 1/3 各有一批 R'
const steps: Step[] = [
  stepFixture({
    id: 's0',
    seq: 0,
    kind: 'model_message',
    tool_name: null,
    result: { content: '想' },
  }),
  stepFixture({ id: 's1', seq: 1 }),
  stepFixture({
    id: 's2',
    seq: 2,
    kind: 'model_message',
    tool_name: null,
    result: { content: '再想' },
  }),
  stepFixture({ id: 's3', seq: 3 }),
]

describe('usePlayback', () => {
  it('初始为初始局面位', () => {
    const { result } = renderHook(() => usePlayback(steps, state))
    expect(result.current.active).toBe(-1)
    expect(result.current.playing).toBe(false)
    expect(result.current.viewState).toBe(state)
  })

  it('select 吸附该步局面且不播放', () => {
    const { result } = renderHook(() => usePlayback(steps, state))
    act(() => result.current.select(2))
    expect(result.current.active).toBe(2)
    expect(result.current.viewState).toBe(state)
    expect(result.current.batch).toBeNull()
    expect(result.current.resetToken).toBeGreaterThan(1)
  })

  it('play 从当前选中步连播，批次完成后跳过无走法步推进，末步停', () => {
    const { result } = renderHook(() => usePlayback(steps, state))
    act(() => result.current.select(1))
    act(() => result.current.play())
    expect(result.current.playing).toBe(true)
    expect(result.current.active).toBe(1)
    expect(result.current.batch?.moves).toEqual(["R'"])
    expect(result.current.viewState).toBe(state) // 起点 = stateFor(0)
    act(() => result.current.handleBatchComplete())
    expect(result.current.active).toBe(3) // 跳过无走法的步 2
    expect(result.current.batch?.moves).toEqual(["R'"])
    act(() => result.current.handleBatchComplete())
    expect(result.current.playing).toBe(false)
    expect(result.current.batch).toBeNull()
  })

  it('pause 停止连播后批次完成不再推进', () => {
    const { result } = renderHook(() => usePlayback(steps, state))
    act(() => result.current.play())
    act(() => result.current.pause())
    expect(result.current.playing).toBe(false)
    const batch = result.current.batch
    act(() => result.current.handleBatchComplete())
    expect(result.current.batch).toBe(batch)
  })

  it('stepPrev/stepNext 步进吸附不播动画，边界收敛', () => {
    const { result } = renderHook(() => usePlayback(steps, state))
    act(() => result.current.select(1))
    act(() => result.current.stepNext())
    expect(result.current.active).toBe(2)
    expect(result.current.batch).toBeNull()
    act(() => result.current.stepPrev())
    expect(result.current.active).toBe(1)
    act(() => result.current.stepPrev())
    expect(result.current.active).toBe(0)
    act(() => result.current.stepPrev())
    expect(result.current.active).toBe(-1)
    act(() => result.current.stepPrev())
    expect(result.current.active).toBe(-1)
  })

  it('键盘 ←/→ 步进、空格播放暂停；输入类聚焦时屏蔽', () => {
    const { result } = renderHook(() => usePlayback(steps, state))
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    })
    expect(result.current.active).toBe(0)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))
    })
    expect(result.current.playing).toBe(true)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))
    })
    expect(result.current.playing).toBe(false)
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    })
    expect(result.current.active).toBe(0)
    input.remove()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd frontend && npx vitest run src/hooks/usePlayback.test.tsx`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现 usePlayback**

`frontend/src/hooks/usePlayback.ts`：

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CubeState, Step } from '../api/types'
import type { MoveBatch } from '../cube/CubeView'

export interface Playback {
  active: number
  playing: boolean
  speed: number
  viewState: CubeState | null
  batch: MoveBatch | null
  resetToken: number
  select: (index: number) => void
  play: () => void
  pause: () => void
  stepPrev: () => void
  stepNext: () => void
  setSpeed: (speed: number) => void
  handleBatchComplete: () => void
}

// 空格在聚焦按钮上会同时触发 click 与 keydown，一并屏蔽防双动作
const KEY_BLOCKED_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'])

function appliedMoves(step: Step): string[] | null {
  const applied = step.result?.applied
  if (Array.isArray(applied) && applied.length > 0 && step.state) {
    return applied as string[]
  }
  return null
}

export function usePlayback(
  steps: Step[],
  initialState: CubeState | null,
): Playback {
  const [active, setActive] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [viewState, setViewState] = useState<CubeState | null>(initialState)
  const [batch, setBatch] = useState<MoveBatch | null>(null)
  const [resetToken, setResetToken] = useState(1)

  const activeRef = useRef(-1)
  const playingRef = useRef(false)
  const stepsRef = useRef(steps)
  const initialStateRef = useRef(initialState)
  stepsRef.current = steps
  initialStateRef.current = initialState

  // 选中步没有落库局面时，回退到之前最近有局面的步骤，再回退到题初始局面。
  function stateFor(index: number): CubeState | null {
    for (let cursor = index; cursor >= 0; cursor -= 1) {
      const candidate = stepsRef.current[cursor]?.state
      if (candidate) return candidate
    }
    return initialStateRef.current
  }

  const pause = useCallback(() => {
    playingRef.current = false
    setPlaying(false)
  }, [])

  const stopAndSnap = useCallback((index: number) => {
    setActive(index)
    activeRef.current = index
    setViewState(stateFor(index))
    setBatch(null)
    setResetToken((current) => current + 1)
  }, [])

  const select = useCallback(
    (index: number) => {
      playingRef.current = false
      setPlaying(false)
      stopAndSnap(index)
    },
    [stopAndSnap],
  )

  // 从 index 起找下一个有走法的步并开播；无走法的步瞬间跳过；到末步即停。
  // 开播时把视图吸附到该步的起点局面（stateFor(cursor - 1)），
  // 跳过的无走法步状态由回退链自然包含。
  const advanceFrom = useCallback((index: number) => {
    const list = stepsRef.current
    let cursor = index
    while (cursor < list.length) {
      const step = list[cursor]
      const moves = appliedMoves(step)
      if (moves && step.state) {
        setActive(cursor)
        activeRef.current = cursor
        setViewState(stateFor(cursor - 1))
        setResetToken((current) => current + 1)
        setBatch({ eventId: Date.now(), moves, state: step.state })
        return
      }
      cursor += 1
    }
    playingRef.current = false
    setPlaying(false)
    setBatch(null)
  }, [])

  const play = useCallback(() => {
    playingRef.current = true
    setPlaying(true)
    advanceFrom(activeRef.current === -1 ? 0 : activeRef.current)
  }, [advanceFrom])

  const handleBatchComplete = useCallback(() => {
    if (!playingRef.current) return
    advanceFrom(activeRef.current + 1)
  }, [advanceFrom])

  const stepPrev = useCallback(() => {
    select(Math.max(-1, activeRef.current - 1))
  }, [select])

  const stepNext = useCallback(() => {
    select(Math.min(stepsRef.current.length - 1, activeRef.current + 1))
  }, [select])

  // 题初始局面异步到达且用户尚未选择时，吸附一次
  const initialApplied = useRef<CubeState | null>(initialState)
  useEffect(() => {
    if (!initialState || initialApplied.current === initialState) return
    initialApplied.current = initialState
    if (activeRef.current !== -1) return
    setViewState(initialState)
    setResetToken((current) => current + 1)
  }, [initialState])

  // 键盘：←/→ 步进（吸附不播动画）、空格播放/暂停（防页面滚动）
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target
      if (
        target instanceof HTMLElement &&
        KEY_BLOCKED_TAGS.has(target.tagName)
      ) {
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        stepPrev()
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        stepNext()
      } else if (event.key === ' ') {
        event.preventDefault()
        if (playingRef.current) pause()
        else play()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [play, pause, stepPrev, stepNext])

  return {
    active,
    playing,
    speed,
    viewState,
    batch,
    resetToken,
    select,
    play,
    pause,
    stepPrev,
    stepNext,
    setSpeed,
    handleBatchComplete,
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd frontend && npx vitest run src/hooks/usePlayback.test.tsx`
Expected: PASS。

- [ ] **Step 5: 写 PlayerBar 失败测试**

`frontend/src/components/PlayerBar.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Step } from '../api/types'
import type { Playback } from '../hooks/usePlayback'
import { PlayerBar } from './PlayerBar'

const steps = [
  { id: 's0', seq: 0, kind: 'model_message', tool_name: null },
  { id: 's1', seq: 1, kind: 'tool_result', tool_name: 'apply_moves' },
] as unknown as Step[]

function playbackFixture(overrides: Partial<Playback> = {}): Playback {
  return {
    active: 1,
    playing: false,
    speed: 1,
    viewState: null,
    batch: null,
    resetToken: 1,
    select: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    stepPrev: vi.fn(),
    stepNext: vi.fn(),
    setSpeed: vi.fn(),
    handleBatchComplete: vi.fn(),
    ...overrides,
  }
}

describe('PlayerBar', () => {
  it('显示当前步指示与初始局面', () => {
    render(<PlayerBar playback={playbackFixture()} steps={steps} />)
    expect(screen.getByTestId('playback-position')).toHaveTextContent(
      '#1 tool_result',
    )
    const scrubber = screen.getByTestId('playback-scrubber')
    expect(scrubber).toHaveAttribute('min', '-1')
    expect(scrubber).toHaveAttribute('max', '1')
  })

  it('active=-1 时显示初始局面', () => {
    render(
      <PlayerBar
        playback={playbackFixture({ active: -1 })}
        steps={steps}
      />,
    )
    expect(screen.getByTestId('playback-position')).toHaveTextContent(
      '初始局面',
    )
  })

  it('播放按钮在播放/暂停间切换，步进与选择回调生效', async () => {
    const user = userEvent.setup()
    const playback = playbackFixture()
    const { rerender } = render(
      <PlayerBar playback={playback} steps={steps} />,
    )
    await user.click(screen.getByRole('button', { name: '播放' }))
    expect(playback.play).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '上一步' }))
    expect(playback.stepPrev).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '下一步' }))
    expect(playback.stepNext).toHaveBeenCalled()
    rerender(
      <PlayerBar
        playback={playbackFixture({ playing: true })}
        steps={steps}
      />,
    )
    await user.click(screen.getByRole('button', { name: '暂停' }))
    expect(
      playbackFixture({ playing: true }).pause,
    ).not.toHaveBeenCalled()
    // 上面那行只是占位防御；真正的暂停断言：
    const playing = playbackFixture({ playing: true })
    rerender(<PlayerBar playback={playing} steps={steps} />)
    await user.click(screen.getByRole('button', { name: '暂停' }))
    expect(playing.pause).toHaveBeenCalled()
  })

  it('scrubber 拖动与速度选择回调', async () => {
    const user = userEvent.setup()
    const playback = playbackFixture()
    render(<PlayerBar playback={playback} steps={steps} />)
    const scrubber = screen.getByTestId('playback-scrubber')
    fireEvent.change(scrubber, { target: { value: '0' } })
    expect(playback.select).toHaveBeenCalledWith(0)
    fireEvent.change(screen.getByLabelText('播放速度'), {
      target: { value: '2' },
    })
    expect(playback.setSpeed).toHaveBeenCalledWith(2)
  })
})
```

注意：Step 5 的测试代码里 `fireEvent` 需要 import——把文件顶部 import 改为：

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
```

并删除「占位防御」那段（`expect(playbackFixture({ playing: true }).pause)...` 两行与其注释）——直接用最后那段 `playing` fixture 断言即可。上面完整保留是为了让失败步骤也能编译；实现步骤落地时以删减后的干净版本为准。

- [ ] **Step 6: 跑测试确认失败**

Run: `cd frontend && npx vitest run src/components/PlayerBar.test.tsx`
Expected: FAIL —— 模块不存在。

- [ ] **Step 7: 实现 PlayerBar**

`frontend/src/components/PlayerBar.tsx`：

```tsx
import type { Step } from '../api/types'
import type { Playback } from '../hooks/usePlayback'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Select } from '../ui/Select'

export function PlayerBar({
  playback,
  steps,
}: {
  playback: Playback
  steps: Step[]
}) {
  const step = playback.active >= 0 ? steps[playback.active] : null
  return (
    <Card className="flex flex-wrap items-center gap-3 p-3">
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="secondary"
          type="button"
          aria-label="上一步"
          onClick={playback.stepPrev}
        >
          ←
        </Button>
        <Button
          size="sm"
          variant="primary"
          type="button"
          onClick={() =>
            playback.playing ? playback.pause() : playback.play()
          }
        >
          {playback.playing ? '暂停' : '播放'}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          type="button"
          aria-label="下一步"
          onClick={playback.stepNext}
        >
          →
        </Button>
      </div>
      <input
        type="range"
        data-testid="playback-scrubber"
        aria-label="步骤进度"
        min={-1}
        max={Math.max(-1, steps.length - 1)}
        step={1}
        value={playback.active}
        onChange={(event) => playback.select(Number(event.target.value))}
        className="min-w-0 flex-1 accent-accent"
      />
      <span
        data-testid="playback-position"
        className="font-mono text-xs text-text-dim"
      >
        {step
          ? `#${step.seq} ${step.kind}${
              step.tool_name ? ` · ${step.tool_name}` : ''
            }`
          : '初始局面'}
      </span>
      <Select
        aria-label="播放速度"
        value={playback.speed}
        onChange={(event) => playback.setSpeed(Number(event.target.value))}
      >
        <option value={0.5}>0.5×</option>
        <option value={1}>1×</option>
        <option value={2}>2×</option>
        <option value={100}>instant</option>
      </Select>
    </Card>
  )
}
```

- [ ] **Step 8: 跑测试确认通过**

Run: `cd frontend && npx vitest run src/hooks/usePlayback.test.tsx src/components/PlayerBar.test.tsx`
Expected: PASS。

- [ ] **Step 9: Commit**

```bash
git add frontend/src/hooks/usePlayback.ts frontend/src/hooks/usePlayback.test.tsx frontend/src/components/PlayerBar.tsx frontend/src/components/PlayerBar.test.tsx
git commit -m "feat: usePlayback 连播播放器 hook 与 PlayerBar"
```

---

### Task 8: RunLivePanel 重组 + RunPage 视角/自转接线

**Files:**
- Modify: `frontend/src/ui/Stat.tsx`（透传 rest props）
- Modify: `frontend/src/pages/RunPage.tsx`
- Test: `frontend/src/pages/RunPage.test.tsx`（改一处断言）

**Interfaces:**
- Consumes: Task 1 `derivePhase`、Task 2 `AnimatedNumber`、Task 3 `ThinkingPanel`、Task 4 `PhaseStepper`、Task 5 已改的 ToolLog/ProgressChart、Task 6 `ViewPresets`/`ViewRequest`、U1 的 `ui/Stat`/`ui/Card`。
- Produces: RunLivePanel 对外 props 不变；Stat 内部格新增 testid `stat-moves`。RunPage 向 CubeView 传 `viewRequest`/`idleSpin`（不传 `onBatchComplete`——Run 页无连播）。

- [ ] **Step 1: 更新 RunPage.test 断言（红）**

`frontend/src/pages/RunPage.test.tsx` 中 `describe('RunLivePanel')` 里：

```ts
expect(screen.getByText('2/30')).toBeInTheDocument()
```

改为：

```ts
expect(screen.getByTestId('stat-moves')).toHaveTextContent('2/30')
```

Run: `cd frontend && npx vitest run src/pages/RunPage.test.tsx`
Expected: FAIL —— `stat-moves` 不存在（其余断言仍绿）。

- [ ] **Step 2: Stat 透传 rest props**

`frontend/src/ui/Stat.tsx` 整体替换为：

```tsx
import type { HTMLAttributes, ReactNode } from 'react'

export function Stat({
  label,
  value,
  delta,
  ...rest
}: {
  label: string
  value: ReactNode
  delta?: string
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className="rounded-lg border border-line bg-surface-2 px-3 py-2"
      {...rest}
    >
      <div className="text-xs text-text-dim">{label}</div>
      <div className="font-mono text-sm text-text-strong">
        {value}
        {delta && <span className="ml-1.5 text-xs text-text-dim">{delta}</span>}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 重组 RunLivePanel**

`frontend/src/pages/RunPage.tsx` 修改：

3a. import 区追加（并删除不再使用的本地 Stat 相关内容）：

```tsx
import { PhaseStepper } from '../components/PhaseStepper'
import { ThinkingPanel } from '../components/ThinkingPanel'
import { ViewPresets } from '../cube/ViewPresets'
import type { ViewRequest } from '../cube/viewControls'
import { derivePhase } from '../hooks/liveReducer'
import { AnimatedNumber } from '../ui/AnimatedNumber'
import { Card } from '../ui/Card'
import { Stat } from '../ui/Stat'
```

3b. 删除本地 `function Stat(...)`（第 46-53 行那段）。

3c. `RunLivePanel` 函数体整体替换为：

```tsx
export function RunLivePanel({
  live,
  run,
  benchmark,
  provider,
  onCancel,
  cancelling,
}: {
  live: LiveState
  run: Run
  benchmark: BenchmarkDetail | null
  provider: Provider | null
  onCancel: () => void
  cancelling: boolean
}) {
  const episode = live.currentEpisode
  const elapsed = useElapsed(run.started_at)
  const tokens =
    live.usage.prompt_tokens + live.usage.completion_tokens
  const completed = live.episodes.filter(
    (item) => item.status !== 'running',
  ).length
  return (
    <Card className="space-y-4 self-start p-4 text-sm">
      <div className="grid grid-cols-2 gap-2">
        <Stat
          label="provider"
          value={
            provider
              ? `${provider.name} / ${provider.model}`
              : run.provider_id
          }
        />
        <Stat label="题集" value={benchmark?.name ?? run.benchmark_id} />
        <Stat
          label="进度"
          value={
            <>
              <AnimatedNumber value={completed} />
              {`/${benchmark?.tasks.length ?? '?'}`}
            </>
          }
        />
        <Stat label="当前题" value={episode?.task_key ?? '—'} />
        <Stat
          data-testid="stat-moves"
          label="步数"
          value={
            episode ? (
              <>
                <AnimatedNumber value={episode.moves_used} />
                {`/${run.budget.max_moves}`}
              </>
            ) : (
              '—'
            )
          }
        />
        <Stat
          label="参照长度"
          value={String(episode?.reference_length ?? '—')}
        />
        <Stat label="计时" value={formatDuration(elapsed)} />
        <Stat
          label="tokens"
          value={<AnimatedNumber value={tokens} format={formatTokens} />}
        />
      </div>
      <PhaseStepper phase={derivePhase(live)} />
      <div className="flex items-center gap-2">
        <StatusBadge status={episode?.status ?? run.status} />
        <span className="text-xs text-text-dim">成本：未配置价格</span>
      </div>
      {live.thinking && !live.thinkingText && (
        <p data-testid="thinking" className="text-sky-300">
          思考中…
        </p>
      )}
      {live.thinking && live.thinkingText && (
        <ThinkingPanel text={live.thinkingText} />
      )}
      {live.firstInvalidCall && (
        <p className="text-amber-300">
          首次非法调用：{live.firstInvalidCall.tool} ·{' '}
          {live.firstInvalidCall.message}
        </p>
      )}
      {live.error && <p className="text-rose-300">{live.error}</p>}
      <ProgressChart
        points={live.progress}
        maxMoves={run.budget.max_moves}
      />
      <ToolLog logs={live.logs} />
      {(run.status === 'queued' || run.status === 'running') && (
        <Button
          variant="danger"
          type="button"
          onClick={onCancel}
          disabled={cancelling}
        >
          取消 run
        </Button>
      )}
    </Card>
  )
}
```

3d. `RunPage` 默认导出组件内：

- import 后新增状态（与 `const [speed, setSpeed] = useState(1)` 同区）：

```tsx
  const [viewRequest, setViewRequest] = useState<ViewRequest | null>(null)
```

- 3D 区域（`<div className="relative space-y-3">` 内的 `<CubeView ...>`）替换为：

```tsx
          <div className="relative">
            <CubeView
              state={cubeReset.state}
              resetToken={cubeReset.token}
              batch={live.latestBatch}
              speed={speed}
              paused={paused}
              skipToken={skipToken}
              viewRequest={viewRequest ?? undefined}
              idleSpin={!finished}
            />
            <ViewPresets
              onRequest={(preset) =>
                setViewRequest((current) => ({
                  preset,
                  token: (current?.token ?? 0) + 1,
                }))
              }
            />
          </div>
```

（FaceLegend 与速度/暂停/跳到最新 控件行保持原位不动，仍在这个 relative 容器内。）

- [ ] **Step 4: 跑测试与类型检查**

Run: `cd frontend && npm run typecheck && npx vitest run src/ui/Stat.test.tsx src/pages/RunPage.test.tsx`
Expected: 全 PASS。重点核对既有用例：`local / m` 文本、`progress-path`、`tool-log`、`thinking-panel` 出现/消失、`log-thinking`、`run-result` 全部不受影响（testid 均保留）。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/ui/Stat.tsx frontend/src/pages/RunPage.tsx frontend/src/pages/RunPage.test.tsx
git commit -m "feat: RunLivePanel 重组——Stat 卡组/滚动数字/阶段 stepper/ThinkingPanel，Run 页视角与自转接入"
```

---

### Task 9: EpisodePage 回放播放器化

**Files:**
- Modify: `frontend/src/pages/EpisodePage.tsx`（整体重写）
- Test: `frontend/src/pages/EpisodePage.test.tsx`（更新两处用例 + 新增键盘用例）

**Interfaces:**
- Consumes: Task 7 `usePlayback`/`Playback`/`PlayerBar`、Task 6 `ViewPresets`/`ViewRequest`、U1 `ui/Stat`。
- Produces: `EpisodeViewProps` 改为 `{ episode, steps, playback, cube }`（原 `selected/onSelect/onPlayBatch` 三 props 移除——现有测试同步更新，属计划内破坏）。EpisodePage 向 CubeView 传 `viewRequest` 与 `onBatchComplete={playback.handleBatchComplete}`。

- [ ] **Step 1: 更新测试（红）**

`frontend/src/pages/EpisodePage.test.tsx` 修改：

1a. import 区：`import type { ... }` 中补充 `Playback`（`from '../hooks/usePlayback'`），并补充 `act`（from '@testing-library/react'，若未导入）。

1b. 顶部（mock 之后）加 playback stub 工厂：

```tsx
function playbackStub(overrides: Partial<Playback> = {}): Playback {
  return {
    active: 1,
    playing: false,
    speed: 1,
    viewState: null,
    batch: null,
    resetToken: 1,
    select: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    stepPrev: vi.fn(),
    stepNext: vi.fn(),
    setSpeed: vi.fn(),
    handleBatchComplete: vi.fn(),
    ...overrides,
  }
}
```

1c. `describe('EpisodeView')` 的用例整体替换为：

```tsx
describe('EpisodeView', () => {
  it('lists steps, syncs chip clicks and shows the player bar', async () => {
    const user = userEvent.setup()
    const playback = playbackStub()
    render(
      <MemoryRouter>
        <EpisodeView
          episode={episode}
          steps={steps}
          playback={playback}
          cube={<div data-testid="cube-stub" />}
        />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('cube-stub')).toBeInTheDocument()
    expect(screen.getAllByTestId('step-row')).toHaveLength(2)
    expect(screen.getAllByTestId('step-row')[0]).toHaveTextContent(
      'model_message',
    )
    await user.click(screen.getAllByTestId('step-row')[1])
    expect(playback.select).toHaveBeenCalledWith(1)
    expect(
      screen.getByRole('button', { name: '播放' }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('playback-position')).toHaveTextContent(
      '#1 tool_result',
    )
  })
})
```

1d. `describe('EpisodePage')` 第一个用例（播放）整体替换为：

```tsx
  it('播放器从选中步起播（吸附起点后播放本步走法）', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (input === '/api/episodes/e1') return jsonResponse(episode)
        if (input === '/api/episodes/e1/steps') return jsonResponse(steps)
        if (input === '/api/runs/r1') {
          return jsonResponse({ run, episodes: [episode] })
        }
        if (input === '/api/benchmarks/b1') return jsonResponse(benchmark)
        return jsonResponse({ detail: 'not found' }, 404)
      }),
    )
    renderEpisodePage('e1')
    const rows = await screen.findAllByTestId('step-row')
    await user.click(rows[1])
    const before = Number(
      screen.getByTestId('cube-stub').getAttribute('data-token'),
    )
    await user.click(screen.getByRole('button', { name: '播放' }))
    const cube = screen.getByTestId('cube-stub')
    expect(cube).toHaveAttribute('data-moves', "R'")
    expect(Number(cube.getAttribute('data-token'))).toBe(before + 1)
  })

  it('键盘 ←/→ 步进吸附', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (input === '/api/episodes/e1') return jsonResponse(episode)
        if (input === '/api/episodes/e1/steps') return jsonResponse(steps)
        if (input === '/api/runs/r1') {
          return jsonResponse({ run, episodes: [episode] })
        }
        if (input === '/api/benchmarks/b1') return jsonResponse(benchmark)
        return jsonResponse({ detail: 'not found' }, 404)
      }),
    )
    renderEpisodePage('e1')
    await screen.findAllByTestId('step-row')
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight' }),
      )
    })
    expect(screen.getByTestId('playback-position')).toHaveTextContent(
      '#0 model_message',
    )
  })
```

（`model_message 步骤展示思考块` 与 `shows the API error` 两个用例不动。）

Run: `cd frontend && npx vitest run src/pages/EpisodePage.test.tsx`
Expected: FAIL —— EpisodeView 还不接收 `playback` prop、无 PlayerBar。

- [ ] **Step 2: 重写 EpisodePage.tsx**

`frontend/src/pages/EpisodePage.tsx` 整体替换为：

```tsx
import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useBenchmark, useEpisode, useRun, useSteps } from '../api/queries'
import type { Episode, Step } from '../api/types'
import { PlayerBar } from '../components/PlayerBar'
import { StatusBadge } from '../components/StatusBadge'
import { CubeView } from '../cube/CubeView'
import { FaceLegend } from '../cube/FaceLegend'
import { ViewPresets } from '../cube/ViewPresets'
import type { ViewRequest } from '../cube/viewControls'
import { usePlayback, type Playback } from '../hooks/usePlayback'
import { describeError } from '../lib/errors'
import {
  formatDuration,
  formatPercent,
  formatTokens,
} from '../lib/format'
import { Alert } from '../ui/Alert'
import { Stat } from '../ui/Stat'
import { Skeleton } from '../ui/Skeleton'

export interface EpisodeViewProps {
  episode: Episode
  steps: Step[]
  playback: Playback
  cube: ReactNode
}

const chipCls = (active: boolean) =>
  `rounded px-2 py-1 text-xs ${
    active ? 'bg-accent-dim text-white' : 'bg-surface text-text'
  }`

export function EpisodeView({
  episode,
  steps,
  playback,
  cube,
}: EpisodeViewProps) {
  const step = playback.active >= 0 ? steps[playback.active] : null
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">
          题目 {episode.task_key}
        </h1>
        <StatusBadge status={episode.status} />
        <Link className="text-sm text-text-dim" to={`/runs/${episode.run_id}`}>
          返回 run
        </Link>
      </div>
      <div className="grid gap-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
        <div>
          <div className="text-xs text-text-dim">解出</div>
          <div>{episode.solved ? '是' : '否'}</div>
        </div>
        <div>
          <div className="text-xs text-text-dim">步数 / 参照</div>
          <div>
            {episode.moves_used} / {episode.reference_length}
          </div>
        </div>
        <div>
          <div className="text-xs text-text-dim">效率</div>
          <div>
            {episode.efficiency == null
              ? '—'
              : formatPercent(episode.efficiency)}
          </div>
        </div>
        <div>
          <div className="text-xs text-text-dim">耗时</div>
          <div>{formatDuration(episode.latency_ms)}</div>
        </div>
        <div>
          <div className="text-xs text-text-dim">tokens</div>
          <div>
            {formatTokens(
              (episode.tokens_in ?? 0) + (episode.tokens_out ?? 0),
            )}
          </div>
        </div>
        <div>
          <div className="text-xs text-text-dim">失败码</div>
          <div>{episode.failure_code ?? '—'}</div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        {cube}
        <aside className="space-y-3 rounded border border-line bg-surface p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => playback.select(-1)}
              className={chipCls(playback.active === -1)}
            >
              初始局面
            </button>
            {steps.map((item, index) => (
              <button
                key={item.id}
                type="button"
                data-testid="step-row"
                onClick={() => playback.select(index)}
                className={chipCls(playback.active === index)}
              >
                #{item.seq} {item.kind}
                {item.tool_name ? ` · ${item.tool_name}` : ''}
              </button>
            ))}
          </div>

          {step && (
            <div className="space-y-2 border-t border-line pt-3">
              <div className="grid grid-cols-2 gap-2">
                <Stat
                  label="kind"
                  value={
                    step.tool_name
                      ? `${step.kind} · ${step.tool_name}`
                      : step.kind
                  }
                />
                <Stat
                  label="参照长度"
                  value={String(step.reference_length_after ?? '—')}
                />
              </div>
              <details>
                <summary className="cursor-pointer text-xs text-text-dim">
                  参数
                </summary>
                <pre className="mt-1 overflow-auto rounded bg-sunken p-2 text-[10px] text-text-dim">
                  {JSON.stringify(step.arguments, null, 2)}
                </pre>
              </details>
              {typeof step.result?.thinking === 'string' &&
                step.result.thinking && (
                  <details data-testid="step-thinking">
                    <summary className="cursor-pointer text-xs text-sky-300">
                      思考过程
                    </summary>
                    <pre className="mt-1 overflow-auto whitespace-pre-wrap rounded bg-sunken p-2 text-[10px] text-text-dim">
                      {step.result.thinking}
                    </pre>
                  </details>
                )}
              <details>
                <summary className="cursor-pointer text-xs text-text-dim">
                  结果
                </summary>
                <pre className="mt-1 overflow-auto rounded bg-sunken p-2 text-[10px] text-text-dim">
                  {JSON.stringify(step.result, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </aside>
      </div>

      <PlayerBar playback={playback} steps={steps} />
    </div>
  )
}

export default function EpisodePage() {
  const { id } = useParams()
  const episodeQuery = useEpisode(id)
  const stepsQuery = useSteps(id)
  const runQuery = useRun(episodeQuery.data?.run_id)
  const benchmarkQuery = useBenchmark(runQuery.data?.run.benchmark_id)
  const [viewRequest, setViewRequest] = useState<ViewRequest | null>(null)

  const episode = episodeQuery.data
  const steps = stepsQuery.data ?? []
  const task = benchmarkQuery.data?.tasks.find(
    (item) => item.id === episode?.task_key,
  )
  // usePlayback 是 hook，必须在早退 return 之前调用；数据未到时 steps 为空数组。
  const playback = usePlayback(steps, task?.state ?? null)

  // 先看错误再看 loading：run/benchmark 依赖上游数据，上游失败时它们会一直 pending。
  const failure =
    episodeQuery.error ??
    stepsQuery.error ??
    runQuery.error ??
    benchmarkQuery.error
  if (failure) {
    return <Alert tone="danger">{describeError(failure)}</Alert>
  }
  if (
    episodeQuery.isPending ||
    stepsQuery.isPending ||
    runQuery.isPending ||
    benchmarkQuery.isPending
  ) {
    return (
      <div aria-busy="true" className="space-y-2">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    )
  }
  if (!episode) return null

  return (
    <EpisodeView
      episode={episode}
      steps={steps}
      playback={playback}
      cube={
        <div className="relative">
          <CubeView
            state={playback.viewState}
            resetToken={playback.resetToken}
            batch={playback.batch}
            speed={playback.speed}
            paused={false}
            skipToken={0}
            viewRequest={viewRequest ?? undefined}
            onBatchComplete={playback.handleBatchComplete}
          />
          <ViewPresets
            onRequest={(preset) =>
              setViewRequest((current) => ({
                preset,
                token: (current?.token ?? 0) + 1,
              }))
            }
          />
          <FaceLegend />
        </div>
      }
    />
  )
}
```

- [ ] **Step 3: 跑测试与类型检查**

Run: `cd frontend && npm run typecheck && npx vitest run src/pages/EpisodePage.test.tsx`
Expected: 全 PASS。特别核对：`model_message 步骤展示思考块`（step-thinking）与 404 错误用例仍绿。

- [ ] **Step 4: 全量单测回归**

Run: `cd frontend && npm run test:run`
Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/EpisodePage.tsx frontend/src/pages/EpisodePage.test.tsx
git commit -m "feat: EpisodePage 回放播放器化——usePlayback 连播/scrubber/键盘/视角预设"
```

---

### Task 10: ResultView sticky residual + E2E + 文档 + 全量验证

**Files:**
- Modify: `frontend/src/components/ResultView.tsx`（两处 Table 包 overflow-auto）
- Modify: `frontend/e2e/workbench.spec.ts`（追加播放器与 thinking 跟随 E2E）
- Modify: `README.md`（前端工作台小节追加 U2 说明）

**Interfaces:**
- Consumes: Task 7-9 的 `playback-scrubber`/`playback-position`/`thinking-follow` testid。
- Produces: E2E 全流程含新能力；文档同步。

- [ ] **Step 1: ResultView 表格容器加 overflow-auto（U1 residual）**

`frontend/src/components/ResultView.tsx`：把「分箱」与「逐题」两处的

```tsx
        <Table>
```

…

```tsx
        </Table>
```

分别包进 `<div className="overflow-auto">…</div>`（即 `<div className="overflow-auto"><Table>…</Table></div>`，两个表各一处；Table 内 Th 已是 sticky top-0，容器滚动后 sticky 生效）。

Run: `cd frontend && npx vitest run src/pages/RunPage.test.tsx`
Expected: PASS（ResultView 用例断言内容不变）。

- [ ] **Step 2: 追加 E2E**

`frontend/e2e/workbench.spec.ts` 两处修改：

2a. 在 live run 段的

```ts
  await expect(page.getByTestId('log-thinking').first()).toBeVisible()
```

之后、`run-status` 断言之前，插入 thinking 跟随的条件断言（Ruling 3）：

```ts
  // thinking 跟随滚动：仅在面板实际溢出且仍在流式时断言（条件断言防 flake）
  const thinkPanel = page.getByTestId('thinking-panel')
  const thinkPre = thinkPanel.locator('pre')
  if (
    (await thinkPanel.isVisible()) &&
    (await thinkPre.evaluate(
      (el) => el.scrollHeight > el.clientHeight,
    ))
  ) {
    await thinkPre.evaluate((el) => {
      el.scrollTop = 0
      el.dispatchEvent(new Event('scroll'))
    })
    const follow = page.getByTestId('thinking-follow')
    await expect(follow).toBeVisible()
    await follow.click()
    await expect
      .poll(() =>
        thinkPre.evaluate((el) => el.scrollTop + el.clientHeight),
      )
      .toBeGreaterThanOrEqual(
        await thinkPre.evaluate((el) => el.scrollHeight - 8),
      )
  }
```

2b. 在回放段末尾（step-thinking 检查之后）追加播放器断言：

```ts
  // —— 回放播放器：scrubber 双向联动 + 键盘步进/播放暂停 ——
  const scrubber = page.getByTestId('playback-scrubber')
  await expect(scrubber).toBeVisible()
  await expect(page.getByTestId('playback-position')).toContainText(
    '初始局面',
  )
  await scrubber.fill('1')
  await expect(page.getByTestId('playback-position')).not.toContainText(
    '初始局面',
  )
  // 拖动后焦点在 range 上，先点到中性的位置指示上再走键盘（input 聚焦被屏蔽）
  await page.getByTestId('playback-position').click()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('playback-position')).toContainText('#2')
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByTestId('playback-position')).toContainText('#1')
  await page.keyboard.press(' ')
  await expect(page.getByRole('button', { name: '暂停' })).toBeVisible()
  await page.keyboard.press(' ')
  await expect(page.getByRole('button', { name: '播放' })).toBeVisible()
```

- [ ] **Step 3: README 文档**

`README.md` 的「前端工作台」小节末尾（`U1 视觉底座已落地…` 段之后、「GPL 边界」之前）追加一段：

```markdown
U2 观测体验已落地：Run live 面板重组为 Stat 卡组（motion 数字滚动）+
四态阶段 stepper + 思考面板（内部滚动、自动跟随、可复制）；3D 画布支持
视角预设（正视/顶视/等轴/重置）与运行中待机自转（尊重
prefers-reduced-motion）；Episode 回放升级为播放器——连播（播完自动进下
一步）、scrubber 拖动选步、`←`/`→` 步进、空格播放/暂停。
```

- [ ] **Step 4: 全量验证**

Run:
```bash
cd frontend
npm run typecheck
npm run test:run
npm run build
npm run e2e
```
Expected: 四项全绿。若 E2E 因 5173 被残留进程占用而失败，确认占用进程属本项目后结束该进程重试。E2E 首次运行需 `npx playwright install chromium`。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ResultView.tsx frontend/e2e/workbench.spec.ts README.md
git commit -m "fix: ResultView 表格容器 overflow-auto 使 sticky 表头生效；E2E 覆盖播放器与 thinking 跟随，README 注记 U2"
```

---

## Self-Review 记录

- **Spec 覆盖**：§1 Stat 卡组+AnimatedNumber（T2/T8）、PhaseStepper+derivePhase（T1/T4/T8）、ThinkingPanel+useFollowScroll+复制+折叠自持（T3/T8）、ToolLog 微标（T5）、ProgressChart 脉冲+虚线（T5）；§2 viewRequest/idleSpin/onBatchComplete/ViewPresets（T6/T8/T9）；§3 usePlayback 连播/scrubber/键盘/信息卡 Stat 重排/播放本步按钮移除（T7/T9）；§4 单测矩阵（各任务）+ E2E（thinking 跟随/scrubber/键盘，T10）+ typecheck/test/build/e2e 全绿（T10）+ ResultView overflow residual（T10）。无遗漏。
- **占位符扫描**：无 TBD/「适当处理」；PlayerBar 测试步骤 5 中的「占位防御」两行已在同一步内给出删减指令，实现以干净版本为准（唯一例外，已就地说明）。
- **类型一致性**：`Playback` 字段名（active/playing/speed/viewState/batch/resetToken/select/play/pause/stepPrev/stepNext/setSpeed/handleBatchComplete）在 T7 定义、T8/T9/T10 消费处一致；`ViewRequest{preset,token}` 在 T6 定义、T8/T9 消费一致；`Phase` 在 T1 定义、T4/T8 消费一致；`derivePhase(live: LiveState): Phase` 签名一致；testid（stat-moves/progress-limit/progress-pulse/thinking-follow/playback-scrubber/playback-position/view-*）各处一致。
