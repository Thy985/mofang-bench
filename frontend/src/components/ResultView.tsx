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
  formatTokens,
  statusLabel,
} from '../lib/format'
import { Alert } from '../ui/Alert'
import { BinChart } from './BinChart'
import { Card } from '../ui/Card'
import { Skeleton } from '../ui/Skeleton'
import { Table, Td, Th } from '../ui/Table'

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-3">
      <div className="text-xs text-text-dim">{label}</div>
      <div className="mt-1 text-lg font-medium">{value}</div>
    </Card>
  )
}

export function ResultView({
  report,
  run,
  provider,
  benchmark,
  error = null,
}: {
  report: Report | null
  run: Run
  provider: Provider | null
  benchmark: BenchmarkDetail | null
  error?: string | null
}) {
  if (!report) {
    return (
      <section data-testid="run-result" className="text-sm">
        {error ? (
          <Alert tone="danger">{error}</Alert>
        ) : (
          <div aria-busy="true" className="space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        )}
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
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold">运行结果</h2>
        <span className="text-sm text-text-dim">
          {provider ? `${provider.name} / ${provider.model}` : run.provider_id}
          {' · '}
          {benchmark?.name ?? run.benchmark_id}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard
          label="解出"
          value={`${report.totals.solved} / ${report.totals.tasks}`}
        />
        <StatCard
          label="解出率"
          value={formatPercent(report.totals.solve_rate)}
        />
        <StatCard
          label="CI95"
          value={`${formatPercent(report.totals.ci95[0])} – ${formatPercent(
            report.totals.ci95[1],
          )}`}
        />
        <StatCard
          label="部分结果"
          value={report.partial ? '是（未跑全）' : '否'}
        />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-text">分箱</h3>
        <BinChart byBin={report.by_bin} />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-text">逐题</h3>
        <div className="overflow-auto">
          <Table>
            <thead>
              <tr>
                <Th>task</Th>
                <Th>状态</Th>
                <Th>已解出</Th>
                <Th>步数</Th>
                <Th>参照</Th>
                <Th>效率</Th>
                <Th>tokens</Th>
                <Th>耗时</Th>
                <Th>失败码</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {report.episodes.map((episode) => (
                <tr key={episode.id}>
                  <Td>{episode.task_key}</Td>
                  <Td>{statusLabel(episode.status)}</Td>
                  <Td>{episode.solved ? '✓' : '—'}</Td>
                  <Td>{episode.moves_used}</Td>
                  <Td>{episode.reference_length}</Td>
                  <Td>
                    {episode.efficiency == null
                      ? '—'
                      : episode.efficiency.toFixed(2)}
                  </Td>
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
                  <Td>{episode.failure_code ?? '—'}</Td>
                  <Td>
                    <Link
                      data-testid="episode-replay-link"
                      className="text-accent"
                      to={`/episodes/${episode.id}`}
                    >
                      回放
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </div>

      {failures.size > 0 && (
        <p className="text-sm text-text-dim">
          失败分布：
          {[...failures.entries()]
            .map(([code, count]) => `${code} × ${count}`)
            .join('，')}
        </p>
      )}

      <div className="flex flex-wrap gap-3 text-sm">
        <a
          data-testid="export-json"
          className="rounded border border-line px-3 py-1.5"
          href={reportUrl(run.id)}
          download={`run-${run.id}.json`}
        >
          JSON
        </a>
        <a
          data-testid="export-csv"
          className="rounded border border-line px-3 py-1.5"
          href={exportUrl(run.id, 'csv')}
        >
          CSV
        </a>
        <a
          data-testid="export-md"
          className="rounded border border-line px-3 py-1.5"
          href={exportUrl(run.id, 'md')}
        >
          Markdown
        </a>
      </div>
    </section>
  )
}
