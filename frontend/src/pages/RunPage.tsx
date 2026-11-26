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
import { PhaseStepper } from '../components/PhaseStepper'
import { ProgressChart } from '../components/ProgressChart'
import { ResultView } from '../components/ResultView'
import { StatusBadge } from '../components/StatusBadge'
import { PlanPanel } from '../components/PlanPanel'
import { ThinkingPanel } from '../components/ThinkingPanel'
import { ToolLog } from '../components/ToolLog'
import { CubeView } from '../cube/CubeView'
import { FaceLegend } from '../cube/FaceLegend'
import { ViewPresets } from '../cube/ViewPresets'
import type { ViewRequest } from '../cube/viewControls'
import { derivePhase } from '../hooks/liveReducer'
import { useRunEvents } from '../hooks/useRunEvents'
import type { LiveState } from '../hooks/liveReducer'
import { describeError } from '../lib/errors'
import {
  formatDuration,
  formatPercent,
  formatTokens,
  shortId,
} from '../lib/format'
import { Alert } from '../ui/Alert'
import { AnimatedNumber } from '../ui/AnimatedNumber'
import { Button } from '../ui/Button'
import { PageHeader } from '../ui/PageHeader'
import { PageSkeleton } from '../ui/PageSkeleton'
import { Select } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { toastError } from '../ui/toastError'

function useElapsed(startedAt: string | null): number | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return startedAt ? now - new Date(startedAt).getTime() : null
}

export function RunLivePanel({
  live,
  run,
  benchmark,
  provider,
  onCancel,
  cancelling,
  showCancel = true,
}: {
  live: LiveState
  run: Run
  benchmark: BenchmarkDetail | null
  provider: Provider | null
  onCancel: () => void
  cancelling: boolean
  showCancel?: boolean
}) {
  const episode = live.currentEpisode
  const elapsed = useElapsed(run.started_at)
  // spec §1：ThinkingPanel 跨 turn 不卸载（折叠态由组件自持、turn 切换不清）。
  // once-seen 锁存：首个思考文本到达后保持挂载，turn 结束清空文本时面板转入
  // 空态（ThinkingPanel 对空 text 只留 summary），模型消息归档行为不变。
  const thinkingSeen = useRef(false)
  if (live.thinkingText) thinkingSeen.current = true
  const tokens =
    live.usage.prompt_tokens + live.usage.completion_tokens
  const totalTasks = benchmark?.tasks.length ?? null
  const completed = live.episodes.filter(
    (item) => item.status !== 'running',
  ).length
  const solved = live.episodes.filter((item) => item.solved).length
  const rate = totalTasks ? solved / totalTasks : null
  return (
    <aside className="inspector">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] text-text-faint">解出率</div>
          <div className="font-mono text-[28px] leading-tight font-semibold tracking-tight">
            {formatPercent(rate)}
          </div>
        </div>
        <StatusBadge status={episode?.status ?? run.status} />
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: rate == null ? '0%' : `${rate * 100}%` }}
        />
      </div>

      <dl className="insp-kv mt-3">
        <div>
          <dt>provider</dt>
          <dd>
            {provider
              ? `${provider.name} / ${provider.model}`
              : run.provider_id}
          </dd>
        </div>
        <div>
          <dt>题集</dt>
          <dd>{benchmark?.name ?? run.benchmark_id}</dd>
        </div>
        <div>
          <dt>进度</dt>
          <dd>
            <AnimatedNumber value={completed} />
            {`/${totalTasks ?? '?'}`}
          </dd>
        </div>
        <div>
          <dt>当前题</dt>
          <dd>{episode?.task_key ?? '—'}</dd>
        </div>
        <div data-testid="stat-moves">
          <dt>步数</dt>
          <dd>
            {episode ? (
              <>
                <AnimatedNumber value={episode.moves_used} />
                {`/${run.budget.max_moves}`}
              </>
            ) : (
              '—'
            )}
          </dd>
        </div>
        <div>
          <dt>参照长度</dt>
          <dd>{String(episode?.reference_length ?? '—')}</dd>
        </div>
        <div>
          <dt>计时</dt>
          <dd>{formatDuration(elapsed)}</dd>
        </div>
        <div>
          <dt>tokens</dt>
          <dd>
            <AnimatedNumber value={tokens} format={formatTokens} />
          </dd>
        </div>
      </dl>

      <div className="sect mt-2">
        <PhaseStepper phase={derivePhase(live)} />
      </div>

      {live.plan && (
        <div className="sect">
          <PlanPanel plan={live.plan} />
        </div>
      )}

      {live.thinking && !live.thinkingText && !thinkingSeen.current && (
        <p data-testid="thinking" className="sect text-xs text-info">
          思考中…
        </p>
      )}
      {thinkingSeen.current && <ThinkingPanel text={live.thinkingText} />}

      {live.firstInvalidCall && (
        <p className="sect text-xs text-warning">
          首次非法调用：{live.firstInvalidCall.tool} ·{' '}
          {live.firstInvalidCall.message}
        </p>
      )}
      {live.error && <p className="sect text-xs text-danger">{live.error}</p>}

      <div className="sect">
        <div className="mb-1 text-xs text-text-dim">进度曲线</div>
        <ProgressChart
          points={live.progress}
          maxMoves={run.budget.max_moves}
        />
      </div>

      <details className="sect" open>
        <summary>工具日志</summary>
        <ToolLog logs={live.logs} />
      </details>

      {showCancel &&
        (run.status === 'queued' || run.status === 'running') && (
          <div className="mt-3">
            <Button
              variant="danger"
              type="button"
              onClick={onCancel}
              disabled={cancelling}
            >
              取消 run
            </Button>
          </div>
        )}
    </aside>
  )
}

export default function RunPage() {
  const { id } = useParams()
  const queryClient = useQueryClient()
  const toast = useToast()
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
      toast.success('已取消')
      void queryClient.invalidateQueries({ queryKey: qk.run(id!) })
    },
    // spec §8：409（已结束/不可取消）时刷新状态，别让界面停在旧的“运行中”。
    onError: (err) => {
      toastError(toast, err)
      void queryClient.invalidateQueries({ queryKey: qk.run(id!) })
      void queryClient.invalidateQueries({ queryKey: qk.runs })
    },
  })
  const [speed, setSpeed] = useState(1)
  const [viewRequest, setViewRequest] = useState<ViewRequest | null>(null)
  const [paused, setPaused] = useState(false)
  const [skipToken, setSkipToken] = useState(0)
  const [cubeReset, setCubeReset] = useState<{
    state: CubeState | null
    token: number
  }>({ state: null, token: 0 })
  const snapshotApplied = useRef(0)
  const episodeApplied = useRef(0)

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

  // 切题时按题初始局面复位；episodeApplied 防题集后到重复吸附，
  // latestBatch 存在时说明新题已经开播，不能再拉回起点。
  useEffect(() => {
    if (live.episodeToken === 0) return
    if (episodeApplied.current === live.episodeToken) return
    const task = benchmark.data?.tasks.find(
      (item) => item.id === live.currentEpisode?.task_key,
    )
    if (!task || live.latestBatch) return
    episodeApplied.current = live.episodeToken
    setCubeReset((current) => ({
      state: task.state,
      token: current.token + 1,
    }))
  }, [
    live.episodeToken,
    live.currentEpisode?.task_key,
    live.latestBatch,
    benchmark.data,
  ])

  if (!id) return null
  if (runQuery.isPending) {
    return <PageSkeleton variant="form" fields={4} />
  }
  if (runQuery.error) {
    return <Alert tone="danger">{describeError(runQuery.error)}</Alert>
  }
  if (!run) {
    return <p className="text-sm text-text-dim">run 不存在。</p>
  }
  const provider =
    providers.data?.find((item) => item.id === run.provider_id) ?? null
  const liveNow = run.status === 'queued' || run.status === 'running'
  const resultError = report.error
    ? describeError(report.error)
    : run.status === 'failed'
      ? (run.error ?? '运行失败')
      : run.status === 'interrupted'
        ? '服务重启导致运行中断，以下为已完成部分。'
        : null

  return (
    <div className="space-y-5">
      <PageHeader
        title={provider?.name ?? `Run ${shortId(run.id)}`}
        subtitle={benchmark.data?.name ?? run.benchmark_id}
        actions={
          <>
            {liveNow && (
              <Button
                variant="danger"
                type="button"
                onClick={() => cancel.mutate()}
                disabled={cancel.isPending}
              >
                取消 run
              </Button>
            )}
            <span data-testid="run-status">
              <StatusBadge status={run.status} />
            </span>
          </>
        }
      />
      <nav
        aria-label="面包屑"
        className="-mt-2 flex items-center gap-1.5 text-xs text-text-dim"
      >
        <Link className="hover:text-text" to="/runs">
          Runs
        </Link>
        <span>/</span>
        <span className="font-mono text-text">
          {shortId(run.id)}
        </span>
      </nav>

      {cancel.error && <Alert>{describeError(cancel.error)}</Alert>}

      {live.connection === 'reconnecting' && (
        <div
          data-testid="connection-banner"
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-[7px] border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-amber-200"
        >
          <span>连接中断，正在重连…</span>
          <Button
            variant="warning"
            size="sm"
            type="button"
            data-testid="retry-connection"
            onClick={() => live.retry()}
          >
            立即重试
          </Button>
        </div>
      )}

      <div className="live-shell">
        <div className={finished ? '' : 'live-grid'}>
          <div className="live-stage">
            <div className="absolute inset-x-4 top-3.5 z-10 flex items-center gap-2.5 text-xs text-text-faint">
              <span className="font-mono">{run.tool_mode}</span>
              {live.currentEpisode && (
                <>
                  <span>·</span>
                  <span className="font-mono text-text-dim">
                    {live.currentEpisode.task_key}
                  </span>
                </>
              )}
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center px-6 pt-12 pb-2">
              <CubeView
                state={cubeReset.state}
                resetToken={cubeReset.token}
                batch={live.latestBatch}
                speed={speed}
                paused={paused}
                skipToken={skipToken}
                viewRequest={viewRequest ?? undefined}
                idleSpin={liveNow}
              />
            </div>
            <div className="border-t border-line-soft px-4 py-2.5">
              <FaceLegend />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Select
                  aria-label="速度"
                  className="h-7 w-[84px] text-xs"
                  value={speed}
                  onChange={(event) => setSpeed(Number(event.target.value))}
                >
                  <option value={0.5}>0.5×</option>
                  <option value={1}>1×</option>
                  <option value={2}>2×</option>
                  <option value={100}>instant</option>
                </Select>
                <button
                  type="button"
                  className="pill"
                  data-on={paused}
                  onClick={() => setPaused((current) => !current)}
                >
                  {paused ? '继续' : '暂停'}
                </button>
                <button
                  type="button"
                  className="pill"
                  onClick={() => setSkipToken((current) => current + 1)}
                >
                  跳到最新
                </button>
                <div className="ml-auto">
                  <ViewPresets
                    onRequest={(preset) =>
                      setViewRequest((current) => ({
                        preset,
                        token: (current?.token ?? 0) + 1,
                      }))
                    }
                  />
                </div>
              </div>
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
              showCancel={false}
            />
          )}
        </div>
      </div>

      {finished && (
        <ResultView
          report={report.data ?? null}
          run={run}
          provider={provider}
          benchmark={benchmark.data ?? null}
          error={resultError}
        />
      )}
    </div>
  )
}
