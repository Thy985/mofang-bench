import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => [],
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('App routes', () => {
  it('renders the providers page and navigation', () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/providers']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(
      screen.getByRole('heading', { name: 'Providers' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Runs' })).toBeInTheDocument()
  })
})
