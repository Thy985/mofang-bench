# U4 信息密度 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Runs 页客户端筛选/排序/勾选对比入口、报告分箱条形图 + 逐题 tokens/耗时列、`/compare` 对比页消费后端已有 `/api/compare`。

**Architecture:** 纯前端批次、后端零改动。RunsView 在现有三数据源上做 useMemo 派生（筛选/排序/选中），筛选与排序状态写 URL search params；BinChart 是新 SVG 组件；Compare 页新路由 + 新 query（`api.compare`），run 元信息从 useRuns 列表派生。

**Tech Stack:** React 19 + Vite + Tailwind v4 + TanStack Query + vitest/jsdom + Playwright；手写 SVG（不引图表库）。

**Spec:** docs/superpowers/specs/2026-10-31-ui-upgrade-u4-design.md

## Global Constraints

- 后端与 API 行为零改动；`client.ts` / `types.ts` / `queries.ts` 只允许**追加**。
- 原语层 `frontend/src/ui/` 零改动（U3 恒定 wrapper 豁免不外溢）。
- 零新增依赖；图表手写 SVG，SVG 内用既有 hex（条 `#059669` accent、须线/标签 `#94a3b8` text-dim），不引入新语义色。
- 基线：typecheck 干净 + 276 用例全绿；最终四连 `npm run typecheck && npm run test:run && npm run build && npm run e2e`（frontend/ 下）。
- 无障碍：排序表头带 `aria-sort`；行 checkbox `aria-label` 用 `选择 {shortId}`。
- 文案逐字：「全部 provider」「全部状态」「清除筛选」「无匹配 run」「已选 {n}/2」「对比」「Run 对比」「返回 Runs」「逐题（仅统计两 run 共同题，解出状态不同的行高亮）」「链接不完整：需要恰好两个 run id（/compare?runs=a,b）」。
- 列文案：逐题表新两列表头 `tokens` / `耗时`。
- 测试基建事实：jsdom 下 fetch mock 用 `vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, status, statusText, json }))` 模式；App 级测试需 `vi.mock('./cube/CubeView', …)`（lazy 链引 three）；渲染带 useSearchParams 的组件须包 MemoryRouter。

---

### Task 1: RunsPage 筛选 + 排序 + URL 同步 + 无匹配空态

**Files:**
- Modify: `frontend/src/pages/RunsPage.tsx`（整文件重写）
- Test: `frontend/src/pages/RunsPage.test.tsx`（新建）

**Interfaces:**
- Consumes: `useRuns/useProviders/useBenchmarks`（queries.ts 现状）、`Select/Button/EmptyState/Table/Th/Td` 原语现状、`formatPercent/shortId/statusLabel`。
- Produces: `RunsView` 导出与 props `{ runs, providers, benchmarks }` 不变（Task 2 在此文件继续加选中）；页面派生逻辑 `sortRuns/solveRate/toggleSort` 仅供本文件内使用。筛选 URL 参数：`provider` / `benchmark` / `status`（空 = 全部，不写参数）；排序参数：`sort`（`created_at|solve_rate`）/ `order`（`asc|desc`），缺省态（created_at desc）不写参数。`data-testid`：`runs-filter`、`runs-no-match`（行上 `run-row` 沿用）。

- [ ] **Step 1: 写失败测试（新文件）**

`frontend/src/pages/RunsPage.test.tsx` 完整内容：

```tsx
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { AggregateReport, BenchmarkSummary, Provider, Run } from '../api/types'
import { RunsView } from './RunsPage'

const providers: Provider[] = [
  {
    id: 'p1',
    name: 'local',
    base_url: 'http://127.0.0.1:20129/v1',
    model: 'mock-model',
    api_key_ref: '',
    params: {},
    key_configured: true,
    key_stored: true,
    created_at: '2026-10-26T00:00:00+00:00',
  },
  {
    id: 'p2',
    name: 'remote',
    base_url: 'https://api.example.com/v1',
    model: 'gpt',
    api_key_ref: '',
    params: {},
    key_configured: false,
    key_stored: false,
    created_at: '2026-10-26T00:00:00+00:00',
  },
]

const benchmarks: BenchmarkSummary[] = [
  {
    id: 'b1',
    name: 'demo',
    version: 'v1',
    kind: 'frozen',
    cube: '2x2',
    content_hash: 'hash',
    frozen_at: '2026-10-26T00:00:00+00:00',
    task_count: 4,
  },
  {
    id: 'b2',
    name: 'other',
    version: 'v1',
    kind: 'frozen',
    cube: '3x3',
    content_hash: 'hash2',
    frozen_at: '2026-10-26T00:00:00+00:00',
    task_count: 1,
  },
]

function aggregate(solveRate: number): AggregateReport {
  return {
    benchmark_id: 'b1',
    benchmark_hash: 'hash',
    benchmark_total_tasks: 4,
    partial: false,
    totals: {
      tasks: 4,
      solved: Math.round(solveRate * 4),
      solve_rate: solveRate,
      ci95: [0, 1],
    },
    by_bin: {},
    episodes: [],
  }
}

function makeRun(id: string, overrides: Partial<Run> = {}): Run {
  return {
    id,
    provider_id: 'p1',
    benchmark_id: 'b1',
    tool_mode: 'both',
    prompt_version: 'v1',
    status: 'finished',
    totals: null,
    error: null,
    created_at: '2026-10-26T00:00:00+00:00',
    started_at: null,
    finished_at: null,
    budget: {
      max_moves: 30,
      max_tool_calls: 50,
      max_tokens: 300000,
      max_seconds: 300,
      turn_timeout: 120,
    },
    ...overrides,
  }
}

const runs: Run[] = [
  makeRun('r-older', {
    created_at: '2026-10-25T00:00:00+00:00',
    status: 'failed',
    provider_id: 'p2',
    totals: aggregate(0.75),
  }),
  makeRun('r-newest', {
    created_at: '2026-10-27T00:00:00+00:00',
    totals: aggregate(0.25),
  }),
  makeRun('r-middle', { totals: aggregate(0.5) }),
]

function LocationProbe() {
  const location = useLocation()
  return <span data-testid="loc">{`${location.pathname}${location.search}`}</span>
}

function renderView(props: Partial<{ runs: Run[] }> = {}, initialEntry = '/runs') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <RunsView
        runs={props.runs ?? runs}
        providers={providers}
        benchmarks={benchmarks}
      />
      <LocationProbe />
    </MemoryRouter>,
  )
}

function rowIds(): string[] {
  return screen
    .getAllByTestId('run-row')
    .map((row) => within(row).getByRole('link').textContent)
}

describe('RunsView 筛选与排序', () => {
  it('默认全部行按创建时间降序', () => {
    renderView()
    expect(rowIds()).toEqual(['r-newest', 'r-middle', 'r-older'])
  })

  it('按 provider 筛选只剩匹配行', async () => {
    const user = userEvent.setup()
    renderView()
    await user.selectOptions(screen.getByLabelText('provider 筛选'), 'p2')
    expect(rowIds()).toEqual(['r-older'])
  })

  it('组合筛选无结果出无匹配空态，清除后恢复', async () => {
    const user = userEvent.setup()
    renderView()
    await user.selectOptions(screen.getByLabelText('provider 筛选'), 'p2')
    await user.selectOptions(screen.getByLabelText('状态筛选'), 'finished')
    expect(screen.getByTestId('runs-no-match')).toBeInTheDocument()
    expect(screen.queryByTestId('run-row')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '清除筛选' }))
    expect(screen.queryByTestId('runs-no-match')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('run-row')).toHaveLength(3)
  })

  it('初始 URL 参数直接生效', () => {
    renderView({}, '/runs?provider=p2')
    expect(rowIds()).toEqual(['r-older'])
  })

  it('点解出率表头先降序再升序，并把排序写进 URL', async () => {
    const user = userEvent.setup()
    renderView()
    await user.click(screen.getByRole('button', { name: '解出率' }))
    expect(rowIds()).toEqual(['r-older', 'r-middle', 'r-newest'])
    expect(screen.getByTestId('loc')).toHaveTextContent(
      'sort=solve_rate&order=desc',
    )
    await user.click(screen.getByRole('button', { name: '解出率 ↓' }))
    expect(rowIds()).toEqual(['r-newest', 'r-middle', 'r-older'])
    expect(screen.getByTestId('loc')).toHaveTextContent(
      'sort=solve_rate&order=asc',
    )
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd frontend && npx vitest run src/pages/RunsPage.test.tsx`
Expected: FAIL——`RunsPage.test.tsx` 不存在则是新文件可直接跑；断言失败点在「筛选/排序/无匹配」行为缺失。

- [ ] **Step 3: 重写 RunsPage.tsx**

`frontend/src/pages/RunsPage.tsx` 整文件替换为：

```tsx
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useRuns, useProviders, useBenchmarks } from '../api/queries'
import type {
  BenchmarkSummary,
  Provider,
  Run,
} from '../api/types'
import { describeError } from '../lib/errors'
import { formatPercent, shortId, statusLabel } from '../lib/format'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { PageSkeleton } from '../ui/PageSkeleton'
import { Select } from '../ui/Select'
import { Table, Td, Th } from '../ui/Table'

type SortKey = 'created_at' | 'solve_rate'
type SortOrder = 'asc' | 'desc'

const FILTER_KEYS = ['provider', 'benchmark', 'status'] as const

function solveRate(run: Run): number {
  return run.totals?.totals.solve_rate ?? -1
}

function sortRuns(list: Run[], key: SortKey, order: SortOrder): Run[] {
  const sorted = [...list].sort((a, b) =>
    key === 'created_at'
      ? a.created_at.localeCompare(b.created_at)
      : solveRate(a) - solveRate(b),
  )
  return order === 'desc' ? sorted.reverse() : sorted
}

function SortableTh({
  label,
  sortKey,
  sort,
  order,
  onSort,
}: {
  label: string
  sortKey: SortKey
  sort: SortKey
  order: SortOrder
  onSort: (key: SortKey) => void
}) {
  const active = sort === sortKey
  return (
    <Th
      aria-sort={
        active ? (order === 'asc' ? 'ascending' : 'descending') : undefined
      }
    >
      <button
        type="button"
        className="hover:text-text"
        onClick={() => onSort(sortKey)}
      >
        {label}
        {active && (order === 'asc' ? ' ↑' : ' ↓')}
      </button>
    </Th>
  )
}

function RunsHeader() {
  return (
    <div className="flex items-center justify-between">
      <h1 className="text-2xl font-semibold">Runs</h1>
      <Link
        className="rounded bg-accent px-4 py-2 text-sm text-white"
        to="/runs/new"
      >
        New Run
      </Link>
    </div>
  )
}

export interface RunsViewProps {
  runs: Run[]
  providers: Provider[]
  benchmarks: BenchmarkSummary[]
}

export function RunsView({ runs, providers, benchmarks }: RunsViewProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const providerFilter = searchParams.get('provider') ?? ''
  const benchmarkFilter = searchParams.get('benchmark') ?? ''
  const statusFilter = searchParams.get('status') ?? ''
  const sort = (searchParams.get('sort') ?? 'created_at') as SortKey
  const order = (searchParams.get('order') ?? 'desc') as SortOrder
  const [selected, setSelected] = useState<Set<string>>(new Set())

  function setParams(mutate: (params: URLSearchParams) => void) {
    const next = new URLSearchParams(searchParams)
    mutate(next)
    setSearchParams(next, { replace: true })
  }

  function setParam(key: string, value: string) {
    setParams((params) => {
      if (value === '') params.delete(key)
      else params.set(key, value)
    })
  }

  function clearFilters() {
    setParams((params) => {
      for (const key of FILTER_KEYS) params.delete(key)
    })
  }

  function toggleSort(key: SortKey) {
    setParams((params) => {
      if (sort !== key) {
        // 切到新列先降序；created_at 降序是缺省态，不写参数
        if (key === 'created_at' && order === 'desc') {
          params.delete('sort')
          params.delete('order')
        } else {
          params.set('sort', key)
          params.set('order', 'desc')
        }
      } else if (order === 'desc') {
        params.set('order', 'asc')
      } else {
        params.delete('sort')
        params.delete('order')
      }
    })
  }

  function toggleRun(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const providerNames = new Map(providers.map((p) => [p.id, p.name]))
  const benchmarkNames = new Map(benchmarks.map((b) => [b.id, b.name]))
  const statuses = useMemo(
    () => [...new Set(runs.map((run) => run.status))].sort(),
    [runs],
  )
  const visible = useMemo(
    () =>
      sortRuns(
        runs.filter(
          (run) =>
            (providerFilter === '' || run.provider_id === providerFilter) &&
            (benchmarkFilter === '' || run.benchmark_id === benchmarkFilter) &&
            (statusFilter === '' || run.status === statusFilter),
        ),
        sort,
        order,
      ),
    [runs, providerFilter, benchmarkFilter, statusFilter, sort, order],
  )
  const hasFilter =
    providerFilter !== '' || benchmarkFilter !== '' || statusFilter !== ''

  return (
    <div className="space-y-4">
      <RunsHeader selected={[...selected]} />
      <div data-testid="runs-filter" className="flex flex-wrap items-end gap-3">
        <Select
          aria-label="provider 筛选"
          className="w-40"
          value={providerFilter}
          onChange={(event) => setParam('provider', event.target.value)}
        >
          <option value="">全部 provider</option>
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label="benchmark 筛选"
          className="w-40"
          value={benchmarkFilter}
          onChange={(event) => setParam('benchmark', event.target.value)}
        >
          <option value="">全部 benchmark</option>
          {benchmarks.map((benchmark) => (
            <option key={benchmark.id} value={benchmark.id}>
              {benchmark.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label="状态筛选"
          className="w-36"
          value={statusFilter}
          onChange={(event) => setParam('status', event.target.value)}
        >
          <option value="">全部状态</option>
          {statuses.map((status) => (
            <option key={status} value={status}>
              {statusLabel(status)}
            </option>
          ))}
        </Select>
        {hasFilter && (
          <Button type="button" variant="ghost" onClick={clearFilters}>
            清除筛选
          </Button>
        )}
      </div>
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
      ) : visible.length === 0 ? (
        <div data-testid="runs-no-match">
          <EmptyState
            title="无匹配 run"
            hint="调整或清除筛选条件再试。"
            action={
              <Button type="button" onClick={clearFilters}>
                清除筛选
              </Button>
            }
          />
        </div>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>run</Th>
              <Th>provider</Th>
              <Th>benchmark</Th>
              <Th>状态</Th>
              <SortableTh
                label="创建时间"
                sortKey="created_at"
                sort={sort}
                order={order}
                onSort={toggleSort}
              />
              <SortableTh
                label="解出率"
                sortKey="solve_rate"
                sort={sort}
                order={order}
                onSort={toggleSort}
              />
            </tr>
          </thead>
          <tbody>
            {visible.map((run) => (
              <tr key={run.id} data-testid="run-row">
                <Td>
                  <Link
                    className="text-accent"
                    to={`/runs/${encodeURIComponent(run.id)}`}
                  >
                    {shortId(run.id)}
                  </Link>
                </Td>
                <Td>
                  {providerNames.get(run.provider_id) ?? run.provider_id}
                </Td>
                <Td>
                  {benchmarkNames.get(run.benchmark_id) ?? run.benchmark_id}
                </Td>
                <Td>{statusLabel(run.status)}</Td>
                <Td>{new Date(run.created_at).toLocaleString()}</Td>
                <Td>{formatPercent(run.totals?.totals.solve_rate)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  )
}

export default function RunsPage() {
  const runs = useRuns()
  const providers = useProviders()
  const benchmarks = useBenchmarks()
  if (runs.isPending) {
    return <PageSkeleton variant="table" rows={4} />
  }
  if (runs.error) {
    return (
      <div className="space-y-4">
        <RunsHeader selected={[]} />
        <div className="flex items-center gap-3">
          <Alert>{describeError(runs.error)}</Alert>
          <Button type="button" onClick={() => void runs.refetch()}>
            重试
          </Button>
        </div>
      </div>
    )
  }
  return (
    <RunsView
      runs={runs.data ?? []}
      providers={providers.data ?? []}
      benchmarks={benchmarks.data ?? []}
    />
  )
}
```

注意：上面的文件**已包含 Task 2 的选中状态与 RunsHeader props**——Task 1 提交前请把 `useState`/`selected`/`toggleRun`、`<RunsHeader selected={...} />`、`RunsHeader` 的 `selected` props 与默认导出里的 `<RunsHeader selected={[]} />` 全部撤掉，回到 Task 1 形态（无选中逻辑、`RunsHeader()` 无 props）；Task 2 再原样加回。这是为了让两个任务各自有完整可运行的文件形态，避免 Task 2 时凭记忆拼装。

- [ ] **Step 4: 跑本文件测试与全量**

Run: `cd frontend && npx vitest run src/pages/RunsPage.test.tsx && npm run typecheck && npm run test:run`
Expected: 本文件 5 用例 PASS；typecheck 干净；全量 281 通过（276 + 5）。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/RunsPage.tsx frontend/src/pages/RunsPage.test.tsx
git commit -m "feat: Runs 页筛选与排序（客户端派生，状态进 URL）"
```

---

### Task 2: RunsPage 勾选两个 run → 对比入口

**Files:**
- Modify: `frontend/src/pages/RunsPage.tsx`
- Test: `frontend/src/pages/RunsPage.test.tsx`

**Interfaces:**
- Consumes: Task 1 的 RunsView 文件形态（`selected` state 与 `toggleRun` 已在 Task 1 文件里预留，本任务把它们接进渲染）。
- Produces: `RunsHeader({ selected }: { selected: string[] })`；`data-testid="runs-selected"`；对比链接 `href="/compare?runs=<id1>,<id2>"`（Task 4 的 ComparePage 消费该 URL）。

- [ ] **Step 1: 追加失败测试**

在 `RunsPage.test.tsx` 的 describe 块后追加：

```tsx
describe('RunsView 勾选对比', () => {
  it('未选/选一个时按钮 disabled，已选计数 0/2 与 1/2', async () => {
    const user = userEvent.setup()
    renderView()
    const count = screen.getByTestId('runs-selected')
    expect(count).toHaveTextContent('已选 0/2')
    const disabled = screen.getByRole('button', { name: '对比' })
    expect(disabled).toBeDisabled()
    await user.click(screen.getByLabelText('选择 r-newest'))
    expect(count).toHaveTextContent('已选 1/2')
    expect(screen.getByRole('button', { name: '对比' })).toBeDisabled()
  })

  it('选满两个出现对比链接且 href 带两个 id，再点取消勾选恢复按钮', async () => {
    const user = userEvent.setup()
    renderView()
    await user.click(screen.getByLabelText('选择 r-newest'))
    await user.click(screen.getByLabelText('选择 r-middle'))
    expect(screen.getByTestId('runs-selected')).toHaveTextContent('已选 2/2')
    expect(screen.getByRole('link', { name: '对比' })).toHaveAttribute(
      'href',
      '/compare?runs=r-newest,r-middle',
    )
    await user.click(screen.getByLabelText('选择 r-middle'))
    expect(screen.getByRole('button', { name: '对比' })).toBeDisabled()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd frontend && npx vitest run src/pages/RunsPage.test.tsx`
Expected: FAIL——找不到 `runs-selected` / `选择 r-newest`。

- [ ] **Step 3: 接上选中渲染**

在 Task 1 形态的 `RunsPage.tsx` 上做三处修改：

1. `RunsHeader` 整体替换为：

```tsx
function RunsHeader({ selected }: { selected: string[] }) {
  const canCompare = selected.length === 2
  return (
    <div className="flex items-center justify-between">
      <h1 className="text-2xl font-semibold">Runs</h1>
      <div className="flex items-center gap-3">
        <span className="text-sm text-text-dim" data-testid="runs-selected">
          已选 {selected.length}/2
        </span>
        {canCompare ? (
          <Link
            className="rounded bg-accent px-4 py-2 text-sm text-white"
            to={`/compare?runs=${encodeURIComponent(selected[0])},${encodeURIComponent(selected[1])}`}
          >
            对比
          </Link>
        ) : (
          <Button type="button" disabled>
            对比
          </Button>
        )}
        <Link
          className="rounded bg-accent px-4 py-2 text-sm text-white"
          to="/runs/new"
        >
          New Run
        </Link>
      </div>
    </div>
  )
}
```

2. RunsView 返回值里 `<RunsHeader />` 改为 `<RunsHeader selected={[...selected]} />`。
3. 表头行首加一列、行首加勾选框——`<thead><tr>` 的第一个子元素改为：

```tsx
              <Th>
                <span className="sr-only">选择</span>
              </Th>
```

`visible.map` 行内 `<tr>` 的第一个子元素改为：

```tsx
                <Td>
                  <input
                    type="checkbox"
                    aria-label={`选择 ${shortId(run.id)}`}
                    checked={selected.has(run.id)}
                    onChange={() => toggleRun(run.id)}
                  />
                </Td>
```

- [ ] **Step 4: 跑测试与全量**

Run: `cd frontend && npx vitest run src/pages/RunsPage.test.tsx && npm run typecheck && npm run test:run`
Expected: 本文件 7 用例 PASS；全量 283 通过。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/RunsPage.tsx frontend/src/pages/RunsPage.test.tsx
git commit -m "feat: Runs 页勾选恰两个 run 出对比入口"
```

---

### Task 3: BinChart 组件 + ResultView 接入

**Files:**
- Create: `frontend/src/components/BinChart.tsx`
- Create: `frontend/src/components/BinChart.test.tsx`
- Modify: `frontend/src/components/ResultView.tsx`
- Test: `frontend/src/pages/RunPage.test.tsx`（ResultView describe 内追加）

**Interfaces:**
- Consumes: `BinStats`（types.ts:105 现状 `{ total, solved, solve_rate, ci95: [number, number], mean_moves }`）、`Report.by_bin: Record<string, BinStats>`；`formatTokens`（lib/format.ts:47）。
- Produces: `BinChart({ byBin }: { byBin: Record<string, BinStats> })`——`data-testid="bin-chart"`，每箱 `<g data-testid="bin-row">`（含标签文本 `bin · solved/total`、`<rect>` 条、`<line data-testid="bin-ci">` 须线）；空 byBin 渲染文本「暂无分箱数据」。ResultView 的分箱区从 Table 换成 BinChart，逐题表新增 tokens/耗时两列。

- [ ] **Step 1: 写 BinChart 失败测试（新文件）**

`frontend/src/components/BinChart.test.tsx` 完整内容：

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { BinStats } from '../api/types'
import { BinChart } from './BinChart'

function stats(solveRate: number, ci: [number, number]): BinStats {
  return { total: 4, solved: Math.round(solveRate * 4), solve_rate: solveRate, ci95: ci, mean_moves: 2 }
}

describe('BinChart', () => {
  it('每箱一行，标签含 solved/total，条宽随 solve_rate', () => {
    render(
      <BinChart
        byBin={{
          '1': stats(0.5, [0.1, 0.9]),
          '4-5': stats(1, [0.5, 1]),
        }}
      />,
    )
    const rows = screen.getAllByTestId('bin-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('1 · 2/4')
    expect(rows[1]).toHaveTextContent('4-5 · 4/4')
    const barArea = 440 - 150 - 8 * 2
    const rect = rows[0].querySelector('rect')
    expect(rect).not.toBeNull()
    expect(rect?.getAttribute('width')).toBe(String(0.5 * barArea))
    expect(rows[0].querySelector('[data-testid="bin-ci"]')).not.toBeNull()
  })

  it('空 byBin 出占位文案', () => {
    render(<BinChart byBin={{}} />)
    expect(screen.getByText('暂无分箱数据')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd frontend && npx vitest run src/components/BinChart.test.tsx`
Expected: FAIL——模块不存在。

- [ ] **Step 3: 实现 BinChart（新文件）**

`frontend/src/components/BinChart.tsx` 完整内容：

```tsx
import type { BinStats } from '../api/types'

// 手写 SVG 条形图（U1 既定不引图表库）：条长 = solve_rate，叠 CI95 须线。
// 尺寸对齐 ProgressChart 先例：固定 viewBox + w-full 自适应。
const WIDTH = 440
const LABEL_WIDTH = 150
const ROW_HEIGHT = 26
const BAR_HEIGHT = 12
const PAD = 8

export function BinChart({ byBin }: { byBin: Record<string, BinStats> }) {
  const bins = Object.entries(byBin)
  if (bins.length === 0) {
    return <p className="text-xs text-text-dim">暂无分箱数据</p>
  }
  const barArea = WIDTH - LABEL_WIDTH - PAD * 2
  const height = PAD * 2 + bins.length * ROW_HEIGHT
  const x = (rate: number) => LABEL_WIDTH + rate * barArea
  return (
    <svg
      data-testid="bin-chart"
      viewBox={`0 0 ${WIDTH} ${height}`}
      className="w-full"
      role="img"
      aria-label="分箱解出率"
    >
      {bins.map(([bin, stats], index) => {
        const y = PAD + index * ROW_HEIGHT
        const barY = y + (ROW_HEIGHT - BAR_HEIGHT) / 2
        const midY = barY + BAR_HEIGHT / 2
        return (
          <g key={bin} data-testid="bin-row">
            <text x={0} y={midY + 3} fontSize="11" fill="#94a3b8">
              {`${bin} · ${stats.solved}/${stats.total}`}
            </text>
            <rect
              x={LABEL_WIDTH}
              y={barY}
              width={Math.max(0, x(stats.solve_rate) - LABEL_WIDTH)}
              height={BAR_HEIGHT}
              fill="#059669"
            />
            <line
              data-testid="bin-ci"
              x1={x(stats.ci95[0])}
              x2={x(stats.ci95[1])}
              y1={midY}
              y2={midY}
              stroke="#94a3b8"
              strokeWidth="2"
            />
            <line
              x1={x(stats.ci95[0])}
              x2={x(stats.ci95[0])}
              y1={barY + 1}
              y2={barY + BAR_HEIGHT - 1}
              stroke="#94a3b8"
              strokeWidth="2"
            />
            <line
              x1={x(stats.ci95[1])}
              x2={x(stats.ci95[1])}
              y1={barY + 1}
              y2={barY + BAR_HEIGHT - 1}
              stroke="#94a3b8"
              strokeWidth="2"
            />
          </g>
        )
      })}
    </svg>
  )
}
```

- [ ] **Step 4: ResultView 接入**

`frontend/src/components/ResultView.tsx` 三处修改：

1. import 区加 `BinChart` 与 `formatTokens`：

```tsx
import { BinChart } from './BinChart'
```

`lib/format` 的 import 改为：

```tsx
import {
  formatPercent,
  formatTokens,
  statusLabel,
} from '../lib/format'
```

2. 「分箱」区块整体替换（原 `<div className="overflow-auto"><Table>…5 列…</Table></div>` 全删）：

```tsx
      <div>
        <h3 className="mb-2 text-sm font-medium text-text">分箱</h3>
        <BinChart byBin={report.by_bin} />
      </div>
```

3. 逐题表：`<Th>效率</Th>` 之后、`<Th>失败码</Th>` 之前插入：

```tsx
                <Th>tokens</Th>
                <Th>耗时</Th>
```

对应行内 `<Td>`（效率格之后、失败码格之前）插入：

```tsx
                  <Td>
                    {episode.tokens_in == null || episode.tokens_out == null
                      ? '—'
                      : formatTokens(episode.tokens_in + episode.tokens_out)}
                  </Td>
                  <Td>
                    {episode.latency_ms == null
                      ? '—'
                      : `${(episode.latency_ms / 1000).toFixed(1)}s`}
                  </Td>
```

- [ ] **Step 5: ResultView 断言（RunPage.test.tsx）**

在 `frontend/src/pages/RunPage.test.tsx` 的 `describe('ResultView', …)` 内追加（需在文件 import 区补 `within`——`@testing-library/react` 的现有 import 里加）：

```tsx
  it('逐题表渲染 tokens 与耗时，null 显示 —', () => {
    const withLatency: Report = {
      ...report,
      episodes: [{ ...report.episodes[0], latency_ms: 1234 }],
    }
    render(
      <ResultView report={withLatency} run={run} provider={null} benchmark={null} />,
    )
    const result = screen.getByTestId('run-result')
    expect(within(result).getByText('15')).toBeInTheDocument()
    expect(within(result).getByText('1.2s')).toBeInTheDocument()
    expect(within(result).getAllByText('—').length).toBeGreaterThan(0)
  })

  it('分箱区渲染 BinChart 而非表格', () => {
    render(<ResultView report={report} run={run} provider={null} benchmark={null} />)
    expect(screen.getByTestId('bin-chart')).toBeInTheDocument()
    expect(screen.queryByText('mean_moves')).not.toBeInTheDocument()
  })
```

- [ ] **Step 6: 跑测试与全量**

Run: `cd frontend && npx vitest run src/components/BinChart.test.tsx src/pages/RunPage.test.tsx && npm run typecheck && npm run test:run`
Expected: BinChart 2 例 + RunPage 新 2 例 PASS；全量 286 通过（283 + 3，RunPage 若有既有断言冲突以实际输出为准并如实报告）。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/BinChart.tsx frontend/src/components/BinChart.test.tsx frontend/src/components/ResultView.tsx frontend/src/pages/RunPage.test.tsx
git commit -m "feat: 报告分箱改条形图（CI 须线），逐题表补 tokens/耗时"
```

---

### Task 4: Compare 数据层 + ComparePage + 路由

**Files:**
- Modify: `frontend/src/api/types.ts`（文件末尾追加）
- Modify: `frontend/src/api/client.ts`（追加 compare 段）
- Modify: `frontend/src/api/queries.ts`（追加 qk.compare 与 useCompare）
- Modify: `frontend/src/App.tsx`（追加 lazy 路由）
- Create: `frontend/src/pages/ComparePage.tsx`
- Test: `frontend/src/pages/ComparePage.test.tsx`（新建）

**Interfaces:**
- Consumes: Task 2 产生的对比 URL `/compare?runs=<id1>,<id2>`；后端 `GET /api/compare?run_ids=a,b` 返回 `{benchmark_id, content_hash, tasks, runs, solve_rate_first, solve_rate_second, solve_rate_diff, ci95: [low, high], pairs: [{task_id, first_solved, second_solved, delta}]}`（delta = second − first，pairs 只含两 run episode 的 task_id 交集）；`useRuns/useProviders/useBenchmarks`、`AnimatedNumber`、`Card`、`PageSkeleton`、`Alert`、`Table/Th/Td`、`formatPercent/shortId/describeError`。
- Produces: `ComparePair` / `CompareResult` 类型；`api.compare.get(runIds: [string, string])`；`qk.compare(first, second)`；`useCompare(runIds: [string, string] | null)`；路由 `/compare`。

- [ ] **Step 1: 写 ComparePage 失败测试（新文件）**

`frontend/src/pages/ComparePage.test.tsx` 完整内容：

```tsx
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompareResult, Run } from '../api/types'
import App from '../App'

// 路由 lazy 导入 RunPage → CubeView → three；jsdom 用不到 WebGL
vi.mock('../cube/CubeView', () => ({
  CubeView: () => <div data-testid="cube-stub" />,
}))

const IDS = ['aaaaaaaa-run1', 'bbbbbbbb-run2'] as const

const runsFixture: Run[] = IDS.map((id, index) => ({
  id,
  provider_id: 'p1',
  benchmark_id: 'b1',
  tool_mode: 'both',
  prompt_version: 'v1',
  status: 'finished',
  totals: {
    benchmark_id: 'b1',
    benchmark_hash: 'hash',
    benchmark_total_tasks: 2,
    partial: false,
    totals: {
      tasks: 2,
      solved: index === 0 ? 2 : 1,
      solve_rate: index === 0 ? 1 : 0.5,
      ci95: [0.2, 1],
    },
    by_bin: {},
    episodes: [],
  },
  error: null,
  created_at: '2026-10-31T00:00:00+00:00',
  started_at: null,
  finished_at: null,
  budget: {
    max_moves: 30,
    max_tool_calls: 50,
    max_tokens: 300000,
    max_seconds: 300,
    turn_timeout: 120,
  },
}))

const compareFixture: CompareResult = {
  benchmark_id: 'b1',
  content_hash: 'hash',
  tasks: 2,
  runs: [...IDS],
  solve_rate_first: 1,
  solve_rate_second: 0.5,
  solve_rate_diff: 0.5,
  ci95: [0.1, 0.9],
  pairs: [
    { task_id: 't1', first_solved: true, second_solved: true, delta: 0 },
    { task_id: 't2', first_solved: true, second_solved: false, delta: -1 },
  ],
}

type MockReply = {
  compare?: CompareResult
  compareStatus?: number
  compareDetail?: string
}

function makeFetch(reply: MockReply) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/compare')) {
      if (reply.compareStatus) {
        return {
          ok: false,
          status: reply.compareStatus,
          statusText: 'Bad Request',
          json: async () => ({ detail: reply.compareDetail ?? '' }),
        }
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => reply.compare,
      }
    }
    if (url.includes('/api/runs')) {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => runsFixture,
      }
    }
    if (url.includes('/api/providers') || url.includes('/api/benchmarks')) {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => [],
      }
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
}

function renderApp(path: string, fetchMock: ReturnType<typeof makeFetch>) {
  vi.stubGlobal('fetch', fetchMock)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ComparePage', () => {
  it('渲染两 run 卡、差值与逐题表，不同行高亮', async () => {
    renderApp(`/compare?runs=${IDS[0]},${IDS[1]}`, makeFetch({ compare: compareFixture }))
    const diff = await screen.findByTestId('compare-diff')
    expect(diff).toHaveTextContent('50.0%')
    expect(screen.getByTestId('runs-selected')).not.toBeInTheDocument()
    const rows = screen.getAllByTestId('compare-pair-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('t2')
    expect(rows[0].className).toContain('bg-surface-2')
    expect(rows[1]).toHaveTextContent('t1')
    expect(rows[1].className).not.toContain('bg-surface-2')
    expect(
      screen.getByRole('link', { name: '返回 Runs' }),
    ).toBeInTheDocument()
  })

  it('runs 参数不足两个时不发 compare 请求，直接提示', async () => {
    const fetchMock = makeFetch({})
    renderApp('/compare?runs=solo', fetchMock)
    expect(await screen.findByText(/链接不完整/)).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes('/api/compare'),
      ),
    ).toBe(false)
  })

  it('后端 400 走 describeError 出 Alert', async () => {
    renderApp(
      `/compare?runs=${IDS[0]},${IDS[1]}`,
      makeFetch({
        compareStatus: 400,
        compareDetail: 'runs use different benchmarks',
      }),
    )
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      '请求不合法（HTTP 400）：runs use different benchmarks',
    )
  })

  it('逐题表头注明只统计共同题', async () => {
    renderApp(`/compare?runs=${IDS[0]},${IDS[1]}`, makeFetch({ compare: compareFixture }))
    await screen.findByTestId('compare-diff')
    expect(
      screen.getByText('逐题（仅统计两 run 共同题，解出状态不同的行高亮）'),
    ).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getAllByRole('columnheader')).toHaveLength(4)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd frontend && npx vitest run src/pages/ComparePage.test.tsx`
Expected: FAIL——`/compare` 路由不存在（URL 匹配不到路由，断言超时）。

- [ ] **Step 3: 数据层追加**

`frontend/src/api/types.ts` 文件末尾追加：

```ts
export interface ComparePair {
  task_id: string
  first_solved: boolean
  second_solved: boolean
  delta: number
}

// GET /api/compare 的返回；solve_rate_diff 的 CI 由后端 bootstrap（2000 次）得出，
// pairs 只覆盖两 run episode 的 task_id 交集，delta = second − first。
export interface CompareResult {
  benchmark_id: string
  content_hash: string
  tasks: number
  runs: string[]
  solve_rate_first: number
  solve_rate_second: number
  solve_rate_diff: number
  ci95: [number, number]
  pairs: ComparePair[]
}
```

`frontend/src/api/client.ts`：type import 列表加 `CompareResult`；`api` 对象内 `episodes` 段之后追加：

```ts
  compare: {
    get: (runIds: [string, string]) =>
      request<CompareResult>(
        `/compare?run_ids=${encodeURIComponent(runIds[0])},${encodeURIComponent(runIds[1])}`,
      ),
  },
```

`frontend/src/api/queries.ts`：`qk` 对象追加一行：

```ts
  compare: (first: string, second: string) =>
    ['compare', first, second] as const,
```

文件末尾追加：

```ts
export function useCompare(runIds: [string, string] | null) {
  return useQuery({
    queryKey: qk.compare(runIds?.[0] ?? '', runIds?.[1] ?? ''),
    queryFn: () => api.compare.get(runIds!),
    enabled: runIds !== null,
  })
}
```

- [ ] **Step 4: ComparePage（新文件）**

`frontend/src/pages/ComparePage.tsx` 完整内容：

```tsx
import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useCompare, useRuns, useProviders, useBenchmarks } from '../api/queries'
import type { Run } from '../api/types'
import { describeError } from '../lib/errors'
import { formatPercent, shortId } from '../lib/format'
import { Alert } from '../ui/Alert'
import { AnimatedNumber } from '../ui/AnimatedNumber'
import { Card } from '../ui/Card'
import { PageSkeleton } from '../ui/PageSkeleton'
import { Table, Td, Th } from '../ui/Table'

function CompareView({
  firstId,
  secondId,
}: {
  firstId: string
  secondId: string
}) {
  const compare = useCompare([firstId, secondId])
  const runs = useRuns()
  const providers = useProviders()
  const benchmarks = useBenchmarks()

  const providerNames = new Map(
    (providers.data ?? []).map((provider) => [provider.id, provider.name]),
  )
  const benchmarkNames = new Map(
    (benchmarks.data ?? []).map((benchmark) => [benchmark.id, benchmark.name]),
  )
  const runById = new Map((runs.data ?? []).map((run) => [run.id, run]))

  const pairs = useMemo(() => {
    const list = compare.data?.pairs ?? []
    return [...list].sort(
      (a, b) =>
        Math.abs(b.delta) - Math.abs(a.delta) ||
        a.task_id.localeCompare(b.task_id),
    )
  }, [compare.data])

  if (
    compare.isPending ||
    runs.isPending ||
    providers.isPending ||
    benchmarks.isPending
  ) {
    return <PageSkeleton variant="form" fields={4} />
  }
  if (compare.error || !compare.data) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Run 对比</h1>
        <Alert tone="danger">
          {compare.error ? describeError(compare.error) : '对比数据缺失'}
        </Alert>
        <Link className="text-accent" to="/runs">
          返回 Runs
        </Link>
      </div>
    )
  }
  const data = compare.data
  const sideRuns: Array<Run | undefined> = [
    runById.get(firstId),
    runById.get(secondId),
  ]
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Run 对比</h1>
        <Link className="text-accent" to="/runs">
          返回 Runs
        </Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {sideRuns.map((run, index) => {
          const fallbackId = index === 0 ? firstId : secondId
          return (
            <Card key={fallbackId} className="space-y-1 p-4 text-sm">
              {run ? (
                <Link
                  className="text-accent"
                  to={`/runs/${encodeURIComponent(run.id)}`}
                >
                  {shortId(run.id)}
                </Link>
              ) : (
                <span>{shortId(fallbackId)}</span>
              )}
              <div className="text-text-dim">
                {run
                  ? `${providerNames.get(run.provider_id) ?? run.provider_id} · ${benchmarkNames.get(run.benchmark_id) ?? run.benchmark_id}`
                  : 'run 信息不在当前列表中'}
              </div>
              <div>
                解出率 {formatPercent(run?.totals?.totals.solve_rate)}
                {run?.totals && (
                  <span className="ml-2 text-text-dim">
                    CI95 {formatPercent(run.totals.totals.ci95[0])} –{' '}
                    {formatPercent(run.totals.totals.ci95[1])}
                  </span>
                )}
              </div>
            </Card>
          )
        })}
      </div>
      <Card className="space-y-1 p-4">
        <div className="text-xs text-text-dim">
          解出率差值（second − first）· bootstrap CI95 · 共同题 {data.tasks}
        </div>
        <div className="text-2xl font-medium" data-testid="compare-diff">
          <AnimatedNumber
            value={data.solve_rate_diff * 1000}
            format={(n) => formatPercent(n / 1000, 1)}
          />
        </div>
        <div className="text-sm text-text-dim">
          CI95 {formatPercent(data.ci95[0])} – {formatPercent(data.ci95[1])}
        </div>
      </Card>
      <div>
        <h3 className="mb-2 text-sm font-medium text-text">
          逐题（仅统计两 run 共同题，解出状态不同的行高亮）
        </h3>
        <div className="overflow-auto">
          <Table>
            <thead>
              <tr>
                <Th>task</Th>
                <Th>run1</Th>
                <Th>run2</Th>
                <Th>delta</Th>
              </tr>
            </thead>
            <tbody>
              {pairs.map((pair) => (
                <tr
                  key={pair.task_id}
                  data-testid="compare-pair-row"
                  className={
                    pair.first_solved !== pair.second_solved
                      ? 'bg-surface-2'
                      : undefined
                  }
                >
                  <Td>{pair.task_id}</Td>
                  <Td>{pair.first_solved ? '✓' : '—'}</Td>
                  <Td>{pair.second_solved ? '✓' : '—'}</Td>
                  <Td>
                    {pair.delta > 0 ? '+1' : pair.delta < 0 ? '−1' : '0'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </div>
    </div>
  )
}

export default function ComparePage() {
  const [searchParams] = useSearchParams()
  const raw = searchParams.get('runs') ?? ''
  const ids = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  if (ids.length !== 2) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Run 对比</h1>
        <Alert tone="danger">
          链接不完整：需要恰好两个 run id（/compare?runs=a,b）
        </Alert>
        <Link className="text-accent" to="/runs">
          返回 Runs
        </Link>
      </div>
    )
  }
  return <CompareView firstId={ids[0]} secondId={ids[1]} />
}
```

- [ ] **Step 5: 注册路由**

`frontend/src/App.tsx`：lazy 声明区（`const RunsPage = …` 之前）加：

```tsx
const ComparePage = lazy(() => import('./pages/ComparePage'))
```

`<Route path="episodes/:id" …/>` 之前加：

```tsx
        <Route path="compare" element={suspense(<ComparePage />)} />
```

- [ ] **Step 6: 跑测试与全量**

Run: `cd frontend && npx vitest run src/pages/ComparePage.test.tsx && npm run typecheck && npm run test:run`
Expected: ComparePage 4 例 PASS；全量 290 通过（286 + 4）。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api/types.ts frontend/src/api/client.ts frontend/src/api/queries.ts frontend/src/App.tsx frontend/src/pages/ComparePage.tsx frontend/src/pages/ComparePage.test.tsx
git commit -m "feat: /compare 对比页接线 /api/compare（差值 CI + 逐题 delta）"
```

---

### Task 5: E2E 筛选断言 + README + 测试名修正 + 四连验证

**Files:**
- Modify: `frontend/e2e/workbench.spec.ts`
- Modify: `README.md`
- Modify: `frontend/src/pages/BenchmarksPage.test.tsx`（两处测试名）

**Interfaces:**
- Consumes: Task 1 的 `runs-filter` / `runs-no-match` / 「清除筛选」；workbench 现有流程（单 run 已完成）。
- Produces: 无。

- [ ] **Step 1: E2E 追加 Runs 筛选断言**

`frontend/e2e/workbench.spec.ts`：在 export/download 块（`expect(download.suggestedFilename()).toContain('.csv')`）之后、`episode-replay-link` 点击之前插入：

```ts
  // —— Runs 信息密度：筛选 / 无匹配 / 清除 ——
  await page.goto('/runs')
  await expect(page.getByTestId('run-row')).toHaveCount(1)
  await page.getByLabel('状态筛选').selectOption('queued')
  await expect(page.getByTestId('runs-no-match')).toBeVisible()
  await page.getByRole('button', { name: '清除筛选' }).click()
  await expect(page.getByTestId('run-row')).toHaveCount(1)
```

- [ ] **Step 2: README 更新**

`README.md` 的 U3 段落后追加一段：

```markdown
U4 信息密度已落地：Runs 页支持 provider/benchmark/状态筛选与创建时间/解出率
排序（筛选与排序状态进 URL，刷新/分享保留），勾选恰两个 run 可进入
/compare 对比页——解出率差值（bootstrap CI95）+ 逐题 delta、解出状态不同的
行高亮；报告分箱以条形图呈现（含 CI95 须线），逐题表新增 tokens 与耗时列。
```

- [ ] **Step 3: 过时测试名修正（U3 残留）**

`frontend/src/pages/BenchmarksPage.test.tsx` 两处 it 名替换：

```tsx
    '每档题数输入字母（React 还原原值）',
```

```tsx
    'seed 输入字母（React 还原原值）',
```

（原名为 `每档题数输入字母（jsdom 净化为空）` / `seed 输入字母（jsdom 净化为空）`；注释行「输入无法解析的字符时 React 会还原原值…」不动。）

- [ ] **Step 4: 四连验证**

Run（frontend/ 下）: `npm run typecheck && npm run test:run && npm run build && npm run e2e`
Expected: 四连全绿；报告记录各自输出摘要（用例数、build 耗时、e2e 通过数）。e2e 若报缺 `data/cache/2x2_distances.pkl`，从主仓库复制该 gitignored 文件到 worktree 同路径（U3 Task 6 同款环境修复）。

- [ ] **Step 5: Commit**

```bash
git add frontend/e2e/workbench.spec.ts README.md frontend/src/pages/BenchmarksPage.test.tsx
git commit -m "test: E2E Runs 筛选断言；README 注记 U4 信息密度；修正过时测试名"
```

---

## Self-Review

1. **Spec 覆盖**：spec §1 筛选栏/排序/多选/URL 同步/两种空态 → Task 1+2；§2 BinChart/逐题两列/不动项 → Task 3；§3 数据层+页面结构+错误边界+路由 → Task 4；§4 测试与验收（单测四组、E2E 筛选断言、测试名修正、README、四连）→ Task 1-4 各自测试 + Task 5。无缺口。
2. **占位符扫描**：无 TBD/TODO；所有代码块完整可粘贴；Task 1 Step 3 的「预留/撤掉」说明是明确的文件形态指令，非占位。
3. **类型一致性**：`BinStats`/`Report.by_bin`（types.ts:105/203）与 BinChart props 一致；`CompareResult.runs: string[]` 与后端返回 list 一致；`useCompare(runIds: [string,string] | null)` 与 CompareView 调用 `[firstId, secondId]` 一致；`api.compare.get` 与 queries 的 `queryFn: () => api.compare.get(runIds!)` 一致；Task 1 测试的 `aggregate()` 返回结构与 `AggregateReport`（types.ts:114）逐字段一致（episodes: [] 合法）；`Provider.params: {}` 合法（ProviderParams 全可选）；Task 2 的 `选择 {shortId}` aria-label 与测试 `选择 r-newest` 一致（shortId 取前 8 位，'r-newest' 恰 8 字符）。
