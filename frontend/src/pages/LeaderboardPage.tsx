import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useBenchmarks, useProviders, useRuns } from '../api/queries'
import type { BenchmarkSummary, Provider, Run } from '../api/types'
import { formatDate, formatPercent } from '../lib/format'
import { describeError } from '../lib/errors'
import { Alert } from '../ui/Alert'
import { EmptyState } from '../ui/EmptyState'
import { PageHeader } from '../ui/PageHeader'
import { PageSkeleton } from '../ui/PageSkeleton'
import { Select } from '../ui/Select'

interface LeaderRow {
  key: string
  providerName: string
  model: string
  benchmarkName: string
  benchmarkId: string
  cube: string
  solveRate: number
  ci95: [number, number]
  tasks: number
  runCount: number
  latestAt: string
  latestRunId: string
}

// 排行榜口径：按「模型 × 题集」聚合，只取每组最新一次已完成 run 的解出率。
// runCount 表示该组合的累计评测次数，方便判断样本是否够。
export function LeaderboardView({
  runs,
  providers,
  benchmarks,
}: {
  runs: Run[]
  providers: Provider[]
  benchmarks: BenchmarkSummary[]
}) {
  const [benchmarkId, setBenchmarkId] = useState('')
  const providerById = useMemo(
    () => new Map(providers.map((item) => [item.id, item])),
    [providers],
  )
  const benchmarkById = useMemo(
    () => new Map(benchmarks.map((item) => [item.id, item])),
    [benchmarks],
  )

  const rows = useMemo<LeaderRow[]>(() => {
    const grouped = new Map<string, Run[]>()
    for (const run of runs) {
      if (run.status !== 'finished' || !run.totals) continue
      const key = `${run.provider_id}|${run.benchmark_id}`
      const list = grouped.get(key) ?? []
      list.push(run)
      grouped.set(key, list)
    }
    const result: LeaderRow[] = []
    for (const [key, list] of grouped) {
      const latest = [...list].sort((a, b) =>
        b.created_at.localeCompare(a.created_at),
      )[0]
      const provider = providerById.get(latest.provider_id)
      const benchmark = benchmarkById.get(latest.benchmark_id)
      result.push({
        key,
        providerName: provider?.name ?? latest.provider_id,
        model: provider?.model ?? '',
        benchmarkName: benchmark?.name ?? latest.benchmark_id,
        benchmarkId: latest.benchmark_id,
        cube: benchmark?.cube ?? '',
        solveRate: latest.totals?.totals.solve_rate ?? 0,
        ci95: latest.totals?.totals.ci95 ?? [0, 1],
        tasks: latest.totals?.totals.tasks ?? 0,
        runCount: list.length,
        latestAt: latest.created_at,
        latestRunId: latest.id,
      })
    }
    return result.sort(
      (a, b) =>
        b.solveRate - a.solveRate ||
        a.providerName.localeCompare(b.providerName) ||
        a.benchmarkName.localeCompare(b.benchmarkName),
    )
  }, [runs, providerById, benchmarkById])

  const visible = benchmarkId
    ? rows.filter((row) => row.benchmarkId === benchmarkId)
    : rows

  return (
    <div>
      <PageHeader
        eyebrow="评测记录"
        title="排行榜"
        subtitle="模型 × 题集 · 取每组最新一次已完成 run"
        actions={
          <Select
            aria-label="题集筛选"
            className="w-48"
            value={benchmarkId}
            onChange={(event) => setBenchmarkId(event.target.value)}
          >
            <option value="">全部题集</option>
            {benchmarks.map((benchmark) => (
              <option key={benchmark.id} value={benchmark.id}>
                {benchmark.name}（{benchmark.cube} · {benchmark.task_count} 题）
              </option>
            ))}
          </Select>
        }
      />
      {rows.length === 0 ? (
        <EmptyState
          title="还没有可排名的 run"
          hint="完成一次评测后，这里会按模型 × 题集聚合出解出率排名。"
        />
      ) : (
        <div className="overflow-auto">
          <table className="board min-w-[560px]">
            <thead>
              <tr>
                <th scope="col" className="rank">
                  #
                </th>
                <th scope="col">模型</th>
                <th scope="col">题集</th>
                <th scope="col" className="r">
                  解出率
                </th>
                <th scope="col" className="r">
                  CI95
                </th>
                <th scope="col" className="r">
                  次数
                </th>
                <th scope="col" className="r">
                  最近
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row, index) => (
                <tr
                  key={row.key}
                  data-testid="leaderboard-row"
                  className={index === 0 ? 'top' : undefined}
                >
                  <td className="rank">{String(index + 1).padStart(2, '0')}</td>
                  <td className="who whitespace-nowrap">
                    <Link
                      className="hover:text-accent"
                      to={`/runs/${encodeURIComponent(row.latestRunId)}`}
                    >
                      {row.providerName}
                    </Link>
                    {row.model && <span>{row.model}</span>}
                  </td>
                  <td className="whitespace-nowrap">
                    <span className="bench-tag">
                      {row.benchmarkName}
                      {row.cube && <em>{row.cube}</em>}
                    </span>
                  </td>
                  <td className="r">
                    <div className="rate-cell">
                      <b className="font-mono">{formatPercent(row.solveRate)}</b>
                      <span className="rate-bar" aria-hidden>
                        <i style={{ width: `${row.solveRate * 100}%` }} />
                      </span>
                    </div>
                  </td>
                  <td className="r ci whitespace-nowrap">
                    {formatPercent(row.ci95[0])}–{formatPercent(row.ci95[1])}
                  </td>
                  <td className="r whitespace-nowrap font-mono text-text-dim">
                    {row.runCount}
                  </td>
                  <td className="r whitespace-nowrap text-xs text-text-faint">
                    {formatDate(row.latestAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function LeaderboardPage() {
  const runs = useRuns()
  const providers = useProviders()
  const benchmarks = useBenchmarks()
  if (runs.isPending || providers.isPending || benchmarks.isPending) {
    return <PageSkeleton variant="table" rows={6} />
  }
  if (runs.error || providers.error || benchmarks.error) {
    return (
      <Alert tone="danger">
        {describeError(runs.error ?? providers.error ?? benchmarks.error)}
      </Alert>
    )
  }
  return (
    <LeaderboardView
      runs={runs.data ?? []}
      providers={providers.data ?? []}
      benchmarks={benchmarks.data ?? []}
    />
  )
}
