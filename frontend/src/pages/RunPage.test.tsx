import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  BenchmarkDetail,
  CubeState,
  Episode,
  Report,
  Run,
} from '../api/types'
import { initialLiveState, type LiveState } from '../hooks/liveReducer'
import RunPage, { RunLivePanel } from './RunPage'
import { ResultView } from '../components/ResultView'

vi.mock('../cube/CubeView', () => ({
  CubeView: (props: { state: CubeState | null; resetToken: number }) => (
    <div
      data-testid="cube-stub"
      data-cube={props.state?.cube ?? 'none'}
      data-token={props.resetToken}
    />
  ),
}))

const run: Run = {
  id: 'run12345678',
  provider_id: 'p1',
  benchmark_id: 'b1',
  tool_mode: 'both',
  prompt_version: 'v1',
  status: 'running',
  totals: null,
  error: null,
  created_at: '2026-10-26T00:00:00+00:00',
  started_at: new Date(Date.now() - 5000).toISOString(),
  finished_at: null,
  budget: {
    max_moves: 30,
    max_tool_calls: 50,
    max_tokens: 300000,
    max_seconds: 300,
    turn_timeout: 120,
  },
}

const episode: Episode = {
  id: 'e1',
  run_id: 'run12345678',
  task_id: 'b1:t1',
  task_key: 't1',
  status: 'running',
  solved: false,
  moves_used: 2,
  reference_length: 3,
  efficiency: null,
  progress_ratio: null,
  protocol_errors: 0,
  tokens_in: 10,
  tokens_out: 5,
  latency_ms: null,
  failure_code: null,
  error: null,
  started_at: '2026-10-26T00:00:00+00:00',
  finished_at: null,
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
      reference_length: 1,
      reference_kind: 'exact',
      bin: '1',
    },
  ],
}

const report: Report = {
  run_id: run.id,
  provider_id: run.provider_id,
  benchmark_id: run.benchmark_id,
  status: 'finished',
  started_at: run.started_at,
  finished_at: '2026-10-26T00:00:10+00:00',
  benchmark_hash: 'hash',
  benchmark_total_tasks: 1,
  partial: false,
  totals: {
    tasks: 1,
    solved: 1,
    solve_rate: 1,
    ci95: [0.2, 1],
  },
  by_bin: {
    '1': {
      total: 1,
      solved: 1,
      solve_rate: 1,
      ci95: [0.2, 1],
      mean_moves: 1,
    },
  },
  episodes: [
    {
      ...episode,
      status: 'solved',
      solved: true,
      moves_used: 1,
    },
  ],
}

function liveState(): LiveState {
  return {
    ...initialLiveState(),
    run,
    episodes: [episode],
    currentEpisode: episode,
    logs: [
      { id: 1, kind: 'model', text: 'thinking', data: {} },
      { id: 2, kind: 'tool', text: "apply_moves {\"moves\":[\"R'\"]}", data: {} },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
    progress: [
      { moves: 0, length: 3 },
      { moves: 2, length: 1 },
    ],
    lastEventId: 2,
    connection: 'open',
  }
}

describe('RunLivePanel', () => {
  it('shows stats, progress and logs', () => {
    render(
      <RunLivePanel
        live={liveState()}
        run={run}
        benchmark={benchmark}
        provider={{
          id: 'p1',
          name: 'local',
          base_url: 'http://localhost/v1',
          model: 'm',
          api_key_ref: 'KEY',
          params: {},
          key_configured: true,
          created_at: '2026-10-26T00:00:00+00:00',
        }}
        onCancel={vi.fn()}
        cancelling={false}
      />,
    )
    expect(screen.getByText('local / m')).toBeInTheDocument()
    expect(screen.getByText('2/30')).toBeInTheDocument()
    expect(screen.getByTestId('progress-path')).toHaveAttribute(
      'd',
      expect.stringContaining('M'),
    )
    expect(screen.getByTestId('tool-log')).toHaveTextContent('thinking')
    expect(screen.getByTestId('tool-log')).toHaveTextContent('apply_moves')
  })
})

describe('ResultView', () => {
  it('renders totals, rows and export links', () => {
    render(
      <MemoryRouter>
        <ResultView
          report={report}
          run={{ ...run, status: 'finished' }}
          provider={null}
          benchmark={benchmark}
        />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('run-result')).toHaveTextContent('1 / 1')
    expect(screen.getByTestId('run-result')).toHaveTextContent('部分结果')
    expect(screen.getAllByTestId('episode-replay-link')[0]).toHaveAttribute(
      'href',
      '/episodes/e1',
    )
    expect(screen.getByTestId('export-csv')).toHaveAttribute(
      'href',
      '/api/runs/run12345678/export?format=csv',
    )
    expect(screen.getByTestId('export-json')).toHaveAttribute(
      'href',
      '/api/runs/run12345678/report',
    )
    expect(screen.getByTestId('export-md')).toHaveAttribute(
      'href',
      '/api/runs/run12345678/export?format=md',
    )
    expect(screen.getByTestId('run-result')).toHaveTextContent('100.0%')
  })
})

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    statusText: status < 400 ? 'OK' : 'Error',
    json: async () => body,
  }
}

class FakeEventSource {
  static instances: FakeEventSource[] = []
  listeners = new Map<string, EventListener>()
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  url: string

  constructor(url: string) {
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
    const event = { data: JSON.stringify(data) } as MessageEvent
    this.listeners.get(type)?.(event as Event)
  }
}

afterEach(() => {
  FakeEventSource.instances = []
  vi.unstubAllGlobals()
})

function renderPage(options: { snapshotState: CubeState | null }) {
  const fetchMock = vi.fn(async (input: string) => {
    if (input === '/api/runs/run12345678') {
      return jsonResponse({ run, episodes: [episode] })
    }
    if (input === '/api/runs/run12345678/snapshot') {
      return jsonResponse({
        run,
        episodes: [episode],
        last_event_id: 3,
        current_state: options.snapshotState,
      })
    }
    if (input === '/api/benchmarks/b1') return jsonResponse(benchmark)
    if (input === '/api/providers') return jsonResponse([])
    if (input === '/api/runs/run12345678/report') {
      return jsonResponse(report)
    }
    return jsonResponse({ detail: 'not found' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('EventSource', FakeEventSource)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/runs/run12345678']}>
        <Routes>
          <Route path="/runs/:id" element={<RunPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('RunPage', () => {
  it('falls back to the task state when the snapshot has no live state', async () => {
    renderPage({ snapshotState: null })
    await waitFor(() =>
      expect(screen.getByTestId('cube-stub')).toHaveAttribute(
        'data-cube',
        '2x2',
      ),
    )
  })

  it('snaps the cube to the final state when the run finishes', async () => {
    renderPage({ snapshotState: benchmark.tasks[0].state })
    await waitFor(() =>
      expect(screen.getByTestId('cube-stub')).toHaveAttribute(
        'data-token',
        '1',
      ),
    )
    await waitFor(() =>
      expect(FakeEventSource.instances).toHaveLength(1),
    )
    expect(FakeEventSource.instances[0].url).toBe(
      '/api/runs/run12345678/events?after=3',
    )
    const cube = screen.getByTestId('cube-stub')
    const source = FakeEventSource.instances[0]
    act(() => {
      source.onopen?.()
      source.emit('run.finished', {
        id: 4,
        type: 'run.finished',
        run_id: 'run12345678',
        episode_id: null,
        ts: '2026-10-26T00:00:04+00:00',
        data: { status: 'finished', totals: null },
      })
    })
    // ResultView 的加载态也带 run-result，findByTestId 会先命中“报告加载中…”；
    // 这里要等报告数据替换掉加载态，断言文本本身不变。
    await waitFor(() =>
      expect(screen.getByTestId('run-result')).toHaveTextContent(
        '1 / 1',
      ),
    )
    await waitFor(() => expect(cube).toHaveAttribute('data-token', '2'))
  })

  it('shows a reconnect banner and retries on demand', async () => {
    renderPage({ snapshotState: null })
    await waitFor(() =>
      expect(FakeEventSource.instances).toHaveLength(1),
    )
    act(() => {
      FakeEventSource.instances[0].onerror?.()
    })
    const banner = await screen.findByTestId('connection-banner')
    expect(banner).toHaveTextContent('连接中断，正在重连…')
    fireEvent.click(screen.getByTestId('retry-connection'))
    await waitFor(() =>
      expect(FakeEventSource.instances.length).toBeGreaterThanOrEqual(2),
    )
  })

  it('shows the failure reason above the partial report', async () => {
    renderPage({ snapshotState: null })
    await waitFor(() =>
      expect(FakeEventSource.instances).toHaveLength(1),
    )
    act(() => {
      const source = FakeEventSource.instances[0]
      source.onopen?.()
      source.emit('run.error', {
        id: 4,
        type: 'run.error',
        run_id: 'run12345678',
        episode_id: null,
        ts: '2026-10-26T00:00:04+00:00',
        data: { message: '上游模型不可用' },
      })
    })
    const result = await screen.findByTestId('run-result')
    await waitFor(() => expect(result).toHaveTextContent('1 / 1'))
    expect(within(result).getByRole('alert')).toHaveTextContent(
      '上游模型不可用',
    )
  })
})
