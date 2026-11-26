import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
import { ToastProvider } from '../ui/Toast'

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
          key_stored: false,
          created_at: '2026-10-26T00:00:00+00:00',
        }}
        onCancel={vi.fn()}
        cancelling={false}
      />,
    )
    expect(screen.getByText('local / m')).toBeInTheDocument()
    expect(screen.getByTestId('stat-moves')).toHaveTextContent('2/30')
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

  it('shows a solved column with check marks per episode', () => {
    render(
      <MemoryRouter>
        <ResultView
          report={{
            ...report,
            episodes: [
              ...report.episodes,
              { ...report.episodes[0], id: 'e2', solved: false },
            ],
          }}
          run={{ ...run, status: 'finished' }}
          provider={null}
          benchmark={benchmark}
        />
      </MemoryRouter>,
    )
    expect(screen.getByRole('columnheader', { name: '已解出' }))
    const result = screen.getByTestId('run-result')
    expect(result).toHaveTextContent('✓')
    expect(result).toHaveTextContent('—')
  })

  it('逐题表渲染 tokens 与耗时，null 显示 —', () => {
    const withLatency: Report = {
      ...report,
      episodes: [{ ...report.episodes[0], latency_ms: 1234 }],
    }
    render(
      <MemoryRouter>
        <ResultView report={withLatency} run={run} provider={null} benchmark={null} />
      </MemoryRouter>,
    )
    const result = screen.getByTestId('run-result')
    expect(within(result).getByText('15')).toBeInTheDocument()
    expect(within(result).getByText('1.2s')).toBeInTheDocument()
    expect(within(result).getAllByText('—').length).toBeGreaterThan(0)
  })

  it('分箱区渲染 BinChart 而非表格', () => {
    render(
      <MemoryRouter>
        <ResultView report={report} run={run} provider={null} benchmark={null} />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('bin-chart')).toBeInTheDocument()
    expect(screen.queryByText('mean_moves')).not.toBeInTheDocument()
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
    if (input === '/api/runs/run12345678/cancel') {
      return jsonResponse({ cancelled: true })
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
      <ToastProvider>
        <MemoryRouter initialEntries={['/runs/run12345678']}>
          <Routes>
            <Route path="/runs/:id" element={<RunPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('ResultView attribution', () => {
  const failingReport: Report = {
    ...report,
    totals: { tasks: 2, solved: 0, solve_rate: 0, ci95: [0, 0.6] },
    episodes: [
      { ...episode, id: 'e1', status: 'stopped_unsolved', solved: false, failure_code: 'stopped_unsolved', task_key: 'b1:t1', error: '{"error":{"message":"模型连续 5 轮无有效动作"}}' },
      { ...episode, id: 'e2', status: 'provider_error', solved: false, failure_code: 'provider_error', task_key: 'b1:t2', error: '{"error":{"message":"[429] 请登录platform进行实名认证以获取更高rpm"}}' },
    ],
    attribution: {
      failed: 2,
      env: 1,
      model: 1,
      codes: { stopped_unsolved: 1, provider_error: 1 },
      signals: {
        '触发速率限制（HTTP 429）：降低并发、更换 key 或加大退避间隔': 1,
        '模型未取得任何进展（progress=0）': 1,
      },
      provider_errors_total: 2,
      protocol_errors_total: 0,
      items: [
        { task_id: 'b1:t1', side: 'model', code: 'stopped_unsolved', signals: ['模型未取得任何进展（progress=0）'] },
        { task_id: 'b1:t2', side: 'env', code: 'provider_error', signals: ['触发速率限制（HTTP 429）：降低并发、更换 key 或加大退避间隔'] },
      ],
    },
  }

  it('失败时渲染归因两侧与信号', () => {
    render(
      <MemoryRouter>
        <ResultView
          report={failingReport}
          run={{ ...run, status: 'finished' }}
          provider={null}
          benchmark={benchmark}
        />
      </MemoryRouter>,
    )
    const section = screen.getByTestId('attribution')
    expect(section).toHaveTextContent('失败 2 = 环境侧 1 + 模型侧 1')
    expect(section).toHaveTextContent('速率限制')
    expect(section).toHaveTextContent('provider 退避/错误 共 2 次')
    expect(section).toHaveTextContent('未取得任何进展')
    // 计数文案不再混在 signals 里
    expect(section).not.toHaveTextContent('本局共 2 次')
  })

  it('归因卡片列出逐题明细：侧别 / 失败码 / 信号 / 原始错误', () => {
    render(
      <MemoryRouter>
        <ResultView
          report={failingReport}
          run={{ ...run, status: 'finished' }}
          provider={null}
          benchmark={benchmark}
        />
      </MemoryRouter>,
    )
    const items = screen.getAllByTestId('attribution-item')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('b1:t1')
    expect(items[0]).toHaveTextContent('模型侧')
    expect(items[0]).toHaveTextContent('模型连续 5 轮无有效动作')
    expect(items[1]).toHaveTextContent('b1:t2')
    expect(items[1]).toHaveTextContent('环境侧')
    expect(items[1]).toHaveTextContent('429')
  })

  it('逐题表新增「原因」列，展示 error 摘要', () => {
    render(
      <MemoryRouter>
        <ResultView
          report={failingReport}
          run={{ ...run, status: 'finished' }}
          provider={null}
          benchmark={benchmark}
        />
      </MemoryRouter>,
    )
    expect(screen.getAllByRole('columnheader', { name: '原因' })).toHaveLength(2)
    // 逐题表与归因明细各出现一次
    expect(screen.getAllByText('模型连续 5 轮无有效动作')).toHaveLength(2)
    // 逐题表与归因明细的「原因」列各出现一次 error 摘要
    expect(screen.getAllByText(/请登录platform进行实名认证/)).toHaveLength(2)
    // 类别信号（429）出现在信号列表与明细表，与 error 原文无关
    expect(screen.getAllByText(/HTTP 429/)).toHaveLength(2)
  })

  it('全部解出时不渲染归因区', () => {
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
    expect(screen.queryByTestId('attribution')).not.toBeInTheDocument()
  })
})

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

  it('流式 thinking 实时渲染到思考面板，结束后归档', async () => {
    renderPage({ snapshotState: null })
    await waitFor(() =>
      expect(FakeEventSource.instances).toHaveLength(1),
    )
    const source = FakeEventSource.instances[0]
    function emit(id: number, type: string, data: unknown) {
      act(() => {
        source.onopen?.()
        source.emit(type, {
          id,
          type,
          run_id: 'run12345678',
          episode_id: 'e1',
          ts: '2026-10-26T00:00:04+00:00',
          data,
        })
      })
    }
    emit(4, 'episode.started', {
      task_id: 'b1:t1',
      reference_length: 3,
    })
    emit(5, 'model.turn.started', { moves_used: 0 })
    emit(6, 'thinking.delta', { seq: 0, text: '推理片段' })
    expect(screen.getByTestId('thinking-panel')).toHaveTextContent(
      '推理片段',
    )
    emit(7, 'model.message', {
      content: '回答',
      thinking: '推理片段 全文',
      tool_calls: 0,
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })
    // spec §1：面板跨 turn 不卸载；turn 结束清空 thinkingText 后转空态（不留全文）
    expect(screen.getByTestId('thinking-panel')).toBeInTheDocument()
    expect(screen.getByTestId('thinking-panel')).not.toHaveTextContent(
      '推理片段 全文',
    )
    expect(screen.getByTestId('log-thinking')).toHaveTextContent(
      '推理片段 全文',
    )
  })

  it('折叠态跨 turn 保持：面板不卸载、下个 turn 不重新弹出', async () => {
    renderPage({ snapshotState: null })
    await waitFor(() =>
      expect(FakeEventSource.instances).toHaveLength(1),
    )
    const source = FakeEventSource.instances[0]
    function emit(id: number, type: string, data: unknown) {
      act(() => {
        source.onopen?.()
        source.emit(type, {
          id,
          type,
          run_id: 'run12345678',
          episode_id: 'e1',
          ts: '2026-10-26T00:00:04+00:00',
          data,
        })
      })
    }
    const user = userEvent.setup()
    emit(4, 'episode.started', {
      task_id: 'b1:t1',
      reference_length: 3,
    })
    emit(5, 'model.turn.started', { moves_used: 0 })
    emit(6, 'thinking.delta', { seq: 0, text: '第一轮思考' })
    await user.click(screen.getByText('思考中…'))
    expect(screen.getByTestId('thinking-panel')).not.toHaveAttribute('open')
    // turn 结束：面板保持挂载且仍折叠（折叠态由组件自持，不被清空重置）
    emit(7, 'model.message', {
      content: '回答',
      thinking: '第一轮思考 全文',
      tool_calls: 0,
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })
    expect(screen.getByTestId('thinking-panel')).toBeInTheDocument()
    expect(screen.getByTestId('thinking-panel')).not.toHaveAttribute('open')
    // 下个 turn：面板不再重新弹出，折叠态保持
    emit(8, 'model.turn.started', { moves_used: 1 })
    emit(9, 'thinking.delta', { seq: 0, text: '第二轮思考' })
    expect(screen.getByTestId('thinking-panel')).not.toHaveAttribute('open')
    expect(screen.getByTestId('thinking-panel')).toHaveTextContent(
      '第二轮思考',
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

  it('取消成功出「已取消」toast', async () => {
    renderPage({ snapshotState: null })
    const user = userEvent.setup()
    // mock run 为 running、按钮文案是「取消 run」；首帧停在骨架屏，用 findByRole 等按钮出现。
    const cancelBtn = await screen.findByRole('button', {
      name: '取消 run',
    })
    await user.click(cancelBtn)
    expect(await screen.findByRole('status')).toHaveTextContent('已取消')
  })
})
