import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import {
  qk,
  useBenchmark,
  useProviders,
  useReport,
  useRun,
} from '../api/queries'
import type {
  BenchmarkDetail,
  CubeState,
  Provider,
  Run,
} from '../api/types'
import { ProgressChart } from '../components/ProgressChart'
import { ResultView } from '../components/ResultView'
import { StatusBadge } from '../components/StatusBadge'
import { ToolLog } from '../components/ToolLog'
import { CubeView } from '../cube/CubeView'
import { useRunEvents } from '../hooks/useRunEvents'
import type { LiveState } from '../hooks/liveReducer'
import {
  formatDuration,
  formatTokens,
  shortId,
} from '../lib/format'

function useElapsed(startedAt: string | null): number | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return startedAt ? now - new Date(startedAt).getTime() : null
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="truncate text-slate-200">{value}</div>
    </div>
  )
}

export function RunLivePanel({
  live,
  run,
  benchmark,
  provider,
  onCancel,
  cancelling,
}: {
  live: LiveState
  run: Run
  benchmark: BenchmarkDetail | null
  provider: Provider | null
  onCancel: () => void
  cancelling: boolean
}) {
  const episode = live.currentEpisode
  const elapsed = useElapsed(run.started_at)
  const tokens =
    live.usage.prompt_tokens + live.usage.completion_tokens
  const completed = live.episodes.filter(
    (item) => item.status !== 'running',
  ).length
  return (
    <aside className="space-y-4 self-start rounded border border-slate-800 bg-slate-900 p-4 text-sm">
      <div className="grid grid-cols-2 gap-3">
        <Stat
          label="provider"
          value={
            provider
              ? `${provider.name} / ${provider.model}`
              : run.provider_id
          }
        />
        <Stat label="题集" value={benchmark?.name ?? run.benchmark_id} />
        <Stat
          label="进度"
          value={`${completed}/${benchmark?.tasks.length ?? '?'}`}
        />
        <Stat label="当前题" value={episode?.task_key ?? '—'} />
        <Stat
          label="步数"
          value={
            episode
              ? `${episode.moves_used}/${run.budget.max_moves}`
              : '—'
          }
        />
        <Stat
          label="参照长度"
          value={String(episode?.reference_length ?? '—')}
        />
        <Stat label="计时" value={formatDuration(elapsed)} />
        <Stat label="tokens" value={formatTokens(tokens)} />
      </div>
      <div className="flex items-center gap-2">
        <StatusBadge status={episode?.status ?? run.status} />
        <span className="text-xs text-slate-500">成本：未配置价格</span>
      </div>
      {live.firstInvalidCall && (
        <p className="text-amber-300">
          首次非法调用：{live.firstInvalidCall.tool} ·{' '}
          {live.firstInvalidCall.message}
        </p>
      )}
      {live.error && <p className="text-rose-300">{live.error}</p>}
      <ProgressChart
        points={live.progress}
        maxMoves={run.budget.max_moves}
      />
      <ToolLog logs={live.logs} />
      {(run.status === 'queued' || run.status === 'running') && (
        <button
          type="button"
          onClick={onCancel}
          disabled={cancelling}
          className="rounded border border-rose-700 px-3 py-1.5 text-rose-300 disabled:opacity-50"
        >
          取消 run
        </button>
      )}
    </aside>
  )
}

export default function RunPage() {
  const { id } = useParams()
  const queryClient = useQueryClient()
  const runQuery = useRun(id)
  const providers = useProviders()
  const live = useRunEvents(id ?? '')
  const benchmark = useBenchmark(runQuery.data?.run.benchmark_id)
  const run = live.run ?? runQuery.data?.run ?? null
  const finished = run
    ? !['queued', 'running'].includes(run.status)
    : false
  const report = useReport(id, finished)
  const cancel = useMutation({
    mutationFn: () => api.runs.cancel(id!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.run(id!) })
    },
  })
  const [speed, setSpeed] = useState(1)
  const [paused, setPaused] = useState(false)
  const [skipToken, setSkipToken] = useState(0)
  const [cubeReset, setCubeReset] = useState<{
    state: CubeState | null
    token: number
  }>({ state: null, token: 0 })
  const snapshotApplied = useRef(0)

  // snapshot 的 current_state 优先；为空且已有 episode 时回退到该题 task.state（spec §4.3）。
  // snapshotApplied 防止题集后到时重复吸附，把已经播出的批次拉回旧局面。
  useEffect(() => {
    if (live.snapshotToken === 0) return
    if (snapshotApplied.current === live.snapshotToken) return
    const taskState = benchmark.data?.tasks.find(
      (item) => item.id === live.currentEpisode?.task_key,
    )?.state
    const target = live.snapshotState ?? taskState ?? null
    if (!target) return
    if (!live.snapshotState && live.latestBatch) return
    snapshotApplied.current = live.snapshotToken
    setCubeReset((current) => ({
      state: target,
      token: current.token + 1,
    }))
  }, [
    live.snapshotToken,
    live.snapshotState,
    live.latestBatch,
    live.currentEpisode?.task_key,
    benchmark.data,
  ])

  // 终态清空动画队列：run.finished / run.error 之后不再有批次（spec §6.3）。
  useEffect(() => {
    if (!finished) return
    setCubeReset((current) => ({
      state:
        live.latestBatch?.state ?? live.snapshotState ?? current.state,
      token: current.token + 1,
    }))
  }, [finished])

  useEffect(() => {
    if (!benchmark.data || live.episodeToken === 0) return
    const task = benchmark.data.tasks.find(
      (item) => item.id === live.currentEpisode?.task_key,
    )
    if (task) {
      setCubeReset((current) => ({
        state: task.state,
        token: current.token + 1,
      }))
    }
  }, [
    live.episodeToken,
    live.currentEpisode?.task_key,
    benchmark.data,
  ])

  if (!id) return null
  if (runQuery.isPending) {
    return <p className="text-sm text-slate-400">加载中…</p>
  }
  if (runQuery.error) {
    return <p className="text-rose-300">{runQuery.error.message}</p>
  }
  if (!run) {
    return <p className="text-sm text-slate-400">run 不存在。</p>
  }
  const provider =
    providers.data?.find((item) => item.id === run.provider_id) ?? null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">
          Run {shortId(run.id)}
        </h1>
        <span data-testid="run-status">
          <StatusBadge status={run.status} />
        </span>
        <Link className="text-sm text-slate-400" to="/runs">
          返回历史
        </Link>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-3">
          <CubeView
            state={cubeReset.state}
            resetToken={cubeReset.token}
            batch={live.latestBatch}
            speed={speed}
            paused={paused}
            skipToken={skipToken}
          />
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              <span className="text-slate-400">速度</span>
              <select
                className="rounded bg-slate-900 px-2 py-1"
                value={speed}
                onChange={(event) =>
                  setSpeed(Number(event.target.value))
                }
              >
                <option value={0.5}>0.5×</option>
                <option value={1}>1×</option>
                <option value={2}>2×</option>
                <option value={100}>instant</option>
              </select>
            </label>
            <button
              type="button"
              className="rounded border border-slate-700 px-3 py-1"
              onClick={() => setPaused((current) => !current)}
            >
              {paused ? '继续' : '暂停'}
            </button>
            <button
              type="button"
              className="rounded border border-slate-700 px-3 py-1"
              onClick={() => setSkipToken((current) => current + 1)}
            >
              跳到最新
            </button>
          </div>
        </div>

        {!finished && (
          <RunLivePanel
            live={live}
            run={run}
            benchmark={benchmark.data ?? null}
            provider={provider}
            onCancel={() => cancel.mutate()}
            cancelling={cancel.isPending}
          />
        )}
      </div>

      {finished && (
        <ResultView
          report={report.data ?? null}
          run={run}
          provider={provider}
          benchmark={benchmark.data ?? null}
        />
      )}
    </div>
  )
}
