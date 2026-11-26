import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { ApiError, api } from '../api/client'
import { describeError } from '../lib/errors'
import { qk, useBenchmarks } from '../api/queries'
import type {
  BenchmarkCreate,
  BenchmarkDetail,
  BenchmarkSummary,
  CubeKind,
} from '../api/types'
import { formatDate, shortId } from '../lib/format'
import { readInteger, readPositiveInt } from '../lib/validate'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { ChoiceChips } from '../ui/ChoiceChips'
import { EmptyState } from '../ui/EmptyState'
import { Input } from '../ui/Input'
import { PageHeader } from '../ui/PageHeader'
import { PageSkeleton } from '../ui/PageSkeleton'
import { Select } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { toastError } from '../ui/toastError'

const DEPTHS = [1, 2, 3, 5, 10, 20]

// 基准集 id 由 name 拼成并被当作 URL 路径段用，后端对这三个字符回 400
const FORBIDDEN_NAME_CHARS = ['/', '#', '?'] as const

const FIELD_IDS: Record<string, string> = {
  name: 'benchmark-name',
  depths: 'benchmark-depths',
  per_depth: 'benchmark-per-depth',
  seed: 'benchmark-seed',
}
const FIELD_ORDER = ['name', 'depths', 'per_depth', 'seed']

function focusFirstError(errors: Record<string, string>) {
  const key = FIELD_ORDER.find((k) => errors[k])
  if (!key) return
  if (key === 'depths') {
    const box = document.querySelector(
      '#benchmark-depths input[type=checkbox]',
    )
    if (box) {
      ;(box as HTMLElement).focus()
      box.scrollIntoView({ block: 'center', behavior: 'smooth' })
      return
    }
  }
  const el = document.getElementById(FIELD_IDS[key])
  if (!el) return
  el.focus()
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

const initialForm = {
  name: '',
  cube: '2x2' as CubeKind,
  depths: [] as number[],
  per_depth: '2',
  seed: '42',
}

// 409 的 detail 是 JSON 字符串 {"message":"benchmark already exists","id":"..."}：
// 界面按 spec 固定中文文案，只从 detail 取 id 做回链，不吐英文 message。
function readConflict(err: unknown): { id: string | null } | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null
  try {
    const parsed: unknown = JSON.parse(err.detail)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const id = (parsed as { id?: unknown }).id
      if (typeof id === 'string' && id !== '') return { id }
    }
  } catch {
    // 非 JSON 的 409 detail 只剩文案，不给回链
  }
  return { id: null }
}

export interface BenchmarksViewProps {
  benchmarks: BenchmarkSummary[]
  loading: boolean
  error: string | null
  onCreate: (payload: BenchmarkCreate) => Promise<void>
}

export function BenchmarksView({
  benchmarks,
  loading,
  error,
  onCreate,
}: BenchmarksViewProps) {
  const [form, setForm] = useState(initialForm)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [conflictId, setConflictId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function update(key: 'name' | 'per_depth' | 'seed', value: string) {
    setForm((current) => ({ ...current, [key]: value }))
    setFieldErrors((current) => {
      if (!(key in current)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  function setCube(cube: CubeKind) {
    setForm((current) => ({
      ...current,
      cube,
      depths: current.depths.filter(
        (depth) => cube === '3x3' || depth !== 20,
      ),
    }))
    setFieldErrors((current) => {
      if (!('depths' in current)) return current
      const next = { ...current }
      delete next.depths
      return next
    })
  }

  function toggleDepth(depth: number) {
    if (form.cube === '2x2' && depth === 20) return
    setForm((current) => ({
      ...current,
      depths: current.depths.includes(depth)
        ? current.depths.filter((item) => item !== depth)
        : [...current.depths, depth].sort((a, b) => a - b),
    }))
    setFieldErrors((current) => {
      if (!('depths' in current)) return current
      const next = { ...current }
      delete next.depths
      return next
    })
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (submitting) return
    setConflictId(null)
    const errors: Record<string, string> = {}
    if (FORBIDDEN_NAME_CHARS.some((char) => form.name.includes(char))) {
      errors.name = '名称不能包含 / # ?'
    }
    if (form.depths.length === 0) {
      errors.depths = '至少选择一个深度'
    }
    const perDepth = readPositiveInt(form.per_depth)
    if (perDepth === null) {
      errors.per_depth = '每档题数必须是正整数'
    }
    const seed = readInteger(form.seed)
    if (seed === null) {
      errors.seed = 'seed 必须是整数'
    }
    setFieldErrors(errors)
    if (
      Object.keys(errors).length > 0 ||
      perDepth === null ||
      seed === null
    ) {
      focusFirstError(errors)
      return
    }
    setSubmitting(true)
    try {
      await onCreate({
        name: form.name,
        cube: form.cube,
        depths: form.depths,
        per_depth: perDepth,
        seed,
        solver: form.cube === '2x2' ? 'table' : 'rubik',
      })
      setForm(initialForm)
      setFieldErrors({})
    } catch (err) {
      const conflict = readConflict(err)
      if (conflict) {
        // id 为 null（非 JSON 409）时用空串占位，区分「无冲突」与「冲突无回链 id」
        setConflictId(conflict.id ?? '')
      }
      // 非 409 失败走页面层 toast（决策 ①）
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="题集" title="Benchmarks" />
      {error && <Alert tone="danger">{error}</Alert>}
      <form
        onSubmit={handleSubmit}
        data-testid="benchmark-form"
        className="clip-slant-r grid gap-3 rounded border border-line bg-surface p-4 md:grid-cols-2"
      >
        <label className="grid gap-1 text-sm">
          <span>名称</span>
          <Input
            id="benchmark-name"
            value={form.name}
            onChange={(event) => update('name', event.target.value)}
            error={fieldErrors.name}
            required
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>尺寸</span>
          <Select
            value={form.cube}
            onChange={(event) =>
              setCube(event.target.value as CubeKind)
            }
          >
            <option value="2x2">2x2</option>
            <option value="3x3">3x3</option>
          </Select>
        </label>
        <div id="benchmark-depths" className="grid gap-1 text-sm md:col-span-2">
          <div className="flex items-center justify-between">
            <span>打乱深度</span>
            <span className="text-xs text-text-dim">
              已选 {form.depths.length}/{DEPTHS.length}
            </span>
          </div>
          <ChoiceChips
            options={DEPTHS.map((depth) => ({
              value: String(depth),
              title: `深度 ${depth}`,
              disabled: form.cube === '2x2' && depth === 20,
            }))}
            selected={new Set(form.depths.map(String))}
            onToggle={(value) => toggleDepth(Number(value))}
          />
          {form.cube === '3x3' && (
            <p className="text-xs text-amber-400">
              3x3 生成需要已构建 twophase 表，可能较慢。
            </p>
          )}
          {fieldErrors.depths && (
            <p role="alert" className="text-xs text-rose-300">
              {fieldErrors.depths}
            </p>
          )}
        </div>
        <label className="grid gap-1 text-sm">
          <span>每档题数</span>
          <Input
            id="benchmark-per-depth"
            type="number"
            min={1}
            value={form.per_depth}
            onChange={(event) => update('per_depth', event.target.value)}
            error={fieldErrors.per_depth}
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>seed</span>
          <Input
            id="benchmark-seed"
            type="number"
            value={form.seed}
            onChange={(event) => update('seed', event.target.value)}
            error={fieldErrors.seed}
          />
        </label>
        <div className="flex flex-wrap items-center gap-3 md:col-span-2">
          <Button variant="primary" type="submit" loading={submitting}>
            生成基准集
          </Button>
          {conflictId !== null && (
            <p role="alert" className="text-sm text-rose-300">
              {conflictId ? `已存在同 id 题集：${conflictId}` : '已存在同 id 题集'}
              {conflictId && (
                <Link
                  className="ml-2 text-accent underline"
                  to={`/benchmarks/${encodeURIComponent(conflictId)}`}
                >
                  查看已有题集
                </Link>
              )}
            </p>
          )}
        </div>
      </form>

      {loading ? (
        <PageSkeleton variant="table" rows={4} />
      ) : benchmarks.length === 0 ? (
        // 加载失败时只留错误横幅，不再叠一句“还没有基准集”的引导文案
        error ? null : (
          <EmptyState
            title="还没有基准集"
            hint="用下方表单生成第一份题集。"
          />
        )
      ) : (
        <ul className="space-y-2">
          {benchmarks.map((benchmark) => (
            <li
              key={benchmark.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded border border-line bg-surface p-4 text-sm"
            >
              <div>
                <div className="font-medium">{benchmark.name}</div>
                <div className="text-text-dim">
                  {benchmark.id} · {benchmark.cube} ·{' '}
                  {benchmark.task_count} 题 · hash {shortId(benchmark.content_hash)} ·
                  冻结 {formatDate(benchmark.frozen_at)}
                </div>
              </div>
              <Link
                className="text-accent"
                to={`/benchmarks/${encodeURIComponent(benchmark.id)}`}
              >
                查看详情
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function BenchmarksPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const toast = useToast()
  const benchmarks = useBenchmarks()
  const create = useMutation({
    mutationFn: api.benchmarks.create,
    onSuccess: (benchmark: BenchmarkDetail) => {
      void queryClient.invalidateQueries({ queryKey: qk.benchmarks })
      navigate(`/benchmarks/${encodeURIComponent(benchmark.id)}`)
    },
  })

  return (
    <BenchmarksView
      benchmarks={benchmarks.data ?? []}
      loading={benchmarks.isPending}
      error={benchmarks.error ? describeError(benchmarks.error) : null}
      onCreate={async (payload) => {
        try {
          await create.mutateAsync(payload)
          toast.success('题集已生成')
        } catch (err) {
          // spec 决策 ③：409 冲突由 View 行内展示（readConflict 已处理），
          // 不进 toast，避免英文原始 message 上屏
          if (readConflict(err)) throw err
          toastError(toast, err)
          throw err
        }
      }}
    />
  )
}
