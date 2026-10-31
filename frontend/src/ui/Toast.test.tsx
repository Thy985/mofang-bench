import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ToastProvider, useToast } from './Toast'

function Fire({ onReady }: { onReady: () => void }) {
  const toast = useToast()
  return (
    <button
      type="button"
      onClick={() => {
        toast.success('已保存')
        toast.error('失败提示')
        onReady()
      }}
    >
      fire
    </button>
  )
}

describe('Toast', () => {
  it('renders success and error toasts via portal', async () => {
    render(
      <ToastProvider>
        <Fire onReady={() => {}} />
      </ToastProvider>,
    )
    await act(async () => {
      screen.getByRole('button', { name: 'fire' }).click()
    })
    const toasts = screen.getAllByTestId('toast')
    expect(toasts).toHaveLength(2)
    expect(screen.getByText('已保存')).toBeInTheDocument()
    expect(screen.getByText('失败提示')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('已保存')
    expect(screen.getByRole('alert')).toHaveTextContent('失败提示')
  })

  it('auto-dismisses after 4s', async () => {
    vi.useFakeTimers()
    try {
      render(
        <ToastProvider>
          <Fire onReady={() => {}} />
        </ToastProvider>,
      )
      await act(async () => {
        screen.getByRole('button', { name: 'fire' }).click()
      })
      expect(screen.getAllByTestId('toast')).toHaveLength(2)
      expect(screen.getByRole('status')).toBeInTheDocument()
      expect(screen.getByRole('alert')).toBeInTheDocument()
      await act(async () => {
        vi.advanceTimersByTime(4100)
      })
      expect(screen.queryByTestId('toast')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
