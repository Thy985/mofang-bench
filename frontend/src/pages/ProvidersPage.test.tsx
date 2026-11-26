import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import type { Provider } from '../api/types'
import { ToastProvider } from '../ui/Toast'
import ProvidersPage, { ProvidersView } from './ProvidersPage'

// focusFirstError 会调 scrollIntoView，jsdom 未实现，桩成 no-op。
Element.prototype.scrollIntoView = vi.fn()

const provider: Provider = {
  id: 'p1',
  name: 'local',
  base_url: 'http://localhost:20128/v1',
  model: 'gpt-oss',
  api_key_ref: 'OPENAI_API_KEY',
  params: { temperature: 0, max_tokens: 4096 },
  key_configured: true,
  key_stored: false,
  created_at: '2026-10-26T00:00:00+00:00',
}

function renderView(
  overrides: Partial<
    React.ComponentProps<typeof ProvidersView>
  > = {},
) {
  const props = {
    providers: [] as Provider[],
    loading: false,
    error: null as string | null,
    onCreate: vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    onProbe: vi.fn().mockResolvedValue({
      ok: true,
      tool_calling: true,
    }),
    onSetKey: vi.fn().mockResolvedValue(undefined),
    onClearKey: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
  const utils = render(<ProvidersView {...props} />)
  return { ...utils, props }
}

describe('ProvidersView field errors', () => {
  it('提交时全显所有字段错误并聚焦第一个错误字段', async () => {
    const user = userEvent.setup()
    renderView({ providers: [] })
    // jsdom 30 会在提交时执行 required 约束校验，先填名称/模型再触发提交。
    await user.type(screen.getByLabelText('名称'), 'local')
    await user.type(screen.getByLabelText('模型'), 'm')
    const baseUrl = screen.getByLabelText('base_url')
    await user.clear(baseUrl)
    await user.clear(screen.getByLabelText('max_tokens'))
    await user.click(screen.getByRole('button', { name: '保存 provider' }))
    expect(screen.getByText('base_url 必须是 http(s)')).toBeInTheDocument()
    expect(screen.getByText('max_tokens 必须是正整数')).toBeInTheDocument()
    expect(
      screen.getByText('API key 与环境变量名至少填一个'),
    ).toBeInTheDocument()
    // 展示错误后 label 文本混入错误文案，getByLabelText 精确匹配会落空；
    // 用前面捕获的同一 DOM 节点断言聚焦（wrapper 稳定，节点不换）。
    expect(document.activeElement).toBe(baseUrl)
  })

  it('输入即清：修正字段后该字段错误消失，其余保留', async () => {
    const user = userEvent.setup()
    renderView({ providers: [] })
    await user.type(screen.getByLabelText('名称'), 'local')
    await user.type(screen.getByLabelText('模型'), 'm')
    const baseUrl = screen.getByLabelText('base_url')
    await user.clear(baseUrl)
    await user.click(screen.getByRole('button', { name: '保存 provider' }))
    expect(screen.getByText('base_url 必须是 http(s)')).toBeInTheDocument()
    await user.type(baseUrl, 'http://localhost/v1')
    expect(
      screen.queryByText('base_url 必须是 http(s)'),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText('API key 与环境变量名至少填一个'),
    ).toBeInTheDocument()
  })

  it('空列表渲染 EmptyState 引导', () => {
    renderView({ providers: [] })
    expect(screen.getByText('还没有 provider')).toBeInTheDocument()
  })
})

describe('ProvidersView', () => {
  it('creates a provider with a stored key and parsed params', async () => {
    const user = userEvent.setup()
    const { props } = renderView()
    await user.type(screen.getByLabelText('名称'), 'local')
    await user.type(screen.getByLabelText('模型'), 'gpt-oss')
    await user.type(
      screen.getByLabelText('API key（可选，保存后不回显）'),
      'sk-test',
    )
    await user.click(screen.getByRole('button', { name: '保存 provider' }))
    expect(props.onCreate).toHaveBeenCalledWith({
      name: 'local',
      base_url: 'http://localhost:20128/v1',
      model: 'gpt-oss',
      api_key_ref: '',
      api_key: 'sk-test',
      params: {
        temperature: 0,
        max_tokens: 32000,
        extra: {},
      },
    })
  })

  it('creates a provider with only an env ref', async () => {
    const user = userEvent.setup()
    const { props } = renderView()
    await user.type(screen.getByLabelText('名称'), 'local')
    await user.type(screen.getByLabelText('模型'), 'gpt-oss')
    await user.type(
      screen.getByLabelText('API key 环境变量'),
      'LOCAL_KEY',
    )
    await user.click(screen.getByRole('button', { name: '保存 provider' }))
    expect(props.onCreate).toHaveBeenCalledWith({
      name: 'local',
      base_url: 'http://localhost:20128/v1',
      model: 'gpt-oss',
      api_key_ref: 'LOCAL_KEY',
      params: {
        temperature: 0,
        max_tokens: 32000,
        extra: {},
      },
    })
  })

  it('requires a stored key or an env ref', async () => {
    const user = userEvent.setup()
    const { props } = renderView()
    await user.type(screen.getByLabelText('名称'), 'local')
    await user.type(screen.getByLabelText('模型'), 'gpt-oss')
    await user.click(screen.getByRole('button', { name: '保存 provider' }))
    // formError 通道已删除：字段校验错误现在经 Input 内建 error 文案常驻展示。
    expect(
      await screen.findByText('API key 与环境变量名至少填一个'),
    ).toBeInTheDocument()
    expect(props.onCreate).not.toHaveBeenCalled()
  })

  it('shows env key state and probe result', async () => {
    const user = userEvent.setup()
    renderView({ providers: [provider] })
    expect(screen.getByTestId('provider-card')).toHaveTextContent('local')
    expect(screen.getByTestId('key-configured')).toHaveTextContent(
      'key 来自环境变量',
    )
    await user.click(screen.getByRole('button', { name: '探测' }))
    expect(
      await screen.findByText('支持 tool calling'),
    ).toBeInTheDocument()
  })

  it('shows the provider creation time on the card', () => {
    renderView({ providers: [provider] })
    expect(screen.getByText(/创建于/)).toHaveTextContent('2026')
  })

  it('shows stored key state without echoing the key', () => {
    renderView({ providers: [{ ...provider, key_stored: true }] })
    expect(screen.getByTestId('key-configured')).toHaveTextContent(
      'key 已保存（不回显）',
    )
    expect(screen.queryByText(/sk-/)).not.toBeInTheDocument()
  })

  it('saves a replacement key for an existing provider', async () => {
    const user = userEvent.setup()
    const { props } = renderView({ providers: [provider] })
    await user.click(screen.getByText('设置/更换 key'))
    await user.type(screen.getByLabelText('新 API key（local）'), 'sk-new')
    await user.click(screen.getByRole('button', { name: '保存 key' }))
    expect(props.onSetKey).toHaveBeenCalledWith('p1', 'sk-new')
  })

  it('clears a stored key', async () => {
    const user = userEvent.setup()
    const { props } = renderView({
      providers: [{ ...provider, key_stored: true }],
    })
    await user.click(screen.getByText('设置/更换 key'))
    await user.click(screen.getByRole('button', { name: '清除 key' }))
    expect(props.onClearKey).toHaveBeenCalledWith('p1')
  })

  it('rejects invalid base_url and extra JSON', async () => {
    const user = userEvent.setup()
    const { props } = renderView()
    const baseUrl = screen.getByLabelText('base_url')
    await user.clear(baseUrl)
    await user.type(baseUrl, 'ftp://bad')
    await user.type(screen.getByLabelText('名称'), 'x')
    await user.type(screen.getByLabelText('模型'), 'm')
    await user.click(screen.getByRole('button', { name: '保存 provider' }))
    // formError 通道已删除：改为断言 base_url 字段错误文案。
    expect(await screen.findByText('base_url 必须是 http(s)')).toBeInTheDocument()
    expect(props.onCreate).not.toHaveBeenCalled()
  })

  it.each([
    ['max_tokens 清空', 'max_tokens', '', 'max_tokens 必须是正整数'],
    ['max_tokens 归零', 'max_tokens', '0', 'max_tokens 必须是正整数'],
    ['max_tokens 非数字', 'max_tokens', 'abc', 'max_tokens 必须是正整数'],
    [
      'temperature 越界',
      'temperature',
      '3',
      'temperature 必须是 0 到 2 之间的数值',
    ],
    [
      'temperature 非数字',
      'temperature',
      'abc',
      'temperature 必须是 0 到 2 之间的数值',
    ],
    // '[1,2]' 要写成 '[[1,2]'：userEvent 把单个 [ 当作修饰符描述符的开头。
    ['extra 是数组', 'extra JSON', '[[1,2]', 'extra 必须是 JSON 对象'],
    ['extra 是 null', 'extra JSON', 'null', 'extra 必须是 JSON 对象'],
    ['extra 是裸字符串', 'extra JSON', '"abc"', 'extra 必须是 JSON 对象'],
    ['extra 是数字', 'extra JSON', '42', 'extra 必须是 JSON 对象'],
  ])(
    'rejects %s before sending anything',
    async (_label, key, value, expected) => {
      const user = userEvent.setup()
      const { props } = renderView()
      await user.type(screen.getByLabelText('名称'), 'x')
      await user.type(screen.getByLabelText('模型'), 'm')
      const field = screen.getByLabelText(key)
      await user.clear(field)
      if (value !== '') await user.type(field, value)
      await user.click(screen.getByRole('button', { name: '保存 provider' }))
      // formError 通道已删除：改为断言对应字段的错误文案。
      expect(await screen.findByText(expected)).toBeInTheDocument()
      expect(props.onCreate).not.toHaveBeenCalled()
    },
  )

  it('View 吞掉提交失败：不设 formError，反馈走页面层 toast', async () => {
    const user = userEvent.setup()
    const onCreate = vi
      .fn()
      .mockRejectedValue(new ApiError(400, 'base_url must be http(s)'))
    renderView({ onCreate })
    await user.type(screen.getByLabelText('名称'), 'local')
    await user.type(screen.getByLabelText('模型'), 'gpt-oss')
    await user.type(
      screen.getByLabelText('API key（可选，保存后不回显）'),
      'sk-test',
    )
    await user.click(screen.getByRole('button', { name: '保存 provider' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalled())
    // 决策 ①：提交类失败在 View 层 catch 吞掉，页面级 toast 负责反馈；
    // 表单区不再出现 role="alert"。
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('unwraps the 502 dict detail when probe fails upstream', async () => {
    const user = userEvent.setup()
    const onProbe = vi.fn().mockRejectedValue(
      new ApiError(
        502,
        JSON.stringify({ kind: 'connection', message: 'connection refused' }),
      ),
    )
    renderView({ providers: [provider], onProbe })
    await user.click(screen.getByRole('button', { name: '探测' }))
    // 行为变更：502 dict detail 现在渲染 kind 徽标 + 原始 message，不再走通用“上游模型服务不可用”文案。
    expect(await screen.findByTestId('probe-kind')).toHaveTextContent(
      'connection',
    )
    expect(screen.getByTestId('probe-error')).toHaveTextContent(
      'connection refused',
    )
    expect(screen.queryByText(/上游模型服务不可用/)).not.toBeInTheDocument()
  })

  it('shows a Chinese network error when the backend is unreachable', async () => {
    const user = userEvent.setup()
    const onProbe = vi
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch'))
    renderView({ providers: [provider], onProbe })
    await user.click(screen.getByRole('button', { name: '探测' }))
    expect(await screen.findByText(/网络错误/)).toBeInTheDocument()
    expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument()
  })

  it('announces a list load failure through role="alert"', async () => {
    renderView({
      error: '网络错误：无法访问后端，请确认服务已启动',
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '网络错误：无法访问后端',
    )
  })

  it('hides the empty-state copy when the list failed to load', async () => {
    renderView({ error: '后端返回错误（HTTP 500）：boom' })
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 500')
    expect(
      screen.queryByText(/还没有 provider/),
    ).not.toBeInTheDocument()
  })

  it('shows the probe error kind as a badge next to the message', async () => {
    const user = userEvent.setup()
    const onProbe = vi.fn().mockRejectedValue(
      new ApiError(
        502,
        JSON.stringify({ kind: 'connection', message: 'connection refused' }),
      ),
    )
    render(
      <ProvidersView
        providers={[provider]}
        loading={false}
        error={null}
        onCreate={vi.fn()}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
        onProbe={onProbe}
        onSetKey={vi.fn().mockResolvedValue(undefined)}
        onClearKey={vi.fn().mockResolvedValue(undefined)}
      />,
    )
    await user.click(screen.getByRole('button', { name: '探测' }))
    expect(await screen.findByTestId('probe-kind')).toHaveTextContent(
      'connection',
    )
    expect(screen.getByTestId('probe-error')).toHaveTextContent(
      'connection refused',
    )
  })
})

describe('ProvidersView edit & delete', () => {
  it('编辑预填表单并在保存时提交更新载荷', async () => {
    const user = userEvent.setup()
    const { props } = renderView({ providers: [provider] })
    await user.click(screen.getByTestId('provider-edit'))
    const editForm = screen.getByTestId('provider-edit-form')
    expect(editForm).toBeInTheDocument()
    // 编辑表单不出现 key 字段，key 走卡片的「设置/更换 key」
    expect(
      within(editForm).queryByLabelText(/API key（可选/),
    ).not.toBeInTheDocument()
    expect(within(editForm).getByLabelText('名称')).toHaveValue('local')
    await user.clear(within(editForm).getByLabelText('名称'))
    await user.type(within(editForm).getByLabelText('名称'), 'renamed')
    await user.click(
      within(editForm).getByRole('button', { name: '保存修改' }),
    )
    expect(props.onUpdate).toHaveBeenCalledWith('p1', {
      name: 'renamed',
      base_url: 'http://localhost:20128/v1',
      model: 'gpt-oss',
      api_key_ref: 'OPENAI_API_KEY',
      params: { temperature: 0, max_tokens: 4096, extra: {} },
    })
  })

  it('保存成功后关闭编辑表单；取消也不发请求', async () => {
    const user = userEvent.setup()
    const { props } = renderView({ providers: [provider] })
    await user.click(screen.getByTestId('provider-edit'))
    await user.click(
      within(screen.getByTestId('provider-edit-form')).getByRole('button', {
        name: '取消',
      }),
    )
    expect(
      screen.queryByTestId('provider-edit-form'),
    ).not.toBeInTheDocument()
    await user.click(screen.getByTestId('provider-edit'))
    await user.click(
      within(screen.getByTestId('provider-edit-form')).getByRole('button', {
        name: '保存修改',
      }),
    )
    await waitFor(() =>
      expect(screen.queryByTestId('provider-edit-form')).not.toBeInTheDocument(),
    )
    expect(props.onUpdate).toHaveBeenCalledTimes(1)
  })

  it('编辑字段校验失败时不发请求', async () => {
    const user = userEvent.setup()
    const { props } = renderView({ providers: [provider] })
    await user.click(screen.getByTestId('provider-edit'))
    const editForm = screen.getByTestId('provider-edit-form')
    await user.clear(within(editForm).getByLabelText('max_tokens'))
    await user.click(
      within(editForm).getByRole('button', { name: '保存修改' }),
    )
    expect(
      await screen.findByText('max_tokens 必须是正整数'),
    ).toBeInTheDocument()
    expect(props.onUpdate).not.toHaveBeenCalled()
  })

  it('删除需二次确认，确认后才调用 onDelete', async () => {
    const user = userEvent.setup()
    const { props } = renderView({ providers: [provider] })
    await user.click(screen.getByTestId('provider-delete'))
    // 第一次点击只出现确认按钮，不删除
    expect(props.onDelete).not.toHaveBeenCalled()
    await user.click(screen.getByTestId('provider-delete-confirm'))
    expect(props.onDelete).toHaveBeenCalledWith('p1')
  })

  it('取消二次确认回到普通态', async () => {
    const user = userEvent.setup()
    const { props } = renderView({ providers: [provider] })
    await user.click(screen.getByTestId('provider-delete'))
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(
      screen.queryByTestId('provider-delete-confirm'),
    ).not.toBeInTheDocument()
    expect(props.onDelete).not.toHaveBeenCalled()
  })
})

describe('ProvidersPage toast', () => {
  function renderPage() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    return render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter>
            <ProvidersPage />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    )
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('创建成功出成功 toast', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? {
            ok: true,
            status: 201,
            statusText: 'Created',
            json: async () => ({
              id: 'p1',
              name: 'n',
              base_url: 'u',
              model: 'm',
              api_key_ref: '',
              params: {},
              key_configured: false,
              key_stored: false,
              created_at: '2026-10-31T00:00:00+00:00',
            }),
          }
        : { ok: true, status: 200, statusText: 'OK', json: async () => [] },
    )
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await user.type(screen.getByLabelText('名称'), 'n')
    await user.type(screen.getByLabelText('模型'), 'm')
    await user.type(
      screen.getByLabelText('API key（可选，保存后不回显）'),
      'k',
    )
    await user.click(screen.getByRole('button', { name: '保存 provider' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Provider 已创建',
    )
  })

  it('创建失败经 toastError 出错误 toast', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? {
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            json: async () => ({ detail: 'boom' }),
          }
        : { ok: true, status: 200, statusText: 'OK', json: async () => [] },
    )
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await user.type(screen.getByLabelText('名称'), 'n')
    await user.type(screen.getByLabelText('模型'), 'm')
    await user.type(
      screen.getByLabelText('API key（可选，保存后不回显）'),
      'k',
    )
    await user.click(screen.getByRole('button', { name: '保存 provider' }))
    const toast = await screen.findByRole('alert')
    expect(toast).toHaveTextContent('boom')
  })

  // 迁移自旧 View 级用例「maps a backend 400 on create to Chinese plus the detail」：
  // 提交失败断言改到页面级 toast 通道。
  it('后端 400 经 toastError 出中文转译 + detail 的错误 toast', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? {
            ok: false,
            status: 400,
            statusText: 'Bad Request',
            json: async () => ({ detail: 'base_url must be http(s)' }),
          }
        : { ok: true, status: 200, statusText: 'OK', json: async () => [] },
    )
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await user.type(screen.getByLabelText('名称'), 'local')
    await user.type(screen.getByLabelText('模型'), 'gpt-oss')
    await user.type(
      screen.getByLabelText('API key（可选，保存后不回显）'),
      'sk-test',
    )
    await user.click(screen.getByRole('button', { name: '保存 provider' }))
    const toast = await screen.findByRole('alert')
    expect(toast).toHaveTextContent('请求不合法（HTTP 400）')
    expect(toast).toHaveTextContent('base_url must be http(s)')
  })
})
