import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { useBenchmark } from '../api/queries'
import { describeError } from '../lib/errors'
import { formatDate } from '../lib/format'
import type { BenchmarkDetail, SelfcheckResult } from '../api/types'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { PageHeader } from '../ui/PageHeader'
import { PageSkeleton } from '../ui/PageSkeleton'
import { Table, Td, Th } from '../ui/Table'

export interface BenchmarkDetailViewProps {
  benchmark: BenchmarkDetail
  // 可选仅为兼容旧用例直渲；页面层总是传入
  onSelfcheck?: () => Promise<SelfcheckResult>
}

export function BenchmarkDetailView({
  benchmark,
  onSelfcheck,
}: BenchmarkDetailViewProps) {
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<SelfcheckResult | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)

  async function handleSelfcheck() {
    if (checking || !onSelfcheck) return
    setChecking(true)
    setCheckError(null)
    try {
      setResult(await onSelfcheck())
    } catch (err) {
      setCheckError(describeError(err))
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="题集"
        title={benchmark.name}
        subtitle={`${benchmark.id} · ${benchmark.cube} · ${benchmark.tasks.length} 题 · hash ${benchmark.content_hash} · 冻结 ${formatDate(benchmark.frozen_at)}}`}
        actions={
          <Button
            type="button"
            data-testid="selfcheck-button"
            loading={checking}
            onClick={() => void handleSelfcheck()}
          >
            Harness 自检
          </Button>
        }
      />
      <p className="text-xs text-text-dim">
        用参照解走同一条工具链（不调 LLM）：全部通过说明工具链与状态引擎对
        「正确的解题者」可行，失败可归因到模型而非 harness。
      </p>
      {checkError && <Alert tone="danger">{checkError}</Alert>}
      {result && (
        <div data-testid="selfcheck-result" className="space-y-2">
          <Alert tone={result.ok ? 'success' : 'danger'}>
            {result.ok
              ? `自检通过：${result.checked} 题的参照解都能经工具链还原，未发现 harness bug。`
              : `自检发现问题：${result.items.filter((item) => !item.ok).length}/${result.checked} 题未通过，工具链或状态引擎存在 bug。`}
          </Alert>
          <Table>
            <thead>
              <tr>
                <Th>task</Th>
                <Th>结果</Th>
                <Th>步数</Th>
                <Th>说明</Th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((item) => (
                <tr key={item.task_id} data-testid="selfcheck-row">
                  <Td>{item.task_id}</Td>
                  <Td>{item.ok ? '✓' : '✗'}</Td>
                  <Td>{item.moves}</Td>
                  <Td>{item.detail || '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
      <Table>
        <thead>
          <tr>
            <Th>task</Th>
            <Th>scramble</Th>
            <Th>depth</Th>
            <Th>reference</Th>
            <Th>kind</Th>
            <Th>bin</Th>
          </tr>
        </thead>
        <tbody>
          {benchmark.tasks.map((task) => (
            <tr key={task.id} data-testid="benchmark-task-row">
              <Td>{task.id}</Td>
              <Td>{task.scramble.join(' ')}</Td>
              <Td>{task.scramble_depth}</Td>
              <Td>{task.reference_length}</Td>
              <Td>{task.reference_kind}</Td>
              <Td>{task.bin}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <div className="flex gap-4 text-sm">
        <Link className="text-accent" to="/benchmarks">
          返回列表
        </Link>
        <Link
          className="text-accent"
          to={`/runs/new?benchmark=${encodeURIComponent(benchmark.id)}`}
        >
          用此题集新建 run
        </Link>
      </div>
    </div>
  )
}

export default function BenchmarkDetailPage() {
  const { id } = useParams()
  const benchmark = useBenchmark(id)
  if (benchmark.isPending) {
    return <PageSkeleton variant="form" fields={4} />
  }
  if (benchmark.error) {
    return <Alert tone="danger">{describeError(benchmark.error)}</Alert>
  }
  if (!benchmark.data) return null
  return (
    <BenchmarkDetailView
      benchmark={benchmark.data}
      onSelfcheck={() => api.benchmarks.selfcheck(benchmark.data!.id)}
    />
  )
}
