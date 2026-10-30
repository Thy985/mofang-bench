import { describe, expect, it } from 'vitest'
import type { AggregateReport, CubeState, RunEvent } from '../api/types'
import { makeEpisode, makeRun } from '../test/fixtures'
import {
  initialLiveState,
  liveReducer,
  type LiveAction,
} from './liveReducer'

function event<T extends RunEvent['type']>(
  type: T,
  data: unknown,
  id = 1,
  episodeId: string | null = 'e1',
): RunEvent {
  return {
    id,
    type,
    run_id: 'r1',
    episode_id: episodeId,
    ts: '2026-10-26T00:00:03+00:00',
    data,
  } as RunEvent
}

function apply(state = initialLiveState(), action: LiveAction) {
  return liveReducer(state, action)
}

describe('liveReducer', () => {
  it('applies a snapshot and resets live data', () => {
    const run = makeRun()
    const episode = makeEpisode()
    const state = apply(initialLiveState(), {
      type: 'snapshot',
      run,
      episodes: [episode],
      lastEventId: 3,
      snapshotState: null,
      reset: true,
    })
    expect(state.run?.id).toBe('r1')
    expect(state.currentEpisode?.id).toBe('e1')
    expect(state.lastEventId).toBe(3)
    expect(state.progress).toEqual([{ moves: 0, length: 1 }])
    expect(state.snapshotToken).toBe(1)
  })

  it('tracks episode, usage, logs, progress and first invalid call', () => {
    let state = apply(initialLiveState(), {
      type: 'snapshot',
      run: makeRun(),
      episodes: [],
      lastEventId: 0,
      snapshotState: null,
      reset: true,
    })
    state = apply(state, {
      type: 'event',
      event: event(
        'episode.started',
        { task_id: 'b1:t1', reference_length: 1 },
        1,
      ),
    })
    expect(state.currentEpisode?.task_key).toBe('t1')
    expect(state.episodeToken).toBe(1)
    state = apply(state, {
      type: 'event',
      event: event(
        'model.message',
        {
          content: 'thinking',
          tool_calls: 1,
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        },
        2,
      ),
    })
    expect(state.logs.at(-1)?.text).toBe('thinking')
    expect(state.usage).toEqual({
      prompt_tokens: 10,
      completion_tokens: 5,
    })
    state = apply(state, {
      type: 'event',
      event: event(
        'tool.result',
        {
          call_id: 'c1',
          tool: 'turn',
          ok: false,
          payload: { error: 'invalid_face' },
        },
        3,
      ),
    })
    expect(state.firstInvalidCall).toEqual({
      tool: 'turn',
      message: 'invalid_face',
    })
    state = apply(state, {
      type: 'event',
      event: event(
        'move.applied',
        {
          moves: ["R'"],
          state: {
            cube: '2x2',
            faces: {
              U: [['white', 'white'], ['white', 'white']],
              R: [['red', 'red'], ['red', 'red']],
              F: [['green', 'green'], ['green', 'green']],
              D: [['yellow', 'yellow'], ['yellow', 'yellow']],
              L: [['orange', 'orange'], ['orange', 'orange']],
              B: [['blue', 'blue'], ['blue', 'blue']],
            },
          },
          moves_used: 1,
          solved: true,
          reference_length_after: 0,
        },
        4,
      ),
    })
    expect(state.latestBatch?.moves).toEqual(["R'"])
    expect(state.progress.at(-1)).toEqual({ moves: 1, length: 0 })
    expect(state.currentEpisode?.solved).toBe(true)
    expect(state.currentEpisode?.moves_used).toBe(1)
  })

  it('deduplicates event ids and closes on run.finished', () => {
    let state = apply(initialLiveState(), {
      type: 'snapshot',
      run: makeRun(),
      episodes: [],
      lastEventId: 1,
      snapshotState: null,
      reset: true,
    })
    const duplicate = event(
      'model.message',
      {
        content: 'old',
        tool_calls: 0,
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
      1,
    )
    state = apply(state, { type: 'event', event: duplicate })
    expect(state.logs).toHaveLength(0)
    state = apply(state, {
      type: 'event',
      event: event(
        'run.finished',
        { status: 'finished', totals: null },
        2,
        null,
      ),
    })
    expect(state.run?.status).toBe('finished')
    expect(state.connection).toBe('closed')
  })

  it('resets per-episode data on a new episode', () => {
    let state = apply(initialLiveState(), {
      type: 'snapshot',
      run: makeRun(),
      episodes: [makeEpisode()],
      lastEventId: 1,
      snapshotState: null,
      reset: true,
    })
    state = apply(state, {
      type: 'event',
      event: event(
        'model.message',
        {
          content: 'first',
          tool_calls: 0,
          usage: { prompt_tokens: 2, completion_tokens: 3 },
        },
        2,
      ),
    })
    state = apply(state, {
      type: 'event',
      event: event(
        'episode.started',
        { task_id: 'b1:t2', reference_length: 2 },
        3,
        'e2',
      ),
    })
    expect(state.currentEpisode?.id).toBe('e2')
    expect(state.logs).toHaveLength(0)
    expect(state.usage).toEqual({
      prompt_tokens: 0,
      completion_tokens: 0,
    })
    expect(state.progress).toEqual([{ moves: 0, length: 2 }])
    expect(state.episodeToken).toBe(1)
  })

  it('keeps live data on a reconnect snapshot', () => {
    let state = apply(initialLiveState(), {
      type: 'snapshot',
      run: makeRun(),
      episodes: [],
      lastEventId: 0,
      snapshotState: null,
      reset: true,
    })
    state = apply(state, {
      type: 'event',
      event: event(
        'model.message',
        {
          content: 'kept',
          tool_calls: 0,
          usage: { prompt_tokens: 5, completion_tokens: 6 },
        },
        1,
      ),
    })
    const token = state.snapshotToken
    const snapshotState: CubeState = {
      cube: '2x2',
      faces: {
        U: [['white', 'white'], ['white', 'white']],
        R: [['red', 'red'], ['red', 'red']],
        F: [['green', 'green'], ['green', 'green']],
        D: [['yellow', 'yellow'], ['yellow', 'yellow']],
        L: [['orange', 'orange'], ['orange', 'orange']],
        B: [['blue', 'blue'], ['blue', 'blue']],
      },
    }
    state = apply(state, {
      type: 'snapshot',
      run: makeRun(),
      episodes: [makeEpisode({ id: 'e2', task_key: 't2' })],
      lastEventId: 1,
      snapshotState,
      reset: false,
    })
    expect(state.logs).toHaveLength(1)
    expect(state.usage).toEqual({
      prompt_tokens: 5,
      completion_tokens: 6,
    })
    expect(state.snapshotToken).toBe(token + 1)
    expect(state.snapshotState).toEqual(snapshotState)
    expect(state.currentEpisode?.id).toBe('e2')
  })

  it('merges finish totals and marks run.error as failed', () => {
    const totals: AggregateReport = {
      benchmark_id: 'b1',
      benchmark_hash: 'h1',
      benchmark_total_tasks: 1,
      partial: false,
      totals: { tasks: 1, solved: 1, solve_rate: 1, ci95: [1, 1] },
      by_bin: {},
      episodes: [],
    }
    let state = apply(initialLiveState(), {
      type: 'snapshot',
      run: makeRun(),
      episodes: [],
      lastEventId: 0,
      snapshotState: null,
      reset: true,
    })
    state = apply(state, {
      type: 'event',
      event: event('run.finished', { status: 'finished', totals }, 1, null),
    })
    expect(state.run?.status).toBe('finished')
    expect(state.run?.totals?.totals.solve_rate).toBe(1)
    expect(state.connection).toBe('closed')

    state = apply(initialLiveState(), {
      type: 'snapshot',
      run: makeRun(),
      episodes: [],
      lastEventId: 0,
      snapshotState: null,
      reset: true,
    })
    state = apply(state, {
      type: 'event',
      event: event('run.error', { message: 'boom' }, 1, null),
    })
    expect(state.run?.status).toBe('failed')
    expect(state.run?.error).toBe('boom')
    expect(state.error).toBe('boom')
    expect(state.connection).toBe('closed')
  })

  it('marks a queued run as running when run.started arrives', () => {
    let state = apply(initialLiveState(), {
      type: 'snapshot',
      run: makeRun({ status: 'queued', started_at: null }),
      episodes: [],
      lastEventId: 0,
      snapshotState: null,
      reset: true,
    })
    state = apply(state, {
      type: 'event',
      event: event('run.started', { benchmark_id: 'b1' }, 1, null),
    })
    expect(state.run?.status).toBe('running')
    expect(state.run?.started_at).toBe('2026-10-26T00:00:03+00:00')
    expect(state.run?.id).toBe('r1')
    expect(state.run?.benchmark_id).toBe('b1')
  })

  it('toggles thinking on model.turn.started and model.message', () => {
    let state = apply(stateAfterSnapshot(), {
      type: 'event',
      event: event('model.turn.started', { moves_used: 0 }, 1),
    })
    expect(state.thinking).toBe(true)
    state = apply(state, {
      type: 'event',
      event: event(
        'model.message',
        {
          content: 'thinking',
          tool_calls: 0,
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        },
        2,
      ),
    })
    expect(state.thinking).toBe(false)
  })

  it('thinking.delta 追加缓冲，model.message 归档全文并清空', () => {
    let state = apply(initialLiveState(), {
      type: 'connection',
      connection: 'open',
    })
    state = apply(state, {
      type: 'event',
      event: event('episode.started', {
        task_id: 'b:t1',
        reference_length: 4,
      }),
    })
    state = apply(state, {
      type: 'event',
      event: event('thinking.delta', { seq: 0, text: '先看 ' }, 2),
    })
    state = apply(state, {
      type: 'event',
      event: event('thinking.delta', { seq: 0, text: '白面' }, 3),
    })
    expect(state.thinkingText).toBe('先看 白面')
    state = apply(state, {
      type: 'event',
      event: event(
        'model.message',
        {
          content: '使用 apply_moves',
          thinking: '先看 白面，再转',
          tool_calls: 1,
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        },
        4,
      ),
    })
    expect(state.thinkingText).toBe('')
    expect(state.logs.at(-1)?.thinking).toBe('先看 白面，再转')
  })

  it('clears thinking on episode.finished', () => {
    let state = apply(stateAfterSnapshot(), {
      type: 'event',
      event: event('model.turn.started', { moves_used: 0 }, 1),
    })
    expect(state.thinking).toBe(true)
    state = apply(state, {
      type: 'event',
      event: event(
        'episode.finished',
        { task_id: 'b1:t1', status: 'solved', solved: true, moves_used: 1 },
        2,
      ),
    })
    expect(state.thinking).toBe(false)
  })

  it('clears thinking on run.finished and run.error', () => {
    let state = apply(stateAfterSnapshot(), {
      type: 'event',
      event: event('model.turn.started', { moves_used: 0 }, 1),
    })
    state = apply(state, {
      type: 'event',
      event: event('run.finished', { status: 'finished', totals: null }, 2, null),
    })
    expect(state.thinking).toBe(false)

    state = apply(stateAfterSnapshot(), {
      type: 'event',
      event: event('model.turn.started', { moves_used: 0 }, 1),
    })
    state = apply(state, {
      type: 'event',
      event: event('run.error', { message: 'boom' }, 2, null),
    })
    expect(state.thinking).toBe(false)
  })
})

function stateAfterSnapshot() {
  return apply(initialLiveState(), {
    type: 'snapshot',
    run: makeRun(),
    episodes: [],
    lastEventId: 0,
    snapshotState: null,
    reset: true,
  })
}
