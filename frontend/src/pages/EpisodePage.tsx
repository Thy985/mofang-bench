import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useBenchmark, useEpisode, useRun, useSteps } from '../api/queries'
import type {
  CubeState,
  Episode,
  Step,
} from '../api/types'
import { StatusBadge } from '../components/StatusBadge'
import { CubeView } from '../cube/CubeView'
import type { MoveBatch } from '../cube/CubeView'
import { describeError } from '../lib/errors'
import {
  formatDuration,
  formatPercent,
  formatTokens,
} from '../lib/format'

export interface EpisodeViewProps {
  episode: Episode
  steps: Step[]
  selected: number
  onSelect: (index: number) => void
  onPlayBatch: (stepIndex: number, moves: string[], state: CubeState) => void
  cube: ReactNode
}

export function EpisodeView({
  episode,
  steps,
  selected,
  onSelect,
  onPlayBatch,
  cube,
}: EpisodeViewProps) {
  const step = selected >= 0 ? steps[selected] : null
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">
          题目 {episode.task_key}
        </h1>
        <StatusBadge status={episode.status} />
        <Link className="text-sm text-slate-400" to={`/runs/${episode.run_id}`}>
          返回 run
        </Link>
      </div>
      <div className="grid gap-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
        <div>
          <div className="text-xs text-slate-500">解出</div>
          <div>{episode.solved ? '是' : '否'}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">步数 / 参照</div>
          <div>
            {episode.moves_used} / {episode.reference_length}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">效率</div>
          <div>
            {episode.efficiency == null
              ? '—'
              : formatPercent(episode.efficiency)}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">耗时</div>
          <div>{formatDuration(episode.latency_ms)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">tokens</div>
          <div>
            {formatTokens(
              (episode.tokens_in ?? 0) + (episode.tokens_out ?? 0),
            )}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">失败码</div>
          <div>{episode.failure_code ?? '—'}</div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        {cube}
        <aside className="space-y-3 rounded border border-slate-800 bg-slate-900 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onSelect(-1)}
              className={`rounded px-2 py-1 text-xs ${
                selected === -1
                  ? 'bg-emerald-700 text-white'
                  : 'bg-slate-800 text-slate-300'
              }`}
            >
              初始局面
            </button>
            {steps.map((item, index) => (
              <button
                key={item.id}
                type="button"
                data-testid="step-row"
                onClick={() => onSelect(index)}
                className={`rounded px-2 py-1 text-xs ${
                  selected === index
                    ? 'bg-emerald-700 text-white'
                    : 'bg-slate-800 text-slate-300'
                }`}
              >
                #{item.seq} {item.kind}
                {item.tool_name ? ` · ${item.tool_name}` : ''}
              </button>
            ))}
          </div>

          {step && (
            <div className="space-y-2 border-t border-slate-800 pt-3">
              <div className="text-slate-300">
                kind：{step.kind}
                {step.tool_name ? ` · ${step.tool_name}` : ''}
              </div>
              <div className="text-slate-400">
                参照长度：{step.reference_length_after ?? '—'}
              </div>
              {Array.isArray(step.result?.applied) &&
                step.result.applied.length > 0 &&
                step.state && (
                  <button
                    type="button"
                    className="rounded border border-slate-700 px-3 py-1 text-xs"
                    onClick={() =>
                      onPlayBatch(
                        selected,
                        step.result!.applied as string[],
                        step.state!,
                      )
                    }
                  >
                    播放本步
                  </button>
                )}
              <details>
                <summary className="cursor-pointer text-xs text-slate-500">
                  参数
                </summary>
                <pre className="mt-1 overflow-auto rounded bg-slate-950 p-2 text-[10px] text-slate-400">
                  {JSON.stringify(step.arguments, null, 2)}
                </pre>
              </details>
              <details>
                <summary className="cursor-pointer text-xs text-slate-500">
                  结果
                </summary>
                <pre className="mt-1 overflow-auto rounded bg-slate-950 p-2 text-[10px] text-slate-400">
                  {JSON.stringify(step.result, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

export default function EpisodePage() {
  const { id } = useParams()
  const episodeQuery = useEpisode(id)
  const stepsQuery = useSteps(id)
  const runQuery = useRun(episodeQuery.data?.run_id)
  const benchmarkQuery = useBenchmark(runQuery.data?.run.benchmark_id)
  const [selected, setSelected] = useState(-1)
  const [batch, setBatch] = useState<MoveBatch | null>(null)
  const [resetToken, setResetToken] = useState(1)

  // 先看错误再看 loading：run/benchmark 依赖上游数据，上游失败时它们会一直 pending。
  const failure =
    episodeQuery.error ??
    stepsQuery.error ??
    runQuery.error ??
    benchmarkQuery.error
  if (failure) {
    return <p className="text-rose-300">{describeError(failure)}</p>
  }
  if (
    episodeQuery.isPending ||
    stepsQuery.isPending ||
    runQuery.isPending ||
    benchmarkQuery.isPending
  ) {
    return <p className="text-sm text-slate-400">加载中…</p>
  }
  const episode = episodeQuery.data
  const steps = stepsQuery.data ?? []
  if (!episode) return null
  const task = benchmarkQuery.data?.tasks.find(
    (item) => item.id === episode.task_key,
  )
  // 选中步没有落库局面时，回退到它之前最近一个有局面的步骤，再回退到题初始局面。
  function stateFor(index: number): CubeState | null {
    for (let cursor = index; cursor >= 0; cursor -= 1) {
      const candidate = steps[cursor]?.state
      if (candidate) return candidate
    }
    return task?.state ?? null
  }
  const state = stateFor(selected)

  function select(index: number) {
    setSelected(index)
    setBatch(null)
    setResetToken((current) => current + 1)
  }

  function playBatch(
    stepIndex: number,
    moves: string[],
    finalState: CubeState,
  ) {
    setSelected(Math.max(-1, stepIndex - 1))
    setResetToken((current) => current + 1)
    setBatch({ eventId: Date.now(), moves, state: finalState })
  }

  return (
    <EpisodeView
      episode={episode}
      steps={steps}
      selected={selected}
      onSelect={select}
      onPlayBatch={playBatch}
      cube={
        <CubeView
          state={state}
          resetToken={resetToken}
          batch={batch}
          speed={1}
          paused={false}
          skipToken={0}
        />
      }
    />
  )
}
