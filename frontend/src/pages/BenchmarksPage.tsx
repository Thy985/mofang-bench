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
import { Input } from '../ui/Input'
import { Skeleton } from '../ui/Skeleton'
import { Spinner } from '../ui/Spinner'

const DEPTHS = [1, 2, 3, 5, 10, 20]

// 基准集 id 由 name 拼成并被当作 URL 路径段用，后端对这三个字符回 400
const FORBIDDEN_NAME_CHARS = ['/', '#', '?'] as const

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
  const [formError, setFormError] = useState<string | null>(null)
  const [conflictId, setConflictId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function update(key: 'name' | 'per_depth' | 'seed', value: string) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function setCube(cube: CubeKind) {
    setForm((current) => ({
      ...current,
      cube,
      depths: current.depths.filter(
        (depth) => cube === '3x3' || depth !== 20,
      ),
    }))
  }

  function toggleDepth(depth: number) {
    if (form.cube === '2x2' && depth === 20) return
    setForm((current) => ({
      ...current,
      depths: current.depths.includes(depth)
        ? current.depths.filter((item) => item !== depth)
        : [...current.depths, depth].sort((a, b) => a - b),
    }))
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setFormError(null)
    setConflictId(null)
    if (FORBIDDEN_NAME_CHARS.some((char) => form.name.includes(char))) {
      setFormError('名称不能包含 / # ?')
      return
    }
    if (form.depths.length === 0) {
      setFormError('至少选择一个深度')
      return
    }
    const perDepth = readPositiveInt(form.per_depth)
    if (perDepth === null) {
      setFormError('每档题数必须是正整数')
      return
    }
    const seed = readInteger(form.seed)
    if (seed === null) {
      setFormError('seed 必须是整数')
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
    } catch (err) {
      const conflict = readConflict(err)
      if (conflict) {
        setConflictId(conflict.id)
        setFormError(
          conflict.id ? `已存在同 id 题集：${conflict.id}` : '已存在同 id 题集',
        )
      } else {
        setFormError(describeError(err))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Benchmarks</h1>
      {error && <Alert tone="danger">{error}</Alert>}
      <form
        onSubmit={handleSubmit}
        data-testid="benchmark-form"
        className="grid gap-3 rounded border border-line bg-surface p-4 md:grid-cols-2"
      >
        <label className="grid gap-1 text-sm">
          <span>名称</span>
          <Input
            value={form.name}
            onChange={(event) => update('name', event.target.value)}
            required
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>尺寸</span>
          <select
            className="rounded bg-sunken px-3 py-2 text-sm"
            value={form.cube}
            onChange={(event) =>
              setCube(event.target.value as CubeKind)
            }
          >
            <option value="2x2">2x2</option>
            <option value="3x3">3x3</option>
          </select>
        </label>
        <div className="grid gap-1 text-sm md:col-span-2">
          <span>打乱深度</span>
          <div className="flex flex-wrap gap-3">
            {DEPTHS.map((depth) => (
              <label key={depth} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.depths.includes(depth)}
                  disabled={form.cube === '2x2' && depth === 20}
                  onChange={() => toggleDepth(depth)}
                />
                <span>深度 {depth}</span>
              </label>
            ))}
          </div>
          {form.cube === '3x3' && (
            <p className="text-xs text-amber-400">
              3x3 生成需要已构建 twophase 表，可能较慢。
            </p>
          )}
        </div>
        <label className="grid gap-1 text-sm">
          <span>每档题数</span>
          <Input
            type="number"
            min={1}
            value={form.per_depth}
            onChange={(event) => update('per_depth', event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>seed</span>
          <Input
            type="number"
            value={form.seed}
            onChange={(event) => update('seed', event.target.value)}
          />
        </label>
        <div className="flex flex-wrap items-center gap-3 md:col-span-2">
          <Button
            variant="primary"
            type="submit"
            disabled={submitting}
          >
            {submitting && (
              <Spinner aria-hidden className="mr-2 border-text-dim border-t-white" />
            )}
            生成基准集
          </Button>
          {formError && (
            <p role="alert" className="text-sm text-rose-300">
              {formError}
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
        <div aria-busy="true" className="space-y-2">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      ) : benchmarks.length === 0 ? (
        // 加载失败时只留错误横幅，不再叠一句“还没有基准集”的引导文案
        error ? null : <p className="text-sm text-text-dim">还没有基准集。</p>
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
        await create.mutateAsync(payload)
      }}
    />
  )
}
