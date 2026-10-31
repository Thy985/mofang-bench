import type { ProgressPoint } from '../api/types'

export function ProgressChart({
  points,
  maxMoves,
}: {
  points: ProgressPoint[]
  maxMoves: number
}) {
  if (points.length === 0) {
    return <p className="text-xs text-text-dim">暂无进度</p>
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
  const last = points[points.length - 1]
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      role="img"
      aria-label="进度曲线"
    >
      <line
        data-testid="progress-limit"
        x1={x(maxMoves)}
        x2={x(maxMoves)}
        y1={pad}
        y2={height - pad}
        stroke="#475569"
        strokeDasharray="4 4"
      />
      <text
        x={x(maxMoves)}
        y={pad + 10}
        textAnchor="middle"
        fill="#94a3b8"
        fontSize="9"
      >
        上限
      </text>
      <path
        data-testid="progress-path"
        d={path}
        fill="none"
        stroke="#34d399"
        strokeWidth="2"
      />
      <circle
        data-testid="progress-pulse"
        cx={x(last.moves)}
        cy={y(last.length ?? 0)}
        r="4"
        className="animate-pulse-ring fill-emerald-300/60"
      />
    </svg>
  )
}
