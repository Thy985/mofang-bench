import type { ProgressPoint } from '../api/types'

export function ProgressChart({
  points,
  maxMoves,
}: {
  points: ProgressPoint[]
  maxMoves: number
}) {
  if (points.length === 0) {
    return <p className="text-xs text-slate-500">暂无进度</p>
  }
  const width = 320
  const height = 120
  const pad = 8
  const maxLength = Math.max(
    1,
    ...points.map((point) => point.length ?? 0),
  )
  const x = (moves: number) =>
    pad +
    (Math.min(moves, maxMoves) / Math.max(1, maxMoves)) *
      (width - pad * 2)
  const y = (length: number) =>
    height - pad - (length / maxLength) * (height - pad * 2)
  const path = points
    .map(
      (point, index) =>
        `${index === 0 ? 'M' : 'L'} ${x(point.moves).toFixed(1)} ${y(
          point.length ?? 0,
        ).toFixed(1)}`,
    )
    .join(' ')
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      role="img"
      aria-label="进度曲线"
    >
      <path
        data-testid="progress-path"
        d={path}
        fill="none"
        stroke="#34d399"
        strokeWidth="2"
      />
    </svg>
  )
}
