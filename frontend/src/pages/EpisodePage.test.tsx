import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  BenchmarkDetail,
  CubeState,
  Episode,
  Run,
  Step,
} from '../api/types'
import EpisodePage, { EpisodeView } from './EpisodePage'

// 页面模块静态导入 CubeView → three；用例不渲染 3D，mock 掉避免把 three 带进 jsdom。
vi.mock('../cube/CubeView', () => ({
  CubeView: (props: {
    state: CubeState | null
    resetToken: number
    batch: { moves: string[] } | null
  }) => (
    <div
      data-testid="cube-stub"
      data-cube={props.state?.cube ?? 'none'}
      data-token={props.resetToken}
      data-moves={props.batch?.moves.join(',') ?? ''}
    />
  ),
}))

const state: CubeState = {
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

const episode: Episode = {
  id: 'e1',
  run_id: 'r1',
  task_id: 'b1:t1',
  task_key: 't1',
  status: 'solved',
  solved: true,
  moves_used: 1,
  reference_length: 1,
  efficiency: 1,
  progress_ratio: 1,
  protocol_errors: 0,
  tokens_in: 10,
  tokens_out: 5,
  latency_ms: 1000,
  failure_code: null,
  error: null,
  started_at: '2026-10-26T00:00:00+00:00',
  finished_at: '2026-10-26T00:00:01+00:00',
}

const steps: Step[] = [
  {
    id: 's1',
    seq: 0,
    kind: 'model_message',
    tool_name: null,
    arguments: { tool_calls: ['apply_moves'] },
    result: { content: 'solving' },
    state,
    reference_length_after: 1,
  },
  {
    id: 's2',
    seq: 1,
    kind: 'tool_result',
    tool_name: 'apply_moves',
    arguments: { moves: ["R'"] },
    result: { applied: ["R'"], state },
    state,
    reference_length_after: 0,
  },
]

const run: Run = {
  id: 'r1',
  provider_id: 'p1',
  benchmark_id: 'b1',
  tool_mode: 'both',
  prompt_version: 'v1',
  status: 'finished',
  totals: null,
  error: null,
  created_at: '2026-10-26T00:00:00+00:00',
  started_at: '2026-10-26T00:00:00+00:00',
  finished_at: '2026-10-26T00:00:01+00:00',
  budget: {
    max_moves: 30,
    max_tool_calls: 50,
    max_tokens: 300000,
    max_seconds: 300,
    turn_timeout: 120,
  },
}

const benchmark: BenchmarkDetail = {
  id: 'b1',
  name: 'demo',
  version: 'v1',
  kind: 'frozen',
  cube: '2x2',
  content_hash: 'hash',
  frozen_at: '2026-10-26T00:00:00+00:00',
  task_count: 1,
  tasks: [
    {
      id: 't1',
      cube: '2x2',
      scramble: ["R'"],
      scramble_depth: 1,
      state,
      reference_length: 1,
      reference_kind: 'exact',
      bin: '1',
    },
  ],
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    statusText: status < 400 ? 'OK' : 'Error',
    json: async () => body,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderEpisodePage(id: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/episodes/${id}`]}>
        <Routes>
          <Route path="/episodes/:id" element={<EpisodePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('EpisodeView', () => {
  it('lists steps, selects one and plays its moves', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onPlayBatch = vi.fn()
    render(
      <MemoryRouter>
        <EpisodeView
          episode={episode}
          steps={steps}
          selected={1}
          onSelect={onSelect}
          onPlayBatch={onPlayBatch}
          cube={<div data-testid="cube-stub" />}
        />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('cube-stub')).toBeInTheDocument()
    expect(screen.getAllByTestId('step-row')).toHaveLength(2)
    expect(screen.getAllByTestId('step-row')[0]).toHaveTextContent(
      'model_message',
    )
    await user.click(screen.getAllByTestId('step-row')[1])
    expect(onSelect).toHaveBeenCalledWith(1)
    await user.click(
      screen.getByRole('button', { name: '播放本步' }),
    )
    expect(onPlayBatch).toHaveBeenCalledWith(1, ["R'"], state)
  })
})

describe('EpisodePage', () => {
  it("plays a step's moves from its previous state", async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (input === '/api/episodes/e1') return jsonResponse(episode)
        if (input === '/api/episodes/e1/steps') return jsonResponse(steps)
        if (input === '/api/runs/r1') {
          return jsonResponse({ run, episodes: [episode] })
        }
        if (input === '/api/benchmarks/b1') return jsonResponse(benchmark)
        return jsonResponse({ detail: 'not found' }, 404)
      }),
    )
    renderEpisodePage('e1')
    const rows = await screen.findAllByTestId('step-row')
    await user.click(rows[1])
    const before = Number(
      screen.getByTestId('cube-stub').getAttribute('data-token'),
    )
    await user.click(
      screen.getByRole('button', { name: '播放本步' }),
    )
    const cube = screen.getByTestId('cube-stub')
    expect(cube).toHaveAttribute('data-moves', "R'")
    expect(
      Number(cube.getAttribute('data-token')),
    ).toBe(before + 1)
  })

  it('shows the API error instead of loading forever', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ detail: 'episode not found' }, 404),
      ),
    )
    renderEpisodePage('missing')
    expect(await screen.findByText(/未找到该记录/)).toBeInTheDocument()
  })
})
