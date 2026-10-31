import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PageSkeleton } from './PageSkeleton'

describe('PageSkeleton', () => {
  it('table 变体渲染 rows 行条目', () => {
    render(<PageSkeleton variant="table" rows={3} />)
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThanOrEqual(4)
  })

  it('cards 变体渲染 count 张卡片', () => {
    const { container } = render(<PageSkeleton variant="cards" count={3} />)
    expect(container.querySelectorAll('.grid > .space-y-2')).toHaveLength(3)
  })

  it('form 变体渲染 fields 组字段与按钮条', () => {
    const { container } = render(<PageSkeleton variant="form" fields={4} />)
    expect(container.querySelectorAll('.grid.gap-1')).toHaveLength(4)
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(4)
  })
})
