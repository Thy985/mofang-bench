import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { describeError } from '../lib/errors'
import {
  readNumberInRange,
  readPositiveInt,
  readPositiveNumber,
} from '../lib/validate'
import { useBenchmarks, useProviders, qk } from '../api/queries'
import type {
  BenchmarkSummary,
  Budget,
  CubeKind,
  Provider,
  RunCreate,
  ToolMode,
} from '../api/types'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { PageSkeleton } from '../ui/PageSkeleton'
import { Select } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { toastError } from '../ui/toastError'

const DEFAULTS: Record<CubeKind, Budget> = {
  '2x2': {
    max_moves: 30,
    max_tool_calls: 50,
    max_tokens: 300000,
    max_seconds: 300,
    turn_timeout: 120,
  },
  '3x3': {
    max_moves: 100,
    max_tool_calls: 150,
    max_tokens: 1000000,
    max_seconds: 900,
    turn_timeout: 120,
  },
}

type BudgetKey =
  | 'max_moves'
  | 'max_tool_calls'
  | 'max_tokens'
  | 'max_seconds'
  | 'turn_timeout'

// 后端 Budget 里 max_seconds / turn_timeout 是 float，spinner 要给 step="any" 才不卡小数
const FLOAT_KEYS = new Set<BudgetKey>(['max_seconds', 'turn_timeout'])

function toBudgetForm(budget: Budget): Record<BudgetKey, string> {
  return {
    max_moves: String(budget.max_moves),
    max_tool_calls: String(budget.max_tool_calls),
    max_tokens: String(budget.max_tokens),
    max_seconds: String(budget.max_seconds),
    turn_timeout: String(budget.turn_timeout),
  }
}

export interface NewRunViewProps {
  providers: Provider[]
  benchmarks: BenchmarkSummary[]
  error?: string | null
  onCreate: (payload: RunCreate) => Promise<void>
}

const FIELD_IDS: Record<string, string> = {
  providerId: 'newrun-provider',
  max_moves: 'newrun-budget-max_moves',
  max_tool_calls: 'newrun-budget-max_tool_calls',
  max_tokens: 'newrun-budget-max_tokens',
  max_seconds: 'newrun-budget-max_seconds',
  turn_timeout: 'newrun-budget-turn_timeout',
  temperature: 'newrun-temperature',
  params_max_tokens: 'newrun-params-max-tokens',
}
const FIELD_ORDER = [
  'providerId',
  'max_moves',
  'max_tool_calls',
  'max_tokens',
  'max_seconds',
  'turn_timeout',
  'temperature',
  'params_max_tokens',
]

function focusFirstError(errors: Record<string, string>) {
  const key = FIELD_ORDER.find((k) => errors[k])
  if (!key) return
  const el = document.getElementById(FIELD_IDS[key])
  if (!el) return
  el.focus()
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

export function NewRunView({
  providers,
  benchmarks,
  error,
  onCreate,
}: NewRunViewProps) {
  const [searchParams] = useSearchParams()
  const requested = searchParams.get('benchmark')
  const initialBenchmark =
    benchmarks.find((item) => item.id === requested) ?? benchmarks[0]
  const [providerId, setProviderId] = useState(providers[0]?.id ?? '')
  const [benchmarkId, setBenchmarkId] = useState(
    initialBenchmark?.id ?? '',
  )
  const [toolMode, setToolMode] = useState<ToolMode>('both')
  const [budget, setBudget] = useState<Record<BudgetKey, string>>(
    toBudgetForm(DEFAULTS[initialBenchmark?.cube ?? '2x2']),
  )
  const [temperature, setTemperature] = useState('')
  const [maxTokens, setMaxTokens] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const selected = benchmarks.find((item) => item.id === benchmarkId)

  const selectedId = selected?.id
  const selectedCube = selected?.cube

  useEffect(() => {
    if (selected) setBudget(toBudgetForm(DEFAULTS[selected.cube]))
  }, [selectedId, selectedCube])

  function updateBudget(key: BudgetKey, value: string) {
    setBudget((current) => ({ ...current, [key]: value }))
    setFieldErrors((current) => {
      if (!(key in current)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  // 留空语义保留：预算五项必填，可选参数留空 = 沿用 provider 默认，不报错。
  // 与旧 parseBudget/parseParams 的双态签名（Budget | string）不同，
  // 一次收集全部字段错误做全显，再统一聚焦首个错误字段。
  function validate(): {
    errors: Record<string, string>
    budget: Budget | null
    params: Record<string, number>
  } {
    const errors: Record<string, string> = {}
    if (!providerId || !benchmarkId) {
      errors.providerId = '请选择 provider 和 benchmark'
    }
    const budgetOut: Partial<Budget> = {}
    let budgetOk = true
    for (const key of ['max_moves', 'max_tool_calls', 'max_tokens'] as const) {
      const value = readPositiveInt(budget[key])
      if (value === null) {
        errors[key] = `${key} 必须是正整数`
        budgetOk = false
      } else {
        budgetOut[key] = value
      }
    }
    for (const key of ['max_seconds', 'turn_timeout'] as const) {
      const value = readPositiveNumber(budget[key])
      if (value === null) {
        errors[key] = `${key} 必须是正数`
        budgetOk = false
      } else {
        budgetOut[key] = value
      }
    }
    const params: Record<string, number> = {}
    if (temperature.trim() !== '') {
      const value = readNumberInRange(temperature, 0, 2)
      if (value === null) {
        errors.temperature = 'temperature 必须是 0 到 2 之间的数值'
      } else {
        params.temperature = value
      }
    }
    if (maxTokens.trim() !== '') {
      const value = readPositiveInt(maxTokens)
      if (value === null) {
        errors.params_max_tokens = 'max_tokens 必须是正整数'
      } else {
        params.max_tokens = value
      }
    }
    return {
      errors,
      budget: budgetOk ? (budgetOut as Budget) : null,
      params,
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (submitting) return
    const { errors, budget: parsedBudget, params: parsedParams } = validate()
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0 || parsedBudget === null) {
      focusFirstError(errors)
      return
    }
    setSubmitting(true)
    try {
      await onCreate({
        provider_id: providerId,
        benchmark_id: benchmarkId,
        tool_mode: toolMode,
        params: parsedParams,
        budget: parsedBudget,
      })
    } catch {
      // toast 由页面层出（决策 ①）
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">New Run</h1>
      {error && <Alert tone="danger">{error}</Alert>}
      {!error && providers.length === 0 && (
        <p className="text-sm text-amber-300">
          还没有 provider，先到 <Link to="/providers">Providers</Link> 配置。
        </p>
      )}
      {!error && benchmarks.length === 0 && (
        <p className="text-sm text-amber-300">
          还没有基准集，先到 <Link to="/benchmarks">Benchmarks</Link> 生成。
        </p>
      )}
      {/* noValidate：小数秒/超时与显式 0 都交给提交时的中文校验，不要浏览器原生气泡 */}
      <form
        noValidate
        onSubmit={handleSubmit}
        className="grid gap-3 rounded border border-line bg-surface p-4 md:grid-cols-2"
      >
        <label className="grid gap-1 text-sm">
          <span>Provider</span>
          <Select
            id="newrun-provider"
            value={providerId}
            error={fieldErrors.providerId}
            onChange={(event) => {
              setProviderId(event.target.value)
              setFieldErrors((current) => {
                if (!('providerId' in current)) return current
                const next = { ...current }
                delete next.providerId
                return next
              })
            }}
          >
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name} ({provider.model})
              </option>
            ))}
          </Select>
        </label>
        <label className="grid gap-1 text-sm">
          <span>Benchmark</span>
          <Select
            value={benchmarkId}
            onChange={(event) => {
              setBenchmarkId(event.target.value)
              // providerId 错误文案是「请选择 provider 和 benchmark」，跨字段
              setFieldErrors((current) => {
                if (!('providerId' in current)) return current
                const next = { ...current }
                delete next.providerId
                return next
              })
            }}
          >
            {benchmarks.map((benchmark) => (
              <option key={benchmark.id} value={benchmark.id}>
                {benchmark.name} ({benchmark.cube}, {benchmark.task_count} 题)
              </option>
            ))}
          </Select>
        </label>
        <label className="grid gap-1 text-sm">
          <span>工具模式</span>
          <Select
            value={toolMode}
            onChange={(event) =>
              setToolMode(event.target.value as ToolMode)
            }
          >
            <option value="both">both（turn + apply_moves）</option>
            <option value="turn_only">turn only</option>
            <option value="batch_only">apply_moves only</option>
          </Select>
        </label>
        <div className="grid gap-2 md:col-span-2">
          <p className="text-sm text-text-dim">
            预算上限（未配置价格，仅统计 tokens）
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {(
              [
                ['max_moves', '最大步数'],
                ['max_seconds', '最长秒数'],
                ['max_tool_calls', '工具调用'],
                ['max_tokens', '最大 tokens'],
                ['turn_timeout', '单轮超时'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="grid gap-1 text-xs">
                <span>{key}</span>
                <Input
                  id={`newrun-budget-${key}`}
                  aria-label={key}
                  type="number"
                  min={1}
                  step={FLOAT_KEYS.has(key) ? 'any' : undefined}
                  value={budget[key]}
                  error={fieldErrors[key]}
                  onChange={(event) =>
                    updateBudget(key, event.target.value)
                  }
                />
                <span className="text-text-dim">{label}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="grid gap-2 md:col-span-2">
          <p className="text-sm text-text-dim">
            可选参数覆盖（留空沿用 provider 默认）
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-xs">
              <span>temperature</span>
              <Input
                id="newrun-temperature"
                aria-label="params_temperature"
                value={temperature}
                error={fieldErrors.temperature}
                onChange={(event) => {
                  setTemperature(event.target.value)
                  setFieldErrors((current) => {
                    if (!('temperature' in current)) return current
                    const next = { ...current }
                    delete next.temperature
                    return next
                  })
                }}
              />
              <span className="text-text-dim">0 到 2，留空不覆盖</span>
            </label>
            <label className="grid gap-1 text-xs">
              <span>max_tokens</span>
              <Input
                id="newrun-params-max-tokens"
                aria-label="params_max_tokens"
                type="number"
                min={1}
                value={maxTokens}
                error={fieldErrors.params_max_tokens}
                onChange={(event) => {
                  setMaxTokens(event.target.value)
                  setFieldErrors((current) => {
                    if (!('params_max_tokens' in current)) return current
                    const next = { ...current }
                    delete next.params_max_tokens
                    return next
                  })
                }}
              />
              <span className="text-text-dim">留空不覆盖</span>
            </label>
          </div>
        </div>
        <div className="flex items-center gap-3 md:col-span-2">
          <Button variant="primary" type="submit" loading={submitting}>
            启动 run
          </Button>
        </div>
      </form>
    </div>
  )
}

export default function NewRunPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const toast = useToast()
  const providers = useProviders()
  const benchmarks = useBenchmarks()
  const create = useMutation({
    mutationFn: api.runs.create,
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: qk.runs })
      navigate(`/runs/${encodeURIComponent(data.id)}`)
    },
  })

  if (providers.isPending || benchmarks.isPending) {
    return <PageSkeleton variant="form" fields={5} />
  }

  const loadError = providers.error ?? benchmarks.error

  return (
    <NewRunView
      providers={providers.data ?? []}
      benchmarks={benchmarks.data ?? []}
      error={loadError ? describeError(loadError) : null}
      onCreate={async (payload) => {
        try {
          await create.mutateAsync(payload)
          toast.success('Run 已创建')
        } catch (err) {
          toastError(toast, err)
          throw err
        }
      }}
    />
  )
}
