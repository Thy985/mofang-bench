import { Link } from 'react-router-dom'
import { useRuns, useProviders, useBenchmarks } from '../api/queries'
import type {
  BenchmarkSummary,
  Provider,
  Run,
} from '../api/types'
import { describeError } from '../lib/errors'
import { formatPercent, shortId, statusLabel } from '../lib/format'

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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Runs</h1>
        <Link
          className="rounded bg-emerald-600 px-4 py-2 text-sm text-white"
          to="/runs/new"
        >
          New Run
        </Link>
      </div>
      {runs.length === 0 ? (
        <p className="text-sm text-slate-400">还没有运行记录。</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-slate-400">
              <th className="py-2">run</th>
              <th>provider</th>
              <th>benchmark</th>
              <th>状态</th>
              <th>解出率</th>
              <th>创建时间</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr
                key={run.id}
                data-testid="run-row"
                className="border-b border-slate-900"
              >
                <td className="py-2">
                  <Link
                    className="text-emerald-400"
                    to={`/runs/${encodeURIComponent(run.id)}`}
                  >
                    {shortId(run.id)}
                  </Link>
                </td>
                <td>
                  {providerNames.get(run.provider_id) ?? run.provider_id}
                </td>
                <td>
                  {benchmarkNames.get(run.benchmark_id) ??
                    run.benchmark_id}
                </td>
                <td>{statusLabel(run.status)}</td>
                <td>{formatPercent(run.totals?.totals.solve_rate)}</td>
                <td>{new Date(run.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default function RunsPage() {
  const runs = useRuns()
  const providers = useProviders()
  const benchmarks = useBenchmarks()
  if (runs.isPending) {
    return <p className="text-sm text-slate-400">加载中…</p>
  }
  if (runs.error) {
    return (
      <p role="alert" className="text-rose-300">
        {describeError(runs.error)}
      </p>
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
