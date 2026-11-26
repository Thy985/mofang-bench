import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './Button'
import { Card } from './Card'
import { Input } from './Input'
import { Textarea } from './Textarea'
import { Select } from './Select'
import { Alert } from './Alert'
import { Skeleton } from './Skeleton'
import { Spinner } from './Spinner'
import { Table, Td, Th, Tr } from './Table'

describe('Button', () => {
  it.each([
    ['primary', 'bg-accent'],
    ['secondary', 'border-line'],
    ['ghost', 'text-text-dim'],
    ['danger', 'border-danger'],
    ['warning', 'border-warning'],
  ] as const)('renders %s variant class', (variant, expected) => {
    render(<Button variant={variant}>go</Button>)
    expect(screen.getByRole('button', { name: 'go' })).toHaveClass(expected)
  })

  it('primary 实心 lime 深字（P0）', () => {
    render(<Button variant="primary">go</Button>)
    const button = screen.getByRole('button', { name: 'go' })
    expect(button).toHaveClass('rounded-md')
    expect(button).toHaveClass('text-on-accent')
  })

  it('defaults to secondary and passes through type and disabled', () => {
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

  it('size sm renders smaller padding and text', () => {
    render(<Button size="sm">go</Button>)
    expect(screen.getByRole('button', { name: 'go' })).toHaveClass('px-2.5')
    expect(screen.getByRole('button', { name: 'go' })).toHaveClass('text-xs')
  })

  it('loading shows spinner, disables and blocks clicks', async () => {
    const onClick = vi.fn()
    render(
      <Button loading onClick={onClick}>
        提交
      </Button>,
    )
    const button = screen.getByRole('button', { name: '提交' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button.querySelector('[role="status"]')).not.toBeNull()
    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('renders focus-visible accent ring class', () => {
    render(<Button>go</Button>)
    expect(screen.getByRole('button')).toHaveClass('focus-visible:outline-accent')
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

describe('Input label/error', () => {
  // 恒定 wrapper（与 Select 同一裁决）：无 label/error 时也渲染包裹 div，
  // error 出现/消失不增删这层 div，避免 React 替换 input DOM 导致焦点丢失。
  it('always renders a wrapper even without label or error', () => {
    render(<Input aria-label="q" />)
    const input = screen.getByLabelText('q')
    expect(input.tagName).toBe('INPUT')
    expect(input.closest('div')).not.toBeNull()
    expect(input).not.toHaveAttribute('aria-invalid')
  })

  it('wraps with label and error text and sets aria-invalid', () => {
    render(<Input label="名称" error="必填" />)
    expect(screen.getByText('名称')).toBeInTheDocument()
    expect(screen.getByText('必填')).toBeInTheDocument()
    expect(screen.getByLabelText('名称')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('名称')).toHaveClass('border-danger')
  })
})

describe('Select', () => {
  it('wraps with label and renders options', () => {
    render(
      <Select label="速度" defaultValue="1">
        <option value="1">1×</option>
        <option value="2">2×</option>
      </Select>,
    )
    expect(screen.getByLabelText('速度').tagName).toBe('SELECT')
    expect(screen.getByRole('option', { name: '2×' })).toBeInTheDocument()
  })

  it('shows error tone', () => {
    render(
      <Select aria-label="s" error="必选">
        <option>1</option>
      </Select>,
    )
    expect(screen.getByLabelText('s')).toHaveClass('border-danger')
  })

  // 恒定 wrapper（与 Input/Textarea 同一裁决）：error 出现/消失时包裹 div
  // 不增删，否则 React 会替换 select DOM 节点导致焦点丢失。
  it('keeps the wrapper div even without label or error', () => {
    render(
      <Select aria-label="s" defaultValue="1">
        <option value="1">1</option>
      </Select>,
    )
    const select = screen.getByLabelText('s')
    expect(select.closest('div')).not.toBeNull()
    expect(select).not.toHaveAttribute('aria-invalid')
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
    expect(card).toHaveClass('bg-surface-2', 'border-line')
    expect(card).toHaveClass('p-4')
    expect(card).not.toHaveClass('p-3')
    expect(card).toHaveTextContent('内容')
  })
})

describe('Alert', () => {
  it('renders role=alert with danger tone by default', () => {
    render(<Alert>boom</Alert>)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('boom')
    expect(alert).toHaveClass('border-danger', 'text-rose-300')
  })

  it('renders info tone', () => {
    render(<Alert tone="info">note</Alert>)
    expect(screen.getByRole('alert')).toHaveClass('border-line', 'bg-surface')
  })
})

describe('Table', () => {
  it('renders th/td with converged styles', () => {
    render(
      <Table>
        <thead>
          <tr>
            <Th>列</Th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <Td>值</Td>
          </tr>
        </tbody>
      </Table>,
    )
    expect(screen.getByRole('columnheader', { name: '列' })).toHaveClass(
      'text-text-dim',
      'border-line',
    )
    expect(screen.getByRole('cell', { name: '值' })).toHaveClass('border-line/50')
  })
})

describe('Table sticky header', () => {
  it('Th is sticky with surface-2 background', () => {
    render(
      <table>
        <thead>
          <tr>
            <Th>粘性</Th>
          </tr>
        </thead>
      </table>,
    )
    expect(screen.getByRole('columnheader', { name: '粘性' })).toHaveClass(
      'sticky',
      'top-0',
      'bg-surface-2',
    )
  })
})

describe('Table row hover', () => {
  it('Tr renders hover transition class', () => {
    render(
      <table>
        <tbody>
          <Tr data-testid="row">
            <Td>cell</Td>
          </Tr>
        </tbody>
      </table>,
    )
    expect(screen.getByTestId('row')).toHaveClass('hover:bg-surface')
  })
})

describe('Skeleton / Spinner', () => {
  it('renders pulse skeleton and spinning status', () => {
    render(
      <>
        <Skeleton className="h-4 w-full" />
        <Spinner />
      </>,
    )
    expect(screen.getByTestId('skeleton')).toHaveClass('animate-pulse')
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', '加载中')
  })

  it('passes through rest props such as aria-hidden while keeping role=status', () => {
    render(<Spinner aria-hidden data-testid="busy" />)
    const spinner = screen.getByTestId('busy')
    expect(spinner).toHaveAttribute('aria-hidden', 'true')
    expect(spinner).toHaveAttribute('role', 'status')
  })
})
