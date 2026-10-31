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
