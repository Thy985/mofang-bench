import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PhaseStepper } from './PhaseStepper'

describe('PhaseStepper', () => {
  it('渲染四个阶段节点', () => {
    render(<PhaseStepper phase="thinking" />)
    const stepper = screen.getByTestId('phase-stepper')
    expect(stepper).toHaveTextContent('排队')
    expect(stepper).toHaveTextContent('思考')
    expect(stepper).toHaveTextContent('工具')
    expect(stepper).toHaveTextContent('完成')
  })

  it('当前节点高亮、之前节点打勾、之后节点待定', () => {
    render(<PhaseStepper phase="tooling" />)
    expect(screen.getByTestId('phase-queued')).toHaveAttribute(
      'data-state',
      'done',
    )
    expect(screen.getByTestId('phase-thinking')).toHaveAttribute(
      'data-state',
      'done',
    )
    expect(screen.getByTestId('phase-tooling')).toHaveAttribute(
      'data-state',
      'active',
    )
    expect(screen.getByTestId('phase-done')).toHaveAttribute(
      'data-state',
      'pending',
    )
  })
})
