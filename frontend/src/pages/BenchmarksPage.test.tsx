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
import { ApiError } from '../api/client'
import type {
  BenchmarkCreate,
  BenchmarkDetail,
  BenchmarkSummary,
} from '../api/types'
import BenchmarkDetailPage, {
  BenchmarkDetailView,
} from './BenchmarkDetailPage'
import { ToastProvider } from '../ui/Toast'
import BenchmarksPage, { BenchmarksView } from './BenchmarksPage'

// focusFirstError 会调 scrollIntoView，jsdom 未实现，桩成 no-op。
Element.prototype.scrollIntoView = vi.fn()

const summary: BenchmarkSummary = {
  id: 'demo-2x2-3',
  name: 'demo',
  version: 'v1',
  kind: 'frozen',
  cube: '2x2',
  content_hash: 'abcdef123456',
  frozen_at: '2026-10-26T00:00:00+00:00',
  task_count: 1,
}

const detail: BenchmarkDetail = {
  ...summary,
  tasks: [
    {
      id: '2x2-1-1',
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

const conflictDetail = (id: string) =>
  JSON.stringify({ message: 'benchmark already exists', id })

function PathProbe() {
  const location = useLocation()
  return <div data-testid="landed-at">{location.pathname}</div>
}

// 站内链接用 Link 渲染，视图必须有 Router 上下文
function renderView({
  benchmarks = [],
  error = null,
  onCreate = vi.fn(),
}: {
  benchmarks?: BenchmarkSummary[]
  error?: string | null
  onCreate?: (payload: BenchmarkCreate) => Promise<void>
} = {}) {
  return render(
    <MemoryRouter initialEntries={['/benchmarks']}>
      <BenchmarksView
        benchmarks={benchmarks}
        loading={false}
        error={error}
        onCreate={onCreate}
      />
    </MemoryRouter>,
  )
}

async function submitDemoForm(
  onCreate: (payload: BenchmarkCreate) => Promise<void>,
) {
  const user = userEvent.setup()
  renderView({ benchmarks: [summary], onCreate })
  await user.type(screen.getByLabelText('名称'), 'demo')
  await user.click(screen.getByLabelText('深度 1'))
  await user.click(screen.getByRole('button', { name: '生成基准集' }))
  return user
}

async function findFormAlert() {
  const form = await screen.findByTestId('benchmark-form')
  return within(form).findByRole('alert')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('BenchmarksView', () => {
  it('creates a 2x2 benchmark with table solver and rejects depth 20', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(undefined)
    renderView({ onCreate })
    expect(screen.getByLabelText('深度 20')).toBeDisabled()
    await user.type(screen.getByLabelText('名称'), 'demo')
    await user.click(screen.getByLabelText('深度 1'))
    await user.click(
      screen.getByRole('button', { name: '生成基准集' }),
    )
    expect(onCreate).toHaveBeenCalledWith({
      name: 'demo',
      cube: '2x2',
      depths: [1],
      per_depth: 2,
      seed: 42,
      solver: 'table',
    })
  })

  it('shows a conflict error from the parent', async () => {
    const onCreate = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError(409, conflictDetail('demo-2x2-3')),
      )
    await submitDemoForm(onCreate)
    const alert = await findFormAlert()
    expect(alert).toHaveTextContent('已存在同 id 题集')
    expect(alert.textContent).not.toContain('benchmark already exists')
  })

  it('links to the existing benchmark from the 409 message', async () => {
    const onCreate = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(409, conflictDetail('demo-2x2-3')))
    await submitDemoForm(onCreate)
    const link = await screen.findByRole('link', { name: '查看已有题集' })
    expect(link).toHaveAttribute('href', '/benchmarks/demo-2x2-3')
  })

  it('encodes the existing benchmark id in the back link', async () => {
    const onCreate = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(409, conflictDetail('we#ird/1')))
    await submitDemoForm(onCreate)
    const link = await screen.findByRole('link', { name: '查看已有题集' })
    expect(link).toHaveAttribute('href', '/benchmarks/we%23ird%2F1')
  })

  it('keeps the conflict copy Chinese when the 409 detail is not JSON', async () => {
    const onCreate = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(409, 'already there'))
    await submitDemoForm(onCreate)
    const alert = await findFormAlert()
    expect(alert).toHaveTextContent('已存在同 id 题集')
    expect(alert.textContent).not.toContain('already there')
    expect(
      screen.queryByRole('link', { name: '查看已有题集' }),
    ).not.toBeInTheDocument()
  })

  it('switches to depth 20 and the rubik solver for 3x3', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(undefined)
    renderView({ onCreate })
    await user.type(screen.getByLabelText('名称'), 'big')
    await user.selectOptions(screen.getByLabelText('尺寸'), '3x3')
    expect(screen.getByText(/twophase/)).toBeInTheDocument()
    expect(screen.getByLabelText('深度 20')).toBeEnabled()
    await user.click(screen.getByLabelText('深度 20'))
    await user.click(screen.getByRole('button', { name: '生成基准集' }))
    expect(onCreate).toHaveBeenCalledWith({
      name: 'big',
      cube: '3x3',
      depths: [20],
      per_depth: 2,
      seed: 42,
      solver: 'rubik',
    })
  })

  it('drops depth 20 again when the size goes back to 2x2', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(undefined)
    renderView({ onCreate })
    await user.type(screen.getByLabelText('名称'), 'big')
    const size = screen.getByLabelText('尺寸')
    await user.selectOptions(size, '3x3')
    await user.click(screen.getByLabelText('深度 20'))
    await user.selectOptions(size, '2x2')
    expect(screen.getByLabelText('深度 20')).not.toBeChecked()
    await user.click(screen.getByLabelText('深度 1'))
    await user.click(screen.getByRole('button', { name: '生成基准集' }))
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ cube: '2x2', depths: [1], solver: 'table' }),
    )
  })

  it('refuses to generate without any depth', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()
    renderView({ onCreate })
    await user.type(screen.getByLabelText('名称'), 'demo')
    await user.click(screen.getByRole('button', { name: '生成基准集' }))
    expect(await findFormAlert()).toHaveTextContent(
      '至少选择一个深度',
    )
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('提交时字段错误全显并聚焦（depths 聚焦到第一个 checkbox）', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()
    renderView({ onCreate })
    // 名称有原生 required（空名无字段级兜底文案，保留原生拦截），
    // 必须先填名，否则 jsdom 约束校验会拦下 submit，字段错误走不到
    await user.type(screen.getByLabelText('名称'), 'demo')
    // type=number 在 jsdom 中把无法解析的输入还原为原值（实测 'x' 不会清成空串，
    // 与先 clear 再提交是同一条 readPositiveInt('') 非法路径），按 brief 回退用 clear
    await user.clear(screen.getByLabelText('每档题数'))
    await user.click(screen.getByRole('button', { name: '生成基准集' }))
    expect(screen.getByText('至少选择一个深度')).toBeInTheDocument()
    expect(screen.getByText('每档题数必须是正整数')).toBeInTheDocument()
    expect(document.activeElement).toHaveAttribute('type', 'checkbox')
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('空列表渲染 EmptyState', () => {
    renderView({ benchmarks: [], error: null })
    expect(screen.getByText('还没有基准集')).toBeInTheDocument()
  })

  // required/min/step 挡得住留空与越界（jsdom 会拦下 submit 事件），但 type=number
  // 把无法解析的输入净化成空串：清空与“输入字母”是同一条路径，Number('') 是 0，
  // 会静默生成 0 题或改掉 id 里的 seed，所以只能在这里拦。
  it.each([
    ['名称含斜杠', '名称', 'a/b', '名称不能包含 / # ?'],
    ['名称含井号', '名称', 'a#b', '名称不能包含 / # ?'],
    ['名称含问号', '名称', 'a?b', '名称不能包含 / # ?'],
    ['每档题数为空', '每档题数', '', '每档题数必须是正整数'],
    [
      '每档题数输入字母（jsdom 净化为空）',
      '每档题数',
      'abc',
      '每档题数必须是正整数',
    ],
    ['seed 为空', 'seed', '', 'seed 必须是整数'],
    [
      'seed 输入字母（jsdom 净化为空）',
      'seed',
      'abc',
      'seed 必须是整数',
    ],
  ])(
    'rejects %s before sending anything',
    async (_label, key, value, expected) => {
      const user = userEvent.setup()
      const onCreate = vi.fn()
      renderView({ onCreate })
      await user.type(screen.getByLabelText('名称'), 'demo')
      await user.click(screen.getByLabelText('深度 1'))
      const field = screen.getByLabelText(key)
      await user.clear(field)
      if (value !== '') await user.type(field, value)
      await user.click(screen.getByRole('button', { name: '生成基准集' }))
      // formError 通道已删除：改为断言对应字段的错误文案。
      expect(await screen.findByText(expected)).toBeInTheDocument()
      expect(onCreate).not.toHaveBeenCalled()
    },
  )

  it('lists each benchmark with an id-safe detail link', () => {
    renderView({
      benchmarks: [summary, { ...summary, id: 'odd#2x2-7', name: 'odd' }],
    })
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('demo-2x2-3')
    expect(rows[0]).toHaveTextContent('1 题')
    expect(rows[0]).toHaveTextContent('abcdef12')
    expect(rows[0]).not.toHaveTextContent('abcdef123456')
    expect(
      // MemoryRouter 下 Link 仍渲染出真实 href，且 id 已编码
      screen.getAllByRole('link', { name: '查看详情' }).map((link) =>
        link.getAttribute('href'),
      ),
    ).toEqual(['/benchmarks/demo-2x2-3', '/benchmarks/odd%232x2-7'])
  })

  it('shows the frozen time in the list row subtitle', () => {
    renderView({ benchmarks: [summary] })
    expect(screen.getByText(/冻结/)).toHaveTextContent('2026')
  })

  it('opens the detail page through the router instead of a full reload', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/benchmarks']}>
        <Routes>
          <Route
            path="/benchmarks"
            element={
              <BenchmarksView
                benchmarks={[{ ...summary, id: 'odd#2x2-7' }]}
                loading={false}
                error={null}
                onCreate={vi.fn()}
              />
            }
          />
          <Route path="/benchmarks/:id" element={<PathProbe />} />
        </Routes>
      </MemoryRouter>,
    )
    await user.click(screen.getByRole('link', { name: '查看详情' }))
    expect(await screen.findByTestId('landed-at')).toHaveTextContent(
      '/benchmarks/odd%232x2-7',
    )
  })

  it('opens the existing benchmark through the router from the 409 message', async () => {
    const user = userEvent.setup()
    const onCreate = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(409, conflictDetail('odd#2x2-7')))
    render(
      <MemoryRouter initialEntries={['/benchmarks']}>
        <Routes>
          <Route
            path="/benchmarks"
            element={
              <BenchmarksView
                benchmarks={[]}
                loading={false}
                error={null}
                onCreate={onCreate}
              />
            }
          />
          <Route path="/benchmarks/:id" element={<PathProbe />} />
        </Routes>
      </MemoryRouter>,
    )
    await user.type(screen.getByLabelText('名称'), 'odd')
    await user.click(screen.getByLabelText('深度 1'))
    await user.click(screen.getByRole('button', { name: '生成基准集' }))
    await user.click(
      await screen.findByRole('link', { name: '查看已有题集' }),
    )
    expect(await screen.findByTestId('landed-at')).toHaveTextContent(
      '/benchmarks/odd%232x2-7',
    )
  })

  it('shows the empty state when the list loaded', () => {
    renderView()
    expect(screen.getByText(/还没有基准集/)).toBeInTheDocument()
  })

  it('announces a list load failure and hides the empty state', () => {
    renderView({ error: '网络错误：无法访问后端，请确认服务已启动' })
    expect(screen.getByRole('alert')).toHaveTextContent('无法访问后端')
    expect(screen.queryByText(/还没有基准集/)).not.toBeInTheDocument()
  })

  it('keeps the form error and the list banner announced separately', async () => {
    const user = userEvent.setup()
    const onCreate = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(409, conflictDetail('demo-2x2-3')))
    renderView({
      benchmarks: [summary],
      error: '后端返回错误（HTTP 500）：boom',
      onCreate,
    })
    await user.type(screen.getByLabelText('名称'), 'demo')
    await user.click(screen.getByLabelText('深度 1'))
    await user.click(screen.getByRole('button', { name: '生成基准集' }))
    await screen.findByRole('link', { name: '查看已有题集' })
    const alerts = screen.getAllByRole('alert')
    expect(alerts).toHaveLength(2)
    expect(
      within(screen.getByTestId('benchmark-form')).getByRole('alert'),
    ).toHaveTextContent('已存在同 id 题集')
    expect(
      alerts.find((node) => node.textContent.includes('HTTP 500')),
    ).toBeTruthy()
  })
})

describe('BenchmarksPage', () => {
  // 容器是唯一走 navigate 的成功路径；id 里的 # 若漏编码会被当成 hash 截断
  it('navigates to the encoded detail path after a create', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(
      async (_input: string, init?: RequestInit) =>
        init?.method === 'POST'
          ? {
              ok: true,
              status: 201,
              statusText: 'Created',
              json: async () => ({ ...detail, id: 'odd#2x2-7' }),
            }
          : {
              ok: true,
              status: 200,
              statusText: 'OK',
              json: async () => [],
            },
    )
    vi.stubGlobal('fetch', fetchMock)
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter initialEntries={['/benchmarks']}>
            <Routes>
              <Route path="/benchmarks" element={<BenchmarksPage />} />
              <Route path="/benchmarks/:id" element={<PathProbe />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    )
    await user.type(screen.getByLabelText('名称'), 'odd')
    await user.click(screen.getByLabelText('深度 1'))
    await user.click(screen.getByRole('button', { name: '生成基准集' }))
    expect(await screen.findByTestId('landed-at')).toHaveTextContent(
      '/benchmarks/odd%232x2-7',
    )
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/benchmarks',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})

describe('BenchmarksPage toast', () => {
  function renderPage() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    return render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter initialEntries={['/benchmarks']}>
            <Routes>
              <Route path="/benchmarks" element={<BenchmarksPage />} />
              <Route path="/benchmarks/:id" element={<PathProbe />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    )
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // 迁移自 View 级用例「maps a non-conflict backend error through describeError」：
  // 非 409 提交失败改走页面层 toast（409 冲突仍保留行内 role="alert"）。
  // 与 conflict 行内 alert 区分：用 getAllByRole + textContent 匹配。
  it('后端 400 经 toastError 出中文转译 + detail 的错误 toast', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? {
            ok: false,
            status: 400,
            statusText: 'Bad Request',
            json: async () => ({ detail: 'depths must be positive' }),
          }
        : {
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => [],
          },
    )
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await user.type(screen.getByLabelText('名称'), 'demo')
    await user.click(screen.getByLabelText('深度 1'))
    await user.click(screen.getByRole('button', { name: '生成基准集' }))
    const alerts = await screen.findAllByRole('alert')
    const toast = alerts.find((node) =>
      node.textContent.includes('depths must be positive'),
    )
    expect(toast).toBeDefined()
    expect(toast).toHaveTextContent('请求不合法（HTTP 400）')
  })

  // 迁移自 View 级用例「announces an unreachable backend in Chinese instead of the raw message」
  it('后端不可达经 toastError 出中文错误 toast，不吐原始 message', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        throw new Error('benchmark already exists')
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => [],
      }
    })
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await user.type(screen.getByLabelText('名称'), 'demo')
    await user.click(screen.getByLabelText('深度 1'))
    await user.click(screen.getByRole('button', { name: '生成基准集' }))
    const alerts = await screen.findAllByRole('alert')
    const toast = alerts.find((node) =>
      node.textContent.includes('网络错误：无法访问后端'),
    )
    expect(toast).toBeDefined()
    expect(toast?.textContent).not.toContain('benchmark already exists')
  })
})

describe('BenchmarkDetailView', () => {
  // BenchmarkDetailView 用的是 Link，必须有 Router 上下文才能渲染
  it('renders task rows', () => {
    render(
      <MemoryRouter>
        <BenchmarkDetailView benchmark={detail} />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('benchmark-task-row')).toHaveTextContent(
      '2x2-1-1',
    )
    expect(screen.getByText('exact')).toBeInTheDocument()
  })

  it('shows the frozen time in the detail subtitle', () => {
    render(
      <MemoryRouter>
        <BenchmarkDetailView benchmark={detail} />
      </MemoryRouter>,
    )
    expect(screen.getByText(/冻结/)).toHaveTextContent('2026')
  })

  it('links back and to a new run with the encoded benchmark id', () => {
    render(
      <MemoryRouter>
        <BenchmarkDetailView benchmark={{ ...detail, id: 'odd#2x2/7' }} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: '返回列表' })).toHaveAttribute(
      'href',
      '/benchmarks',
    )
    expect(
      screen.getByRole('link', { name: '用此题集新建 run' }),
    ).toHaveAttribute('href', '/runs/new?benchmark=odd%232x2%2F7')
  })
})

describe('BenchmarkDetailPage', () => {
  it('maps a load failure through describeError instead of the raw message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ detail: 'benchmark not found' }),
      }),
    )
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/benchmarks/missing']}>
          <Routes>
            <Route path="/benchmarks/:id" element={<BenchmarkDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('未找到该记录（HTTP 404）')
    // describeError 会把 detail 接在中文标签后；单独上屏才算把英文当错误文案
    expect(alert).not.toHaveTextContent(/^benchmark not found$/)
  })
})
