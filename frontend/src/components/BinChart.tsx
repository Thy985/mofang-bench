import type { BinStats } from '../api/types'

// 手写 SVG 条形图（U1 既定不引图表库）：条长 = solve_rate，叠 CI95 须线。
// 尺寸对齐 ProgressChart 先例：固定 viewBox + w-full 自适应。
const WIDTH = 440
const LABEL_WIDTH = 150
const ROW_HEIGHT = 26
const BAR_HEIGHT = 12
const PAD = 8

export function BinChart({ byBin }: { byBin: Record<string, BinStats> }) {
  const bins = Object.entries(byBin)
  if (bins.length === 0) {
    return <p className="text-xs text-text-dim">暂无分箱数据</p>
  }
  const barArea = WIDTH - LABEL_WIDTH - PAD * 2
  const height = PAD * 2 + bins.length * ROW_HEIGHT
  const x = (rate: number) => LABEL_WIDTH + rate * barArea
  return (
    <svg
      data-testid="bin-chart"
      viewBox={`0 0 ${WIDTH} ${height}`}
      className="w-full"
      role="img"
      aria-label="分箱解出率"
    >
      {bins.map(([bin, stats], index) => {
        const y = PAD + index * ROW_HEIGHT
        const barY = y + (ROW_HEIGHT - BAR_HEIGHT) / 2
        const midY = barY + BAR_HEIGHT / 2
        return (
          <g key={bin} data-testid="bin-row">
            <text x={0} y={midY + 3} fontSize="11" fill="#94a3b8">
              {`${bin} · ${stats.solved}/${stats.total}`}
            </text>
            <rect
              x={LABEL_WIDTH}
              y={barY}
              width={Math.max(0, x(stats.solve_rate) - LABEL_WIDTH)}
              height={BAR_HEIGHT}
              className="fill-accent"
            />
            <line
              data-testid="bin-ci"
              x1={x(stats.ci95[0])}
              x2={x(stats.ci95[1])}
              y1={midY}
              y2={midY}
              stroke="#94a3b8"
              strokeWidth="2"
            />
            <line
              x1={x(stats.ci95[0])}
              x2={x(stats.ci95[0])}
              y1={barY + 1}
              y2={barY + BAR_HEIGHT - 1}
              stroke="#94a3b8"
              strokeWidth="2"
            />
            <line
              x1={x(stats.ci95[1])}
              x2={x(stats.ci95[1])}
              y1={barY + 1}
              y2={barY + BAR_HEIGHT - 1}
              stroke="#94a3b8"
              strokeWidth="2"
            />
          </g>
        )
      })}
    </svg>
  )
}
