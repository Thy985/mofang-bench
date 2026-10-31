import { Link } from 'react-router-dom'
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
import { Table, Td, Th } from '../ui/Table'

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

export function RunsView({
  runs,
  providers,
  benchmarks,
}: RunsViewProps) {
  const providerNames = new Map(
    providers.map((provider) => [provider.id, provider.name]),
  )
  const benchmarkNames = new Map(
    benchmarks.map((benchmark) => [benchmark.id, benchmark.name]),
  )
  return (
    <div className="space-y-4">
      <RunsHeader />
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
        <Table>
          <thead>
            <tr>
              <Th>run</Th>
              <Th>provider</Th>
              <Th>benchmark</Th>
              <Th>状态</Th>
              <Th>创建时间</Th>
              <Th>解出率</Th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
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
                  {benchmarkNames.get(run.benchmark_id) ??
                    run.benchmark_id}
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
