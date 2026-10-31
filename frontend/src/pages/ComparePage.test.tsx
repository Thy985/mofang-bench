import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompareResult, Run } from '../api/types'
import App from '../App'

// 路由 lazy 导入 RunPage → CubeView → three；jsdom 用不到 WebGL
vi.mock('../cube/CubeView', () => ({
  CubeView: () => <div data-testid="cube-stub" />,
}))

const IDS = ['aaaaaaaa-run1', 'bbbbbbbb-run2'] as const

const runsFixture: Run[] = IDS.map((id, index) => ({
  id,
  provider_id: 'p1',
  benchmark_id: 'b1',
  tool_mode: 'both',
  prompt_version: 'v1',
  status: 'finished',
  totals: {
    benchmark_id: 'b1',
    benchmark_hash: 'hash',
    benchmark_total_tasks: 2,
    partial: false,
    totals: {
      tasks: 2,
      solved: index === 0 ? 2 : 1,
      solve_rate: index === 0 ? 1 : 0.5,
      ci95: [0.2, 1],
    },
    by_bin: {},
    episodes: [],
  },
  error: null,
  created_at: '2026-10-31T00:00:00+00:00',
  started_at: null,
  finished_at: null,
  budget: {
    max_moves: 30,
    max_tool_calls: 50,
    max_tokens: 300000,
    max_seconds: 300,
    turn_timeout: 120,
  },
}))

const compareFixture: CompareResult = {
  benchmark_id: 'b1',
  content_hash: 'hash',
  tasks: 2,
  runs: [...IDS],
  solve_rate_first: 1,
  solve_rate_second: 0.5,
  solve_rate_diff: 0.5,
  ci95: [0.1, 0.9],
  pairs: [
    { task_id: 't1', first_solved: true, second_solved: true, delta: 0 },
    { task_id: 't2', first_solved: true, second_solved: false, delta: -1 },
  ],
}

type MockReply = {
  compare?: CompareResult
  compareStatus?: number
  compareDetail?: string
}

function makeFetch(reply: MockReply) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/compare')) {
      if (reply.compareStatus) {
        return {
          ok: false,
          status: reply.compareStatus,
          statusText: 'Bad Request',
          json: async () => ({ detail: reply.compareDetail ?? '' }),
        }
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => reply.compare,
      }
    }
    if (url.includes('/api/runs')) {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => runsFixture,
      }
    }
    if (url.includes('/api/providers') || url.includes('/api/benchmarks')) {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => [],
      }
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
}

function renderApp(path: string, fetchMock: ReturnType<typeof makeFetch>) {
  vi.stubGlobal('fetch', fetchMock)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ComparePage', () => {
  it('渲染两 run 卡、差值与逐题表，不同行高亮', async () => {
    renderApp(`/compare?runs=${IDS[0]},${IDS[1]}`, makeFetch({ compare: compareFixture }))
    const diff = await screen.findByTestId('compare-diff')
    expect(diff).toHaveTextContent('50.0%')
    expect(screen.queryByTestId('runs-selected')).not.toBeInTheDocument()
    const rows = screen.getAllByTestId('compare-pair-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('t2')
    expect(rows[0].className).toContain('bg-surface-2')
    expect(rows[1]).toHaveTextContent('t1')
    expect(rows[1].className).not.toContain('bg-surface-2')
    expect(
      screen.getByRole('link', { name: '返回 Runs' }),
    ).toBeInTheDocument()
  })

  it('runs 参数不足两个时不发 compare 请求，直接提示', async () => {
    const fetchMock = makeFetch({})
    renderApp('/compare?runs=solo', fetchMock)
    expect(await screen.findByText(/链接不完整/)).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes('/api/compare'),
      ),
    ).toBe(false)
  })

  it('后端 400 走 describeError 出 Alert', async () => {
    renderApp(
      `/compare?runs=${IDS[0]},${IDS[1]}`,
      makeFetch({
        compareStatus: 400,
        compareDetail: 'runs use different benchmarks',
      }),
    )
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      '请求不合法（HTTP 400）：runs use different benchmarks',
    )
  })

  it('逐题表头注明只统计共同题', async () => {
    renderApp(`/compare?runs=${IDS[0]},${IDS[1]}`, makeFetch({ compare: compareFixture }))
    await screen.findByTestId('compare-diff')
    expect(
      screen.getByText('逐题（仅统计两 run 共同题，解出状态不同的行高亮）'),
    ).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getAllByRole('columnheader')).toHaveLength(4)
  })
})
