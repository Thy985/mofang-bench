import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
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
import { BenchmarksView } from './BenchmarksPage'

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

async function submitDemoForm(
  onCreate: (payload: BenchmarkCreate) => Promise<void>,
) {
  const user = userEvent.setup()
  render(
    <BenchmarksView
      benchmarks={[summary]}
      loading={false}
      error={null}
      onCreate={onCreate}
    />,
  )
  await user.type(screen.getByLabelText('名称'), 'demo')
  await user.click(screen.getByLabelText('深度 1'))
  await user.click(screen.getByRole('button', { name: '生成基准集' }))
  return user
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('BenchmarksView', () => {
  it('creates a 2x2 benchmark with table solver and rejects depth 20', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(undefined)
    render(
      <BenchmarksView
        benchmarks={[]}
        loading={false}
        error={null}
        onCreate={onCreate}
      />,
    )
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
    const alert = await screen.findByRole('alert')
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
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('已存在同 id 题集')
    expect(alert.textContent).not.toContain('already there')
    expect(
      screen.queryByRole('link', { name: '查看已有题集' }),
    ).not.toBeInTheDocument()
  })

  it('maps a non-conflict backend error through describeError', async () => {
    const onCreate = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(400, 'depths must be positive'))
    await submitDemoForm(onCreate)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('请求不合法（HTTP 400）')
    expect(alert).toHaveTextContent('depths must be positive')
  })

  it('announces an unreachable backend in Chinese instead of the raw message', async () => {
    const onCreate = vi
      .fn()
      .mockRejectedValueOnce(new Error('benchmark already exists'))
    await submitDemoForm(onCreate)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('网络错误：无法访问后端')
    expect(alert.textContent).not.toContain('benchmark already exists')
  })

  it('switches to depth 20 and the rubik solver for 3x3', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(undefined)
    render(
      <BenchmarksView
        benchmarks={[]}
        loading={false}
        error={null}
        onCreate={onCreate}
      />,
    )
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
    render(
      <BenchmarksView
        benchmarks={[]}
        loading={false}
        error={null}
        onCreate={onCreate}
      />,
    )
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
    render(
      <BenchmarksView
        benchmarks={[]}
        loading={false}
        error={null}
        onCreate={onCreate}
      />,
    )
    await user.type(screen.getByLabelText('名称'), 'demo')
    await user.click(screen.getByRole('button', { name: '生成基准集' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '至少选择一个深度',
    )
    expect(onCreate).not.toHaveBeenCalled()
  })

  // required/min/step 挡得住留空与越界（jsdom 会拦下 submit 事件），但 type=number
  // 把无法解析的输入净化成空串：清空与“输入字母”是同一条路径，Number('') 是 0，
  // 会静默生成 0 题或改掉 id 里的 seed，所以只能在这里拦。
  it.each([
    ['名称含斜杠', '名称', 'a/b', '名称不能包含 / # ?'],
    ['名称含井号', '名称', 'a#b', '名称不能包含 / # ?'],
    ['名称含问号', '名称', 'a?b', '名称不能包含 / # ?'],
    ['每档题数清空', '每档题数', '', '每档题数必须是正整数'],
    ['每档题数是非数字', '每档题数', 'abc', '每档题数必须是正整数'],
    ['seed 清空', 'seed', '', 'seed 必须是整数'],
    ['seed 是非数字', 'seed', 'abc', 'seed 必须是整数'],
  ])(
    'rejects %s before sending anything',
    async (_label, key, value, expected) => {
      const user = userEvent.setup()
      const onCreate = vi.fn()
      render(
        <BenchmarksView
          benchmarks={[]}
          loading={false}
          error={null}
          onCreate={onCreate}
        />,
      )
      await user.type(screen.getByLabelText('名称'), 'demo')
      await user.click(screen.getByLabelText('深度 1'))
      const field = screen.getByLabelText(key)
      await user.clear(field)
      if (value !== '') await user.type(field, value)
      await user.click(screen.getByRole('button', { name: '生成基准集' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(expected)
      expect(onCreate).not.toHaveBeenCalled()
    },
  )

  it('lists each benchmark with an id-safe detail link', () => {
    render(
      <BenchmarksView
        benchmarks={[summary, { ...summary, id: 'odd#2x2-7', name: 'odd' }]}
        loading={false}
        error={null}
        onCreate={vi.fn()}
      />,
    )
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('demo-2x2-3')
    expect(rows[0]).toHaveTextContent('1 题')
    expect(rows[0]).toHaveTextContent('abcdef12')
    expect(rows[0]).not.toHaveTextContent('abcdef123456')
    expect(
      // 详情链接必须是真实 href：BenchmarksView 在无 Router 上下文时也要能渲染
      screen.getAllByRole('link', { name: '查看详情' }).map((link) =>
        link.getAttribute('href'),
      ),
    ).toEqual(['/benchmarks/demo-2x2-3', '/benchmarks/odd%232x2-7'])
  })

  it('shows the empty state when the list loaded', () => {
    render(
      <BenchmarksView
        benchmarks={[]}
        loading={false}
        error={null}
        onCreate={vi.fn()}
      />,
    )
    expect(screen.getByText(/还没有基准集/)).toBeInTheDocument()
  })

  it('announces a list load failure and hides the empty state', () => {
    render(
      <BenchmarksView
        benchmarks={[]}
        loading={false}
        error="网络错误：无法访问后端，请确认服务已启动"
        onCreate={vi.fn()}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('无法访问后端')
    expect(screen.queryByText(/还没有基准集/)).not.toBeInTheDocument()
  })

  it('keeps the form error and the list banner announced separately', async () => {
    const user = userEvent.setup()
    const onCreate = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(409, conflictDetail('demo-2x2-3')))
    render(
      <BenchmarksView
        benchmarks={[summary]}
        loading={false}
        error="后端返回错误（HTTP 500）：boom"
        onCreate={onCreate}
      />,
    )
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
    expect(await screen.findByText(/未找到该记录（HTTP 404）/)).toBeInTheDocument()
    expect(screen.queryByText('benchmark not found')).not.toBeInTheDocument()
  })
})
