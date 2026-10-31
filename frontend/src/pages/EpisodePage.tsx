import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useBenchmark, useEpisode, useRun, useSteps } from '../api/queries'
import type { Episode, Step } from '../api/types'
import { PlayerBar } from '../components/PlayerBar'
import { StatusBadge } from '../components/StatusBadge'
import { CubeView } from '../cube/CubeView'
import { FaceLegend } from '../cube/FaceLegend'
import { ViewPresets } from '../cube/ViewPresets'
import type { ViewRequest } from '../cube/viewControls'
import { usePlayback, type Playback } from '../hooks/usePlayback'
import { describeError } from '../lib/errors'
import {
  formatDuration,
  formatPercent,
  formatTokens,
} from '../lib/format'
import { Alert } from '../ui/Alert'
import { PageSkeleton } from '../ui/PageSkeleton'
import { Stat } from '../ui/Stat'

export interface EpisodeViewProps {
  episode: Episode
  steps: Step[]
  playback: Playback
  cube: ReactNode
}

const chipCls = (active: boolean) =>
  `rounded px-2 py-1 text-xs ${
    active ? 'bg-accent-dim text-white' : 'bg-surface text-text'
  }`

export function EpisodeView({
  episode,
  steps,
  playback,
  cube,
}: EpisodeViewProps) {
  const step = playback.active >= 0 ? steps[playback.active] : null
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">
          题目 {episode.task_key}
        </h1>
        <StatusBadge status={episode.status} />
        <Link className="text-sm text-text-dim" to={`/runs/${episode.run_id}`}>
          返回 run
        </Link>
      </div>
      <div className="grid gap-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
        <div>
          <div className="text-xs text-text-dim">解出</div>
          <div>{episode.solved ? '是' : '否'}</div>
        </div>
        <div>
          <div className="text-xs text-text-dim">步数 / 参照</div>
          <div>
            {episode.moves_used} / {episode.reference_length}
          </div>
        </div>
        <div>
          <div className="text-xs text-text-dim">效率</div>
          <div>
            {episode.efficiency == null
              ? '—'
              : formatPercent(episode.efficiency)}
          </div>
        </div>
        <div>
          <div className="text-xs text-text-dim">耗时</div>
          <div>{formatDuration(episode.latency_ms)}</div>
        </div>
        <div>
          <div className="text-xs text-text-dim">tokens</div>
          <div>
            {formatTokens(
              (episode.tokens_in ?? 0) + (episode.tokens_out ?? 0),
            )}
          </div>
        </div>
        <div>
          <div className="text-xs text-text-dim">失败码</div>
          <div>{episode.failure_code ?? '—'}</div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        {cube}
        <aside className="space-y-3 rounded border border-line bg-surface p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => playback.select(-1)}
              className={chipCls(playback.active === -1)}
            >
              初始局面
            </button>
            {steps.map((item, index) => (
              <button
                key={item.id}
                type="button"
                data-testid="step-row"
                onClick={() => playback.select(index)}
                className={chipCls(playback.active === index)}
              >
                #{item.seq} {item.kind}
                {item.tool_name ? ` · ${item.tool_name}` : ''}
              </button>
            ))}
          </div>

          {step && (
            <div className="space-y-2 border-t border-line pt-3">
              <div className="grid grid-cols-2 gap-2">
                <Stat
                  label="kind"
                  value={
                    step.tool_name
                      ? `${step.kind} · ${step.tool_name}`
                      : step.kind
                  }
                />
                <Stat
                  label="参照长度"
                  value={String(step.reference_length_after ?? '—')}
                />
              </div>
              <details>
                <summary className="cursor-pointer text-xs text-text-dim">
                  参数
                </summary>
                <pre className="mt-1 overflow-auto rounded bg-sunken p-2 text-[10px] text-text-dim">
                  {JSON.stringify(step.arguments, null, 2)}
                </pre>
              </details>
              {typeof step.result?.thinking === 'string' &&
                step.result.thinking && (
                  <details data-testid="step-thinking">
                    <summary className="cursor-pointer text-xs text-sky-300">
                      思考过程
                    </summary>
                    <pre className="mt-1 overflow-auto whitespace-pre-wrap rounded bg-sunken p-2 text-[10px] text-text-dim">
                      {step.result.thinking}
                    </pre>
                  </details>
                )}
              <details>
                <summary className="cursor-pointer text-xs text-text-dim">
                  结果
                </summary>
                <pre className="mt-1 overflow-auto rounded bg-sunken p-2 text-[10px] text-text-dim">
                  {JSON.stringify(step.result, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </aside>
      </div>

      <PlayerBar playback={playback} steps={steps} />
    </div>
  )
}

export default function EpisodePage() {
  const { id } = useParams()
  const episodeQuery = useEpisode(id)
  const stepsQuery = useSteps(id)
  const runQuery = useRun(episodeQuery.data?.run_id)
  const benchmarkQuery = useBenchmark(runQuery.data?.run.benchmark_id)
  const [viewRequest, setViewRequest] = useState<ViewRequest | null>(null)

  const episode = episodeQuery.data
  const steps = stepsQuery.data ?? []
  const task = benchmarkQuery.data?.tasks.find(
    (item) => item.id === episode?.task_key,
  )
  // usePlayback 是 hook，必须在早退 return 之前调用；数据未到时 steps 为空数组。
  const playback = usePlayback(steps, task?.state ?? null)

  // 先看错误再看 loading：run/benchmark 依赖上游数据，上游失败时它们会一直 pending。
  const failure =
    episodeQuery.error ??
    stepsQuery.error ??
    runQuery.error ??
    benchmarkQuery.error
  if (failure) {
    return <Alert tone="danger">{describeError(failure)}</Alert>
  }
  if (
    episodeQuery.isPending ||
    stepsQuery.isPending ||
    runQuery.isPending ||
    benchmarkQuery.isPending
  ) {
    return <PageSkeleton variant="form" fields={4} />
  }
  if (!episode) return null

  return (
    <EpisodeView
      episode={episode}
      steps={steps}
      playback={playback}
      cube={
        <div className="relative">
          <CubeView
            state={playback.viewState}
            resetToken={playback.resetToken}
            batch={playback.batch}
            speed={playback.speed}
            paused={false}
            skipToken={0}
            viewRequest={viewRequest ?? undefined}
            onBatchComplete={playback.handleBatchComplete}
          />
          <ViewPresets
            onRequest={(preset) =>
              setViewRequest((current) => ({
                preset,
                token: (current?.token ?? 0) + 1,
              }))
            }
          />
          <FaceLegend />
        </div>
      }
    />
  )
}
