import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import type {
  AggregateReport,
  BenchmarkSummary,
  Provider,
  Run,
} from '../api/types'
import NewRunPage, { NewRunView } from './NewRunPage'
import RunsPage, { RunsView } from './RunsPage'
import { ToastProvider } from '../ui/Toast'

// focusFirstError 会调 scrollIntoView，jsdom 未实现，桩成 no-op。
Element.prototype.scrollIntoView = vi.fn()

const provider: Provider = {
  id: 'p1',
  name: 'local',
  base_url: 'http://localhost/v1',
  model: 'm',
  api_key_ref: 'KEY',
  params: {},
  key_configured: true,
  key_stored: false,
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
  totals: { tasks: 2, solved: 1, solve_rate: 0.25, ci95: [0.1, 0.9] },
  by_bin: {},
  episodes: [],
}

function PathProbe() {
  const location = useLocation()
  return <div data-testid="landed-at">{location.pathname}</div>
}

// NewRunView 需要 Router（useSearchParams 预选 benchmark），沿用现有渲染方式包 MemoryRouter
const viewProps = {
  providers: [provider],
  benchmarks,
  onCreate: vi.fn(async () => {}),
}

function renderView(props: Partial<typeof viewProps> = {}) {
  return render(
    <MemoryRouter>
      <NewRunView {...viewProps} {...props} />
    </MemoryRouter>,
  )
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
  // viewProps.onCreate 是共享 mock，逐用例清空调用记录
  beforeEach(() => {
    viewProps.onCreate.mockClear()
  })

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
      renderView()
      await user.clear(screen.getByLabelText(key))
      await user.click(screen.getByRole('button', { name: '启动 run' }))
      // 字段级校验经 Input 的 error 行展示，不再有表单级 role="alert"
      expect(await screen.findByText(expected)).toBeInTheDocument()
      expect(viewProps.onCreate).not.toHaveBeenCalled()
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
    expect(screen.getByLabelText('Benchmark')).toHaveValue('b3')
    expect(screen.getByLabelText('max_moves')).toHaveValue(100)
    expect(screen.getByLabelText('max_seconds')).toHaveValue(900)
  })

  it('shows a query error instead of the empty guides', () => {
    render(
      <MemoryRouter>
        <NewRunView
          providers={[]}
          benchmarks={[]}
          error="网络错误：无法访问后端，请确认服务已启动"
          onCreate={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('网络错误')
    expect(screen.queryByText(/还没有 provider/)).not.toBeInTheDocument()
    expect(screen.queryByText(/还没有基准集/)).not.toBeInTheDocument()
  })

  // validate() 全显：两个错误同时出现，并聚焦按 FIELD_ORDER 的首个错误字段
  it('预算字段错误全显并聚焦首个错误', async () => {
    const user = userEvent.setup()
    renderView()
    const maxMoves = screen.getByLabelText('max_moves')
    await user.clear(maxMoves)
    const seconds = screen.getByLabelText('max_seconds')
    await user.clear(seconds)
    await user.click(screen.getByRole('button', { name: '启动 run' }))
    expect(screen.getByText('max_moves 必须是正整数')).toBeInTheDocument()
    expect(screen.getByText('max_seconds 必须是正数')).toBeInTheDocument()
    expect(document.activeElement).toBe(maxMoves)
  })

  // 留空 = 沿用 provider 默认参数，不触发可选参数校验
  it('清空可选参数不报错（留空沿用 provider 默认）', async () => {
    const user = userEvent.setup()
    renderView()
    await user.clear(screen.getByLabelText('params_temperature'))
    await user.clear(screen.getByLabelText('params_max_tokens'))
    await user.click(screen.getByRole('button', { name: '启动 run' }))
    expect(
      screen.queryByText('temperature 必须是 0 到 2 之间的数值'),
    ).not.toBeInTheDocument()
  })

  it('sends optional param overrides when provided', async () => {
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
    await user.type(screen.getByLabelText('params_temperature'), '0.5')
    await user.type(screen.getByLabelText('params_max_tokens'), '2048')
    await user.click(screen.getByRole('button', { name: '启动 run' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1))
    expect(onCreate.mock.calls[0][0].params).toEqual({
      temperature: 0.5,
      max_tokens: 2048,
    })
  })

  it('rejects an out-of-range temperature', async () => {
    const user = userEvent.setup()
    renderView()
    await user.type(screen.getByLabelText('params_temperature'), '3')
    await user.click(screen.getByRole('button', { name: '启动 run' }))
    expect(
      await screen.findByText('temperature 必须是 0 到 2 之间的数值'),
    ).toBeInTheDocument()
    expect(viewProps.onCreate).not.toHaveBeenCalled()
  })

  // 后端 Budget 的 max_seconds / turn_timeout 是 float，min=1 的默认 step=1
  // 会把 120.5 判成 stepMismatch，submit 被原生校验吞掉
  it('submits fractional max_seconds as-is', async () => {
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
    await user.clear(screen.getByLabelText('max_seconds'))
    await user.type(screen.getByLabelText('max_seconds'), '120.5')
    await user.click(screen.getByRole('button', { name: '启动 run' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1))
    expect(onCreate.mock.calls[0][0].budget.max_seconds).toBe(120.5)
  })

  // 显式 0 要落到组件的中文提示，不能被原生 rangeUnderflow 抢先弹浏览器气泡
  it('rejects an explicit zero through the Chinese message', async () => {
    const user = userEvent.setup()
    renderView()
    await user.clear(screen.getByLabelText('max_moves'))
    await user.type(screen.getByLabelText('max_moves'), '0')
    await user.click(screen.getByRole('button', { name: '启动 run' }))
    expect(
      await screen.findByText('max_moves 必须是正整数'),
    ).toBeInTheDocument()
    expect(viewProps.onCreate).not.toHaveBeenCalled()
  })

  // 两个可选参数留空 = 沿用 provider 默认，params 必须是空对象而不是缺键或 0
  it('sends empty params when the optional overrides stay blank', async () => {
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
    await user.click(screen.getByRole('button', { name: '启动 run' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1))
    expect(onCreate.mock.calls[0][0].params).toEqual({})
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
              provider_id: 'p-gone',
              benchmark_id: 'b-gone',
            },
          ]}
          providers={[provider]}
          benchmarks={benchmarks}
        />
      </MemoryRouter>,
    )
    const row = screen.getByTestId('run-row')
    expect(row).toHaveTextContent('p-gone')
    expect(row).toHaveTextContent('b-gone')
    expect(within(row).getByRole('link')).toHaveAttribute(
      'href',
      '/runs/odd%23run%2F1',
    )
  })

  it('lists columns in spec order with scoped headers', () => {
    render(
      <MemoryRouter>
        <RunsView
          runs={[run]}
          providers={[provider]}
          benchmarks={benchmarks}
        />
      </MemoryRouter>,
    )
    const headers = screen.getAllByRole('columnheader')
    expect(headers.map((header) => header.textContent)).toEqual([
      'run',
      'provider',
      'benchmark',
      '状态',
      '创建时间',
      '解出率',
    ])
    for (const header of headers) {
      expect(header).toHaveAttribute('scope', 'col')
    }
  })

  // solve_rate 用后端独有值（1/2 本地算会得 50%），确保前端不自行计算
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
    expect(rows[0]).toHaveTextContent('25.0%')
    expect(rows[1]).toHaveTextContent('—')
  })
})

describe('NewRunPage', () => {
  function renderPage(initialEntries = ['/runs/new']) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    return render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter initialEntries={initialEntries}>
            <Routes>
              <Route path="/runs/new" element={<NewRunPage />} />
              <Route path="/runs/:id" element={<PathProbe />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    )
  }

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
    renderPage()
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

  it('surfaces providers load failures instead of an empty guide', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (input === '/api/providers') {
          return jsonResponse({ detail: 'boom' }, 500)
        }
        return jsonResponse([])
      }),
    )
    renderPage()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('后端返回错误（HTTP 500）')
    expect(alert).toHaveTextContent('boom')
    expect(screen.queryByText(/还没有 provider/)).not.toBeInTheDocument()
  })
})

describe('NewRunPage toast', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // 迁移自 View 级用例「maps a rejected create through describeError」：
  // 提交失败改走页面层 toastError（决策 ①），表单内不再出现 role="alert"。
  it('提交失败经 toastError 出中文错误 toast', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        throw new Error('boom')
      }
      if (_input === '/api/providers') return jsonResponse([provider])
      if (_input === '/api/benchmarks') return jsonResponse(benchmarks)
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', fetchMock)
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter initialEntries={['/runs/new']}>
            <NewRunPage />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    )
    await user.click(
      await screen.findByRole('button', { name: '启动 run' }),
    )
    const toast = await screen.findByRole('alert')
    expect(toast).toHaveTextContent('网络错误：无法访问后端')
    expect(toast.textContent).not.toContain('boom')
  })
})

describe('RunsPage', () => {
  it('keeps the title and entry when loading fails', async () => {
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
    expect(
      screen.getByRole('heading', { name: 'Runs' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'New Run' }),
    ).toHaveAttribute('href', '/runs/new')
    expect(
      screen.getByRole('button', { name: '重试' }),
    ).toBeInTheDocument()
  })

  it('retries a failed load', async () => {
    const user = userEvent.setup()
    let runsCalls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (input === '/api/runs') {
          runsCalls += 1
          return runsCalls === 1
            ? jsonResponse({ detail: 'boom' }, 500)
            : jsonResponse([])
        }
        return jsonResponse([])
      }),
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
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(
      await screen.findByText('还没有运行记录。'),
    ).toBeInTheDocument()
    expect(runsCalls).toBe(2)
  })
})
