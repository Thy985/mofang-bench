import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from './Button'
import { Card } from './Card'
import { Input } from './Input'
import { Textarea } from './Textarea'

describe('Button', () => {
  it.each([
    ['primary', 'bg-accent'],
    ['neutral', 'border-line'],
    ['danger', 'border-danger'],
    ['warning', 'border-warning'],
  ] as const)('renders %s variant class', (variant, expected) => {
    render(<Button variant={variant}>go</Button>)
    expect(screen.getByRole('button', { name: 'go' })).toHaveClass(expected)
  })

  it('defaults to neutral and passes through type and disabled', () => {
    render(
      <Button type="submit" disabled>
        保存
      </Button>,
    )
    const button = screen.getByRole('button', { name: '保存' })
    expect(button).toHaveAttribute('type', 'submit')
    expect(button).toBeDisabled()
    expect(button).toHaveClass('border-line')
  })

  it('appends caller className', () => {
    render(<Button className="w-full">go</Button>)
    expect(screen.getByRole('button')).toHaveClass('w-full')
  })
})

describe('Input / Textarea', () => {
  it('applies sunken field styling and value props', () => {
    render(
      <>
        <Input aria-label="名称" defaultValue="x" />
        <Textarea aria-label="extra" defaultValue="{}" rows={2} />
      </>,
    )
    expect(screen.getByLabelText('名称')).toHaveClass('bg-sunken')
    expect(screen.getByLabelText('extra')).toHaveClass('bg-sunken')
  })

  it('appends caller className to Input', () => {
    render(<Input aria-label="q" className="font-mono" />)
    expect(screen.getByLabelText('q')).toHaveClass('font-mono')
  })
})

describe('Card', () => {
  it('renders surface container without padding and keeps testid', () => {
    render(
      <Card className="p-4" data-testid="box">
        内容
      </Card>,
    )
    const card = screen.getByTestId('box')
    expect(card).toHaveClass('bg-surface', 'border-line')
    expect(card).toHaveClass('p-4')
    expect(card).not.toHaveClass('p-3')
    expect(card).toHaveTextContent('内容')
  })
})
