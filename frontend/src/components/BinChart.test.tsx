import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { BinStats } from '../api/types'
import { BinChart } from './BinChart'

function stats(solveRate: number, ci: [number, number]): BinStats {
  return { total: 4, solved: Math.round(solveRate * 4), solve_rate: solveRate, ci95: ci, mean_moves: 2 }
}

describe('BinChart', () => {
  it('每箱一行，标签含 solved/total，条宽随 solve_rate', () => {
    render(
      <BinChart
        byBin={{
          '1': stats(0.5, [0.1, 0.9]),
          '4-5': stats(1, [0.5, 1]),
        }}
      />,
    )
    const rows = screen.getAllByTestId('bin-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('1 · 2/4')
    expect(rows[1]).toHaveTextContent('4-5 · 4/4')
    const barArea = 440 - 150 - 8 * 2
    const rect = rows[0].querySelector('rect')
    expect(rect).not.toBeNull()
    expect(rect?.getAttribute('width')).toBe(String(0.5 * barArea))
    expect(rows[0].querySelector('[data-testid="bin-ci"]')).not.toBeNull()
  })

  it('空 byBin 出占位文案', () => {
    render(<BinChart byBin={{}} />)
    expect(screen.getByText('暂无分箱数据')).toBeInTheDocument()
  })
})
