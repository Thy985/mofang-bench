import {
  act,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Playback } from '../hooks/usePlayback'
import type {
  BenchmarkDetail,
  CubeState,
  Episode,
  Run,
  Step,
} from '../api/types'
import EpisodePage, { EpisodeView, planFromSteps } from './EpisodePage'

// 页面模块静态导入 CubeView → three；用例不渲染 3D，mock 掉避免把 three 带进 jsdom。
// stub 同时模拟真实内核的 instant 分支（速度 ≥100 瞬间消费批次并回调 onBatchComplete），
// 用于覆盖「instant 连播不卡死」的跨层链路（终审 I-1）。
vi.mock('../cube/CubeView', async () => {
  const { useEffect } = await import('react')
  return {
    CubeView: (props: {
      state: CubeState | null
      resetToken: number
      batch: { moves: string[] } | null
      speed: number
      onBatchComplete?: () => void
    }) => {
      useEffect(() => {
        if (props.speed >= 100 && props.batch && props.onBatchComplete) {
          props.onBatchComplete()
        }
      }, [props.batch, props.speed, props.onBatchComplete])
      return (
        <div
          data-testid="cube-stub"
          data-cube={props.state?.cube ?? 'none'}
          data-token={props.resetToken}
          data-moves={props.batch?.moves.join(',') ?? ''}
        />
      )
    },
  }
})

function playbackStub(overrides: Partial<Playback> = {}): Playback {
  return {
    active: 1,
    playing: false,
    speed: 1,
    viewState: null,
    batch: null,
    resetToken: 1,
    select: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    stepPrev: vi.fn(),
    stepNext: vi.fn(),
    setSpeed: vi.fn(),
    handleBatchComplete: vi.fn(),
    ...overrides,
  }
}

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
  it('lists steps, syncs chip clicks and shows the player bar', async () => {
    const user = userEvent.setup()
    const playback = playbackStub()
    render(
      <MemoryRouter>
        <EpisodeView
          episode={episode}
          steps={steps}
          playback={playback}
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
    expect(playback.select).toHaveBeenCalledWith(1)
    expect(
      screen.getByRole('button', { name: '播放' }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('playback-position')).toHaveTextContent(
      '#1 tool_result',
    )
  })
})

describe('EpisodePage', () => {
  it('播放器从选中步起播（吸附起点后播放本步走法）', async () => {
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
    await user.click(screen.getByRole('button', { name: '播放' }))
    const cube = screen.getByTestId('cube-stub')
    expect(cube).toHaveAttribute('data-moves', "R'")
    expect(Number(cube.getAttribute('data-token'))).toBe(before + 1)
  })

  it('instant 速度下连播不卡死：批次被瞬间消费后回调推进，到末步停', async () => {
    const user = userEvent.setup()
    // 两步各有走法（中间夹一个无走法思考步）：instant 速度下每批消费完
    // 必须回调 onBatchComplete 推进，否则连播永卡第一步（终审 I-1）。
    const multiSteps: Step[] = [
      steps[0],
      steps[1],
      {
        ...steps[1],
        id: 's3',
        seq: 2,
        arguments: { moves: ['U'] },
        result: { applied: ['U'], state },
      },
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (input === '/api/episodes/e1') return jsonResponse(episode)
        if (input === '/api/episodes/e1/steps')
          return jsonResponse(multiSteps)
        if (input === '/api/runs/r1') {
          return jsonResponse({ run, episodes: [episode] })
        }
        if (input === '/api/benchmarks/b1') return jsonResponse(benchmark)
        return jsonResponse({ detail: 'not found' }, 404)
      }),
    )
    renderEpisodePage('e1')
    await screen.findAllByTestId('step-row')
    await user.selectOptions(screen.getByLabelText('播放速度'), '100')
    await user.click(screen.getByRole('button', { name: '播放' }))
    // 连播推进：跳过无走法步，直达末个有走法步
    await waitFor(() =>
      expect(screen.getByTestId('playback-position')).toHaveTextContent(
        '#2 tool_result',
      ),
    )
    // 末步批次播完即停：playing=false（按钮回「播放」）、批次清空
    await waitFor(() =>
      expect(screen.getByTestId('cube-stub')).toHaveAttribute(
        'data-moves',
        '',
      ),
    )
    expect(screen.getByRole('button', { name: '播放' })).toBeInTheDocument()
  })

  it('键盘 ←/→ 步进吸附', async () => {
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
    await screen.findAllByTestId('step-row')
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight' }),
      )
    })
    expect(screen.getByTestId('playback-position')).toHaveTextContent(
      '#0 model_message',
    )
  })

  it('model_message 步骤展示思考块', async () => {
    const user = userEvent.setup()
    const stepsWithThinking: Step[] = [
      {
        ...steps[0],
        result: { content: 'solving', thinking: '回放思考文本' },
      },
      steps[1],
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (input === '/api/episodes/e1') return jsonResponse(episode)
        if (input === '/api/episodes/e1/steps')
          return jsonResponse(stepsWithThinking)
        if (input === '/api/runs/r1') {
          return jsonResponse({ run, episodes: [episode] })
        }
        if (input === '/api/benchmarks/b1') return jsonResponse(benchmark)
        return jsonResponse({ detail: 'not found' }, 404)
      }),
    )
    renderEpisodePage('e1')
    const rows = await screen.findAllByTestId('step-row')
    await user.click(rows[0])
    expect(screen.getByTestId('step-thinking')).toHaveTextContent(
      '回放思考文本',
    )
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


describe('planFromSteps', () => {
  const planStep: Step = {
    id: 's2',
    seq: 2,
    kind: 'tool',
    tool_name: 'submit_plan',
    arguments: { goal: '还原魔方', phases: [{ name: '第一步' }] },
    result: { ok: true },
    state: null,
    reference_length_after: null,
  }

  it('取最后一次 submit_plan 的参数作为计划', () => {
    const steps: Step[] = [
      {
        id: 's1', seq: 1, kind: 'model', tool_name: null,
        arguments: null, result: {}, state: null,
        reference_length_after: null,
      },
      planStep,
      {
        id: 's3', seq: 3, kind: 'tool', tool_name: 'apply_moves',
        arguments: { moves: ["R'"] }, result: {}, state: null,
        reference_length_after: null,
      },
    ]
    expect(planFromSteps(steps)).toEqual({
      goal: '还原魔方',
      phases: [{ name: '第一步' }],
    })
  })

  it('没有计划时返回 null；畸形参数也返回 null', () => {
    expect(planFromSteps([])).toBeNull()
    expect(
      planFromSteps([
        { ...planStep, arguments: { phases: [] } },
      ]),
    ).toBeNull()
  })
})
