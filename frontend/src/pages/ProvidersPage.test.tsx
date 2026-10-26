import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import type { Provider } from '../api/types'
import { ProvidersView } from './ProvidersPage'

const provider: Provider = {
  id: 'p1',
  name: 'local',
  base_url: 'http://localhost:20128/v1',
  model: 'gpt-oss',
  api_key_ref: 'OPENAI_API_KEY',
  params: { temperature: 0, max_tokens: 4096 },
  key_configured: true,
  created_at: '2026-10-26T00:00:00+00:00',
}

describe('ProvidersView', () => {
  it('creates a provider with parsed params', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(undefined)
    const onProbe = vi.fn().mockResolvedValue({
      ok: true,
      tool_calling: true,
    })
    render(
      <ProvidersView
        providers={[]}
        loading={false}
        error={null}
        onCreate={onCreate}
        onProbe={onProbe}
      />,
    )
    await user.type(screen.getByLabelText('名称'), 'local')
    await user.type(screen.getByLabelText('模型'), 'gpt-oss')
    await user.click(screen.getByRole('button', { name: '保存 provider' }))
    expect(onCreate).toHaveBeenCalledWith({
      name: 'local',
      base_url: 'http://localhost:20128/v1',
      model: 'gpt-oss',
      api_key_ref: 'OPENAI_API_KEY',
      params: {
        temperature: 0,
        max_tokens: 4096,
        extra: {},
      },
    })
  })

  it('shows key state and probe result', async () => {
    const user = userEvent.setup()
    render(
      <ProvidersView
        providers={[provider]}
        loading={false}
        error={null}
        onCreate={vi.fn()}
        onProbe={vi.fn().mockResolvedValue({
          ok: true,
          tool_calling: true,
        })}
      />,
    )
    expect(screen.getByTestId('provider-card')).toHaveTextContent('local')
    expect(screen.getByTestId('key-configured')).toHaveTextContent(
      'key 已配置',
    )
    await user.click(screen.getByRole('button', { name: '探测' }))
    expect(
      await screen.findByText('支持 tool calling'),
    ).toBeInTheDocument()
  })

  it('rejects invalid base_url and extra JSON', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()
    render(
      <ProvidersView
        providers={[]}
        loading={false}
        error={null}
        onCreate={onCreate}
        onProbe={vi.fn()}
      />,
    )
    const baseUrl = screen.getByLabelText('base_url')
    await user.clear(baseUrl)
    await user.type(baseUrl, 'ftp://bad')
    await user.type(screen.getByLabelText('名称'), 'x')
    await user.type(screen.getByLabelText('模型'), 'm')
    await user.click(screen.getByRole('button', { name: '保存 provider' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'base_url 必须是 http(s)',
    )
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('maps a backend 400 on create to Chinese plus the detail', async () => {
    const user = userEvent.setup()
    const onCreate = vi
      .fn()
      .mockRejectedValue(new ApiError(400, 'base_url must be http(s)'))
    render(
      <ProvidersView
        providers={[]}
        loading={false}
        error={null}
        onCreate={onCreate}
        onProbe={vi.fn()}
      />,
    )
    await user.type(screen.getByLabelText('名称'), 'local')
    await user.type(screen.getByLabelText('模型'), 'gpt-oss')
    await user.click(screen.getByRole('button', { name: '保存 provider' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('请求不合法（HTTP 400）')
    expect(alert).toHaveTextContent('base_url must be http(s)')
  })

  it('unwraps the 502 dict detail when probe fails upstream', async () => {
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
        onProbe={onProbe}
      />,
    )
    await user.click(screen.getByRole('button', { name: '探测' }))
    const text = await screen.findByText(/上游模型服务不可用/)
    expect(text).toHaveTextContent('connection refused')
    expect(text.textContent).not.toContain('{')
  })

  it('shows a Chinese network error when the backend is unreachable', async () => {
    const user = userEvent.setup()
    const onProbe = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    render(
      <ProvidersView
        providers={[provider]}
        loading={false}
        error={null}
        onCreate={vi.fn()}
        onProbe={onProbe}
      />,
    )
    await user.click(screen.getByRole('button', { name: '探测' }))
    expect(await screen.findByText(/网络错误/)).toBeInTheDocument()
    expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument()
  })
})
