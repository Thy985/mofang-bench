import { useCallback, useEffect, useReducer, useRef } from 'react'
import { api } from '../api/client'
import type { RunEvent } from '../api/types'
import {
  initialLiveState,
  liveReducer,
  type LiveState,
} from './liveReducer'

const EVENT_TYPES: RunEvent['type'][] = [
  'run.started',
  'episode.started',
  'model.turn.started',
  'model.message',
  'tool.call',
  'tool.result',
  'move.applied',
  'episode.finished',
  'run.finished',
  'run.error',
]

export type RunEventsState = LiveState & { retry: () => void }

export function useRunEvents(runId: string): RunEventsState {
  const [state, dispatch] = useReducer(liveReducer, undefined, initialLiveState)
  const sourceRef = useRef<EventSource | null>(null)
  const retryRef = useRef(0)
  const lastEventIdRef = useRef(0)
  const connectRef = useRef<(initial: boolean) => void>(() => {})

  useEffect(() => {
    lastEventIdRef.current = state.lastEventId
  }, [state.lastEventId])

  // 手动重试只重建流，不清空已落地的日志与 usage（snapshotLanded 保持为 true）。
  const retry = useCallback(() => {
    retryRef.current = 0
    connectRef.current(false)
  }, [])

  useEffect(() => {
    // 每个 effect 实例独立的存活标记：runId 切换时旧 snapshot 的迟到响应必须作废。
    let alive = true
    // reset 只取决于“本 run 是否已有一份 snapshot 落地”，与第几次连接无关。
    let snapshotLanded = false
    let timer: number | undefined
    lastEventIdRef.current = 0
    retryRef.current = 0

    async function connect(initial: boolean) {
      // 重新连接前先清掉待执行的退避定时器，避免手动重试后又叠加一条自动重连。
      if (timer !== undefined) {
        window.clearTimeout(timer)
        timer = undefined
      }
      const previous = sourceRef.current
      if (previous) {
        previous.onerror = null
        previous.close()
        sourceRef.current = null
      }
      dispatch({
        type: 'connection',
        connection: initial ? 'connecting' : 'reconnecting',
      })
      let snapshot
      try {
        snapshot = await api.runs.snapshot(runId)
      } catch {
        if (!alive) return
        dispatch({ type: 'connection', connection: 'reconnecting' })
        const delay = Math.min(10_000, 1_000 * 2 ** retryRef.current++)
        timer = window.setTimeout(() => void connect(false), delay)
        return
      }
      if (!alive) return
      dispatch({
        type: 'snapshot',
        run: snapshot.run,
        episodes: snapshot.episodes,
        lastEventId: snapshot.last_event_id,
        snapshotState: snapshot.current_state,
        reset: !snapshotLanded,
      })
      snapshotLanded = true
      if (
        snapshot.run.status !== 'queued' &&
        snapshot.run.status !== 'running'
      ) {
        dispatch({ type: 'connection', connection: 'closed' })
        return
      }

      const after = Math.max(
        snapshot.last_event_id,
        lastEventIdRef.current,
      )
      const source = new EventSource(api.runs.eventsUrl(runId, after))
      sourceRef.current = source
      source.onopen = () => {
        retryRef.current = 0
        dispatch({ type: 'connection', connection: 'open' })
      }
      const handle = (raw: Event) => {
        const message = raw as MessageEvent
        let event: RunEvent
        try {
          event = JSON.parse(message.data) as RunEvent
        } catch {
          return
        }
        dispatch({ type: 'event', event })
        if (event.type === 'run.finished' || event.type === 'run.error') {
          source.close()
        }
      }
      for (const type of EVENT_TYPES) {
        source.addEventListener(type, handle)
      }
      source.onerror = () => {
        source.close()
        if (!alive) return
        dispatch({ type: 'connection', connection: 'reconnecting' })
        const delay = Math.min(10_000, 1_000 * 2 ** retryRef.current++)
        timer = window.setTimeout(() => void connect(false), delay)
      }
    }

    connectRef.current = connect
    void connect(true)
    return () => {
      alive = false
      connectRef.current = () => {}
      if (timer !== undefined) window.clearTimeout(timer)
      const source = sourceRef.current
      if (source) {
        source.onerror = null
        source.close()
        sourceRef.current = null
      }
    }
  }, [runId])

  return { ...state, retry }
}
