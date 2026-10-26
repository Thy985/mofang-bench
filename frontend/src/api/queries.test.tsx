import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  qk,
  useBenchmark,
  useBenchmarks,
  useEpisode,
  useProviders,
  useReport,
  useRun,
  useRuns,
  useSnapshot,
  useSteps,
} from './queries'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

const fetchMock = vi.fn()

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

// 九个 hook 的返回类型各不相同，断言只投影它们共有的字段。
type QueryProjection = {
  status: string
  fetchStatus: string
  data: unknown
}

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

describe('qk', () => {
  it('gives each resource its own key', () => {
    expect(qk.providers).toEqual(['providers'])
    expect(qk.benchmarks).toEqual(['benchmarks'])
    expect(qk.benchmark('b1')).toEqual(['benchmark', 'b1'])
    expect(qk.runs).toEqual(['runs'])
    expect(qk.run('r1')).toEqual(['run', 'r1'])
    expect(qk.snapshot('r1')).toEqual(['snapshot', 'r1'])
    expect(qk.episode('e1')).toEqual(['episode', 'e1'])
    expect(qk.steps('e1')).toEqual(['steps', 'e1'])
    expect(qk.report('r1')).toEqual(['report', 'r1'])
  })
})

describe('query hooks', () => {
  const cases: Array<{
    name: string
    url: string
    key: readonly unknown[]
    use: () => QueryProjection
  }> = [
    {
      name: 'useProviders',
      url: '/api/providers',
      key: qk.providers,
      use: () => useProviders(),
    },
    {
      name: 'useBenchmarks',
      url: '/api/benchmarks',
      key: qk.benchmarks,
      use: () => useBenchmarks(),
    },
    {
      name: 'useBenchmark',
      url: '/api/benchmarks/b1',
      key: qk.benchmark('b1'),
      use: () => useBenchmark('b1'),
    },
    {
      name: 'useRuns',
      url: '/api/runs',
      key: qk.runs,
      use: () => useRuns(),
    },
    {
      name: 'useRun',
      url: '/api/runs/r1',
      key: qk.run('r1'),
      use: () => useRun('r1'),
    },
    {
      name: 'useSnapshot',
      url: '/api/runs/r1/snapshot',
      key: qk.snapshot('r1'),
      use: () => useSnapshot('r1'),
    },
    {
      name: 'useEpisode',
      url: '/api/episodes/e1',
      key: qk.episode('e1'),
      use: () => useEpisode('e1'),
    },
    {
      name: 'useSteps',
      url: '/api/episodes/e1/steps',
      key: qk.steps('e1'),
      use: () => useSteps('e1'),
    },
    {
      name: 'useReport',
      url: '/api/runs/r1/report',
      key: qk.report('r1'),
      use: () => useReport('r1', true),
    },
  ]

  it.each(cases)('$name fetches $url', async ({ url, key, use }) => {
    vi.stubGlobal('fetch', fetchMock)
    const body = { marker: url }
    fetchMock.mockResolvedValue(jsonResponse(body))
    const { client, wrapper } = createWrapper()
    const { result } = renderHook(use, { wrapper })
    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(fetchMock.mock.calls[0][0]).toBe(url)
    // 数据必须落在该 hook 自己的键下，否则后续任务会读到别的资源。
    expect(client.getQueryData(key)).toEqual(body)
  })

  it('stays idle until the id arrives', () => {
    vi.stubGlobal('fetch', fetchMock)
    const gated: Array<() => QueryProjection> = [
      () => useBenchmark(undefined),
      () => useRun(undefined),
      () => useSnapshot(undefined),
      () => useEpisode(undefined),
      () => useSteps(undefined),
      () => useReport(undefined, true),
    ]
    for (const use of gated) {
      const { wrapper } = createWrapper()
      const { result } = renderHook(use, { wrapper })
      expect(result.current.fetchStatus).toBe('idle')
      expect(result.current.data).toBeUndefined()
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('gates the report on the run status flag', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(jsonResponse({ run_id: 'r1' }))
    const { wrapper: closedWrapper } = createWrapper()
    const closed = renderHook(() => useReport('r1', false), {
      wrapper: closedWrapper,
    })
    expect(closed.result.current.fetchStatus).toBe('idle')
    expect(closed.result.current.status).toBe('pending')
    expect(fetchMock).not.toHaveBeenCalled()

    const { wrapper: openWrapper } = createWrapper()
    const open = renderHook(() => useReport('r1', true), {
      wrapper: openWrapper,
    })
    await waitFor(() => expect(open.result.current.status).toBe('success'))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/runs/r1/report')
  })
})
