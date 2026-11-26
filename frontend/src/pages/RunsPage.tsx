import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useRuns, useProviders, useBenchmarks } from '../api/queries'
import type {
  BenchmarkSummary,
  Provider,
  Run,
} from '../api/types'
import { StatusBadge } from '../components/StatusBadge'
import { describeError } from '../lib/errors'
import {
  formatDate,
  formatDuration,
  formatPercent,
  statusLabel,
} from '../lib/format'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { PageHeader } from '../ui/PageHeader'
import { PageSkeleton } from '../ui/PageSkeleton'
import { Select } from '../ui/Select'

type SortKey = 'created_at' | 'solve_rate'
type SortOrder = 'asc' | 'desc'

const FILTER_KEYS = ['provider', 'benchmark', 'status'] as const

const SORT_OPTIONS: Array<{ value: `${SortKey}:${SortOrder}`; label: string }> = [
  { value: 'created_at:desc', label: '最新优先' },
  { value: 'created_at:asc', label: '最早优先' },
  { value: 'solve_rate:desc', label: '解出率 高→低' },
  { value: 'solve_rate:asc', label: '解出率 低→高' },
]

const PRIMARY_LINK =
  'inline-flex h-8 items-center rounded-md bg-accent px-3 text-[13px] font-semibold text-on-accent transition-colors duration-fast hover:bg-accent-dim focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

function solveRate(run: Run): number {
  return run.totals?.totals.solve_rate ?? -1
}

function sortRuns(list: Run[], key: SortKey, order: SortOrder): Run[] {
  // 同键值保持原相对顺序（stable sort），desc 不能用 reverse 否则并列会被翻转
  const dir = order === 'asc' ? 1 : -1
  return [...list].sort((a, b) =>
    key === 'created_at'
      ? a.created_at.localeCompare(b.created_at) * dir
      : (solveRate(a) - solveRate(b)) * dir,
  )
}

function elapsed(run: Run): string {
  if (!run.started_at) return '—'
  const start = new Date(run.started_at).getTime()
  const end = run.finished_at ? new Date(run.finished_at).getTime() : Date.now()
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '—'
  return formatDuration(end - start)
}

function ci95(run: Run): string {
  const ci = run.totals?.totals.ci95
  if (!ci) return '—'
  return `${Math.round(ci[0] * 100)}–${Math.round(ci[1] * 100)}`
}

function RunsHeader() {
  return (
    <PageHeader
      eyebrow="评测记录"
      title="Runs"
      subtitle="模型 × 题集的运行记录"
      actions={
        <Link className={PRIMARY_LINK} to="/runs/new">
          New Run
        </Link>
      }
    />
  )
}

function RunRow({
  run,
  providerName,
  providerModel,
  benchmarkName,
  benchmarkTasks,
  selected,
  onToggle,
}: {
  run: Run
  providerName: string
  providerModel: string
  benchmarkName: string
  benchmarkTasks: number | null
  selected: boolean
  onToggle: () => void
}) {
  const navigate = useNavigate()
  const rate = run.totals?.totals.solve_rate ?? null
  const solved = run.totals?.totals.solved
  const tasks = run.totals?.totals.tasks
  return (
    <div
      data-testid="run-row"
      data-selected={selected}
      className="run-row"
      onClick={() => navigate(`/runs/${encodeURIComponent(run.id)}`)}
      title={formatDate(run.created_at)}
    >
      <div
        className="c-ck"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          type="checkbox"
          className="ck block"
          aria-label={`选择 ${run.id}`}
          checked={selected}
          onChange={onToggle}
        />
      </div>
      <div className="cell-model c-model">
        <b>
          <Link
            className="hover:text-accent"
            to={`/runs/${encodeURIComponent(run.id)}`}
            onClick={(event) => event.stopPropagation()}
          >
            {providerName}
          </Link>
        </b>
        <span>{providerModel}</span>
      </div>
      <div className="c-bench">
        <span className="bench-tag">
          {benchmarkName}
          {benchmarkTasks != null && <em>{benchmarkTasks}</em>}
        </span>
      </div>
      <div className="c-rate rate-cell">
        <b>{formatPercent(rate)}</b>
        <span className="rate-bar" aria-hidden>
          <i style={{ width: rate == null ? '0%' : `${rate * 100}%` }} />
        </span>
      </div>
      <div className="c-hide cell-num">
        {solved == null || tasks == null ? '—' : `${solved}/${tasks}`}
      </div>
      <div className="c-hide cell-num">{ci95(run)}</div>
      <div className="c-hide cell-num">{elapsed(run)}</div>
      <div className="c-status">
        <StatusBadge status={run.status} />
      </div>
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

  function toggleRun(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

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

  function setSort(value: string) {
    const [key, dir] = value.split(':') as [SortKey, SortOrder]
    setParams((params) => {
      // created_at 降序是缺省态，不写参数
      if (key === 'created_at' && dir === 'desc') {
        params.delete('sort')
        params.delete('order')
      } else {
        params.set('sort', key)
        params.set('order', dir)
      }
    })
  }

  const providerById = new Map(providers.map((p) => [p.id, p]))
  const benchmarkById = new Map(benchmarks.map((b) => [b.id, b]))
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

  const selectedList = [...selected]
  const canCompare = selectedList.length === 2

  return (
    <div>
      <RunsHeader />
      <div
        data-testid="runs-filter"
        className="mb-3.5 flex flex-wrap items-center gap-2"
      >
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
          <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
            清除筛选
          </Button>
        )}
        <span
          className="ml-auto font-mono text-xs text-text-faint"
          data-testid="runs-count"
        >
          {visible.length} / {runs.length} 条
        </span>
        <Select
          aria-label="排序"
          className="w-44"
          value={`${sort}:${order}`}
          onChange={(event) => setSort(event.target.value)}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>

      {runs.length === 0 ? (
        <EmptyState
          title="还没有运行记录"
          hint="选择模型与题集，启动第一次评测。"
          action={
            <Link className={PRIMARY_LINK} to="/runs/new">
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
        <div className="runs-list">
          <div className="runs-head" aria-hidden>
            <span />
            <span>模型</span>
            <span>题集</span>
            <span>解出率</span>
            <span className="text-right">已解</span>
            <span className="text-right">CI95</span>
            <span className="text-right">耗时</span>
            <span>状态</span>
          </div>
          {visible.map((run) => {
            const provider = providerById.get(run.provider_id)
            const benchmark = benchmarkById.get(run.benchmark_id)
            return (
              <RunRow
                key={run.id}
                run={run}
                providerName={provider?.name ?? run.provider_id}
                providerModel={provider?.model ?? '—'}
                benchmarkName={benchmark?.name ?? run.benchmark_id}
                benchmarkTasks={benchmark?.task_count ?? null}
                selected={selected.has(run.id)}
                onToggle={() => toggleRun(run.id)}
              />
            )
          })}
        </div>
      )}

      <div
        className={`fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3.5 rounded-[10px] border border-[#2c333b] bg-[#15181c] py-2.5 pl-4 pr-3 shadow-[0_16px_48px_rgba(0,0,0,0.55)] transition-all duration-200 ${
          selected.size === 0
            ? 'pointer-events-none translate-y-3 opacity-0'
            : 'translate-y-0 opacity-100'
        }`}
      >
        <span
          className="text-[12.5px] text-text-dim"
          data-testid="runs-selected"
        >
          已选 <b className="font-medium text-text-strong">{selected.size}</b>/2
        </span>
        <span className="text-[11.5px] text-text-faint">
          选择两个 run 进行对比
        </span>
        {canCompare ? (
          <Link
            className={PRIMARY_LINK}
            to={`/compare?runs=${encodeURIComponent(selectedList[0])},${encodeURIComponent(selectedList[1])}`}
          >
            对比
          </Link>
        ) : (
          <Button type="button" variant="primary" disabled>
            对比
          </Button>
        )}
      </div>
    </div>
  )
}

export default function RunsPage() {
  const runs = useRuns()
  const providers = useProviders()
  const benchmarks = useBenchmarks()
  if (runs.isPending) {
    return <PageSkeleton variant="list" rows={5} />
  }
  if (runs.error) {
    return (
      <div className="space-y-4">
        <RunsHeader />
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
