import type {
  CubeState,
  Episode,
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
  latestBatch: MoveBatch | null
  firstInvalidCall: { tool: string; message: string } | null
  error: string | null
  snapshotState: CubeState | null
  snapshotToken: number
  episodeToken: number
}

export type LiveAction =
  | {
      type: 'snapshot'
      run: Run
      episodes: Episode[]
      lastEventId: number
      snapshotState: CubeState | null
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
    latestBatch: null,
    firstInvalidCall: null,
    error: null,
    snapshotState: null,
    snapshotToken: 0,
    episodeToken: 0,
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
        episodeToken: state.episodeToken + 1,
      }
    }
    case 'model.turn.started':
      return { ...next, thinking: true }
    case 'model.message': {
      const logs = event.data.content
        ? [
            ...state.logs,
            {
              id: event.id,
              kind: 'model' as const,
              text: event.data.content,
              data: event.data,
            },
          ]
        : state.logs
      return {
        ...next,
        logs,
        usage: event.data.usage,
        thinking: false,
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
