import { Link } from 'react-router-dom'
import { exportUrl, reportUrl } from '../api/client'
import type {
  BenchmarkDetail,
  Provider,
  Report,
  Run,
} from '../api/types'
import {
  formatPercent,
  statusLabel,
} from '../lib/format'

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-slate-800 bg-slate-900 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-medium">{value}</div>
    </div>
  )
}

export function ResultView({
  report,
  run,
  provider,
  benchmark,
}: {
  report: Report | null
  run: Run
  provider: Provider | null
  benchmark: BenchmarkDetail | null
}) {
  if (!report) {
    return (
      <section data-testid="run-result" className="text-sm text-slate-400">
        报告加载中…
      </section>
    )
  }
  const failures = new Map<string, number>()
  for (const episode of report.episodes) {
    if (episode.failure_code) {
      failures.set(
        episode.failure_code,
        (failures.get(episode.failure_code) ?? 0) + 1,
      )
    }
  }
  return (
    <section data-testid="run-result" className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold">运行结果</h2>
        <span className="text-sm text-slate-400">
          {provider ? `${provider.name} / ${provider.model}` : run.provider_id}
          {' · '}
          {benchmark?.name ?? run.benchmark_id}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Card
          label="解出"
          value={`${report.totals.solved} / ${report.totals.tasks}`}
        />
        <Card
          label="解出率"
          value={formatPercent(report.totals.solve_rate)}
        />
        <Card
          label="CI95"
          value={`${formatPercent(report.totals.ci95[0])} – ${formatPercent(
            report.totals.ci95[1],
          )}`}
        />
        <Card
          label="部分结果"
          value={report.partial ? '是（未跑全）' : '否'}
        />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-slate-300">分箱</h3>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-slate-400">
              <th className="py-2">bin</th>
              <th>total</th>
              <th>solved</th>
              <th>solve_rate</th>
              <th>mean_moves</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(report.by_bin).map(([bin, stats]) => (
              <tr key={bin} className="border-b border-slate-900">
                <td className="py-2">{bin}</td>
                <td>{stats.total}</td>
                <td>{stats.solved}</td>
                <td>{formatPercent(stats.solve_rate)}</td>
                <td>{stats.mean_moves.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-slate-300">逐题</h3>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-slate-400">
              <th className="py-2">task</th>
              <th>状态</th>
              <th>步数</th>
              <th>参照</th>
              <th>效率</th>
              <th>失败码</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {report.episodes.map((episode) => (
              <tr
                key={episode.id}
                className="border-b border-slate-900"
              >
                <td className="py-2">{episode.task_key}</td>
                <td>{statusLabel(episode.status)}</td>
                <td>{episode.moves_used}</td>
                <td>{episode.reference_length}</td>
                <td>
                  {episode.efficiency == null
                    ? '—'
                    : episode.efficiency.toFixed(2)}
                </td>
                <td>{episode.failure_code ?? '—'}</td>
                <td>
                  <Link
                    data-testid="episode-replay-link"
                    className="text-emerald-400"
                    to={`/episodes/${episode.id}`}
                  >
                    回放
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {failures.size > 0 && (
        <p className="text-sm text-slate-400">
          失败分布：
          {[...failures.entries()]
            .map(([code, count]) => `${code} × ${count}`)
            .join('，')}
        </p>
      )}

      <div className="flex flex-wrap gap-3 text-sm">
        <a
          data-testid="export-json"
          className="rounded border border-slate-700 px-3 py-1.5"
          href={reportUrl(run.id)}
          download={`run-${run.id}.json`}
        >
          JSON
        </a>
        <a
          data-testid="export-csv"
          className="rounded border border-slate-700 px-3 py-1.5"
          href={exportUrl(run.id, 'csv')}
        >
          CSV
        </a>
        <a
          data-testid="export-md"
          className="rounded border border-slate-700 px-3 py-1.5"
          href={exportUrl(run.id, 'md')}
        >
          Markdown
        </a>
      </div>
    </section>
  )
}
