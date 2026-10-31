import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ProgressChart } from './ProgressChart'

describe('ProgressChart', () => {
  it('渲染曲线、上限虚线与终点脉冲', () => {
    render(
      <ProgressChart
        points={[
          { moves: 0, length: 3 },
          { moves: 5, length: 1 },
        ]}
        maxMoves={30}
      />,
    )
    expect(screen.getByTestId('progress-path')).toHaveAttribute(
      'd',
      expect.stringContaining('M'),
    )
    expect(screen.getByTestId('progress-limit')).toHaveAttribute(
      'stroke-dasharray',
      '4 4',
    )
    expect(screen.getByTestId('progress-pulse')).toBeInTheDocument()
    expect(screen.getByText('上限')).toBeInTheDocument()
  })

  it('空数据时显示占位', () => {
    render(<ProgressChart points={[]} maxMoves={30} />)
    expect(screen.getByText('暂无进度')).toBeInTheDocument()
  })
})
