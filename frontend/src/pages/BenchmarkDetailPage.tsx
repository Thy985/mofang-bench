import { Link, useParams } from 'react-router-dom'
import { useBenchmark } from '../api/queries'
import { describeError } from '../lib/errors'
import type { BenchmarkDetail } from '../api/types'

export function BenchmarkDetailView({
  benchmark,
}: {
  benchmark: BenchmarkDetail
}) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{benchmark.name}</h1>
      <p className="text-sm text-slate-400">
        {benchmark.id} · {benchmark.cube} · {benchmark.tasks.length} 题 ·
        hash {benchmark.content_hash}
      </p>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-left text-slate-400">
            <th className="py-2">task</th>
            <th>scramble</th>
            <th>depth</th>
            <th>reference</th>
            <th>kind</th>
            <th>bin</th>
          </tr>
        </thead>
        <tbody>
          {benchmark.tasks.map((task) => (
            <tr
              key={task.id}
              data-testid="benchmark-task-row"
              className="border-b border-slate-900"
            >
              <td className="py-2">{task.id}</td>
              <td>{task.scramble.join(' ')}</td>
              <td>{task.scramble_depth}</td>
              <td>{task.reference_length}</td>
              <td>{task.reference_kind}</td>
              <td>{task.bin}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-4 text-sm">
        <Link className="text-emerald-400" to="/benchmarks">
          返回列表
        </Link>
        <Link
          className="text-emerald-400"
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
  if (benchmark.isPending) return <p>加载中…</p>
  if (benchmark.error) {
    return (
      <p role="alert" className="text-rose-300">
        {describeError(benchmark.error)}
      </p>
    )
  }
  if (!benchmark.data) return null
  return <BenchmarkDetailView benchmark={benchmark.data} />
}
