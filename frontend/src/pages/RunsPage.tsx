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
  // 同键值保持原相对顺序（stable sort），desc 不能用 reverse 否则并列会被翻转
  const dir = order === 'asc' ? 1 : -1
  return [...list].sort((a, b) =>
    key === 'created_at'
      ? a.created_at.localeCompare(b.created_at) * dir
      : (solveRate(a) - solveRate(b)) * dir,
  )
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
  // created_at desc 是缺省态（URL 不写参数），表头也不显示排序指示
  const active =
    sort === sortKey && !(sort === 'created_at' && order === 'desc')
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
              <Th>
                <span className="sr-only">选择</span>
              </Th>
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
                  <input
                    type="checkbox"
                    aria-label={`选择 ${shortId(run.id)}`}
                    checked={selected.has(run.id)}
                    onChange={() => toggleRun(run.id)}
                  />
                </Td>
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
