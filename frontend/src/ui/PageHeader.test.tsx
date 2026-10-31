import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { PageHeader } from './PageHeader'

describe('PageHeader', () => {
  it('renders title, subtitle, back link and actions', () => {
    render(
      <MemoryRouter>
        <PageHeader
          title="Run abc123"
          subtitle="2x2 depth 1"
          back={{ to: '/runs', label: '返回历史' }}
          actions={<button type="button">导出</button>}
        />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: 'Run abc123' })).toBeInTheDocument()
    expect(screen.getByText('2x2 depth 1')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '返回历史' })).toHaveAttribute(
      'href',
      '/runs',
    )
    expect(screen.getByRole('button', { name: '导出' })).toBeInTheDocument()
  })
})
