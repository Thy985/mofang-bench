import { Link, useParams } from 'react-router-dom'
import { useBenchmark } from '../api/queries'
import { describeError } from '../lib/errors'
import { formatDate } from '../lib/format'
import type { BenchmarkDetail } from '../api/types'
import { Alert } from '../ui/Alert'
import { PageSkeleton } from '../ui/PageSkeleton'
import { Table, Td, Th } from '../ui/Table'

export function BenchmarkDetailView({
  benchmark,
}: {
  benchmark: BenchmarkDetail
}) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{benchmark.name}</h1>
      <p className="text-sm text-text-dim">
        {benchmark.id} · {benchmark.cube} · {benchmark.tasks.length} 题 ·
        hash {benchmark.content_hash} · 冻结{' '}
        {formatDate(benchmark.frozen_at)}
      </p>
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
  return <BenchmarkDetailView benchmark={benchmark.data} />
}
