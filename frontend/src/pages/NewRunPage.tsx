import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { describeError } from '../lib/errors'
import {
  readNumberInRange,
  readPositiveInt,
  readPositiveNumber,
} from '../lib/validate'
import {
  useBenchmarks,
  useBenchmark,
  useProviders,
  qk,
} from '../api/queries'
import type {
  BenchmarkDetail,
  BenchmarkSummary,
  Budget,
  CubeKind,
  Provider,
  RunCreate,
  SkillMode,
  SolverMode,
  ToolMode,
} from '../api/types'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { ChoiceChips } from '../ui/ChoiceChips'
import { Input } from '../ui/Input'
import { ModeCards } from '../ui/ModeCards'
import { PageHeader } from '../ui/PageHeader'
import { PageSkeleton } from '../ui/PageSkeleton'
import { Select } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { toastError } from '../ui/toastError'

const DEFAULTS: Record<CubeKind, Budget> = {
  '2x2': {
    max_moves: 30,
    max_tool_calls: 50,
    max_tokens: 300000,
    max_seconds: 1800,
    turn_timeout: 600,
  },
  '3x3': {
    max_moves: 100,
    max_tool_calls: 150,
    max_tokens: 1000000,
    max_seconds: 2400,
    turn_timeout: 900,
  },
}

// skill 模式只抬高 max_moves；与后端 factory.SKILL_MAX_MOVES 保持一致。
const SKILL_MAX_MOVES: Record<Exclude<SkillMode, 'none'>, number> = {
  ortega: 36,
  lbl: 200,
}
const SKILL_CUBE: Record<Exclude<SkillMode, 'none'>, CubeKind> = {
  ortega: '2x2',
  lbl: '3x3',
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
  // benchmarkId 提到页面层：页面用 useBenchmark 拉详情（含 tasks）传下来，
  // View 保持纯展示、测试无需 QueryClient。可选仅为兼容旧用例直渲。
  benchmarkId?: string
  onBenchmarkChange?: (id: string) => void
  benchmarkDetail?: BenchmarkDetail | null
  benchmarkLoading?: boolean
  error?: string | null
  onCreate: (payload: RunCreate) => Promise<void>
}

const FIELD_IDS: Record<string, string> = {
  providerIds: 'newrun-providers',
  tasks: 'newrun-tasks',
  max_moves: 'newrun-budget-max_moves',
  max_tool_calls: 'newrun-budget-max_tool_calls',
  max_tokens: 'newrun-budget-max_tokens',
  max_seconds: 'newrun-budget-max_seconds',
  turn_timeout: 'newrun-budget-turn_timeout',
  temperature: 'newrun-temperature',
  params_max_tokens: 'newrun-params-max-tokens',
}
const FIELD_ORDER = [
  'providerIds',
  'tasks',
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
  benchmarkId = '',
  onBenchmarkChange = () => {},
  benchmarkDetail = null,
  benchmarkLoading = false,
  error,
  onCreate,
}: NewRunViewProps) {
  const [selectedProviders, setSelectedProviders] = useState<string[]>(
    providers[0] ? [providers[0].id] : [],
  )
  // null = 全选（默认）；选中题集切换后回落到全选
  const [selectedTasks, setSelectedTasks] = useState<Set<string> | null>(null)
  const [toolMode, setToolMode] = useState<ToolMode>('both')
  // 计划模式默认开启：prompt_version 记为 v2-plan，可与关闭的 run 消融对比
  const [requirePlan, setRequirePlan] = useState(true)
  // 求解器辅助默认关闭；assist 才暴露 solve 工具（只给建议，执行仍由模型负责）
  const [solverMode, setSolverMode] = useState<SolverMode>('off')
  // 方法 pack 默认不注入；首版与 assist 互斥
  const [skillMode, setSkillMode] = useState<SkillMode>('none')
  const [budget, setBudget] = useState<Record<BudgetKey, string>>(
    toBudgetForm(DEFAULTS['2x2']),
  )
  const [temperature, setTemperature] = useState('')
  const [maxTokens, setMaxTokens] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  // 页面层总传显式 benchmarkId；兜底首个题集，兼容未传 id 的直渲用例
  const activeBenchmarkId = benchmarkId || benchmarks[0]?.id || ''
  const selected = benchmarks.find((item) => item.id === activeBenchmarkId)
  const tasks = useMemo(
    () => benchmarkDetail?.tasks ?? [],
    [benchmarkDetail],
  )

  const selectedId = selected?.id
  const selectedCube = selected?.cube

  useEffect(() => {
    if (!selected) return
    const next = toBudgetForm(DEFAULTS[selected.cube])
    // 同阶数切换题集时保持 skill 模式的 max_moves，不回落成无 skill 的默认值。
    if (skillMode !== 'none' && SKILL_CUBE[skillMode] === selected.cube) {
      next.max_moves = String(SKILL_MAX_MOVES[skillMode])
    }
    setBudget(next)
  }, [selectedId, selectedCube])

  useEffect(() => {
    setSelectedTasks(null)
  }, [selectedId])

  // 阶数切换后，已选的 pack 若不适用就回落到 none（不静默提交错配组合）。
  useEffect(() => {
    if (
      selectedCube &&
      skillMode !== 'none' &&
      SKILL_CUBE[skillMode] !== selectedCube
    ) {
      setSkillMode('none')
    }
  }, [selectedCube, skillMode])

  function changeSkill(value: SkillMode) {
    setSkillMode(value)
    // 互斥：选了 pack 就关掉 assist；预算按模式默认抬高（用户仍可手动改回）。
    if (value !== 'none') {
      setSolverMode('off')
      setBudget((current) => ({
        ...current,
        max_moves: String(SKILL_MAX_MOVES[value]),
      }))
    } else if (selected) {
      setBudget((current) => ({
        ...current,
        max_moves: String(DEFAULTS[selected.cube].max_moves),
      }))
    }
  }

  function clearError(key: string) {
    setFieldErrors((current) => {
      if (!(key in current)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  function toggleProvider(id: string, checked: boolean) {
    clearError('providerIds')
    setSelectedProviders((current) =>
      checked ? [...current, id] : current.filter((item) => item !== id),
    )
  }

  function toggleTask(id: string, checked: boolean) {
    clearError('tasks')
    setSelectedTasks((current) => {
      const all = new Set(tasks.map((task) => task.id))
      if (checked) {
        if (current === null) return null // 本来就是全选
        const next = new Set(current)
        next.add(id)
        return next
      }
      // 从「全选」落到显式集合：先物化全集再移除
      const next = current ?? all
      const after = new Set(next)
      after.delete(id)
      return after
    })
  }

  function updateBudget(key: BudgetKey, value: string) {
    setBudget((current) => ({ ...current, [key]: value }))
    clearError(key)
  }

  // 留空语义保留：预算五项必填，可选参数留空 = 沿用 provider 默认，不报错。
  // 一次收集全部字段错误做全显，再统一聚焦首个错误字段。
  function validate(): {
    errors: Record<string, string>
    budget: Budget | null
    params: Record<string, number>
  } {
    const errors: Record<string, string> = {}
    if (selectedProviders.length === 0) {
      errors.providerIds = '请至少选择一个模型'
    }
    if (!activeBenchmarkId) {
      errors.providerIds = errors.providerIds ?? '请选择 provider 和 benchmark'
    }
    if (tasks.length > 0 && selectedTasks !== null && selectedTasks.size === 0) {
      errors.tasks = '请至少选择一道题'
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
    const selectedKeys =
      selectedTasks === null
        ? null
        : tasks.map((task) => task.id).filter((id) => selectedTasks.has(id))
    const allSelected = selectedKeys !== null && selectedKeys.length === tasks.length
    setSubmitting(true)
    try {
      await onCreate({
        provider_ids: selectedProviders,
        benchmark_id: activeBenchmarkId,
        tool_mode: toolMode,
        task_keys: allSelected ? null : selectedKeys,
        require_plan: requirePlan,
        solver: solverMode,
        skill: skillMode,
        params: parsedParams,
        budget: parsedBudget,
      })
    } catch {
      // toast 由页面层出（决策 ①）
    } finally {
      setSubmitting(false)
    }
  }

  const selectedCount =
    selectedTasks === null ? tasks.length : selectedTasks.size
  const selectedProviderNames = selectedProviders
    .map((id) => providers.find((p) => p.id === id)?.name)
    .filter((name): name is string => Boolean(name))

  return (
    <div>
      <PageHeader
        eyebrow="评测记录"
        title="New Run"
        subtitle="选择模型与题集，启动一次评测"
      />
      {error && (
        <div className="mb-5">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
      {!error && providers.length === 0 && (
        <p className="mb-5 text-sm text-warning">
          还没有 provider，先到 <Link className="text-accent" to="/providers">Providers</Link> 配置。
        </p>
      )}
      {!error && benchmarks.length === 0 && (
        <p className="mb-5 text-sm text-warning">
          还没有基准集，先到 <Link className="text-accent" to="/benchmarks">Benchmarks</Link> 生成。
        </p>
      )}
      {/* noValidate：小数秒/超时与显式 0 都交给提交时的中文校验，不要浏览器原生气泡 */}
      <form noValidate onSubmit={handleSubmit} className="new-grid">
        <div className="min-w-0">
          <section className="group">
            <header>
              <span className="idx">01</span>
              <h2>模型与题集</h2>
              <span className="note">每个模型各建一个 run 并行执行</span>
            </header>

            <div className="field">
              <div className="flex items-center justify-between gap-3">
                <span className="lab mb-0">模型</span>
                <span className="flex items-center gap-1.5">
                  <span className="text-xs text-text-faint">
                    已选 {selectedProviders.length}/{providers.length}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      clearError('providerIds')
                      setSelectedProviders(providers.map((item) => item.id))
                    }}
                  >
                    全选
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      clearError('providerIds')
                      setSelectedProviders([])
                    }}
                  >
                    清空
                  </Button>
                </span>
              </div>
              <ChoiceChips
                id="newrun-providers"
                data-testid="newrun-providers"
                tabIndex={-1}
                options={providers.map((provider) => ({
                  value: provider.id,
                  title: provider.name,
                  hint: `（${provider.model}）`,
                }))}
                selected={new Set(selectedProviders)}
                onToggle={toggleProvider}
              />
              {fieldErrors.providerIds && (
                <p role="alert" className="mt-1 text-xs text-danger">
                  {fieldErrors.providerIds}
                </p>
              )}
            </div>

            <div className="field">
              <label htmlFor="newrun-benchmark" className="lab">
                Benchmark
              </label>
              <Select
                id="newrun-benchmark"
                value={activeBenchmarkId}
                onChange={(event) => onBenchmarkChange(event.target.value)}
              >
                {benchmarks.map((benchmark) => (
                  <option key={benchmark.id} value={benchmark.id}>
                    {benchmark.name} ({benchmark.cube}, {benchmark.task_count} 题)
                  </option>
                ))}
              </Select>
            </div>

            <div className="field">
              <div className="flex items-center justify-between gap-3">
                <span className="lab mb-0">
                  选题子集
                  {benchmarkLoading && (
                    <span className="ml-2 text-text-faint">题目加载中…</span>
                  )}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="text-xs text-text-faint">
                    已选 {selectedCount}/{tasks.length}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      clearError('tasks')
                      setSelectedTasks(null)
                    }}
                  >
                    全选
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      clearError('tasks')
                      setSelectedTasks(new Set())
                    }}
                  >
                    清空
                  </Button>
                </span>
              </div>
              {tasks.length > 0 && (
                <ChoiceChips
                  id="newrun-tasks"
                  data-testid="newrun-tasks"
                  tabIndex={-1}
                  className="max-h-24 overflow-auto pr-1"
                  options={tasks.map((task) => ({
                    value: task.id,
                    title: `#${task.id}`,
                    hint: `· bin ${task.bin} · 参照 ${task.reference_length}`,
                  }))}
                  selected={
                    selectedTasks ?? new Set(tasks.map((task) => task.id))
                  }
                  onToggle={toggleTask}
                />
              )}
              {fieldErrors.tasks && (
                <p role="alert" className="mt-1 text-xs text-danger">
                  {fieldErrors.tasks}
                </p>
              )}
            </div>
          </section>

          <section className="group">
            <header>
              <span className="idx">02</span>
              <h2>策略</h2>
              <span className="note">工具与提示词模式</span>
            </header>

            <div className="field">
              <span className="lab">工具模式</span>
              <ModeCards
                aria-label="工具模式"
                value={toolMode}
                onChange={(value) => setToolMode(value as ToolMode)}
                options={[
                  {
                    value: 'both',
                    title: 'both',
                    hint: 'turn + apply_moves',
                    badge: '默认',
                  },
                  {
                    value: 'turn_only',
                    title: 'turn only',
                    hint: '只发 turn（单步）',
                    badge: '单步',
                  },
                  {
                    value: 'batch_only',
                    title: 'apply_moves only',
                    hint: '只发 apply_moves（批量）',
                    badge: '批量',
                  },
                ]}
              />
            </div>

            <div className="field">
              <span className="lab">求解器辅助</span>
              <ModeCards
                aria-label="求解器辅助"
                value={solverMode}
                onChange={(value) => setSolverMode(value as SolverMode)}
                options={[
                  {
                    value: 'off',
                    title: 'off',
                    hint: '不提供 solve 工具',
                    badge: '默认',
                  },
                  {
                    value: 'assist',
                    title: 'assist',
                    hint: '提供 solve，仅建议、不自动执行',
                    badge: '建议',
                    disabled: skillMode !== 'none',
                  },
                ]}
              />
            </div>

            <div className="field">
              <span className="lab">方法 pack（skill）</span>
              <ModeCards
                aria-label="方法 pack（skill）"
                value={skillMode}
                onChange={(value) => changeSkill(value as SkillMode)}
                options={[
                  {
                    value: 'none',
                    title: 'none',
                    hint: '不注入方法',
                    badge: '默认',
                  },
                  {
                    value: 'ortega',
                    title: 'ortega',
                    hint: '2x2 · Ortega 方法',
                    badge: '2x2',
                    disabled: selectedCube !== '2x2' || solverMode === 'assist',
                  },
                  {
                    value: 'lbl',
                    title: 'lbl',
                    hint: '3x3 · 入门分层法',
                    badge: '3x3',
                    disabled: selectedCube !== '3x3' || solverMode === 'assist',
                  },
                ]}
              />
              {solverMode === 'assist' && (
                <span className="field-hint text-warning">
                  assist 与 skill 首版互斥：先关闭 assist 才能选 pack。
                </span>
              )}
            </div>

            <div className="field" data-testid="newrun-require-plan">
              <span className="lab">计划模式</span>
              <ModeCards
                aria-label="计划模式"
                value={requirePlan ? 'on' : 'off'}
                onChange={(value) => setRequirePlan(value === 'on')}
                options={[
                  {
                    value: 'on',
                    title: '开启',
                    hint: '先提交 goal 与分阶段计划',
                    badge: 'v2-plan',
                  },
                  {
                    value: 'off',
                    title: '关闭',
                    hint: '关掉可与开启的 run 做消融对比',
                    badge: 'v1',
                  },
                ]}
              />
            </div>

            <div
              data-testid="newrun-mode-summary"
              className="flex flex-wrap items-center gap-1.5"
            >
              <span className="text-xs text-text-faint">模式</span>
              <span className="chip h-[22px] cursor-default text-[10.5px]">
                工具 {toolMode}
              </span>
              <span className="chip h-[22px] cursor-default text-[10.5px]">
                求解器 {solverMode}
              </span>
              <span className="chip h-[22px] cursor-default text-[10.5px]">
                pack {skillMode}
              </span>
              <span
                className={`chip h-[22px] cursor-default text-[10.5px] ${
                  requirePlan ? 'text-accent' : ''
                }`}
              >
                计划 {requirePlan ? 'ON' : 'OFF'}
              </span>
            </div>
          </section>

          <section className="group">
            <header>
              <span className="idx">03</span>
              <h2>预算与参数</h2>
              <span className="note">未配置价格，仅统计 tokens</span>
            </header>

            <div className="budget-row">
              {(
                [
                  ['max_moves', '最大步数', '步'],
                  ['max_seconds', '最长秒数', '秒'],
                  ['max_tool_calls', '工具调用', '次'],
                  ['max_tokens', '最大 tokens', 'tokens'],
                  ['turn_timeout', '单轮超时', '秒'],
                ] as const
              ).map(([key, label, unit]) => (
                <div key={key} className="min-w-0">
                  <label htmlFor={`newrun-budget-${key}`} className="lab">
                    {label}
                  </label>
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
                  <span className="u font-mono">{unit}</span>
                </div>
              ))}
            </div>

            <div className="field-row mt-3.5">
              <div>
                <label htmlFor="newrun-temperature" className="lab">
                  temperature
                </label>
                <Input
                  id="newrun-temperature"
                  aria-label="params_temperature"
                  value={temperature}
                  error={fieldErrors.temperature}
                  onChange={(event) => {
                    setTemperature(event.target.value)
                    clearError('temperature')
                  }}
                />
                <span className="field-hint">0 到 2，留空不覆盖</span>
              </div>
              <div>
                <label htmlFor="newrun-params-max-tokens" className="lab">
                  max_tokens
                </label>
                <Input
                  id="newrun-params-max-tokens"
                  aria-label="params_max_tokens"
                  type="number"
                  min={1}
                  value={maxTokens}
                  error={fieldErrors.params_max_tokens}
                  onChange={(event) => {
                    setMaxTokens(event.target.value)
                    clearError('params_max_tokens')
                  }}
                />
                <span className="field-hint">留空不覆盖</span>
              </div>
            </div>
          </section>
        </div>

        <aside className="summary">
          <h3>本次将启动</h3>
          <div className="sum-row">
            <span className="k">模型</span>
            <span className="v" title={selectedProviderNames.join(', ')}>
              {selectedProviders.length === 0
                ? '未选择'
                : selectedProviderNames.length > 1
                  ? `${selectedProviderNames[0]} 等 ${selectedProviderNames.length} 个`
                  : selectedProviderNames[0]}
            </span>
          </div>
          <div className="sum-row">
            <span className="k">题集</span>
            <span className="v">
              {selected ? `${selected.name} · ${selected.cube}` : '—'}
            </span>
          </div>
          <div className="sum-row">
            <span className="k">题目</span>
            <span className="v font-mono">
              {selectedCount}/{tasks.length || '—'}
            </span>
          </div>
          <div className="sum-row">
            <span className="k">工具</span>
            <span className="v font-mono">{toolMode}</span>
          </div>
          <div className="sum-row">
            <span className="k">求解器</span>
            <span className="v font-mono">{solverMode}</span>
          </div>
          <div className="sum-row">
            <span className="k">方法包</span>
            <span className="v font-mono">{skillMode}</span>
          </div>
          <div className="sum-row">
            <span className="k">计划</span>
            <span className={`v font-mono ${requirePlan ? 'text-accent' : ''}`}>
              {requirePlan ? 'ON' : 'OFF'}
            </span>
          </div>
          <div className="sum-row border-b-0">
            <span className="k">预算</span>
            <span className="v font-mono">
              {budget.max_moves} 步 · {budget.max_seconds}s
            </span>
          </div>

          <div className="mt-4">
            <Button
              variant="primary"
              type="submit"
              loading={submitting}
              className="w-full"
            >
              启动 run
            </Button>
          </div>
          <p className="mt-2 text-[11.5px] text-text-faint">
            将为所选的 {selectedProviders.length || 0} 个模型各创建一个 run。
          </p>
        </aside>
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
  const [searchParams] = useSearchParams()
  const requested = searchParams.get('benchmark')
  const [benchmarkId, setBenchmarkId] = useState('')

  // 数据到位后落初始值：URL ?benchmark= 指定优先，否则取列表第一项
  useEffect(() => {
    if (benchmarkId) return
    const list = benchmarks.data ?? []
    if (list.length === 0) return
    const initial =
      list.find((item) => item.id === requested)?.id ?? list[0].id
    setBenchmarkId(initial)
  }, [benchmarkId, requested, benchmarks.data])

  const detail = useBenchmark(benchmarkId || undefined)
  const create = useMutation({
    mutationFn: api.runs.create,
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: qk.runs })
      if (data.runs.length > 1) {
        toast.success(`已创建 ${data.runs.length} 个 run 并行执行`)
        navigate('/runs')
      } else {
        toast.success('Run 已创建')
        navigate(`/runs/${encodeURIComponent(data.id)}`)
      }
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
      benchmarkId={benchmarkId}
      onBenchmarkChange={setBenchmarkId}
      benchmarkDetail={detail.data ?? null}
      benchmarkLoading={detail.isFetching}
      error={loadError ? describeError(loadError) : null}
      onCreate={async (payload) => {
        try {
          await create.mutateAsync(payload)
        } catch (err) {
          toastError(toast, err)
          throw err
        }
      }}
    />
  )
}
