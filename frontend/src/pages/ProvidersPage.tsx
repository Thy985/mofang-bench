import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../api/client'
import { qk, useProviders } from '../api/queries'
import { describeError, describeProbeError } from '../lib/errors'
import { formatDate } from '../lib/format'
import { readNumberInRange, readPositiveInt } from '../lib/validate'
import type {
  ProbeResult,
  Provider,
  ProviderCreate,
} from '../api/types'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { Input } from '../ui/Input'
import { PageSkeleton } from '../ui/PageSkeleton'
import { Textarea } from '../ui/Textarea'
import { useToast } from '../ui/Toast'
import { toastError } from '../ui/toastError'

const FIELD_IDS: Record<string, string> = {
  base_url: 'provider-base-url',
  max_tokens: 'provider-max-tokens',
  temperature: 'provider-temperature',
  extra: 'provider-extra',
  api_key: 'provider-api-key',
}
const FIELD_ORDER = ['base_url', 'max_tokens', 'temperature', 'extra', 'api_key']

function focusFirstError(errors: Record<string, string>) {
  const key = FIELD_ORDER.find((k) => errors[k])
  if (!key) return
  const el = document.getElementById(FIELD_IDS[key])
  if (!el) return
  el.focus()
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

const initialForm = {
  name: '',
  base_url: 'http://localhost:20128/v1',
  model: '',
  api_key: '',
  api_key_ref: '',
  temperature: '0',
  max_tokens: '16384',
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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [probes, setProbes] = useState<
    Record<string, { kind: string | null; text: string }>
  >({})
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({})
  const [keyErrors, setKeyErrors] = useState<Record<string, string>>({})

  function update(key: keyof typeof initialForm, value: string) {
    setForm((current) => ({ ...current, [key]: value }))
    setFieldErrors((current) => {
      // api_key 错误（「API key 与环境变量名至少填一个」）是跨字段的，
      // 两个输入任意一个变化都要清掉对方的错误
      const related =
        key === 'api_key' ? 'api_key_ref' : key === 'api_key_ref' ? 'api_key' : null
      const relatedHit = related !== null && related in current
      if (!(key in current) && !relatedHit) return current
      const next = { ...current }
      delete next[key]
      if (related) delete next[related]
      return next
    })
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (submitting) return
    const errors: Record<string, string> = {}
    if (
      !form.base_url.startsWith('http://') &&
      !form.base_url.startsWith('https://')
    ) {
      errors.base_url = 'base_url 必须是 http(s)'
    }
    const maxTokens = readPositiveInt(form.max_tokens)
    if (maxTokens === null) {
      errors.max_tokens = 'max_tokens 必须是正整数'
    }
    const temperature = readNumberInRange(form.temperature, 0, 2)
    if (temperature === null) {
      errors.temperature = 'temperature 必须是 0 到 2 之间的数值'
    }
    let extra: Record<string, unknown> = {}
    try {
      const parsed: unknown = JSON.parse(form.extra || '{}')
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        errors.extra = 'extra 必须是 JSON 对象'
      } else {
        extra = parsed as Record<string, unknown>
      }
    } catch {
      errors.extra = 'extra 必须是合法 JSON'
    }
    const apiKey = form.api_key.trim()
    const apiKeyRef = form.api_key_ref.trim()
    if (!apiKey && !apiKeyRef) {
      errors.api_key = 'API key 与环境变量名至少填一个'
    }
    setFieldErrors(errors)
    if (
      Object.keys(errors).length > 0 ||
      maxTokens === null ||
      temperature === null
    ) {
      focusFirstError(errors)
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
      setFieldErrors({})
    } catch {
      // 提交失败反馈走页面层 toast（决策 ①），字段错误已常驻
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
    setProbes((current) => ({
      ...current,
      [id]: { kind: null, text: '探测中…' },
    }))
    try {
      const result = await onProbe(id)
      setProbes((current) => ({
        ...current,
        [id]: result.tool_calling
          ? { kind: null, text: '支持 tool calling' }
          : { kind: null, text: '不支持 tool calling' },
      }))
    } catch (err) {
      setProbes((current) => ({ ...current, [id]: describeProbeError(err) }))
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Providers</h1>
      {error && <Alert tone="danger">{error}</Alert>}
      <form
        onSubmit={handleSubmit}
        className="grid gap-3 rounded border border-line bg-surface p-4 md:grid-cols-2"
      >
        <label className="grid gap-1 text-sm">
          <span>名称</span>
          <Input
            id="provider-name"
            value={form.name}
            onChange={(event) => update('name', event.target.value)}
            required
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>模型</span>
          <Input
            id="provider-model"
            value={form.model}
            onChange={(event) => update('model', event.target.value)}
            required
          />
        </label>
        <label className="grid gap-1 text-sm md:col-span-2">
          <span>base_url</span>
          <Input
            id="provider-base-url"
            value={form.base_url}
            onChange={(event) => update('base_url', event.target.value)}
            error={fieldErrors.base_url}
            // 不加 required：原生的 required 会拦截空 base_url 的提交
            // （浏览器/jsdom 都先于 onSubmit 跑约束校验），
            // 字段级校验"errors.base_url"就永远走不到；空值由校验器兜底。
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>API key（可选，保存后不回显）</span>
          <Input
            id="provider-api-key"
            type="password"
            autoComplete="off"
            value={form.api_key}
            onChange={(event) => update('api_key', event.target.value)}
            error={fieldErrors.api_key}
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>API key 环境变量</span>
          <Input
            id="provider-api-key-ref"
            value={form.api_key_ref}
            onChange={(event) =>
              update('api_key_ref', event.target.value)
            }
            placeholder="可选，例如 OPENAI_API_KEY"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>temperature</span>
          <Input
            id="provider-temperature"
            type="number"
            step="0.1"
            value={form.temperature}
            onChange={(event) =>
              update('temperature', event.target.value)
            }
            error={fieldErrors.temperature}
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>max_tokens</span>
          <Input
            id="provider-max-tokens"
            type="number"
            value={form.max_tokens}
            onChange={(event) =>
              update('max_tokens', event.target.value)
            }
            error={fieldErrors.max_tokens}
          />
        </label>
        <label className="grid gap-1 text-sm md:col-span-2">
          <span>extra JSON</span>
          <Textarea
            id="provider-extra"
            className="font-mono text-xs"
            rows={2}
            value={form.extra}
            onChange={(event) => update('extra', event.target.value)}
            error={fieldErrors.extra}
          />
        </label>
        <div className="flex items-center gap-3 md:col-span-2">
          <Button variant="primary" type="submit" loading={submitting}>
            保存 provider
          </Button>
        </div>
      </form>

      {loading ? (
        <PageSkeleton variant="cards" count={2} />
      ) : providers.length === 0 ? (
        // 加载失败时只留错误横幅，不再叠一句“还没有 provider”的引导文案
        error ? null : (
          <EmptyState
            title="还没有 provider"
            hint="可在上方表单直接保存 API key，或用环境变量名回退。"
          />
        )
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {providers.map((provider) => (
            <li
              key={provider.id}
              data-testid="provider-card"
              className="space-y-2 rounded border border-line bg-surface p-4 text-sm"
            >
              <div className="text-base font-medium">{provider.name}</div>
              <div className="text-text-dim">
                {provider.model} · {provider.base_url}
              </div>
              <div className="text-text-dim">
                环境变量：{provider.api_key_ref || '—'} · 创建于{' '}
                {formatDate(provider.created_at)}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span
                  data-testid="key-configured"
                  className={
                    provider.key_configured ? 'text-accent' : 'text-warning'
                  }
                >
                  {provider.key_stored
                    ? 'key 已保存（不回显）'
                    : provider.key_configured
                      ? 'key 来自环境变量'
                      : 'key 未配置'}
                </span>
                <Button
                  type="button"
                  onClick={() => void handleProbe(provider.id)}
                >
                  探测
                </Button>
                {probes[provider.id] && (
                  <span className="flex items-center gap-2 text-text">
                    {probes[provider.id].kind && (
                      <span
                        data-testid="probe-kind"
                        className="rounded border border-warning px-1.5 py-0.5 text-xs text-amber-300"
                      >
                        {probes[provider.id].kind}
                      </span>
                    )}
                    <span data-testid="probe-error">
                      {probes[provider.id].text}
                    </span>
                  </span>
                )}
              </div>
              <details className="text-sm">
                <summary className="cursor-pointer text-text-dim">
                  设置/更换 key
                </summary>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Input
                    type="password"
                    autoComplete="off"
                    aria-label={`新 API key（${provider.name}）`}
                    value={keyDrafts[provider.id] ?? ''}
                    onChange={(event) =>
                      setKeyDrafts((current) => ({
                        ...current,
                        [provider.id]: event.target.value,
                      }))
                    }
                  />
                  <Button
                    type="button"
                    onClick={() => void handleSetKey(provider.id)}
                  >
                    保存 key
                  </Button>
                  {provider.key_stored && (
                    <Button
                      type="button"
                      onClick={() => void handleClearKey(provider.id)}
                      variant="danger"
                    >
                      清除 key
                    </Button>
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
  const toast = useToast()
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
        try {
          await create.mutateAsync(payload)
          toast.success('Provider 已创建')
        } catch (err) {
          toastError(toast, err)
          throw err
        }
      }}
      onProbe={async (id) => {
        try {
          return await probe.mutateAsync(id)
        } catch (err) {
          toastError(toast, err)
          throw err
        }
      }}
      onSetKey={async (id, key) => {
        try {
          await setKey.mutateAsync({ id, key })
          toast.success('API key 已保存')
        } catch (err) {
          toastError(toast, err)
          throw err
        }
      }}
      onClearKey={async (id) => {
        try {
          await clearKey.mutateAsync(id)
          toast.success('API key 已清除')
        } catch (err) {
          toastError(toast, err)
          throw err
        }
      }}
    />
  )
}
