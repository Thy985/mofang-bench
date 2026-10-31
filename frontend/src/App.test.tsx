import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

// 路由 lazy 导入 RunPage → CubeView → three；vi.mock 对动态导入同样生效，jsdom 用不到 WebGL。
vi.mock('./cube/CubeView', () => ({
  CubeView: () => <div data-testid="cube-stub" />,
}))

beforeEach(() => {
  // Providers 页挂载即发 GET /api/providers，该 stub 就是它的空列表响应。
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => [],
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('App routes', () => {
  it('renders the providers page and navigation', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/providers']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(
      await screen.findByRole('heading', { name: 'Providers' }),
    ).toBeInTheDocument()
    // 占位组件只有标题；断言表单按钮才能证明接的是真实页面
    expect(
      await screen.findByRole('button', { name: '保存 provider' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Runs' })).toBeInTheDocument()
  })

  it('renders the runs history route', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/runs']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(
      await screen.findByRole('heading', { name: 'Runs' }),
    ).toBeInTheDocument()
    // 占位组件只有标题；空状态文案才能证明接的是真实页面
    expect(await screen.findByText('还没有运行记录')).toBeInTheDocument()
  })

  it('renders the new run route', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/runs/new']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(
      await screen.findByRole('heading', { name: 'New Run' }),
    ).toBeInTheDocument()
    expect(
      await screen.findByRole('button', { name: '启动 run' }),
    ).toBeInTheDocument()
  })
})
