import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../api/client'
import { qk, useProviders } from '../api/queries'
import { describeError } from '../lib/errors'
import { readNumberInRange, readPositiveInt } from '../lib/validate'
import type {
  ProbeResult,
  Provider,
  ProviderCreate,
} from '../api/types'

const initialForm = {
  name: '',
  base_url: 'http://localhost:20128/v1',
  model: '',
  api_key: '',
  api_key_ref: '',
  temperature: '0',
  max_tokens: '4096',
  extra: '{}',
}

export interface ProvidersViewProps {
  providers: Provider[]
  loading: boolean
  error: string | null
  onCreate: (payload: ProviderCreate) => Promise<void>
  onProbe: (id: string) => Promise<ProbeResult>
  onSetKey: (id: string, apiKey: string) => Promise<void>
  onClearKey: (id: string) => Promise<void>
}

export function ProvidersView({
  providers,
  loading,
  error,
  onCreate,
  onProbe,
  onSetKey,
  onClearKey,
}: ProvidersViewProps) {
  const [form, setForm] = useState(initialForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [probes, setProbes] = useState<Record<string, string>>({})
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({})
  const [keyErrors, setKeyErrors] = useState<Record<string, string>>({})

  function update(key: keyof typeof initialForm, value: string) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setFormError(null)
    if (
      !form.base_url.startsWith('http://') &&
      !form.base_url.startsWith('https://')
    ) {
      setFormError('base_url 必须是 http(s)')
      return
    }
    const maxTokens = readPositiveInt(form.max_tokens)
    if (maxTokens === null) {
      setFormError('max_tokens 必须是正整数')
      return
    }
    const temperature = readNumberInRange(form.temperature, 0, 2)
    if (temperature === null) {
      setFormError('temperature 必须是 0 到 2 之间的数值')
      return
    }
    let extra: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(form.extra || '{}')
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setFormError('extra 必须是 JSON 对象')
        return
      }
      extra = parsed as Record<string, unknown>
    } catch {
      setFormError('extra 必须是合法 JSON')
      return
    }
    const apiKey = form.api_key.trim()
    const apiKeyRef = form.api_key_ref.trim()
    if (!apiKey && !apiKeyRef) {
      setFormError('API key 与环境变量名至少填一个')
      return
    }
    setSubmitting(true)
    try {
      await onCreate({
        name: form.name,
        base_url: form.base_url,
        model: form.model,
        api_key_ref: apiKeyRef,
        ...(apiKey ? { api_key: apiKey } : {}),
        params: {
          temperature,
          max_tokens: maxTokens,
          extra,
        },
      })
      setForm(initialForm)
    } catch (err) {
      setFormError(describeError(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSetKey(id: string) {
    const draft = (keyDrafts[id] ?? '').trim()
    if (!draft) {
      setKeyErrors((current) => ({
        ...current,
        [id]: '请先填写新的 API key',
      }))
      return
    }
    try {
      await onSetKey(id, draft)
      setKeyDrafts((current) => ({ ...current, [id]: '' }))
      setKeyErrors((current) => ({ ...current, [id]: '' }))
    } catch (err) {
      setKeyErrors((current) => ({ ...current, [id]: describeError(err) }))
    }
  }

  async function handleClearKey(id: string) {
    try {
      await onClearKey(id)
      setKeyErrors((current) => ({ ...current, [id]: '' }))
    } catch (err) {
      setKeyErrors((current) => ({ ...current, [id]: describeError(err) }))
    }
  }

  async function handleProbe(id: string) {
    setProbes((current) => ({ ...current, [id]: '探测中…' }))
    try {
      const result = await onProbe(id)
      setProbes((current) => ({
        ...current,
        [id]: result.tool_calling
          ? '支持 tool calling'
          : '不支持 tool calling',
      }))
    } catch (err) {
      setProbes((current) => ({
        ...current,
        [id]: describeError(err),
      }))
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Providers</h1>
      {error && (
        <p
          role="alert"
          className="rounded border border-rose-700 bg-rose-950/40 p-3 text-sm text-rose-300"
        >
          {error}
        </p>
      )}
      <form
        onSubmit={handleSubmit}
        className="grid gap-3 rounded border border-slate-800 bg-slate-900 p-4 md:grid-cols-2"
      >
        <label className="grid gap-1 text-sm">
          <span>名称</span>
          <input
            className="rounded bg-slate-950 px-3 py-2"
            value={form.name}
            onChange={(event) => update('name', event.target.value)}
            required
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>模型</span>
          <input
            className="rounded bg-slate-950 px-3 py-2"
            value={form.model}
            onChange={(event) => update('model', event.target.value)}
            required
          />
        </label>
        <label className="grid gap-1 text-sm md:col-span-2">
          <span>base_url</span>
          <input
            className="rounded bg-slate-950 px-3 py-2"
            value={form.base_url}
            onChange={(event) => update('base_url', event.target.value)}
            required
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>API key（可选，保存后不回显）</span>
          <input
            type="password"
            autoComplete="off"
            className="rounded bg-slate-950 px-3 py-2"
            value={form.api_key}
            onChange={(event) => update('api_key', event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>API key 环境变量</span>
          <input
            className="rounded bg-slate-950 px-3 py-2"
            value={form.api_key_ref}
            onChange={(event) =>
              update('api_key_ref', event.target.value)
            }
            placeholder="可选，例如 OPENAI_API_KEY"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>temperature</span>
          <input
            type="number"
            step="0.1"
            className="rounded bg-slate-950 px-3 py-2"
            value={form.temperature}
            onChange={(event) =>
              update('temperature', event.target.value)
            }
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>max_tokens</span>
          <input
            type="number"
            className="rounded bg-slate-950 px-3 py-2"
            value={form.max_tokens}
            onChange={(event) =>
              update('max_tokens', event.target.value)
            }
          />
        </label>
        <label className="grid gap-1 text-sm md:col-span-2">
          <span>extra JSON</span>
          <textarea
            className="rounded bg-slate-950 px-3 py-2 font-mono text-xs"
            rows={2}
            value={form.extra}
            onChange={(event) => update('extra', event.target.value)}
          />
        </label>
        <div className="flex items-center gap-3 md:col-span-2">
          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            保存 provider
          </button>
          {formError && (
            <p role="alert" className="text-sm text-rose-300">
              {formError}
            </p>
          )}
        </div>
      </form>

      {loading ? (
        <p className="text-sm text-slate-400">加载中…</p>
      ) : providers.length === 0 ? (
        // 加载失败时只留错误横幅，不再叠一句“还没有 provider”的引导文案
        error ? null : (
          <p className="text-sm text-slate-400">
            还没有 provider。可在上方直接保存 API key，或用环境变量名回退。
          </p>
        )
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {providers.map((provider) => (
            <li
              key={provider.id}
              data-testid="provider-card"
              className="space-y-2 rounded border border-slate-800 bg-slate-900 p-4 text-sm"
            >
              <div className="text-base font-medium">{provider.name}</div>
              <div className="text-slate-400">
                {provider.model} · {provider.base_url}
              </div>
              <div className="text-slate-500">
                环境变量：{provider.api_key_ref || '—'}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span
                  data-testid="key-configured"
                  className={
                    provider.key_configured
                      ? 'text-emerald-400'
                      : 'text-amber-400'
                  }
                >
                  {provider.key_stored
                    ? 'key 已保存（不回显）'
                    : provider.key_configured
                      ? 'key 来自环境变量'
                      : 'key 未配置'}
                </span>
                <button
                  type="button"
                  onClick={() => void handleProbe(provider.id)}
                  className="rounded border border-slate-700 px-3 py-1"
                >
                  探测
                </button>
                {probes[provider.id] && (
                  <span className="text-slate-300">{probes[provider.id]}</span>
                )}
              </div>
              <details className="text-sm">
                <summary className="cursor-pointer text-slate-400">
                  设置/更换 key
                </summary>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    type="password"
                    autoComplete="off"
                    aria-label={`新 API key（${provider.name}）`}
                    className="rounded bg-slate-950 px-2 py-1"
                    value={keyDrafts[provider.id] ?? ''}
                    onChange={(event) =>
                      setKeyDrafts((current) => ({
                        ...current,
                        [provider.id]: event.target.value,
                      }))
                    }
                  />
                  <button
                    type="button"
                    onClick={() => void handleSetKey(provider.id)}
                    className="rounded border border-slate-700 px-3 py-1"
                  >
                    保存 key
                  </button>
                  {provider.key_stored && (
                    <button
                      type="button"
                      onClick={() => void handleClearKey(provider.id)}
                      className="rounded border border-rose-700 px-3 py-1 text-rose-300"
                    >
                      清除 key
                    </button>
                  )}
                </div>
                {keyErrors[provider.id] && (
                  <p role="alert" className="mt-1 text-xs text-rose-300">
                    {keyErrors[provider.id]}
                  </p>
                )}
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function ProvidersPage() {
  const queryClient = useQueryClient()
  const providers = useProviders()
  const create = useMutation({
    mutationFn: api.providers.create,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: qk.providers }),
  })
  const probe = useMutation({ mutationFn: api.providers.probe })
  const setKey = useMutation({
    mutationFn: ({ id, key }: { id: string; key: string }) =>
      api.providers.setKey(id, key),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: qk.providers }),
  })
  const clearKey = useMutation({
    mutationFn: api.providers.clearKey,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: qk.providers }),
  })

  return (
    <ProvidersView
      providers={providers.data ?? []}
      loading={providers.isPending}
      error={providers.error ? describeError(providers.error) : null}
      onCreate={async (payload) => {
        await create.mutateAsync(payload)
      }}
      onProbe={async (id) => probe.mutateAsync(id)}
      onSetKey={async (id, key) => {
        await setKey.mutateAsync({ id, key })
      }}
      onClearKey={async (id) => {
        await clearKey.mutateAsync(id)
      }}
    />
  )
}
