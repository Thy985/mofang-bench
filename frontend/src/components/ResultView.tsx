import { Link } from 'react-router-dom'
import { exportUrl, reportUrl } from '../api/client'
import type {
  BenchmarkDetail,
  Provider,
  Report,
  Run,
} from '../api/types'
import {
  errorSummary,
  formatPercent,
  formatTokens,
  statusLabel,
} from '../lib/format'
import { Alert } from '../ui/Alert'
import { BinChart } from './BinChart'
import { Card } from '../ui/Card'
import { Skeleton } from '../ui/Skeleton'
import { Table, Td, Th } from '../ui/Table'

const SIDE_LABELS: Record<string, string> = {
  env: '环境侧',
  model: '模型侧',
  user: '用户',
}

const SIDE_STYLES: Record<string, string> = {
  env: 'border-amber-400/40 text-amber-300',
  model: 'border-rose-400/40 text-rose-300',
  user: 'border-line text-text-dim',
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
  const episodeByTask = new Map(
    report.episodes.map((episode) => [episode.task_key, episode]),
  )
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
      <Card className="p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-eyebrow text-text-dim">
              解出率
            </div>
            <div className="mt-1 text-5xl font-bold tracking-tight text-accent">
              {formatPercent(report.totals.solve_rate)}
            </div>
          </div>
          <dl className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
            <div>
              <dt className="text-xs text-text-dim">已解出</dt>
              <dd className="mt-0.5 text-lg font-medium">
                {report.totals.solved} / {report.totals.tasks}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-dim">CI95</dt>
              <dd className="mt-0.5 text-lg font-medium">
                {formatPercent(report.totals.ci95[0])} –{' '}
                {formatPercent(report.totals.ci95[1])}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-dim">部分结果</dt>
              <dd className="mt-0.5 text-lg font-medium">
                {report.partial ? '是（未跑全）' : '否'}
              </dd>
            </div>
          </dl>
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: `${report.totals.solve_rate * 100}%` }}
          />
        </div>
      </Card>

      <div>
        <h3 className="mb-2 text-sm font-medium text-text">分箱</h3>
        <BinChart byBin={report.by_bin} />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-text">逐题</h3>
        <div className="overflow-auto">
          <Table className="min-w-[900px] [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
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
                <Th>原因</Th>
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
                  <Td className="max-w-[260px]">
                    {episode.error ? (
                      <span
                        className="block truncate text-text-dim"
                        title={episode.error}
                      >
                        {errorSummary(episode.error)}
                      </span>
                    ) : (
                      '—'
                    )}
                  </Td>
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

      {report.attribution && report.attribution.failed > 0 && (
        <div
          data-testid="attribution"
          className="space-y-2 rounded border border-line bg-surface p-4 text-sm"
        >
          <h3 className="text-sm font-medium text-text">失败归因</h3>
          <p>
            失败 {report.attribution.failed}
            {' = '}
            环境侧 {report.attribution.env}
            {' + '}
            模型侧 {report.attribution.model}
            {report.attribution.failed >
              report.attribution.env + report.attribution.model && (
              <span className="text-text-dim">
                {' '}
                （其余为用户取消，不计入两侧）
              </span>
            )}
          </p>
          {(() => {
            const stats: string[] = []
            if (report.attribution.provider_errors_total) {
              stats.push(
                `provider 退避/错误 共 ${report.attribution.provider_errors_total} 次`,
              )
            }
            if (report.attribution.protocol_errors_total) {
              stats.push(
                `协议错误 共 ${report.attribution.protocol_errors_total} 次`,
              )
            }
            return stats.length > 0 ? (
              <p className="text-text-dim">{stats.join(' · ')}</p>
            ) : null
          })()}
          {Object.keys(report.attribution.signals).length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-text-dim">
              {Object.entries(report.attribution.signals).map(
                ([signal, count]) => (
                  <li key={signal}>
                    {signal}
                    {count > 1 && `（× ${count}）`}
                  </li>
                ),
              )}
            </ul>
          )}
          <div className="overflow-auto">
            <Table className="min-w-[680px] [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
              <thead>
                <tr>
                  <Th>task</Th>
                  <Th>侧别</Th>
                  <Th>失败码</Th>
                  <Th>信号</Th>
                  <Th>原因</Th>
                </tr>
              </thead>
              <tbody>
                {report.attribution.items.map((item, index) => (
                  <tr
                    key={`${item.task_id}-${index}`}
                    data-testid="attribution-item"
                  >
                    <Td>{item.task_id}</Td>
                    <Td>
                      <span
                        className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold ${SIDE_STYLES[item.side] ?? SIDE_STYLES.user}`}
                      >
                        {SIDE_LABELS[item.side] ?? item.side}
                      </span>
                    </Td>
                    <Td>{item.code}</Td>
                    <Td className="text-text-dim">
                      {item.signals.length > 0 ? item.signals.join('；') : '—'}
                    </Td>
                    <Td className="max-w-[260px]">
                      {episodeByTask.get(item.task_id)?.error ? (
                        <span
                          className="block truncate"
                          title={episodeByTask.get(item.task_id)?.error ?? ''}
                        >
                          {errorSummary(
                            episodeByTask.get(item.task_id)?.error,
                          )}
                        </span>
                      ) : (
                        '—'
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <p className="text-xs text-text-dim">
            harness 工具链本身的正确性由题集详情页的「Harness
            自检」独立验证；两侧的详细定义见 README「失败归因」。
          </p>
        </div>
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
