import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import type { Snapshot } from '../api/types'
import { makeRun } from '../test/fixtures'
import { useRunEvents } from './useRunEvents'

class FakeEventSource {
  static instances: FakeEventSource[] = []
  listeners = new Map<string, EventListener>()
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  url: string

  constructor(url: string) {
    // tsconfig 的 erasableSyntaxOnly 禁止构造函数参数属性，故显式声明字段。
    this.url = url
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: EventListener) {
    this.listeners.set(type, listener)
  }

  close() {
    this.closed = true
  }

  emit(type: string, data: unknown) {
    const event = {
      data: JSON.stringify(data),
    } as MessageEvent
    this.listeners.get(type)?.(event as Event)
  }
}

const snapshot: Snapshot = {
  run: makeRun(),
  episodes: [],
  last_event_id: 3,
  current_state: null,
}

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
  vi.spyOn(api.runs, 'snapshot').mockResolvedValue(snapshot)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('useRunEvents', () => {
  it('loads snapshot then applies SSE events', async () => {
    const { result } = renderHook(() => useRunEvents('r1'))
    await waitFor(() => expect(result.current.run?.id).toBe('r1'))
    expect(FakeEventSource.instances[0]?.url).toBe(
      '/api/runs/r1/events?after=3',
    )
    const source = FakeEventSource.instances[0]
    act(() => {
      source.onopen?.()
      source.emit('run.finished', {
        id: 4,
        type: 'run.finished',
        run_id: 'r1',
        episode_id: null,
        ts: '2026-10-26T00:00:04+00:00',
        data: { status: 'finished', totals: null },
      })
    })
    await waitFor(() =>
      expect(result.current.run?.status).toBe('finished'),
    )
    expect(result.current.connection).toBe('closed')
  })

  it('enters reconnecting on stream error', async () => {
    const { result } = renderHook(() => useRunEvents('r1'))
    await waitFor(() => expect(result.current.run?.id).toBe('r1'))
    act(() => {
      FakeEventSource.instances[0].onerror?.()
    })
    await waitFor(() =>
      expect(result.current.connection).toBe('reconnecting'),
    )
  })

  it('ignores a stale snapshot after the run changes', async () => {
    let resolveStale!: (value: Snapshot) => void
    const stale = new Promise<Snapshot>((resolve) => {
      resolveStale = resolve
    })
    const fresh: Snapshot = {
      run: makeRun({ id: 'r2' }),
      episodes: [],
      last_event_id: 0,
      current_state: null,
    }
    vi.spyOn(api.runs, 'snapshot').mockImplementation((id) =>
      id === 'r1' ? stale : Promise.resolve(fresh),
    )
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useRunEvents(id),
      { initialProps: { id: 'r1' } },
    )
    rerender({ id: 'r2' })
    await waitFor(() => expect(result.current.run?.id).toBe('r2'))
    await act(async () => {
      resolveStale(snapshot)
      await stale
    })
    expect(result.current.run?.id).toBe('r2')
  })
})
