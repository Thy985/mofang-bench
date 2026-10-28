import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AggregateReport,
  BenchmarkSummary,
  Provider,
  Run,
} from '../api/types'
import NewRunPage, { NewRunView } from './NewRunPage'
import RunsPage, { RunsView } from './RunsPage'

const provider: Provider = {
  id: 'p1',
  name: 'local',
  base_url: 'http://localhost/v1',
  model: 'm',
  api_key_ref: 'KEY',
  params: {},
  key_configured: true,
  created_at: '2026-10-26T00:00:00+00:00',
}

const benchmarks: BenchmarkSummary[] = [
  {
    id: 'b2',
    name: 'two',
    version: 'v1',
    kind: 'frozen',
    cube: '2x2',
    content_hash: 'h2',
    frozen_at: '2026-10-26T00:00:00+00:00',
    task_count: 1,
  },
  {
    id: 'b3',
    name: 'three',
    version: 'v1',
    kind: 'frozen',
    cube: '3x3',
    content_hash: 'h3',
    frozen_at: '2026-10-26T00:00:00+00:00',
    task_count: 1,
  },
]

const run: Run = {
  id: 'run12345678',
  provider_id: 'p1',
  benchmark_id: 'b2',
  tool_mode: 'both',
  prompt_version: 'v1',
  status: 'finished',
  totals: null,
  error: null,
  created_at: '2026-10-26T00:00:00+00:00',
  started_at: null,
  finished_at: null,
  budget: {
    max_moves: 30,
    max_tool_calls: 50,
    max_tokens: 300000,
    max_seconds: 300,
    turn_timeout: 120,
  },
}

const totals: AggregateReport = {
  benchmark_id: 'b2',
  benchmark_hash: 'h2',
  benchmark_total_tasks: 2,
  partial: false,
  totals: { tasks: 2, solved: 1, solve_rate: 0.5, ci95: [0.1, 0.9] },
  by_bin: {},
  episodes: [],
}

function PathProbe() {
  const location = useLocation()
  return <div data-testid="landed-at">{location.pathname}</div>
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

describe('NewRunView', () => {
  it('uses 2x2 defaults and submits overrides', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(undefined)
    render(
      <MemoryRouter>
        <NewRunView
          providers={[provider]}
          benchmarks={benchmarks}
          onCreate={onCreate}
        />
      </MemoryRouter>,
    )
    expect(screen.getByLabelText('max_moves')).toHaveValue(30)
    await user.clear(screen.getByLabelText('max_moves'))
    await user.type(screen.getByLabelText('max_moves'), '12')
    await user.click(screen.getByRole('button', { name: '启动 run' }))
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        provider_id: 'p1',
        benchmark_id: 'b2',
        tool_mode: 'both',
        budget: expect.objectContaining({ max_moves: 12 }),
      }),
    )
  })

  it('switches defaults when a 3x3 benchmark is selected', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <NewRunView
          providers={[provider]}
          benchmarks={benchmarks}
          onCreate={vi.fn()}
        />
      </MemoryRouter>,
    )
    await user.selectOptions(screen.getByLabelText('Benchmark'), 'b3')
    expect(screen.getByLabelText('max_moves')).toHaveValue(100)
    expect(screen.getByLabelText('max_seconds')).toHaveValue(900)
  })

  it.each([
    ['max_moves 清空', 'max_moves', 'max_moves 必须是正整数'],
    ['max_tool_calls 清空', 'max_tool_calls', 'max_tool_calls 必须是正整数'],
    ['max_seconds 清空', 'max_seconds', 'max_seconds 必须是正数'],
    ['turn_timeout 清空', 'turn_timeout', 'turn_timeout 必须是正数'],
  ])(
    'rejects %s before starting a run',
    async (_label, key, expected) => {
      const user = userEvent.setup()
      const onCreate = vi.fn().mockResolvedValue(undefined)
      render(
        <MemoryRouter>
          <NewRunView
            providers={[provider]}
            benchmarks={benchmarks}
            onCreate={onCreate}
          />
        </MemoryRouter>,
      )
      await user.clear(screen.getByLabelText(key))
      await user.click(screen.getByRole('button', { name: '启动 run' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(expected)
      expect(onCreate).not.toHaveBeenCalled()
    },
  )

  // 详情页的“用此题集新建 run”靠 query 参数预选，跑错题集不会报错但会浪费一次运行
  it('prefills the benchmark from the query string', () => {
    render(
      <MemoryRouter initialEntries={['/runs/new?benchmark=b3']}>
        <NewRunView
          providers={[provider]}
          benchmarks={benchmarks}
          onCreate={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.getByLabelText('max_moves')).toHaveValue(100)
    expect(screen.getByLabelText('max_seconds')).toHaveValue(900)
  })

  it('maps a rejected create through describeError', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockRejectedValueOnce(new TypeError('boom'))
    render(
      <MemoryRouter>
        <NewRunView
          providers={[provider]}
          benchmarks={benchmarks}
          onCreate={onCreate}
        />
      </MemoryRouter>,
    )
    await user.click(screen.getByRole('button', { name: '启动 run' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '网络错误：无法访问后端',
    )
    expect(onCreate).toHaveBeenCalledTimes(1)
  })
})

describe('RunsView', () => {
  it('maps provider and benchmark names', () => {
    render(
      <MemoryRouter>
        <RunsView
          runs={[run]}
          providers={[provider]}
          benchmarks={benchmarks}
        />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('run-row')).toHaveTextContent('local')
    expect(screen.getByTestId('run-row')).toHaveTextContent('two')
  })

  // provider/benchmark 被删后列表仍要能打开；id 里的 # 不编码会被 Link 当成 hash
  it('falls back to the raw ids and encodes the row link', () => {
    render(
      <MemoryRouter>
        <RunsView
          runs={[
            {
              ...run,
              id: 'odd#run/1',
              provider_id: 'gone',
              benchmark_id: 'gone2',
            },
          ]}
          providers={[provider]}
          benchmarks={benchmarks}
        />
      </MemoryRouter>,
    )
    const row = screen.getByTestId('run-row')
    expect(row).toHaveTextContent('gone')
    expect(row).toHaveTextContent('gone2')
    expect(within(row).getByRole('link')).toHaveAttribute(
      'href',
      '/runs/odd%23run%2F1',
    )
  })

  it('shows the backend solve rate only when totals exist', () => {
    render(
      <MemoryRouter>
        <RunsView
          runs={[
            { ...run, totals },
            { ...run, id: 'run87654321', totals: null },
          ]}
          providers={[provider]}
          benchmarks={benchmarks}
        />
      </MemoryRouter>,
    )
    const rows = screen.getAllByTestId('run-row')
    expect(rows[0]).toHaveTextContent('50.0%')
    expect(rows[1]).toHaveTextContent('—')
  })
})

describe('NewRunPage', () => {
  it('posts the run and navigates to the encoded run path', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(
      async (input: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return jsonResponse({ id: 'odd#run/1' }, 202)
        }
        if (input === '/api/providers') return jsonResponse([provider])
        if (input === '/api/benchmarks') return jsonResponse(benchmarks)
        return jsonResponse([])
      },
    )
    vi.stubGlobal('fetch', fetchMock)
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/runs/new']}>
          <Routes>
            <Route path="/runs/new" element={<NewRunPage />} />
            <Route path="/runs/:id" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await user.click(
      await screen.findByRole('button', { name: '启动 run' }),
    )
    expect(await screen.findByTestId('landed-at')).toHaveTextContent(
      '/runs/odd%23run%2F1',
    )
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/runs',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})

describe('RunsPage', () => {
  it('maps a load failure through describeError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ detail: 'boom' }, 500)),
    )
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <RunsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('后端返回错误（HTTP 500）')
    expect(alert).toHaveTextContent('boom')
  })
})
