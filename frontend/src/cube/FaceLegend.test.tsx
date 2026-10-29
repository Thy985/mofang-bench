import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FaceLegend } from './FaceLegend'

describe('FaceLegend', () => {
  it('renders all six faces with letters and swatches', () => {
    render(<FaceLegend />)
    const legend = screen.getByTestId('face-legend')
    expect(legend).toHaveTextContent('U')
    expect(legend).toHaveTextContent('R')
    expect(legend).toHaveTextContent('F')
    expect(legend).toHaveTextContent('D')
    expect(legend).toHaveTextContent('L')
    expect(legend).toHaveTextContent('B')
    expect(legend.querySelectorAll('span[aria-hidden]')).toHaveLength(6)
  })

  it('uses the backend face color mapping', () => {
    render(<FaceLegend />)
    const swatches = screen.getByTestId('face-legend').querySelectorAll(
      'span[aria-hidden]',
    )
    // jsdom 会把 background 简写展开成完整串，无法与 toHaveStyle 直接比较，
    // 因此用 backgroundColor 断言（值与组件里的 background 一致）。
    expect(swatches[0]).toHaveStyle({ backgroundColor: '#f8fafc' }) // U → white
    expect(swatches[1]).toHaveStyle({ backgroundColor: '#ef4444' }) // R → red
    expect(swatches[2]).toHaveStyle({ backgroundColor: '#22c55e' }) // F → green
  })
})
