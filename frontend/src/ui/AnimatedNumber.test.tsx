import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AnimatedNumber } from './AnimatedNumber'

describe('AnimatedNumber', () => {
  it('渲染格式化后的当前值', () => {
    render(<AnimatedNumber value={42} />)
    expect(screen.getByText('42')).toBeInTheDocument()
  })

  it('支持自定义格式化', () => {
    render(
      <AnimatedNumber
        value={1500}
        format={(n) => `${(n / 1000).toFixed(1)}k`}
      />,
    )
    expect(screen.getByText('1.5k')).toBeInTheDocument()
  })

  it('值变化后渲染新值（测试环境动画跳变到终值）', async () => {
    const { rerender } = render(<AnimatedNumber value={1} />)
    rerender(<AnimatedNumber value={7} />)
    await waitFor(() =>
      expect(screen.getByText('7')).toBeInTheDocument(),
    )
  })
})
