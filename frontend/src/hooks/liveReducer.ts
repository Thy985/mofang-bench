import type {
  CubeState,
  Episode,
  Plan,
  ProgressPoint,
  Run,
  RunEvent,
  Usage,
} from '../api/types'

export type ConnectionState =
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'closed'

export interface LiveLog {
  id: number
  kind: 'model' | 'tool'
  text: string
  data: unknown
  thinking?: string | null
}

export interface MoveBatch {
  eventId: number
  moves: string[]
  state: CubeState
}

export interface LiveState {
  run: Run | null
  episodes: Episode[]
  currentEpisode: Episode | null
  logs: LiveLog[]
  usage: Usage
  progress: ProgressPoint[]
  lastEventId: number
  connection: ConnectionState
  thinking: boolean
  thinkingText: string
  latestBatch: MoveBatch | null
  firstInvalidCall: { tool: string; message: string } | null
  error: string | null
  snapshotState: CubeState | null
  snapshotToken: number
  episodeToken: number
  // 当前 episode 的计划（submit_plan 提交）；每局重置
  plan: Plan | null
}

export type LiveAction =
  | {
      type: 'snapshot'
      run: Run
      episodes: Episode[]
      lastEventId: number
      snapshotState: CubeState | null
      // 重连恢复用；缺省时 reset 清空、非 reset 保留现值
      currentPlan?: Plan | null
      reset: boolean
    }
  | { type: 'event'; event: RunEvent }
  | { type: 'connection'; connection: ConnectionState }

export function initialLiveState(): LiveState {
  return {
    run: null,
    episodes: [],
    currentEpisode: null,
    logs: [],
    usage: { prompt_tokens: 0, completion_tokens: 0 },
    progress: [],
    lastEventId: 0,
    connection: 'connecting',
    thinking: false,
    thinkingText: '',
    latestBatch: null,
    firstInvalidCall: null,
    error: null,
    snapshotState: null,
    snapshotToken: 0,
    episodeToken: 0,
    plan: null,
  }
}

function episodeFromStarted(event: RunEvent): Episode {
  if (event.type !== 'episode.started') {
    throw new Error('not an episode.started event')
  }
  const taskId = event.data.task_id
  return {
    id: event.episode_id ?? `episode-${event.id}`,
    run_id: event.run_id,
    task_id: taskId,
    task_key: taskId.split(':').slice(-1)[0],
    status: 'running',
    solved: false,
    moves_used: 0,
    reference_length: event.data.reference_length,
    efficiency: null,
    progress_ratio: null,
    protocol_errors: 0,
    tokens_in: 0,
    tokens_out: 0,
    latency_ms: null,
    failure_code: null,
    error: null,
    plan: null,
    started_at: event.ts,
    finished_at: null,
  }
}

export function liveReducer(
  state: LiveState,
  action: LiveAction,
): LiveState {
  if (action.type === 'connection') {
    return { ...state, connection: action.connection }
  }
  if (action.type === 'snapshot') {
    const current = action.episodes.at(-1) ?? null
    return {
      ...state,
      run: action.run,
      episodes: action.episodes,
      currentEpisode: current,
      lastEventId: action.reset
        ? action.lastEventId
        : Math.max(state.lastEventId, action.lastEventId),
      snapshotState: action.snapshotState,
      snapshotToken: state.snapshotToken + 1,
      error: action.run.error,
      // 重连时用后端落库的计划恢复；首次落地以 snapshot 为准
      plan: action.currentPlan ?? (action.reset ? null : state.plan),
      connection:
        action.run.status === 'queued' || action.run.status === 'running'
          ? state.connection
          : 'closed',
      ...(action.reset
        ? {
            logs: [],
            usage: { prompt_tokens: 0, completion_tokens: 0 },
            progress: current
              ? [{ moves: current.moves_used, length: current.reference_length }]
              : [],
            latestBatch: null,
            firstInvalidCall: null,
            thinking: false,
            thinkingText: '',
          }
        : {}),
    }
  }

  const event = action.event
  if (event.id <= state.lastEventId) return state
  const next = { ...state, lastEventId: event.id }

  switch (event.type) {
    case 'run.started': {
      const startedAt = state.run?.started_at ?? event.ts
      return {
        ...next,
        run: state.run
          ? { ...state.run, status: 'running', started_at: startedAt }
          : state.run,
      }
    }
    case 'episode.started': {
      const episode = episodeFromStarted(event)
      const episodes = [
        ...state.episodes.filter((item) => item.id !== episode.id),
        episode,
      ]
      return {
        ...next,
        episodes,
        currentEpisode: episode,
        logs: [],
        usage: { prompt_tokens: 0, completion_tokens: 0 },
        progress: [{ moves: 0, length: episode.reference_length }],
        latestBatch: null,
        firstInvalidCall: null,
        thinking: false,
        thinkingText: '',
        episodeToken: state.episodeToken + 1,
        plan: null,
      }
    }
    case 'plan.updated':
      return { ...next, plan: event.data.plan }
    case 'model.turn.started':
      return { ...next, thinking: true, thinkingText: '' }
    case 'thinking.delta':
      return {
        ...next,
        thinkingText: state.thinkingText + event.data.text,
      }
    case 'model.message': {
      const entry = {
        id: event.id,
        kind: 'model' as const,
        text:
          event.data.content ??
          (event.data.tool_calls ? `tool_calls ×${event.data.tool_calls}` : ''),
        data: event.data,
        thinking: event.data.thinking ?? (state.thinkingText || null),
      }
      // 纯工具调用 turn 没有 content，但思考过程仍要进日志（E2E 硬断言依赖）。
      const logs =
        event.data.content || entry.thinking ? [...state.logs, entry] : state.logs
      return {
        ...next,
        logs,
        usage: event.data.usage,
        thinking: false,
        thinkingText: '',
      }
    }
    case 'tool.call': {
      return {
        ...next,
        logs: [
          ...state.logs,
          {
            id: event.id,
            kind: 'tool',
            text: `${event.data.tool} ${JSON.stringify(
              event.data.arguments ?? {},
            )}`,
            data: event.data,
          },
        ],
      }
    }
    case 'tool.result': {
      const ok = event.data.ok
      const message = String(event.data.payload.error ?? 'failed')
      return {
        ...next,
        logs: [
          ...state.logs,
          {
            id: event.id,
            kind: 'tool',
            text: `${event.data.tool} → ${ok ? 'ok' : message}`,
            data: event.data,
          },
        ],
        firstInvalidCall:
          !ok && !state.firstInvalidCall
            ? { tool: event.data.tool, message }
            : state.firstInvalidCall,
      }
    }
    case 'move.applied': {
      const current = state.currentEpisode
        ? {
            ...state.currentEpisode,
            moves_used: event.data.moves_used,
            solved: event.data.solved,
          }
        : null
      return {
        ...next,
        currentEpisode: current,
        episodes: current
          ? state.episodes.map((item) =>
              item.id === current.id ? current : item,
            )
          : state.episodes,
        progress: [
          ...state.progress,
          {
            moves: event.data.moves_used,
            length: event.data.reference_length_after,
          },
        ],
        latestBatch: {
          eventId: event.id,
          moves: event.data.moves,
          state: event.data.state,
        },
      }
    }
    case 'episode.finished': {
      const current = state.currentEpisode
        ? {
            ...state.currentEpisode,
            status: event.data.status,
            solved: event.data.solved,
            moves_used: event.data.moves_used,
          }
        : null
      return {
        ...next,
        currentEpisode: current,
        episodes: current
          ? state.episodes.map((item) =>
              item.id === current.id ? current : item,
            )
          : state.episodes,
        thinking: false,
      }
    }
    case 'run.finished':
      return {
        ...next,
        run: state.run
          ? {
              ...state.run,
              status: event.data.status,
              totals: event.data.totals,
            }
          : state.run,
        thinking: false,
        connection: 'closed',
      }
    case 'run.error':
      return {
        ...next,
        run: state.run
          ? { ...state.run, status: 'failed', error: event.data.message }
          : state.run,
        error: event.data.message,
        thinking: false,
        connection: 'closed',
      }
    default:
      return next
  }
}

export type Phase = 'queued' | 'thinking' | 'tooling' | 'done'

// 判定顺序有讲究：done 必须先于日志尾判断——题结束时最后一个事件是
// tool.result，若先看日志尾会把已完成的题显示成「工具」。
export function derivePhase(live: LiveState): Phase {
  if (!live.currentEpisode) return 'queued'
  if (live.currentEpisode.status !== 'running') return 'done'
  if (live.thinking) return 'thinking'
  const last = live.logs.at(-1)
  if (last && last.kind === 'tool') return 'tooling'
  return 'thinking'
}
