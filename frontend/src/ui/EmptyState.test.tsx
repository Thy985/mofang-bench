import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from './Button'
import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it('renders title, hint and action', () => {
    render(
      <EmptyState
        title="还没有 run"
        hint="先创建 provider"
        action={<Button>去创建</Button>}
      />,
    )
    expect(screen.getByText('还没有 run')).toBeInTheDocument()
    expect(screen.getByText('先创建 provider')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '去创建' })).toBeInTheDocument()
  })

  it('renders without hint and action', () => {
    render(<EmptyState title="空" />)
    expect(screen.getByText('空')).toBeInTheDocument()
  })

  it('renders optional icon slot above the title', () => {
    render(<EmptyState title="还没有 run" icon={<span data-testid="icon">▣</span>} />)
    const icon = screen.getByTestId('icon')
    const title = screen.getByText('还没有 run')
    expect(icon).toBeInTheDocument()
    expect(
      icon.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('renders no icon slot by default', () => {
    render(<EmptyState title="空" />)
    expect(screen.queryByTestId('icon')).toBeNull()
  })
})
