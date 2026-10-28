import { useEffect, useReducer, useRef } from 'react'
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

export function useRunEvents(runId: string): LiveState {
  const [state, dispatch] = useReducer(liveReducer, undefined, initialLiveState)
  const sourceRef = useRef<EventSource | null>(null)
  const retryRef = useRef(0)
  const lastEventIdRef = useRef(0)

  useEffect(() => {
    lastEventIdRef.current = state.lastEventId
  }, [state.lastEventId])

  useEffect(() => {
    // 每个 effect 实例独立的存活标记：runId 切换时旧 snapshot 的迟到响应必须作废。
    let alive = true
    let timer: number | undefined

    async function connect(initial: boolean) {
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
        reset: initial,
      })
      if (
        snapshot.run.status !== 'queued' &&
        snapshot.run.status !== 'running'
      ) {
        dispatch({ type: 'connection', connection: 'closed' })
        return
      }

      retryRef.current = 0
      const after = initial
        ? snapshot.last_event_id
        : Math.max(snapshot.last_event_id, lastEventIdRef.current)
      const source = new EventSource(api.runs.eventsUrl(runId, after))
      sourceRef.current?.close()
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

    void connect(true)
    return () => {
      alive = false
      if (timer !== undefined) window.clearTimeout(timer)
      sourceRef.current?.close()
    }
  }, [runId])

  return state
}
