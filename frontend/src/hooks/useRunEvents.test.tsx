import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import type { Snapshot } from '../api/types'
import { makeEpisode, makeRun } from '../test/fixtures'
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
    expect(source.closed).toBe(true)
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

  it('does not open a stream for a finished run', async () => {
    vi.spyOn(api.runs, 'snapshot').mockResolvedValue({
      ...snapshot,
      run: makeRun({ status: 'finished' }),
    })
    const { result } = renderHook(() => useRunEvents('r1'))
    await waitFor(() => expect(result.current.connection).toBe('closed'))
    expect(FakeEventSource.instances).toHaveLength(0)
  })

  it('retries a failed first snapshot with reset and its own cursor', async () => {
    const snapshotSpy = vi
      .spyOn(api.runs, 'snapshot')
      .mockResolvedValue(snapshot)
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useRunEvents(id),
      { initialProps: { id: 'r1' } },
    )
    await waitFor(() => expect(result.current.run?.id).toBe('r1'))
    act(() => {
      FakeEventSource.instances[0].emit('model.message', {
        id: 4,
        type: 'model.message',
        run_id: 'r1',
        episode_id: 'e1',
        ts: '2026-10-26T00:00:04+00:00',
        data: {
          content: 'old log',
          tool_calls: 0,
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        },
      })
    })
    await waitFor(() => expect(result.current.logs).toHaveLength(1))

    const retry: Snapshot = {
      run: makeRun({ id: 'r2' }),
      episodes: [makeEpisode({ id: 'e2', task_key: 't2' })],
      last_event_id: 1,
      current_state: null,
    }
    snapshotSpy.mockRejectedValueOnce(new Error('offline'))
    snapshotSpy.mockResolvedValueOnce(retry)
    rerender({ id: 'r2' })
    await waitFor(() => expect(result.current.run?.id).toBe('r2'), {
      timeout: 2500,
    })
    expect(result.current.logs).toHaveLength(0)
    expect(result.current.progress).toEqual([{ moves: 0, length: 1 }])
    expect(FakeEventSource.instances.at(-1)?.url).toBe(
      '/api/runs/r2/events?after=1',
    )
  })

  it('backs off stream failures and keeps live data on reconnect', async () => {
    const timeoutSpy = vi.spyOn(window, 'setTimeout')
    const { result } = renderHook(() => useRunEvents('r1'))
    await waitFor(() => expect(result.current.run?.id).toBe('r1'))
    act(() => {
      FakeEventSource.instances[0].emit('model.message', {
        id: 4,
        type: 'model.message',
        run_id: 'r1',
        episode_id: 'e1',
        ts: '2026-10-26T00:00:04+00:00',
        data: {
          content: 'kept',
          tool_calls: 0,
          usage: { prompt_tokens: 2, completion_tokens: 2 },
        },
      })
    })
    await waitFor(() => expect(result.current.logs).toHaveLength(1))
    act(() => {
      FakeEventSource.instances[0].onerror?.()
    })
    await waitFor(
      () => expect(FakeEventSource.instances).toHaveLength(2),
      { timeout: 2500 },
    )
    expect(result.current.logs).toHaveLength(1)
    expect(FakeEventSource.instances[1].url).toBe(
      '/api/runs/r1/events?after=4',
    )
    act(() => {
      FakeEventSource.instances[1].onerror?.()
    })
    const delays = timeoutSpy.mock.calls
      .map((call) => call[1])
      .filter((delay): delay is number => typeof delay === 'number')
    expect(delays).toContain(2000)
  })
})
