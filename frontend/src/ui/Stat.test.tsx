import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Stat } from './Stat'

describe('Stat', () => {
  it('renders label, mono value and delta', () => {
    render(<Stat label="tokens" value="1,234" delta="+12" />)
    expect(screen.getByText('tokens')).toBeInTheDocument()
    expect(screen.getByText('1,234')).toHaveClass('font-mono')
    expect(screen.getByText('+12')).toBeInTheDocument()
  })
})
