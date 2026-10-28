import type { Episode, Run } from '../api/types'

export function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 'r1',
    provider_id: 'p1',
    benchmark_id: 'b1',
    tool_mode: 'both',
    prompt_version: 'v1',
    status: 'running',
    totals: null,
    error: null,
    created_at: '2026-10-26T00:00:00+00:00',
    started_at: '2026-10-26T00:00:01+00:00',
    finished_at: null,
    budget: {
      max_moves: 30,
      max_tool_calls: 50,
      max_tokens: 300000,
      max_seconds: 300,
      turn_timeout: 120,
    },
    ...overrides,
  }
}

export function makeEpisode(overrides: Partial<Episode> = {}): Episode {
  return {
    id: 'e1',
    run_id: 'r1',
    task_id: 'b1:t1',
    task_key: 't1',
    status: 'running',
    solved: false,
    moves_used: 0,
    reference_length: 1,
    efficiency: null,
    progress_ratio: null,
    protocol_errors: 0,
    tokens_in: 0,
    tokens_out: 0,
    latency_ms: null,
    failure_code: null,
    error: null,
    started_at: '2026-10-26T00:00:02+00:00',
    finished_at: null,
    ...overrides,
  }
}
